// ============================================================================
// TESTS — rekenkern
// ----------------------------------------------------------------------------
// Referentiecases uit echte ontwerpdiscussies. Draai met: npm test
// Gebruikt Node's ingebouwde test runner (node --test) — geen dependencies.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vocAtTemp,
  stringVocStc,
  tempAtMaxVoltage,
  minFuse,
  checkConfig,
  allPass,
  findMatchingInverters,
  checkLegplanMulti,
  autoAssign,
  autoAssignFleet,
  canShareMppt,
  DEFAULT_AZIMUTH_TOLERANCE,
  DEFAULT_TILT_TOLERANCE,
  checkLegplan,
  distributeCounts,
  buildStringsFromRoofFaces,
  distributeSlotsEvenly,
  splitIntoEqualMpptStrings,
  splitGroupOverMppts,
  allocateGroupsToMppts,
  splitClusterIntoStrings,
  findMatchingInvertersForFaces,
  stringLengthRange,
  maxPhaseCurrent,
  inverterPhases,
  mpptCapacity,
  totalMpptSlots,
  minMpptCapacity,
  voltageDropPct,
  requiredCableCrossSection,
  checkAcCable,
  CABLE_AMPACITY_CU_PVC,
  VOLTAGE_DROP_MAX_PCT,
  OVERDIM_MIN,
} from "../src/core/calculations.js";

// Referentiepaneel: JA Solar JAM54D41-430/GB
const JA430 = { id: "JAM54D41-430/GB", wp: 430, voc: 38.32, vmp: 32.21, isc: 14.23, imp: 13.35, betaVoc: -0.26 };
// Tweede paneeltype, alleen voor "verschillend moduletype mag nooit samen op
// één MPPT"-tests — elektrisch verder irrelevant welke waarden dit zijn.
const LONGI540 = { id: "LR7-60HVH-540M", wp: 540, voc: 49.9, vmp: 41.9, isc: 13.9, imp: 12.9, betaVoc: -0.25 };

// Referentieomvormers
const T20 = { id: "SMILE-G3-T20", vmax: 1000, vmpptMin: 200, vmpptMax: 850, imppt: 18, isc: 22.5, nMppt: 3, stringsPerMppt: 1, pmax: 40000, pacNom: 20000, iacMax: 32.0, isGoodwe: false };
const SUN100 = { id: "SUN2000-100KTL-M2", vmax: 1100, vmpptMin: 200, vmpptMax: 1000, imppt: 30, isc: 40, nMppt: 10, stringsPerMppt: 2, pmax: 150000, pacNom: 100000, iacMax: 160.4, isGoodwe: false };
const GW_SDT40 = { id: "GW40K-SDT-P30", vmax: 1100, vmpptMin: 140, vmpptMax: 1000, imppt: 40, isc: 56, nMppt: 4, stringsPerMppt: 2, pmax: 72000, pacNom: 40000, iacMax: 60.6, isGoodwe: true };

// Asymmetrische omvormer: 2 MPPT's met ongelijke capaciteit — MPPT 1 kan
// maar 1 string aan, MPPT 2 kan er 2 aan. Referentiecase: Bas kon dit soort
// omvormer eerst niet invoeren omdat stringsPerMppt altijd één uniform getal
// moest zijn (2026-07-24).
const ASYM = { id: "ASYM-TEST-2K", vmax: 600, vmpptMin: 80, vmpptMax: 550, imppt: 30, isc: 32, nMppt: 2, stringsPerMppt: [1, 2], pmax: 20000, pacNom: 6000, iacMax: 15, isGoodwe: false };

// --- Temperatuurcorrectie ---------------------------------------------------

test("Voc stijgt bij koude", () => {
  const cold = vocAtTemp(JA430.voc, JA430.betaVoc, -10);
  assert.ok(cold > JA430.voc, "Voc bij -10°C moet hoger zijn dan STC");
  // -10°C: 38,32 × (1 + 0,0026×35) ≈ 41,8 V
  assert.ok(Math.abs(cold - 41.8) < 0.2, `verwacht ~41,8 V, kreeg ${cold.toFixed(2)}`);
});

test("stringVocStc: Voc STC voor een string van 19 panelen", () => {
  assert.equal(stringVocStc(JA430, 19), 19 * 38.32);
});

test("26 panelen STC past net (<1000V), bij koude niet", () => {
  const stc = JA430.voc * 26;            // 996,3 V
  assert.ok(stc < 1000, "26× bij STC moet onder 1000 V");
  const cold = vocAtTemp(JA430.voc, JA430.betaVoc, -10) * 26;  // ~1087 V
  assert.ok(cold > 1000, "26× bij -10°C moet boven 1000 V");
});

test("grens-temperatuur 26-string ligt net onder kamertemperatuur", () => {
  const tGrens = tempAtMaxVoltage(JA430.voc, JA430.betaVoc, 26, 1000);
  // marge is 3,7 V op STC → grens ligt rond +23,6°C
  assert.ok(tGrens > 22 && tGrens < 25, `verwacht ~23,6°C, kreeg ${tGrens.toFixed(1)}`);
});

// --- Afzekering -------------------------------------------------------------

test("minimale afzekering = iacMax × 1,25 → standaardzekering", () => {
  assert.equal(minFuse(32.0), 40);   // 32×1,25 = 40,0 → 40A bestaat → 40
  assert.equal(minFuse(31.9), 40);   // 31,9×1,25 = 39,875 → 40
  assert.equal(minFuse(160.4), 250); // 160,4×1,25 = 200,5 → 250
});

// --- Enkele config-check ----------------------------------------------------

test("25 panelen op T20 past bij STC-achtige temp", () => {
  const checks = checkConfig({ panel: JA430, inverter: T20, nPerString: 25, stringsPerMppt: 1, tMinCold: 0, tMaxHot: 70 });
  // bij 0°C: 25×38,32×(1+0,0026×25) ≈ 1020 V → Voc-check faalt
  const vocCheck = checks.find((c) => c.key === "vocCold");
  assert.ok(!vocCheck.pass, "25× bij 0°C overschrijdt 1000 V");
});

test("23 panelen op T20 past bij -10°C", () => {
  const checks = checkConfig({ panel: JA430, inverter: T20, nPerString: 23, stringsPerMppt: 1, tMinCold: -10, tMaxHot: 70 });
  const vocCheck = checks.find((c) => c.key === "vocCold");
  assert.ok(vocCheck.pass, "23× bij -10°C moet onder 1000 V blijven");
});

test("2 parallelle strings op T20 overschrijden stroom", () => {
  const checks = checkConfig({ panel: JA430, inverter: T20, nPerString: 19, stringsPerMppt: 2, tMinCold: -10, tMaxHot: 70 });
  const impCheck = checks.find((c) => c.key === "imp");
  // 2×13,35 = 26,7 A > 18 A
  assert.ok(!impCheck.pass, "2 parallelle strings overschrijden 18 A/MPPT");
  // en de strings-per-MPPT check faalt ook (T20 = 1 string/MPPT)
  const strCheck = checks.find((c) => c.key === "strings");
  assert.ok(!strCheck.pass);
});

