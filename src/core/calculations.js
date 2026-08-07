// ============================================================================
// REKENKERN — PV-configurator
// ----------------------------------------------------------------------------
// Pure, deterministische functies. GEEN AI, GEEN side-effects, GEEN UI.
// Dezelfde invoer geeft altijd dezelfde uitkomst. Wijzig niets zonder de
// tests in /tests te draaien.
// ============================================================================

export const STD_FUSES = [10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630];

// Nederlandse aansluitwaarden: { id, phases, amps (per fase) }.
export const CONNECTIONS = [
  { id: "1x25", phases: 1, amps: 25 },
  { id: "1x35", phases: 1, amps: 35 },
  { id: "1x40", phases: 1, amps: 40 },
  { id: "3x25", phases: 3, amps: 25 },
  { id: "3x35", phases: 3, amps: 35 },
  { id: "3x50", phases: 3, amps: 50 },
  { id: "3x63", phases: 3, amps: 63 },
  { id: "3x80", phases: 3, amps: 80 },
  { id: "3x100", phases: 3, amps: 100 },
  { id: "3x125", phases: 3, amps: 125 },
  { id: "3x160", phases: 3, amps: 160 },
  { id: "3x200", phases: 3, amps: 200 },
  { id: "3x250", phases: 3, amps: 250 },
  { id: "3x315", phases: 3, amps: 315 },
  { id: "3x400", phases: 3, amps: 400 },
  { id: "3x500", phases: 3, amps: 500 },
  { id: "3x630", phases: 3, amps: 630 },
  { id: "3x800", phases: 3, amps: 800 },
  { id: "3x1000", phases: 3, amps: 1000 },
  { id: "3x1250", phases: 3, amps: 1250 },
  { id: "3x1600", phases: 3, amps: 1600 },
  { id: "3x2000", phases: 3, amps: 2000 },
];

export function getConnection(id) {
  return CONNECTIONS.find((c) => c.id === id) || CONNECTIONS[3];
}

// Overdimensionering-band: het ideale DC/AC-venster.
export const OVERDIM_MIN = 1.2; // 120%
export const OVERDIM_MAX = 1.5; // 150%

// ----------------------------------------------------------------------------
// Temperatuurcorrectie
// ----------------------------------------------------------------------------

// Voc bij celtemperatuur T. β_Voc is negatief (%/°C); bij T < 25 stijgt Voc.
export function vocAtTemp(vocStc, betaVocPct, tCell) {
  return vocStc * (1 + (betaVocPct / 100) * (tCell - 25));
}

// Vmp bij celtemperatuur T (β_Voc als benadering voor de Vmp-tempco).
export function vmpAtTemp(vmpStc, betaVocPct, tCell) {
  return vmpStc * (1 + (betaVocPct / 100) * (tCell - 25));
}

// Voc bij STC voor één string van n panelen — triviaal, maar hoort in de
// rekenkern net als elke andere elektrische waarde waar een installatie-
// advies (hier: een monteursinstructie met verwachte stringspanningen) op
// gebaseerd wordt.
export function stringVocStc(panel, n) {
  return panel.voc * n;
}

// Bij welke celtemperatuur bereikt een string van N panelen de max. spanning?
// Nuttig om de "grens-temperatuur" te tonen. Geeft °C terug.
export function tempAtMaxVoltage(vocStc, betaVocPct, nPanels, vMax) {
  // vMax = N × vocStc × (1 + β/100 × (T − 25))  ⇒  los T op
  const ratio = vMax / (nPanels * vocStc);
  return 25 + (ratio - 1) / (betaVocPct / 100);
}

// ----------------------------------------------------------------------------
// Afzekering & aansluiting
// ----------------------------------------------------------------------------

// Minimale afzekering = max. AC-stroom × 1,25, naar eerstvolgende standaard.
export function minFuse(iacMax) {
  const required = iacMax * 1.25;
  return STD_FUSES.find((f) => f >= required) || Math.ceil(required);
}

