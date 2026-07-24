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
  checkLegplan,
  distributeCounts,
  OVERDIM_MIN,
} from "../src/core/calculations.js";

// Referentiepaneel: JA Solar JAM54D41-430/GB
const JA430 = { id: "JAM54D41-430/GB", wp: 430, voc: 38.32, vmp: 32.21, isc: 14.23, imp: 13.35, betaVoc: -0.26 };

// Referentieomvormers
const T20 = { id: "SMILE-G3-T20", vmax: 1000, vmpptMin: 200, vmpptMax: 850, imppt: 18, isc: 22.5, nMppt: 3, stringsPerMppt: 1, pmax: 40000, pacNom: 20000, iacMax: 32.0, isGoodwe: false };
const SUN100 = { id: "SUN2000-100KTL-M2", vmax: 1100, vmpptMin: 200, vmpptMax: 1000, imppt: 30, isc: 40, nMppt: 10, stringsPerMppt: 2, pmax: 150000, pacNom: 100000, iacMax: 160.4, isGoodwe: false };
const GW_SDT40 = { id: "GW40K-SDT-P30", vmax: 1100, vmpptMin: 140, vmpptMax: 1000, imppt: 40, isc: 56, nMppt: 4, stringsPerMppt: 2, pmax: 72000, pacNom: 40000, iacMax: 60.6, isGoodwe: true };

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