// --- Omvormer zoeken --------------------------------------------------------

test("1400 panelen → ~5× SUN2000-100KTL in band", () => {
  const res = findMatchingInverters({ panel: JA430, totalPanels: 1400, tMinCold: -10, tMaxHot: 70, inverters: [SUN100] });
  assert.equal(res.length, 1);
  assert.equal(res[0].invCount, 5, "verwacht 5 omvormers");
  assert.ok(res[0].inBand, "overdimensionering moet in 120-150% band");
  assert.ok(res[0].dcAcRatio >= 1.2 && res[0].dcAcRatio <= 1.5);
});

test("fixedInvCount: 1400 panelen geforceerd op 7 omvormers (meer dan het optimale minimum van 5)", () => {
  const res = findMatchingInverters({ panel: JA430, totalPanels: 1400, tMinCold: -10, tMaxHot: 70, inverters: [SUN100], fixedInvCount: 7 });
  assert.equal(res.length, 1);
  assert.equal(res[0].invCount, 7, "moet het opgegeven vaste aantal gebruiken, niet het geoptimaliseerde minimum");
  assert.ok(!res[0].inBand, "7 omvormers voor 1400 panelen zit onder de 120-150%-band");
  assert.ok(res[0].dcAcRatio < OVERDIM_MIN);
});

test("fixedInvCount: te weinig omvormers voor het aantal panelen levert geen match op", () => {
  const res = findMatchingInverters({ panel: JA430, totalPanels: 1400, tMinCold: -10, tMaxHot: 70, inverters: [SUN100], fixedInvCount: 1 });
  assert.equal(res.length, 0, "1400 panelen past niet op 1 SUN2000-100KTL, ongeacht stringlengte");
});

test("GoodWe wordt boven gelijkwaardige niet-GoodWe gesorteerd", () => {
  const res = findMatchingInverters({ panel: JA430, totalPanels: 200, tMinCold: -10, tMaxHot: 70, inverters: [SUN100, GW_SDT40] });
  // GoodWe moet eerst staan als beide passen
  if (res.length === 2) {
    assert.ok(res[0].inverter.isGoodwe, "GoodWe hoort bovenaan");
  }
});

test("optimalisatie kiest minste omvormers binnen band", () => {
  // 300 panelen op GW40K: check dat het niet onnodig veel units pakt
  const res = findMatchingInverters({ panel: JA430, totalPanels: 300, tMinCold: -10, tMaxHot: 70, inverters: [GW_SDT40] });
  assert.equal(res.length, 1);
  // 300×430 = 129 kWp; bij 40kW AC → minstens ceil(129/60)=3 op power, of band
  assert.ok(res[0].invCount >= 2, "moet meerdere omvormers zijn voor 129 kWp op 40kW");
});

test("hoge overdimensionering toegestaan zolang DC onder pmax blijft", () => {
  // T20: pmax 40kW, pacNom 20kW → tot 200% toegestaan. Een systeem dat op
  // één omvormer past boven 150% moet NIET kunstmatig naar 2 omvormers gaan.
  // 69 panelen (3×23) = 29,67 kWp op 20kW AC = 148%, past op 1 omvormer.
  const res = findMatchingInverters({ panel: JA430, totalPanels: 69, tMinCold: -10, tMaxHot: 70, inverters: [T20] });
  assert.equal(res.length, 1);
  assert.equal(res[0].invCount, 1, "69 panelen passen op 1 T20, niet kunstmatig opsplitsen");
  // DC-vermogen blijft onder pmax (40kW)
  assert.ok(res[0].totalWp <= T20.pmax, "DC-vermogen moet onder pmax blijven");
});

// --- Legplan multi ----------------------------------------------------------

test("legplan van 83 strings → 5× SUN2000-100KTL", () => {
  const strings = Array.from({ length: 83 }, () => ({ n: 17, panel: JA430, azimuth: 180, helling: 10 }));
  const m = checkLegplanMulti(strings, SUN100, -10, 70);
  assert.ok(m.pass, "legplan moet passen");
  assert.equal(m.invCount, 5, "83 strings ÷ 20/omvormer → 5 omvormers");
});

test("legplan met te lange strings faalt op spanning", () => {
  const strings = [{ n: 28, panel: JA430, azimuth: 180, helling: 10 }];
  const m = checkLegplanMulti(strings, T20, -10, 70);
  // 28× bij -10°C ver boven 1000 V
  assert.ok(!m.pass, "28-paneel string moet falen op Voc");
});

// --- Legplan per MPPT --------------------------------------------------------

test("checkLegplan: gelijke oriëntatie op één MPPT past, gemengd wordt niet ten onrechte gemarkeerd", () => {
  const strings = [
    { n: 19, panel: JA430, azimuth: 180 },
    { n: 19, panel: JA430, azimuth: 180 },
    { n: 19, panel: JA430, azimuth: 90 },
  ];
  const assignment = autoAssign(strings, SUN100);
  const result = checkLegplan(strings, SUN100, assignment, -10, 70);
  assert.ok(result.pass, "legplan moet passen op SUN2000-100KTL-M2");

  const mpptWithTwo = result.mpptResults.find((m) => m.strings.length === 2);
  assert.ok(mpptWithTwo, "twee strings met dezelfde azimuth moeten samen op één MPPT staan");
  assert.equal(mpptWithTwo.mixed, false, "zelfde azimuth mag niet als gemengd gemarkeerd worden");

  const impCheck = mpptWithTwo.checks.find((c) => c.key === "imp");
  assert.ok(Math.abs(impCheck.value - 2 * JA430.imp) < 0.01, "Imp moet de som zijn van beide parallelle strings");
});

test("checkLegplan werkt ook met een handmatig opgebouwde (niet-autoAssign) toewijzing", () => {
  // Configuratie checken bouwt de assignment direct op uit een vaste per-MPPT
  // grid, in plaats van via autoAssign. checkLegplan moet daar net zo goed
  // mee werken, want hij raakt alleen assignment.mppts/overflow aan.
  const strings = [
    { n: 23, panel: JA430, azimuth: 180 },
    { n: 23, panel: JA430, azimuth: 180 },
  ];
  const assignment = { mppts: [[0, 1], []], overflow: false };
  const result = checkLegplan(strings, SUN100, assignment, -10, 70);
  assert.ok(result.pass, "2× 23-paneel strings op één MPPT moeten passen op SUN2000-100KTL-M2 (max 2/MPPT)");

  const filledMppt = result.mpptResults.find((m) => m.mpptNum === 0);
  assert.equal(filledMppt.strings.length, 2, "beide strings horen op MPPT 1 te staan");
  const emptyMppt = result.mpptResults.find((m) => m.mpptNum === 1);
  assert.equal(emptyMppt.empty, true, "MPPT 2 moet als leeg gemarkeerd worden");
  assert.equal(emptyMppt.pass, true, "een lege MPPT faalt niet");
});