export function inverterFitsConnection(iacMaxTotal, connAmpsPerPhase) {
  return iacMaxTotal <= connAmpsPerPhase;
}

// ----------------------------------------------------------------------------
// MPPT-capaciteit: stringsPerMppt is meestal één getal (uniform, gelijk voor
// elke MPPT), maar mag ook een array van nMppt waarden zijn voor omvormers
// met ongelijke trackers (bijv. [1, 2]: MPPT 1 kan 1 string aan, MPPT 2 kan
// er 2 aan). Overal waar eerder blind inverter.stringsPerMppt werd gebruikt,
// gaat het nu via één van deze helpers.
// ----------------------------------------------------------------------------

export function mpptCapacity(inverter, mpptIdx) {
  return Array.isArray(inverter.stringsPerMppt) ? inverter.stringsPerMppt[mpptIdx] : inverter.stringsPerMppt;
}
export function totalMpptSlots(inverter) {
  return Array.isArray(inverter.stringsPerMppt)
    ? inverter.stringsPerMppt.reduce((a, b) => a + b, 0)
    : inverter.nMppt * inverter.stringsPerMppt;
}
// Conservatieve uniforme ondergrens — gebruikt waar een zoekfunctie (nog)
// geen per-MPPT-toewijzing doet, alleen een gelijk aantal strings per MPPT
// zoekt (bijv. findMatchingInverters/checkConfig): nooit meer beloven dan de
// krapste tracker aankan.
export function minMpptCapacity(inverter) {
  return Array.isArray(inverter.stringsPerMppt) ? Math.min(...inverter.stringsPerMppt) : inverter.stringsPerMppt;
}

// ----------------------------------------------------------------------------
// Enkele configuratie-check (één omvormer, gegeven stringlengte)
// ----------------------------------------------------------------------------

export function checkConfig({ panel, inverter, nPerString, stringsPerMppt, tMinCold, tMaxHot }) {
  const checks = [];

  const vocCold = vocAtTemp(panel.voc, panel.betaVoc, tMinCold) * nPerString;
  checks.push({ key: "vocCold", label: `Voc bij ${tMinCold}°C`, value: vocCold, unit: "V", limit: inverter.vmax, pass: vocCold < inverter.vmax });

  const vocStc = panel.voc * nPerString;
  checks.push({ key: "vocStc", label: "Voc STC", value: vocStc, unit: "V", limit: inverter.vmax, pass: vocStc < inverter.vmax });

  const vmpCold = vmpAtTemp(panel.vmp, panel.betaVoc, tMinCold) * nPerString;
  checks.push({ key: "vmpCold", label: `Vmp bij ${tMinCold}°C`, value: vmpCold, unit: "V", limit: inverter.vmpptMax, pass: vmpCold <= inverter.vmpptMax });

  const vmpHot = vmpAtTemp(panel.vmp, panel.betaVoc, tMaxHot) * nPerString;
  checks.push({ key: "vmpHot", label: `Vmp bij ${tMaxHot}°C`, value: vmpHot, unit: "V", limit: inverter.vmpptMin, pass: vmpHot >= inverter.vmpptMin });

  const impTotal = panel.imp * stringsPerMppt;
  checks.push({ key: "imp", label: `Imp per MPPT (${stringsPerMppt}× string)`, value: impTotal, unit: "A", limit: inverter.imppt, pass: impTotal <= inverter.imppt });

  const iscTotal = panel.isc * stringsPerMppt;
  checks.push({ key: "isc", label: `Isc per MPPT (${stringsPerMppt}× string)`, value: iscTotal, unit: "A", limit: inverter.isc, pass: iscTotal <= inverter.isc });

  checks.push({ key: "strings", label: "Strings per MPPT", value: stringsPerMppt, unit: "", limit: minMpptCapacity(inverter), pass: stringsPerMppt <= minMpptCapacity(inverter) });

  return checks;
}