// --- Asymmetrische MPPT-capaciteit (ongelijke trackers) ---------------------

test("mpptCapacity/totalMpptSlots/minMpptCapacity: asymmetrische vs. uniforme omvormer", () => {
  assert.equal(mpptCapacity(ASYM, 0), 1);
  assert.equal(mpptCapacity(ASYM, 1), 2);
  assert.equal(totalMpptSlots(ASYM), 3);
  assert.equal(minMpptCapacity(ASYM), 1);
  // Uniforme omvormers (scalar stringsPerMppt) blijven ongewijzigd werken.
  assert.equal(mpptCapacity(T20, 0), 1);
  assert.equal(totalMpptSlots(T20), 3);
  assert.equal(minMpptCapacity(SUN100), 2);
});

test("checkLegplan: asymmetrische omvormer laat 2 strings toe op MPPT 2, niet op MPPT 1", () => {
  const strings = [
    { n: 10, panel: JA430, azimuth: 180 },
    { n: 10, panel: JA430, azimuth: 180 },
  ];
  const badAssignment = { mppts: [[0, 1], []], overflow: false };
  const badResult = checkLegplan(strings, ASYM, badAssignment, -10, 70);
  const badStringsCheck = badResult.mpptResults[0].checks.find((c) => c.key === "strings");
  assert.ok(!badStringsCheck.pass, "MPPT 1 mag maar 1 string aan");

  const goodAssignment = { mppts: [[], [0, 1]], overflow: false };
  const goodResult = checkLegplan(strings, ASYM, goodAssignment, -10, 70);
  assert.ok(goodResult.pass, "MPPT 2 kan wel 2 strings aan");
});

test("autoAssign: vult de MPPT met capaciteit 1 eerst, de rest gaat naar de MPPT met capaciteit 2", () => {
  const strings = Array.from({ length: 3 }, () => ({ n: 10, panel: JA430, azimuth: 180 }));
  const result = autoAssign(strings, ASYM);
  assert.equal(result.overflow, false);
  assert.equal(result.mppts[0].length, 1, "MPPT 1 (capaciteit 1) mag er maar 1 krijgen");
  assert.equal(result.mppts[1].length, 2, "de overige 2 gaan naar MPPT 2 (capaciteit 2)");
});

test("autoAssign: strings met ongelijke lengte mogen nooit samen op één MPPT (elektrisch ongeldig)", () => {
  // Referentiecase (2026-08-07): "Gebruiken in Ontwerp checken" leverde voor
  // GW25K-SDT-30 (2 strings/MPPT) een voorstel met 22+21 panelen samen op
  // MPPT 1 — ongelijke strings parallel op één MPPT kan niet. De twee
  // 21-panelen-strings moeten samen op één MPPT komen, de 22 moet alleen
  // staan (desnoods met een lege tweede slot).
  const strings = [
    { n: 22, panel: JA430, azimuth: 180 },
    { n: 21, panel: JA430, azimuth: 180 },
    { n: 21, panel: JA430, azimuth: 180 },
  ];
  const result = autoAssign(strings, GW_SDT40); // 4 MPPT × 2 strings/MPPT
  assert.equal(result.overflow, false);
  for (const mppt of result.mppts) {
    const lengths = new Set(mppt.map((si) => strings[si].n));
    assert.ok(lengths.size <= 1, `strings op één MPPT moeten gelijke lengte hebben, kreeg ${[...lengths]}`);
  }
  const pairedMppt = result.mppts.find((m) => m.length === 2);
  assert.ok(pairedMppt, "de twee 21-panelen strings moeten samen op één MPPT komen");
  assert.deepEqual(pairedMppt.map((si) => strings[si].n).sort(), [21, 21]);
});

test("autoAssignFleet: strings met ongelijke lengte mogen nooit samen op één MPPT", () => {
  const strings = [
    { n: 22, panel: JA430, azimuth: 180 },
    { n: 21, panel: JA430, azimuth: 180 },
    { n: 21, panel: JA430, azimuth: 180 },
  ];
  const units = [{ inverter: GW_SDT40 }];
  const result = autoAssignFleet(strings, units);
  assert.equal(result.overflow, false);
  for (const mppt of result.units[0]) {
    const lengths = new Set(mppt.map((si) => strings[si].n));
    assert.ok(lengths.size <= 1, `strings op één MPPT moeten gelijke lengte hebben, kreeg ${[...lengths]}`);
  }
});

// --- Gemengde MPPT's binnen instelbare oriëntatie/helling-tolerantie --------
// (2026-09-18, op verzoek: mengen mag, binnen grenzen, i.p.v. nooit)

test("canShareMppt: azimuth binnen tolerantie (incl. 360°-wrap) mag delen, erbuiten niet", () => {
  const a = { n: 19, panelId: "P", azimuth: 350, helling: 20 };
  assert.equal(canShareMppt(a, { ...a, azimuth: 10 }, { azimuthTol: 20 }), true, "350° en 10° liggen 20° uit elkaar (via de wrap), niet 340°");
  assert.equal(canShareMppt(a, { ...a, azimuth: 320 }, { azimuthTol: 20 }), false, "30° verschil (350° t.o.v. 320°) is buiten een tolerantie van 20°");
});

test("canShareMppt: helling binnen tolerantie mag delen, erbuiten niet", () => {
  const a = { n: 19, panelId: "P", azimuth: 180, helling: 15 };
  assert.equal(canShareMppt(a, { ...a, helling: 24 }, { tiltTol: 10 }), true);
  assert.equal(canShareMppt(a, { ...a, helling: 26 }, { tiltTol: 10 }), false);
});

test("canShareMppt: verschillend paneeltype of aantal panelen mag nooit delen, ongeacht tolerantie", () => {
  const a = { n: 19, panelId: "A", azimuth: 180, helling: 20 };
  assert.equal(canShareMppt(a, { ...a, panelId: "B" }, { azimuthTol: 360, tiltTol: 90 }), false, "ander moduletype blijft hard geblokkeerd, ook bij (onrealistisch) ruime tolerantie");
  assert.equal(canShareMppt(a, { ...a, n: 18 }, { azimuthTol: 360, tiltTol: 90 }), false, "ander aantal panelen blijft hard geblokkeerd");
});

test("autoAssign: twee dakvlakken met licht afwijkende azimuth/helling delen nu bewust één MPPT (binnen default tolerantie)", () => {
  // Twee vlakken van 19 panelen, beide 'vrijwel zuid' maar niet identiek
  // (176° vs 184°, 18° vs 22°) — binnen de default 20°/10°-tolerantie.
  const strings = [
    { n: 19, panel: JA430, azimuth: 176, helling: 18 },
    { n: 19, panel: JA430, azimuth: 184, helling: 22 },
  ];
  const result = autoAssign(strings, GW_SDT40); // 2 strings/MPPT
  assert.equal(result.overflow, false);
  const paired = result.mppts.find((m) => m.length === 2);
  assert.ok(paired, "beide vlakken vallen binnen tolerantie en moeten samen op één MPPT komen");
});

test("autoAssign: azimuthverschil buiten tolerantie mag nooit gemengd worden, ook al is er verder plek", () => {
  const strings = [
    { n: 19, panel: JA430, azimuth: 90 },
    { n: 19, panel: JA430, azimuth: 270 },
  ];
  const result = autoAssign(strings, GW_SDT40, { azimuthTol: 20, tiltTol: 10 });
  assert.equal(result.overflow, false);
  for (const mppt of result.mppts) {
    assert.ok(mppt.length <= 1, "oost (90°) en west (270°) liggen ver buiten tolerantie en mogen nooit één MPPT delen");
  }
});

test("autoAssign: aangepaste (ruimere) tolerantie laat een grotere azimuth-mix toe dan de default", () => {
  const strings = [
    { n: 19, panel: JA430, azimuth: 150 },
    { n: 19, panel: JA430, azimuth: 210 },
  ];
  const defaultResult = autoAssign(strings, GW_SDT40);
  assert.ok(defaultResult.mppts.every((m) => m.length <= 1), "60° verschil zit buiten de default tolerantie van 20°");
  const wideResult = autoAssign(strings, GW_SDT40, { azimuthTol: 60, tiltTol: 10 });
  assert.ok(wideResult.mppts.some((m) => m.length === 2), "met een ingestelde tolerantie van 60° moeten ze wél samen kunnen");
});

test("checkLegplan: valt terug op falen als een handmatige toewijzing ongelijke strings op één MPPT zet", () => {
  // autoAssign zou dit nooit produceren, maar echt-handmatige invoer kan dit
  // wel — checkLegplan moet dit dan als falende check signaleren, niet
  // stilzwijgend doorrekenen.
  const strings = [
    { n: 19, panel: JA430, azimuth: 180 },
    { n: 19, panel: LONGI540, azimuth: 180 },
  ];
  const assignment = { mppts: [[0, 1]], overflow: false };
  const inverterOneMppt = { ...GW_SDT40, nMppt: 1 };
  const result = checkLegplan(strings, inverterOneMppt, assignment, -10, 70);
  const eq = result.mpptResults[0].checks.find((c) => c.key === "equalStrings");
  assert.ok(eq, "de nieuwe gelijkheids-check moet aanwezig zijn zodra er >1 string op een MPPT staat");
  assert.equal(eq.pass, false, "twee verschillende paneeltypen op één MPPT moet falen");
  assert.equal(result.pass, false);
});

// --- Vloot van omvormer-eenheden (multi-omvormer, echte mix) -----------------

test("autoAssignFleet: 2 eenheden van hetzelfde type — gelijkmatig over beide verdeeld", () => {
  // Was: eenheid na eenheid vullen (eerste vol, dan pas de tweede). Bij een
  // bewust gekozen omvormerpark moeten alle eenheden gelijk belast worden
  // (testlead 1234, 2026-10-02: laatste omvormers bleven leeg).
  const strings = Array.from({ length: 4 }, () => ({ n: 19, panel: JA430, azimuth: 180 }));
  const units = [{ inverter: T20 }, { inverter: T20 }]; // elk 3 MPPT × 1 string/MPPT
  const result = autoAssignFleet(strings, units);
  assert.equal(result.overflow, false);
  assert.equal(result.units[0].flat().length, 2);
  assert.equal(result.units[1].flat().length, 2);
});

test("autoAssignFleet: echte mix van twee verschillende omvormertypen, belasting naar verhouding van pacNom", () => {
  // T20 (20 kW, 3 MPPT × 1) + GW40K (40 kW, 4 MPPT × 2): de GW40K hoort
  // ruwweg twee keer zoveel strings te krijgen.
  const strings = Array.from({ length: 6 }, () => ({ n: 19, panel: JA430, azimuth: 90 }));
  const units = [{ inverter: T20 }, { inverter: GW_SDT40 }];
  const result = autoAssignFleet(strings, units);
  assert.equal(result.overflow, false);
  assert.equal(result.units[0].flat().length, 2, "T20 krijgt 2 strings");
  assert.equal(result.units[1].flat().length, 4, "GW40K krijgt 4 strings");
  for (const m of result.units[1]) assert.ok(m.length === 0 || m.length === 2, "strings op de GW40K in paren per MPPT");
});

test("autoAssignFleet: gebalanceerd vullen mag nooit overflow veroorzaken die sequentieel niet had", () => {
  // 6×13 + 2×12 op 2 eenheden × 2 MPPT × 2 = precies 8 slots: alleen te
  // plaatsen als de 13-ers in paren blijven.
  const INV22 = { id: "TEST-2x2", nMppt: 2, stringsPerMppt: 2, pacNom: 10000 };
  const strings = [...Array(6).fill(13), ...Array(2).fill(12)].map((n) => ({ n, panel: JA430, azimuth: 180 }));
  const result = autoAssignFleet(strings, [{ inverter: INV22 }, { inverter: INV22 }]);
  assert.equal(result.overflow, false);
  for (const u of result.units) for (const m of u) assert.equal(new Set(m.map((i) => strings[i].n)).size, 1);
});

test("autoAssignFleet: overflow wanneer de vloot te klein is voor het aantal strings", () => {
  const strings = Array.from({ length: 4 }, () => ({ n: 19, panel: JA430, azimuth: 180 }));
  const units = [{ inverter: T20 }]; // maar 3 slots
  const result = autoAssignFleet(strings, units);
  assert.equal(result.overflow, true, "4 strings passen niet op 3 slots");
});

// Referentiecase: 1252-panelen-project (LONGi 540 Wp / GoodWe SDT-C30),
// besproken 2026-07-17. distributeCounts moet dezelfde stringverdeling geven
// als het handmatige ontwerp: 111 panelen over 6 strings → 19/19/19/18/18/18.
test("distributeCounts: 111 panelen over 6 strings (Mevlana-omvormer)", () => {
  assert.deepEqual(distributeCounts(111, 6), [19, 19, 19, 18, 18, 18]);
});

test("distributeCounts: 102 panelen over 6 strings (Ameco-omvormer, exact deelbaar)", () => {
  assert.deepEqual(distributeCounts(102, 6), [17, 17, 17, 17, 17, 17]);
});

test("distributeCounts: 89 panelen over 6 strings (Emin Chicken-omvormer)", () => {
  assert.deepEqual(distributeCounts(89, 6), [15, 15, 15, 15, 15, 14]);
});