export function allPass(checks) {
  return checks.every((c) => c.pass);
}

// Verdeelt `total` zo gelijkmatig mogelijk over `parts` gehele delen
// (verschil tussen grootste en kleinste deel ≤ 1), aflopend gesorteerd.
// Bouwsteen voor elke vraag waarbij een totaal niet netjes deelbaar is
// over strings/omvormers/partijen.
export function distributeCounts(total, parts) {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

// Vertaalt dakvlakken (nog geen strings) naar een concrete strings-lijst,
// gegeven een gekozen stringlengte (bijv. de winnaar uit findMatchingInverters).
// Elk dakvlak wordt onafhankelijk over hele strings verdeeld via
// distributeCounts, zodat een rest binnen dát dakvlak blijft (niet over het
// hele systeem uitgesmeerd).
export function buildStringsFromRoofFaces(roofFaces, nPerString) {
  return roofFaces.flatMap((face) => {
    const numStrings = Math.max(1, Math.ceil(face.count / nPerString));
    return distributeCounts(face.count, numStrings).map((n) => ({ n, azimuth: face.azimuth, helling: face.helling }));
  });
}

// Verdeelt groepen ({ count, maxPerString, ... }) over een vast totaal aantal
// strings (bijv. alle beschikbare MPPT-slots van een gekozen omvormer(park)),
// zo gelijk mogelijk qua stringlengte over ALLE groepen heen — i.p.v. per
// groep onafhankelijk het minimum aantal strings te pakken (zoals
// buildStringsFromRoofFaces doet), wat MPPT-slots ongebruikt kan laten.
// Elke groep krijgt eerst het minimum aantal strings dat nodig is om binnen
// maxPerString te blijven (Voc-veilig); de resterende strings gaan steeds
// naar de groep met op dat moment de langste gemiddelde string, tot alle
// totalSlots op zijn. Geeft null als zelfs het minimum niet in totalSlots
// past.
export function distributeSlotsEvenly(groups, totalSlots) {
  if (groups.length === 0) return [];
  const minSlots = groups.map((g) => Math.max(1, Math.ceil(g.count / g.maxPerString)));
  const used = minSlots.reduce((a, b) => a + b, 0);
  if (used > totalSlots) return null;
  const slots = [...minSlots];
  let extra = totalSlots - used;
  while (extra > 0) {
    let worst = 0;
    let worstAvg = -Infinity;
    for (let i = 0; i < groups.length; i++) {
      const avg = groups[i].count / slots[i];
      if (avg > worstAvg) {
        worstAvg = avg;
        worst = i;
      }
    }
    slots[worst]++;
    extra--;
  }
  return groups.map((g, i) => ({ ...g, slots: slots[i] }));
}

// Vertaalt een aantal panelen naar concrete stringlengtes voor een omvormer
// met `cap` strings/MPPT, met als doel zo dicht mogelijk bij `targetSlots`
// strings te komen (bijv. uit distributeSlotsEvenly) — maar NOOIT ten koste
// van de eis dat strings op dezelfde MPPT exact gelijke lengte hebben
// (distributeCounts' ±1-afronding volstaat daar niet voor: 57 panelen over
// 4 strings geeft bijv. [15,14,14,14], en 15+14 past niet samen op één
// MPPT). Zoekt daarom terug vanaf targetSlots naar het kleinste aantal
// strings S (tot het Voc-veilige minimum) waarbij count exact deelbaar is
// door S — dan zijn alle S strings identiek, dus per definitie geen enkel
// MPPT ooit ongelijk. Lukt dat nergens (zeldzaam, bijv. een priemgetal),
// dan de veilige terugval: zo min mogelijk strings op de maximale
// (Voc-veilige) lengte, net als buildStringsFromRoofFaces.
export function splitIntoEqualMpptStrings(count, cap, maxPerString, targetSlots) {
  const minSlots = Math.max(1, Math.ceil(count / maxPerString));
  for (let s = Math.max(targetSlots, minSlots); s >= minSlots; s--) {
    if (count % s === 0 && count / s <= maxPerString) {
      return Array(s).fill(count / s);
    }
  }
  const strings = [];
  let remaining = count;
  while (remaining > 0) {
    if (remaining <= maxPerString) {
      strings.push(remaining);
      break;
    }
    const k = Math.max(1, Math.min(cap, Math.floor(remaining / maxPerString)));
    for (let i = 0; i < k; i++) strings.push(maxPerString);
    remaining -= k * maxPerString;
  }
  return strings;
}

// ----------------------------------------------------------------------------
// AC-kabel: aderdikte tussen meterkast/verdeelkast en omvormer(s)
// ----------------------------------------------------------------------------
// Stroombelastbaarheid uit IEC 60364-5-52, Tabel B.52.4 (PVC-isolatie, koper,
// 3 belaste aders, geleidertemp. 70°C, omgevingstemp. 30°C lucht / 20°C
// grond) — bron: ti-soft.com/en/support/help/electricaldesign/standards/
// iec-60364-5-52/current-carrying-capacity/table_b_52_4 (2026-08-07
// gecontroleerd tegen de norm-tabel, alle 7 kolommen A1/A2/B1/B2/C/D1/D2).
// Voor 1-fase (2 belaste aders) wordt dezelfde tabel gebruikt: dat is een
// bewuste, conservatieve vereenvoudiging — 2 belaste aders mogen in
// werkelijkheid iets méér stroom verdragen dan 3 (minder onderlinge
// opwarming), dus dit onderschat de belastbaarheid nooit.
//
// Legmethodes = de IEC-referentiemethodes zelf (zie CABLE_INSTALL_METHODS
// voor de NL-omschrijvingen):
//   a1 = aders in buis, weggewerkt in een geïsoleerde wand
//   a2 = kabel in buis, weggewerkt in een geïsoleerde wand
//   b1 = aders in opbouwbuis tegen/op een wand
//   b2 = kabel in opbouwbuis tegen/op een wand
//   c  = kabel vrij/geclipt (kabelgoot, tegen wand of plafond)
//   d1 = ondergronds in mantelbuis
//   d2 = ondergronds rechtstreeks (geen mantelbuis)
export const CABLE_AMPACITY_CU_PVC = {
  1.5: { a1: 13.5, a2: 13, b1: 15.5, b2: 15, c: 17.5, d1: 18, d2: 19 },
  2.5: { a1: 18, a2: 17.5, b1: 21, b2: 20, c: 24, d1: 24, d2: 24 },
  4: { a1: 24, a2: 23, b1: 28, b2: 27, c: 32, d1: 30, d2: 33 },
  6: { a1: 31, a2: 29, b1: 36, b2: 34, c: 41, d1: 38, d2: 41 },
  10: { a1: 42, a2: 39, b1: 50, b2: 46, c: 57, d1: 50, d2: 54 },
  16: { a1: 56, a2: 52, b1: 68, b2: 62, c: 76, d1: 64, d2: 70 },
  25: { a1: 73, a2: 68, b1: 89, b2: 80, c: 96, d1: 82, d2: 92 },
  35: { a1: 89, a2: 83, b1: 110, b2: 99, c: 119, d1: 98, d2: 110 },
  50: { a1: 108, a2: 99, b1: 134, b2: 118, c: 144, d1: 116, d2: 130 },
  70: { a1: 136, a2: 125, b1: 171, b2: 149, c: 184, d1: 143, d2: 162 },
  95: { a1: 164, a2: 150, b1: 207, b2: 179, c: 223, d1: 169, d2: 193 },
};

export const CABLE_INSTALL_METHODS = [
  { key: "a1", label: "Aders in buis, weggewerkt in geïsoleerde wand (A1)" },
  { key: "a2", label: "Kabel in buis, weggewerkt in geïsoleerde wand (A2)" },
  { key: "b1", label: "Aders in opbouwbuis tegen/op een wand (B1)" },
  { key: "b2", label: "Kabel in opbouwbuis tegen/op een wand (B2)" },
  { key: "c", label: "Kabelgoot / vrij geclipt tegen wand of plafond (C)" },
  { key: "d1", label: "Ondergronds, in mantelbuis (D1)" },
  { key: "d2", label: "Ondergronds, rechtstreeks — geen mantelbuis (D2)" },
];

export const CABLE_CROSS_SECTIONS = Object.keys(CABLE_AMPACITY_CU_PVC)
  .map(Number)
  .sort((a, b) => a - b);

// Ω·mm²/m, koper bij ~70°C (ontwerpwaarde, gangbaar in NL-kabelberekeningen).
const COPPER_RESISTIVITY = 0.0225;

// Vaste norm voor het traject meterkast → omvormer(s) (op verzoek niet
// instelbaar gemaakt).
export const VOLTAGE_DROP_MAX_PCT = 3;

// Spanningsval in % voor een gekozen doorsnede, gegeven ontwerpstroom,
// kabellengte (enkele lengte, niet heen-en-terug) en aantal fasen. Reactantie
// wordt genegeerd (vereenvoudiging, gangbaar voor doorsnedes tot 95mm²).
export function voltageDropPct({ crossSection, current, length, phases }) {
  const r = COPPER_RESISTIVITY / crossSection; // Ω/m
  const uNom = phases === 1 ? 230 : 400;
  const factor = phases === 1 ? 2 : Math.sqrt(3);
  const dU = factor * current * length * r;
  return (dU / uNom) * 100;
}

// Kleinste standaarddoorsnede die zowel de stroombelastbaarheid als de
// 3%-spanningsvalnorm haalt, of null als geen enkele doorsnede tot 95mm²
// voldoet.
export function requiredCableCrossSection({ current, length, phases, installMethod }) {
  const ampacityMin = CABLE_CROSS_SECTIONS.find((cs) => CABLE_AMPACITY_CU_PVC[cs][installMethod] >= current) ?? null;
  for (const cs of CABLE_CROSS_SECTIONS) {
    const ampacity = CABLE_AMPACITY_CU_PVC[cs][installMethod];
    if (ampacity < current) continue;
    const dU = voltageDropPct({ crossSection: cs, current, length, phases });
    if (dU > VOLTAGE_DROP_MAX_PCT) continue;
    return { crossSection: cs, ampacity, voltageDropPct: dU, limitedBy: cs === ampacityMin ? "stroombelastbaarheid" : "spanningsval" };
  }
  return null;
}

// Toetst een specifiek gekozen doorsnede (bijv. wat er al ligt) tegen beide eisen.
export function checkAcCable({ crossSection, current, length, phases, installMethod }) {
  const ampacity = CABLE_AMPACITY_CU_PVC[crossSection]?.[installMethod] ?? null;
  const dU = voltageDropPct({ crossSection, current, length, phases });
  const ampacityOk = ampacity != null && ampacity >= current;
  const voltageDropOk = dU <= VOLTAGE_DROP_MAX_PCT;
  return { crossSection, ampacity, ampacityOk, voltageDropPct: dU, voltageDropOk, pass: ampacityOk && voltageDropOk };
}

// ----------------------------------------------------------------------------
// Omvormer zoeken (multi-omvormer, optimalisatie naar 120-150% band)
// ----------------------------------------------------------------------------

// Geeft per omvormertype de beste verdeling: zo min mogelijk omvormers, met
// DC/AC-overdimensionering liefst in [OVERDIM_MIN, OVERDIM_MAX]. Optioneel
// `fixedInvCount`: reken met een vast aantal omvormers (bijv. omdat een pand
// een vast aantal aansluitingen heeft) in plaats van te optimaliseren naar
// het minimum — vindt dan de beste stringlengte gegeven dat vaste aantal.
export function findMatchingInverters({ panel, totalPanels, tMinCold, tMaxHot, inverters, fixedInvCount }) {
  const results = [];
  const totalWp = totalPanels * panel.wp;

  for (const inv of inverters) {
    const maxStringsPerInv = totalMpptSlots(inv);
    let best = null;

    // String-lengte van lang naar kort: langere strings → minder strings nodig.
    for (let nPer = 40; nPer >= 2; nPer--) {
      const stringsTotal = Math.ceil(totalPanels / nPer);
      let invCount;
      if (fixedInvCount) {
        invCount = fixedInvCount;
      } else {
        const minInvByStrings = Math.ceil(stringsTotal / maxStringsPerInv);
        const minInvByPower = Math.ceil(totalWp / inv.pmax);
        // pmax is de harde grens (fabrikant-max PV-input). Overdimensionering
        // boven OVERDIM_MAX is toegestaan zolang DC per omvormer onder pmax blijft.
        invCount = Math.max(minInvByStrings, minInvByPower);
      }

      const stringsPerInv = Math.ceil(stringsTotal / invCount);
      const stringsPerMpptUsed = Math.ceil(stringsPerInv / inv.nMppt);
      const checks = checkConfig({ panel, inverter: inv, nPerString: nPer, stringsPerMppt: stringsPerMpptUsed, tMinCold, tMaxHot });
      const powerOk = totalWp / invCount <= inv.pmax;
      const dcAcRatio = totalWp / (inv.pacNom * invCount);

      if (allPass(checks) && powerOk) {
        const inBand = dcAcRatio >= OVERDIM_MIN && dcAcRatio <= OVERDIM_MAX;
        const highOverdim = dcAcRatio > OVERDIM_MAX;
        best = { nPerString: nPer, stringsTotal, invCount, stringsPerInv, stringsPerMpptUsed, totalWp, totalAc: inv.pacNom * invCount, dcAcRatio, inBand, highOverdim };
        break;
      }
    }
    if (best) results.push({ inverter: inv, ...best });
  }

  // GoodWe bovenaan → in-band → minste omvormers → dichtst bij 135%.
  results.sort((a, b) => {
    if (!!a.inverter.isGoodwe !== !!b.inverter.isGoodwe) return a.inverter.isGoodwe ? -1 : 1;
    if (a.inBand !== b.inBand) return a.inBand ? -1 : 1;
    if (a.invCount !== b.invCount) return a.invCount - b.invCount;
    return Math.abs(a.dcAcRatio - 1.35) - Math.abs(b.dcAcRatio - 1.35);
  });
  return results;
}

// ----------------------------------------------------------------------------
// Legplan: lijst strings { n, panel, azimuth, helling }
// ----------------------------------------------------------------------------

// Oriëntatie-bewuste toewijzing van strings aan MPPT's van één omvormer.
export function autoAssign(strings, inverter) {
  const mppts = Array.from({ length: inverter.nMppt }, () => []);
  const byAz = {};
  strings.forEach((s, i) => {
    const key = `${s.azimuth}`;
    (byAz[key] = byAz[key] || []).push(i);
  });
  const ordered = Object.values(byAz).sort((a, b) => b.length - a.length).flat();
  for (const si of ordered) {
    const az = strings[si].azimuth;
    const n = strings[si].n;
    // Strings die parallel op dezelfde MPPT komen te staan moeten elektrisch
    // gelijke lengte hebben (anders stuurt de kortste string de hele
    // parallelcombinatie) — nooit combineren op basis van oriëntatie alleen.
    let target = mppts.findIndex(
      (m, idx) => m.length < mpptCapacity(inverter, idx) && m.length > 0 && strings[m[0]].azimuth === az && strings[m[0]].n === n
    );
    if (target === -1) target = mppts.findIndex((m) => m.length === 0);
    if (target === -1) target = mppts.findIndex((m, idx) => m.length < mpptCapacity(inverter, idx) && strings[m[0]].n === n);
    if (target === -1) return { mppts, overflow: true };
    mppts[target].push(si);
  }
  return { mppts, overflow: false };
}

// Verdeelt strings over een vloot van (mogelijk verschillende) omvormer-
// eenheden. Zelfde heuristiek als autoAssign (oriëntatie eerst, dan
// capaciteit), nu over alle MPPT-slots van de hele vloot heen. Elektrische
// geschiktheid per type wordt hier niet gecheckt — dat doet checkLegplan,
// per eenheid, achteraf (net als bij één omvormer).
export function autoAssignFleet(strings, units) {
  const unitMppts = units.map((u) => Array.from({ length: u.inverter.nMppt }, () => []));
  const slots = [];
  units.forEach((u, uIdx) => {
    for (let mIdx = 0; mIdx < u.inverter.nMppt; mIdx++) {
      slots.push({ uIdx, mIdx, cap: mpptCapacity(u.inverter, mIdx) });
    }
  });
  const arrOf = (s) => unitMppts[s.uIdx][s.mIdx];

  const byAz = {};
  strings.forEach((s, i) => {
    (byAz[s.azimuth] = byAz[s.azimuth] || []).push(i);
  });
  const ordered = Object.values(byAz).sort((a, b) => b.length - a.length).flat();

  for (const si of ordered) {
    const az = strings[si].azimuth;
    const n = strings[si].n;
    // Zelfde regel als autoAssign: nooit strings van ongelijke lengte samen
    // op één MPPT (parallel) zetten, ook niet als fallback zonder oriëntatie-match.
    let target = slots.find((s) => {
      const a = arrOf(s);
      return a.length > 0 && a.length < s.cap && strings[a[0]].azimuth === az && strings[a[0]].n === n;
    });
    if (!target) target = slots.find((s) => arrOf(s).length === 0);
    if (!target)
      target = slots.find((s) => {
        const a = arrOf(s);
        return a.length > 0 && a.length < s.cap && strings[a[0]].n === n;
      });
    if (!target) return { units: unitMppts, overflow: true };
    arrOf(target).push(si);
  }
  return { units: unitMppts, overflow: false };
}

// Multi-omvormer legplan-advies: aantal benodigde units met optimale band.
export function checkLegplanMulti(strings, inverter, tMinCold, tMaxHot) {
  if (strings.length === 0) return null;
  const maxStringsPerInv = totalMpptSlots(inverter);
  let allStringsOk = true;
  for (const s of strings) {
    const vocCold = vocAtTemp(s.panel.voc, s.panel.betaVoc, tMinCold) * s.n;
    const vmpCold = vmpAtTemp(s.panel.vmp, s.panel.betaVoc, tMinCold) * s.n;
    const vmpHot = vmpAtTemp(s.panel.vmp, s.panel.betaVoc, tMaxHot) * s.n;
    if (vocCold >= inverter.vmax) allStringsOk = false;
    if (vmpCold > inverter.vmpptMax) allStringsOk = false;
    if (vmpHot < inverter.vmpptMin) allStringsOk = false;
    if (s.panel.imp > inverter.imppt || s.panel.isc > inverter.isc) allStringsOk = false;
  }
  const stringsTotal = strings.length;
  const totalWp = strings.reduce((sum, s) => sum + s.n * s.panel.wp, 0);
  let invCount = Math.max(Math.ceil(stringsTotal / maxStringsPerInv), Math.ceil(totalWp / inverter.pmax));
  const stringsPerInv = Math.ceil(stringsTotal / invCount);
  const powerOk = totalWp / invCount <= inverter.pmax;
  const dcAcRatio = totalWp / (inverter.pacNom * invCount);
  const inBand = dcAcRatio >= OVERDIM_MIN && dcAcRatio <= OVERDIM_MAX;
  const highOverdim = dcAcRatio > OVERDIM_MAX;
  const azimuths = new Set(strings.map((s) => s.azimuth));
  const anyMixed = azimuths.size > 1 && stringsPerInv > inverter.nMppt;
  return { pass: allStringsOk && powerOk, invCount, stringsPerInv, stringsTotal, totalWp, totalAc: inverter.pacNom * invCount, dcAcRatio, inBand, highOverdim, anyMixed };
}

// Legplan-check per MPPT voor één omvormer, gegeven een strings→MPPT-toewijzing
// (bijv. van autoAssign). Worstcase per MPPT: hoogste Voc-string, som van stromen.
export function checkLegplan(strings, inverter, assignment, tMinCold, tMaxHot) {
  const mpptResults = assignment.mppts.map((stringIdxs, mpptNum) => {
    if (stringIdxs.length === 0) {
      return { mpptNum, empty: true, checks: [], strings: [], stringIdxs, mixed: false, pass: true };
    }
    const strs = stringIdxs.map((i) => strings[i]);
    const azimuths = [...new Set(strs.map((s) => s.azimuth))];
    const mixed = azimuths.length > 1;
    const checks = [];

    const vocCold = Math.max(...strs.map((s) => vocAtTemp(s.panel.voc, s.panel.betaVoc, tMinCold) * s.n));
    checks.push({ key: "vocCold", label: `Voc bij ${tMinCold}°C`, value: vocCold, unit: "V", limit: inverter.vmax, pass: vocCold < inverter.vmax });

    const vocStc = Math.max(...strs.map((s) => s.panel.voc * s.n));
    checks.push({ key: "vocStc", label: "Voc STC", value: vocStc, unit: "V", limit: inverter.vmax, pass: vocStc < inverter.vmax });

    const vmpCold = Math.max(...strs.map((s) => vmpAtTemp(s.panel.vmp, s.panel.betaVoc, tMinCold) * s.n));
    checks.push({ key: "vmpCold", label: `Vmp bij ${tMinCold}°C`, value: vmpCold, unit: "V", limit: inverter.vmpptMax, pass: vmpCold <= inverter.vmpptMax });

    const vmpHot = Math.min(...strs.map((s) => vmpAtTemp(s.panel.vmp, s.panel.betaVoc, tMaxHot) * s.n));
    checks.push({ key: "vmpHot", label: `Vmp bij ${tMaxHot}°C`, value: vmpHot, unit: "V", limit: inverter.vmpptMin, pass: vmpHot >= inverter.vmpptMin });

    const impTotal = strs.reduce((sum, s) => sum + s.panel.imp, 0);
    checks.push({ key: "imp", label: `Imp (${strs.length}× string)`, value: impTotal, unit: "A", limit: inverter.imppt, pass: impTotal <= inverter.imppt });

    const iscTotal = strs.reduce((sum, s) => sum + s.panel.isc, 0);
    checks.push({ key: "isc", label: `Isc (${strs.length}× string)`, value: iscTotal, unit: "A", limit: inverter.isc, pass: iscTotal <= inverter.isc });

    checks.push({ key: "strings", label: "Strings", value: strs.length, unit: "", limit: mpptCapacity(inverter, mpptNum), pass: strs.length <= mpptCapacity(inverter, mpptNum) });

    return { mpptNum, empty: false, checks, strings: strs, stringIdxs, mixed, pass: allPass(checks) };
  });

  const totalWp = strings.reduce((sum, s) => sum + s.n * s.panel.wp, 0);
  const powerOk = totalWp <= inverter.pmax;
  const allAssigned = assignment.mppts.flat().length === strings.length && !assignment.overflow;
  const pass = mpptResults.every((m) => m.pass) && powerOk && allAssigned;
  const anyMixed = mpptResults.some((m) => m.mixed);

  return { mpptResults, totalWp, powerOk, allAssigned, pass, anyMixed };
}