// --- Dakvlak → strings (Indeling: voorstel zonder vooraf bepaalde strings) --

test("buildStringsFromRoofFaces: één dakvlak, 111 panelen bij 19 per string → 6 strings 19/19/19/18/18/18", () => {
  const strings = buildStringsFromRoofFaces([{ count: 111, azimuth: 180, helling: 35 }], 19);
  assert.deepEqual(strings.map((s) => s.n).sort((a, b) => b - a), [19, 19, 19, 18, 18, 18]);
  assert.equal(strings.reduce((s, x) => s + x.n, 0), 111, "totaal aantal panelen moet behouden blijven");
  assert.ok(strings.every((s) => s.azimuth === 180 && s.helling === 35), "azimuth/helling van het dakvlak moet op elke string staan");
});

test("buildStringsFromRoofFaces: meerdere dakvlakken worden onafhankelijk verdeeld", () => {
  const strings = buildStringsFromRoofFaces(
    [
      { count: 40, azimuth: 90, helling: 10 },
      { count: 21, azimuth: 270, helling: 10 },
    ],
    20
  );
  const az90 = strings.filter((s) => s.azimuth === 90);
  const az270 = strings.filter((s) => s.azimuth === 270);
  assert.equal(az90.reduce((s, x) => s + x.n, 0), 40);
  assert.equal(az270.reduce((s, x) => s + x.n, 0), 21);
  assert.deepEqual(az90.map((s) => s.n), [20, 20], "40 panelen bij 20/string past exact in 2 strings");
  assert.equal(az270.length, 2, "21 panelen bij max 20/string moet 2 strings worden (11/10 of gelijkwaardig)");
});

test("distributeSlotsEvenly: één groep gebruikt alle beschikbare slots (referentiecase GW25K-SDT-30)", () => {
  // 64 panelen, max 26/string (Voc-veilig), 6 beschikbare MPPT-slots (3
  // MPPT × 2 strings) — moet alle 6 slots gebruiken i.p.v. het minimum van 3.
  const res = distributeSlotsEvenly([{ count: 64, maxPerString: 26 }], 6);
  assert.equal(res[0].slots, 6, "alle 6 beschikbare slots moeten gebruikt worden");
  assert.deepEqual(distributeCounts(res[0].count, res[0].slots), [11, 11, 11, 11, 10, 10]);
});

test("distributeSlotsEvenly: twee groepen convergeren naar gelijke gemiddelde stringlengte", () => {
  // 60 en 20 panelen, ruime maxPerString (niet beperkend), 8 slots totaal —
  // eerlijke verdeling geeft exact 6:2 slots → 10 panelen/string in beide groepen.
  const res = distributeSlotsEvenly(
    [
      { count: 60, maxPerString: 100 },
      { count: 20, maxPerString: 100 },
    ],
    8
  );
  assert.equal(res[0].slots, 6);
  assert.equal(res[1].slots, 2);
  assert.deepEqual(distributeCounts(res[0].count, res[0].slots), [10, 10, 10, 10, 10, 10]);
  assert.deepEqual(distributeCounts(res[1].count, res[1].slots), [10, 10]);
});

test("distributeSlotsEvenly: Voc-veilig minimum per groep blijft leidend, ook als dat oneerlijk oogt", () => {
  // Groep A (100 panelen, max 10/string) heeft minstens 10 slots nodig;
  // groep B (10 panelen, max 100/string) kan met 1 slot. 12 slots totaal →
  // A krijgt zijn minimum (10) + de rest (1 extra na de gelijkstand), B blijft op 1.
  const res = distributeSlotsEvenly(
    [
      { count: 100, maxPerString: 10 },
      { count: 10, maxPerString: 100 },
    ],
    12
  );
  assert.equal(res[0].slots, 11);
  assert.equal(res[1].slots, 1);
});

test("distributeSlotsEvenly: geeft null als zelfs het Voc-veilige minimum niet in totalSlots past", () => {
  const res = distributeSlotsEvenly([{ count: 100, maxPerString: 10 }], 5);
  assert.equal(res, null);
});

test("splitIntoEqualMpptStrings: referentiecase — vindt een exact gelijke deling i.p.v. distributeCounts' ±1-afronding", () => {
  // Regressiecase (2026-08-07): distributeCounts(57, 4) geeft [15,14,14,14]
  // — 15 en 14 passen niet samen op één MPPT (cap 2). 57 is wel exact
  // deelbaar door 3 (19 elk), dus dat moet de uitkomst zijn i.p.v. 4 strings
  // te forceren.
  const strings = splitIntoEqualMpptStrings(57, 2, 26, 4);
  assert.deepEqual(strings, [19, 19, 19]);
});

test("splitIntoEqualMpptStrings: lone group (19 panelen) blijft één string, niet geforceerd in 2", () => {
  const strings = splitIntoEqualMpptStrings(19, 2, 26, 2);
  assert.deepEqual(strings, [19]);
});

test("splitIntoEqualMpptStrings: 64 panelen bij 6 slots — kiest 4 gelijke strings van 16 (past exact)", () => {
  const strings = splitIntoEqualMpptStrings(64, 2, 26, 6);
  assert.deepEqual(strings, [16, 16, 16, 16]);
});

test("splitIntoEqualMpptStrings: alle geretourneerde strings passen samen zonder ongelijke MPPT-paren (autoAssign-check)", () => {
  // Bouwt de strings, laat autoAssign ze indelen op GW_SDT40-achtige
  // capaciteit (2/MPPT) en controleert dat geen enkele MPPT ongelijke
  // strings krijgt — dezelfde eis als de eerdere autoAssign-fix.
  const lengths = splitIntoEqualMpptStrings(57, 2, 26, 4);
  const strings = lengths.map((n) => ({ n, panel: JA430, azimuth: 142 }));
  const result = autoAssign(strings, GW_SDT40);
  assert.equal(result.overflow, false);
  for (const mppt of result.mppts) {
    const uniq = new Set(mppt.map((si) => strings[si].n));
    assert.ok(uniq.size <= 1, `strings op één MPPT moeten gelijk zijn, kreeg ${[...uniq]}`);
  }
});

test("splitIntoEqualMpptStrings: geen exacte deler beschikbaar (58, priemachtig) — veilige terugval zonder ongelijke MPPT's", () => {
  const strings = splitIntoEqualMpptStrings(58, 2, 26, 4);
  assert.equal(strings.reduce((s, x) => s + x, 0), 58, "totaal aantal panelen moet behouden blijven");
  assert.ok(strings.every((s) => s <= 26), "geen string mag de Voc-veilige max overschrijden");
});

test("splitIntoEqualMpptStrings: terugval vult MPPT's per stuk i.p.v. de rest in één lange string te dumpen", () => {
  // Referentiecase (2026-09-19): bij een bewust hoog aantal omvormers
  // (dus een grote targetSlots) kon de oude terugval de rest zodra die onder
  // maxPerString paste als ÉÉN string wegzetten, waardoor de tweede helft
  // van de laatste MPPT (en dus MPPT's/omvormers erna) leeg bleef. Voor 58
  // panelen (geen nette deler) moet nu [26,26,3,3] uitkomen — beide MPPT's
  // (2 strings/MPPT) volledig gebruikt — i.p.v. het oude [26,26,6] (tweede
  // MPPT maar half gevuld).
  const strings = splitIntoEqualMpptStrings(58, 2, 26, 4);
  assert.deepEqual(strings, [26, 26, 3, 3]);
});

// --- AC-kabel: aderdikte meterkast → omvormer(s) ----------------------------

test("voltageDropPct: 3-fase, 25A/15m/4mm² conduit — referentiecijfer handmatig nagerekend", () => {
  // ΔU = √3 × 25 × 15 × (0,0225/4) ≈ 3,65 V → 3,65/400 ≈ 0,91%
  const pct = voltageDropPct({ crossSection: 4, current: 25, length: 15, phases: 3 });
  assert.ok(Math.abs(pct - 0.913) < 0.01, `verwacht ~0,91%, kreeg ${pct.toFixed(3)}`);
});

test("requiredCableCrossSection: korte 3-fase kabel — stroombelastbaarheid is de maatgevende eis", () => {
  // 25A/15m/b1: 2,5mm² (21A) is te dun qua stroom, 4mm² (28A) past — en de
  // spanningsval bij 4mm² (~0,91%) zit ruim onder de 3%-norm.
  const res = requiredCableCrossSection({ current: 25, length: 15, phases: 3, installMethod: "b1" });
  assert.equal(res.crossSection, 4);
  assert.equal(res.limitedBy, "stroombelastbaarheid");
  assert.ok(res.voltageDropPct < VOLTAGE_DROP_MAX_PCT);
});

test("requiredCableCrossSection: lange 3-fase kabel — spanningsval dwingt een dikkere ader af dan stroombelastbaarheid alleen", () => {
  // 10A/60m/b1: 1,5mm² (15,5A) kan de stroom wel aan, maar de spanningsval
  // (~3,90%) overschrijdt de 3%-norm. 2,5mm² (~2,34%) past wel.
  const res = requiredCableCrossSection({ current: 10, length: 60, phases: 3, installMethod: "b1" });
  assert.equal(res.crossSection, 2.5);
  assert.equal(res.limitedBy, "spanningsval");
  assert.ok(res.voltageDropPct < VOLTAGE_DROP_MAX_PCT);
});

test("requiredCableCrossSection: 1-fase ondergronds rechtstreeks (d2) — 2 aders i.p.v. 3 in de spanningsvalformule", () => {
  // 16A/25m/d2: 1,5mm² en 2,5mm² halen de stroom prima maar niet de
  // 3%-spanningsval (230V-basis, factor 2 i.p.v. √3); 4mm² (~1,96%) past.
  const res = requiredCableCrossSection({ current: 16, length: 25, phases: 1, installMethod: "d2" });
  assert.equal(res.crossSection, 4);
  assert.equal(res.limitedBy, "spanningsval");
});

test("requiredCableCrossSection: d1 (mantelbuis) heeft lagere belastbaarheid dan d2 (rechtstreeks) bij dezelfde doorsnede", () => {
  // Bevestigt het onderscheid tussen de twee ondergrondse methodes: een
  // kabel rechtstreeks in de grond (d2) mag meer stroom dan dezelfde kabel
  // in een mantelbuis (d1), want die laatste dissipeert warmte slechter.
  assert.ok(CABLE_AMPACITY_CU_PVC[16].d2 > CABLE_AMPACITY_CU_PVC[16].d1, "d2 (rechtstreeks) moet hoger zijn dan d1 (mantelbuis) bij 16mm²");
});

test("checkAcCable: 1,5mm² op de lange 3-fase kabel faalt specifiek op spanningsval, niet op stroom", () => {
  const res = checkAcCable({ crossSection: 1.5, current: 10, length: 60, phases: 3, installMethod: "b1" });
  assert.equal(res.ampacityOk, true, "1,5mm² (15,5A) kan 10A prima aan");
  assert.equal(res.voltageDropOk, false, "spanningsval (~3,90%) overschrijdt de 3%-norm");
  assert.equal(res.pass, false);
});

test("requiredCableCrossSection: geeft null als geen enkele doorsnede tot 95mm² voldoet", () => {
  const res = requiredCableCrossSection({ current: 500, length: 15, phases: 3, installMethod: "b1" });
  assert.equal(res, null);
});

// --- Gelijkmatige verdeling op MPPT-niveau (2026-10-02) ---------------------
// Oude aanpak (slots per dakvlak + exacte deler) gaf o.a. 76 panelen op
// 3 MPPT × 2 als [19,19,19,19] (2 slots leeg) en vulde bij een fallback de
// eerste MPPT's tot de max. Nu: alle strings ≤1 paneel verschil, parallelle
// strings op één MPPT altijd exact gelijk.

const flatSorted = (perMppt) => perMppt.flat().sort((a, b) => b - a);

test("stringLengthRange: JA430 op T20 bij -10/70°C → 8 t/m 23", () => {
  assert.deepEqual(stringLengthRange(JA430, T20, -10, 70), { min: 8, max: 23 });
});

test("splitGroupOverMppts: 76 panelen over 3 MPPT × 2 → alle 6 slots, 13/13/13/13/12/12", () => {
  const res = splitGroupOverMppts(76, 3, 2, 5, 26);
  assert.deepEqual(flatSorted(res), [13, 13, 13, 13, 12, 12]);
  for (const m of res) assert.equal(new Set(m).size, 1, "parallelle strings gelijk");
});

test("splitGroupOverMppts: 58 panelen over 4 MPPT × 2 → 8/8 + 3× 7/7", () => {
  assert.deepEqual(splitGroupOverMppts(58, 4, 2, 5, 26), [[8, 8], [7, 7], [7, 7], [7, 7]]);
});

test("splitGroupOverMppts: oneven aantal bij cap 2 → één MPPT met één string, geen MPPT leeg", () => {
  const res = splitGroupOverMppts(25, 2, 2, 5, 26);
  assert.equal(res.length, 2);
  assert.deepEqual(flatSorted(res), [9, 8, 8]);
  for (const m of res) assert.equal(new Set(m).size, 1);
});

test("splitGroupOverMppts: te weinig panelen voor alle MPPT's binnen min. stringlengte → minder MPPT's", () => {
  // 12 panelen, min 8 per string: maar één string mogelijk.
  assert.deepEqual(splitGroupOverMppts(12, 3, 1, 8, 23), [[12]]);
  assert.equal(splitGroupOverMppts(5, 3, 1, 8, 23), null);
});

test("allocateGroupsToMppts: 300 panelen over 3× GW40K → 100 per omvormer, alle 24 slots", () => {
  const groups = [{ count: 300, panel: JA430, azimuth: 180, minPerString: 5, maxPerString: 26 }];
  const strings = allocateGroupsToMppts(groups, 3 * GW_SDT40.nMppt, 2);
  assert.equal(strings.length, 24);
  assert.equal(strings.reduce((s, x) => s + x.n, 0), 300);
  const result = autoAssignFleet(strings, [{ inverter: GW_SDT40 }, { inverter: GW_SDT40 }, { inverter: GW_SDT40 }]);
  assert.equal(result.overflow, false);
  for (const u of result.units) {
    assert.equal(u.flat().reduce((s, i) => s + strings[i].n, 0), 100);
    for (const m of u) assert.equal(new Set(m.map((i) => strings[i].n)).size, 1);
  }
});

test("allocateGroupsToMppts: 10 omvormers — alle 10 krijgen panelen, verschil per omvormer ≤ 1 string", () => {
  const GW25 = { id: "GW25K-SDT-30", vmax: 1100, vmpptMin: 140, vmpptMax: 1000, imppt: 40, isc: 50, nMppt: 3, stringsPerMppt: 2, pmax: 45000, pacNom: 25000, iacMax: 38 };
  const groups = [{ count: 245, panel: JA430, azimuth: 180, minPerString: 5, maxPerString: 26 }];
  const strings = allocateGroupsToMppts(groups, 10 * GW25.nMppt, 2);
  const units = Array.from({ length: 10 }, () => ({ inverter: GW25 }));
  const result = autoAssignFleet(strings, units);
  assert.equal(result.overflow, false);
  const perUnit = result.units.map((u) => u.flat().reduce((s, i) => s + strings[i].n, 0));
  assert.ok(perUnit.every((p) => p > 0), `alle omvormers gevuld, kreeg ${perUnit}`);
  assert.ok(Math.max(...perUnit) - Math.min(...perUnit) <= 5, `max. één string (5) verschil, kreeg ${perUnit}`);
});

test("allocateGroupsToMppts: twee dakvlakken krijgen elk eigen MPPT's, lengtes per dakvlak ≤1 verschil", () => {
  const groups = [
    { count: 40, panel: JA430, azimuth: 90, minPerString: 5, maxPerString: 26 },
    { count: 37, panel: JA430, azimuth: 270, minPerString: 5, maxPerString: 26 },
  ];
  const strings = allocateGroupsToMppts(groups, 4, 2);
  const east = strings.filter((s) => s.azimuth === 90).map((s) => s.n);
  const west = strings.filter((s) => s.azimuth === 270).map((s) => s.n);
  assert.equal(east.reduce((a, b) => a + b, 0), 40);
  assert.equal(west.reduce((a, b) => a + b, 0), 37);
  assert.ok(Math.max(...east) - Math.min(...east) <= 1);
  assert.ok(Math.max(...west) - Math.min(...west) <= 1);
  assert.equal(autoAssignFleet(strings, [{ inverter: GW_SDT40 }]).overflow, false);
});

// --- Hoofdaansluiting bij omvormervoorstel ----------------------------------

test("findMatchingInverters: met connAmps → totalIacMax/fitsConn, passende voorstellen bovenaan", () => {
  // 200 panelen: GW40K (60,6 A) is GoodWe maar past niet op 3×50 A; de
  // SUN100 (160,4 A) ook niet. Op 3×200 A passen beide.
  const tight = findMatchingInverters({ panel: JA430, totalPanels: 200, tMinCold: -10, tMaxHot: 70, inverters: [SUN100, GW_SDT40, T20], connAmps: 50 });
  for (const r of tight) assert.equal(r.totalIacMax, r.inverter.iacMax * r.invCount);
  const firstNonFit = tight.findIndex((r) => !r.fitsConn);
  if (firstNonFit !== -1) assert.ok(tight.slice(firstNonFit).every((r) => !r.fitsConn), "alle passende voorstellen staan vóór de niet-passende");
  assert.equal(tight.find((r) => r.inverter.id === SUN100.id).fitsConn, false);
  const roomy = findMatchingInverters({ panel: JA430, totalPanels: 200, tMinCold: -10, tMaxHot: 70, inverters: [SUN100, GW_SDT40], connAmps: 200 });
  assert.ok(roomy.every((r) => r.fitsConn));
  // Zonder connAmps: gedrag ongewijzigd (alles fitsConn, GoodWe bovenaan).
  const none = findMatchingInverters({ panel: JA430, totalPanels: 200, tMinCold: -10, tMaxHot: 70, inverters: [SUN100, GW_SDT40] });
  assert.equal(none[0].inverter.isGoodwe, true);
});

test("maxPhaseCurrent: 1-fase omvormers worden over 3 fasen gespreid, 3-fase telt op elke fase", () => {
  const DNS = { id: "GW6000-DNS-30", family: "GoodWe DNS G3 (1-fase)", iacMax: 28.8 };
  assert.equal(inverterPhases(DNS), 1);
  assert.equal(inverterPhases(GW_SDT40), 3, "onbekende familie → 3-fase (conservatief)");
  // 4× 1-fase op 3-fase aansluiting: zwaarste fase krijgt er 2.
  assert.ok(Math.abs(maxPhaseCurrent(Array(4).fill(DNS), 3) - 57.6) < 1e-9);
  // Op een 1-fase aansluiting komt alles op één fase.
  assert.ok(Math.abs(maxPhaseCurrent(Array(2).fill(DNS), 1) - 57.6) < 1e-9);
  // 3-fase: gewoon optellen per fase.
  assert.ok(Math.abs(maxPhaseCurrent([GW_SDT40, GW_SDT40], 3) - 121.2) < 1e-9);
  // Mix: 3-fase GW40K + 1× 1-fase → 60,6 + 28,8 op één fase.
  assert.ok(Math.abs(maxPhaseCurrent([GW_SDT40, DNS], 3) - 89.4) < 1e-9);
});

// --- Marge bij stringverdeling: dakvlakken binnen tolerantie delen MPPT's ----
// Verzoek 2026-10-02: twee strings die 10° verschillen moeten bij een marge
// van 15° al bij "Toepassen" van een voorstel samen op één MPPT kunnen.

test("allocateGroupsToMppts: 2 dakvlakken 10° uit elkaar, marge 15° → strings delen een MPPT", () => {
  const groups = [
    { count: 19, panelId: JA430.id, panel: JA430, azimuth: 180, helling: 10, minPerString: 5, maxPerString: 20 },
    { count: 19, panelId: JA430.id, panel: JA430, azimuth: 190, helling: 10, minPerString: 5, maxPerString: 20 },
  ];
  const tol = { azimuthTol: 15, tiltTol: 10 };
  const strings = allocateGroupsToMppts(groups, 4, 2, tol);
  assert.equal(strings.filter((s) => s.azimuth === 180).reduce((a, s) => a + s.n, 0), 19, "elk vlak houdt z'n eigen panelen");
  assert.equal(strings.filter((s) => s.azimuth === 190).reduce((a, s) => a + s.n, 0), 19);
  const result = autoAssignFleet(strings, [{ inverter: GW_SDT40 }], tol);
  assert.equal(result.overflow, false);
  const mixed = result.units[0].some((m) => new Set(m.map((i) => strings[i].azimuth)).size > 1);
  assert.ok(mixed, "minstens één MPPT met strings van beide dakvlakken");
  for (const m of result.units[0]) assert.ok(new Set(m.map((i) => strings[i].n)).size <= 1, "parallelle strings gelijk");
});

test("allocateGroupsToMppts: zelfde 2 dakvlakken, marge 5° → nooit samen op één MPPT", () => {
  const groups = [
    { count: 19, panelId: JA430.id, panel: JA430, azimuth: 180, helling: 10, minPerString: 5, maxPerString: 20 },
    { count: 19, panelId: JA430.id, panel: JA430, azimuth: 190, helling: 10, minPerString: 5, maxPerString: 20 },
  ];
  const tol = { azimuthTol: 5, tiltTol: 10 };
  const strings = allocateGroupsToMppts(groups, 4, 2, tol);
  const result = autoAssignFleet(strings, [{ inverter: GW_SDT40 }], tol);
  for (const m of result.units[0]) assert.ok(new Set(m.map((i) => strings[i].azimuth)).size <= 1);
});

test("allocateGroupsToMppts: marge laat 2 kleine vlakken passen waar ze los niet passen", () => {
  // 1 MPPT × 2 strings: los heeft elk vlak een eigen MPPT nodig (2 > 1),
  // binnen de marge kunnen ze samen als 2× 15 parallel.
  const groups = [
    { count: 15, panelId: JA430.id, panel: JA430, azimuth: 175, helling: 10, minPerString: 8, maxPerString: 20 },
    { count: 15, panelId: JA430.id, panel: JA430, azimuth: 185, helling: 10, minPerString: 8, maxPerString: 20 },
  ];
  assert.equal(allocateGroupsToMppts(groups, 1, 2, { azimuthTol: 5, tiltTol: 10 }), null);
  const strings = allocateGroupsToMppts(groups, 1, 2, { azimuthTol: 15, tiltTol: 10 });
  assert.deepEqual(strings.map((s) => s.n), [15, 15]);
});

test("splitClusterIntoStrings: ander paneelaantal per vlak → lengtes afgestemd zodat ze in de MPPT's passen", () => {
  const res = splitClusterIntoStrings([40, 37], 4, 2, 5, 26);
  assert.equal(res[0].reduce((a, b) => a + b, 0), 40);
  assert.equal(res[1].reduce((a, b) => a + b, 0), 37);
  const byLen = new Map();
  for (const n of res.flat()) byLen.set(n, (byLen.get(n) || 0) + 1);
  assert.ok([...byLen.values()].reduce((a, k) => a + Math.ceil(k / 2), 0) <= 4);
});

// --- Voorstel moet altijd toepasbaar zijn (2026-10-05) ----------------------
// Referentiecase: Bas kreeg 2× GW10K-SDT-30 als "Beste match" en bij
// Toepassen tegelijk "Te veel panelen voor de MPPT-capaciteit". Oorzaak:
// het voorstel keek alleen naar het totaal (65 ≤ 4 strings × 24), terwijl
// de verdeling per dakvlak 5 strings nodig had op 4 MPPT's (1 string/MPPT).
const JA460LR = { id: "JAM54D41-460/LR", wp: 460, imp: 13.66, isc: 14.43, vmp: 33.68, voc: 40.6, betaVoc: -0.25 };
const GW10K = { id: "GW10K-SDT-30", family: "GoodWe SDT G3 (3-fase)", vmax: 1100, vmpptMin: 140, vmpptMax: 1000, imppt: 22, isc: 27.5, nMppt: 2, stringsPerMppt: 1, pmax: 15000, pacNom: 10000, iacMax: 16.7, isGoodwe: true };
const FACES_1005 = [
  { count: 17, azimuth: 141, helling: 10 },
  { count: 8, azimuth: 143, helling: 10 },
  { count: 29, azimuth: 232, helling: 10 },
  { count: 11, azimuth: 231, helling: 10 },
];

test("findMatchingInvertersForFaces: elk voorstel past echt — strings in de MPPT's, alle panelen verdeeld", () => {
  const tol = { azimuthTol: 20, tiltTol: 10 };
  const res = findMatchingInvertersForFaces({ panel: JA460LR, faces: FACES_1005, tMinCold: -10, tMaxHot: 70, inverters: [GW10K, T20, GW_SDT40], connAmps: 35, tolerances: tol });
  assert.ok(res.length > 0);
  for (const m of res) {
    assert.equal(m.strings.reduce((a, x) => a + x.n, 0), 65, `${m.inverter.id}: alle 65 panelen`);
    const units = Array.from({ length: m.invCount }, () => ({ inverter: m.inverter }));
    const a = autoAssignFleet(m.strings.map((x) => ({ ...x, panel: JA460LR })), units, tol);
    assert.equal(a.overflow, false, `${m.inverter.id} ×${m.invCount} moet passen`);
  }
});

test("findMatchingInvertersForFaces: referentiecase 2× GW10K — vlakken binnen marge samen gestringd", () => {
  const res = findMatchingInvertersForFaces({ panel: JA460LR, faces: FACES_1005, tMinCold: -10, tMaxHot: 70, inverters: [GW10K], connAmps: 35, tolerances: { azimuthTol: 20, tiltTol: 10 } });
  assert.equal(res[0].invCount, 2);
  assert.deepEqual(res[0].strings.map((x) => x.n).sort((a, b) => b - a), [20, 20, 13, 12]);
});

test("findMatchingInvertersForFaces: zonder marge past 2× GW10K niet → meer omvormers of geen GW10K-voorstel", () => {
  const res = findMatchingInvertersForFaces({ panel: JA460LR, faces: FACES_1005, tMinCold: -10, tMaxHot: 70, inverters: [GW10K], tolerances: { azimuthTol: 0, tiltTol: 0 } });
  for (const m of res) assert.ok(m.invCount >= 3, "met 4 losse vlakken zijn minstens 5 MPPT's nodig");
  const fixed = findMatchingInvertersForFaces({ panel: JA460LR, faces: FACES_1005, tMinCold: -10, tMaxHot: 70, inverters: [GW10K], fixedInvCount: 2, tolerances: { azimuthTol: 0, tiltTol: 0 } });
  assert.equal(fixed.length, 0, "vast aantal 2 kan niet → geen voorstel i.p.v. een onuitvoerbaar voorstel");
});
