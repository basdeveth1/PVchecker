import React, { useState, useMemo } from "react";

// ============================================================================
// COMPONENT DATABASE
// Geëxtraheerd uit de geüploade datasheets. Elke variant heeft een "available"
// vlag die je per leverancier kunt aan-/uitzetten.
// LET OP: controleer elke waarde één keer tegen de originele datasheet voordat
// je dit productief gebruikt. PDF-extractie is ~95% betrouwbaar.
// ============================================================================

const PANEL_DB = [
  {
    family: "JA Solar JAM54D41 GB (430 serie)",
    source: "jam54d41-410-435-gb",
    note: "n-type bifacial, β_Voc -0,260%/°C",
    betaVoc: -0.260,
    vsysMax: 1500,
    variants: [
      { id: "JAM54D41-410/GB", wp: 410, voc: 37.82, vmp: 31.37, isc: 13.95, imp: 13.07, available: true },
      { id: "JAM54D41-415/GB", wp: 415, voc: 37.92, vmp: 31.59, isc: 14.02, imp: 13.14, available: true },
      { id: "JAM54D41-420/GB", wp: 420, voc: 38.05, vmp: 31.80, isc: 14.09, imp: 13.21, available: true },
      { id: "JAM54D41-425/GB", wp: 425, voc: 38.20, vmp: 32.01, isc: 14.16, imp: 13.28, available: true },
      { id: "JAM54D41-430/GB", wp: 430, voc: 38.32, vmp: 32.21, isc: 14.23, imp: 13.35, available: true },
      { id: "JAM54D41-435/GB", wp: 435, voc: 38.45, vmp: 32.42, isc: 14.30, imp: 13.42, available: true },
    ],
  },
  {
    family: "JA Solar JAM60D42 LB (530 serie)",
    source: "JAM60D42_LB",
    note: "n-type bifacial, β_Voc -0,250%/°C",
    betaVoc: -0.250,
    vsysMax: 1500,
    variants: [
      { id: "JAM60D42-505/LB", wp: 505, voc: 42.93, vmp: 35.69, isc: 15.01, imp: 14.15, available: true },
      { id: "JAM60D42-510/LB", wp: 510, voc: 43.13, vmp: 35.92, isc: 15.06, imp: 14.20, available: true },
      { id: "JAM60D42-515/LB", wp: 515, voc: 43.33, vmp: 36.15, isc: 15.11, imp: 14.25, available: true },
      { id: "JAM60D42-520/LB", wp: 520, voc: 43.53, vmp: 36.37, isc: 15.16, imp: 14.30, available: true },
      { id: "JAM60D42-525/LB", wp: 525, voc: 43.73, vmp: 36.59, isc: 15.21, imp: 14.35, available: true },
      { id: "JAM60D42-530/LB", wp: 530, voc: 43.93, vmp: 36.81, isc: 15.26, imp: 14.40, available: true },
    ],
  },
  {
    family: "LONGi Hi-MO X10 LR7-60HVH",
    source: "LR7-60HVH",
    note: "BC-cel, β_Voc -0,200%/°C",
    betaVoc: -0.200,
    vsysMax: 1500,
    variants: [
      { id: "LR7-60HVH-535M", wp: 535, voc: 44.78, vmp: 37.01, isc: 15.15, imp: 14.46, available: true },
      { id: "LR7-60HVH-540M", wp: 540, voc: 44.88, vmp: 37.11, isc: 15.25, imp: 14.55, available: true },
      { id: "LR7-60HVH-545M", wp: 545, voc: 44.98, vmp: 37.21, isc: 15.35, imp: 14.65, available: true },
      { id: "LR7-60HVH-550M", wp: 550, voc: 45.08, vmp: 37.31, isc: 15.45, imp: 14.74, available: true },
      { id: "LR7-60HVH-555M", wp: 555, voc: 45.18, vmp: 37.41, isc: 15.55, imp: 14.84, available: true },
      { id: "LR7-60HVH-560M", wp: 560, voc: 45.28, vmp: 37.51, isc: 15.65, imp: 14.93, available: true },
    ],
  },
  {
    family: "Solarge SOLO Ultra Low Carbon",
    source: "ultra-low-carbon-solarge",
    note: "Mono PERC 72-cel, lichtgewicht, β_Voc -0,24%/°C",
    betaVoc: -0.240,
    vsysMax: 1500,
    variants: [
      { id: "SOLO-470", wp: 470, voc: 49.8, vmp: 39.4, isc: 12.73, imp: 11.99, available: true },
      { id: "SOLO-480", wp: 480, voc: 49.8, vmp: 39.7, isc: 12.86, imp: 12.15, available: true },
      { id: "SOLO-490", wp: 490, voc: 49.9, vmp: 40.0, isc: 13.00, imp: 12.31, available: true },
      { id: "SOLO-500", wp: 500, voc: 49.9, vmp: 40.3, isc: 13.13, imp: 12.47, available: true },
      { id: "SOLO-510", wp: 510, voc: 49.9, vmp: 40.6, isc: 13.27, imp: 12.63, available: true },
      { id: "SOLO-520", wp: 520, voc: 49.9, vmp: 40.8, isc: 13.40, imp: 12.79, available: true },
    ],
  },
  {
    family: "E.ON Aura JN440BB",
    source: "E_ON_Aura_440",
    note: "n-type bifacial, β_Voc -0,250%/°C",
    betaVoc: -0.250,
    vsysMax: 1500,
    variants: [
      { id: "JN440BB-54G3", wp: 440, voc: 38.90, vmp: 32.47, isc: 14.31, imp: 13.55, available: true },
    ],
  },
];

const INVERTER_DB = [
  {
    family: "GoodWe DNS G3 (1-fase)",
    source: "GW_DNS-G3",
    note: "Enkelfase residentieel, 2 MPPT, 1 string/MPPT",
    variants: [
      { id: "GW3000-DNS-30", pmax: 4500, vmax: 600, vmpptMin: 40, vmpptMax: 560, imppt: 16, isc: 23, nMppt: 2, stringsPerMppt: 1, pacNom: 3000, iacMax: 14.4, available: true },
      { id: "GW3600-DNS-30", pmax: 5400, vmax: 600, vmpptMin: 40, vmpptMax: 560, imppt: 16, isc: 23, nMppt: 2, stringsPerMppt: 1, pacNom: 3600, iacMax: 17.3, available: true },
      { id: "GW4200-DNS-30", pmax: 6300, vmax: 600, vmpptMin: 40, vmpptMax: 560, imppt: 16, isc: 23, nMppt: 2, stringsPerMppt: 1, pacNom: 4200, iacMax: 20.1, available: true },
      { id: "GW5000-DNS-30", pmax: 7500, vmax: 600, vmpptMin: 40, vmpptMax: 560, imppt: 16, isc: 23, nMppt: 2, stringsPerMppt: 1, pacNom: 5000, iacMax: 24.0, available: true },
      { id: "GW6000-DNS-30", pmax: 9000, vmax: 600, vmpptMin: 40, vmpptMax: 560, imppt: 16, isc: 23, nMppt: 2, stringsPerMppt: 1, pacNom: 6000, iacMax: 28.8, available: true },
    ],
  },
  {
    family: "GoodWe XS G3 (1-fase EMEA)",
    source: "GW_XS-G3",
    note: "Compacte enkelfase, 1 MPPT, 1 string",
    variants: [
      { id: "GW700-XS-30", pmax: 1050, vmax: 600, vmpptMin: 40, vmpptMax: 450, imppt: 16, isc: 25, nMppt: 1, stringsPerMppt: 1, pacNom: 700, iacMax: 3.2, available: true },
      { id: "GW1000-XS-30", pmax: 1500, vmax: 600, vmpptMin: 40, vmpptMax: 450, imppt: 16, isc: 25, nMppt: 1, stringsPerMppt: 1, pacNom: 1000, iacMax: 4.6, available: true },
      { id: "GW1500-XS-30", pmax: 2250, vmax: 600, vmpptMin: 40, vmpptMax: 450, imppt: 16, isc: 25, nMppt: 1, stringsPerMppt: 1, pacNom: 1500, iacMax: 6.9, available: true },
      { id: "GW2000-XS-30", pmax: 3000, vmax: 600, vmpptMin: 40, vmpptMax: 450, imppt: 16, isc: 25, nMppt: 1, stringsPerMppt: 1, pacNom: 2000, iacMax: 9.1, available: true },
      { id: "GW2500-XS-30", pmax: 3750, vmax: 600, vmpptMin: 40, vmpptMax: 450, imppt: 16, isc: 25, nMppt: 1, stringsPerMppt: 1, pacNom: 2500, iacMax: 11.4, available: true },
      { id: "GW3000-XS-30", pmax: 4500, vmax: 600, vmpptMin: 40, vmpptMax: 450, imppt: 16, isc: 25, nMppt: 1, stringsPerMppt: 1, pacNom: 3000, iacMax: 13.7, available: true },
    ],
  },
  {
    family: "GoodWe SDT G3 (3-fase)",
    source: "SDT-G3",
    note: "Driefase commercieel, 3-4 MPPT, 2 strings/MPPT",
    variants: [
      { id: "GW25K-SDT-30", pmax: 45000, vmax: 1100, vmpptMin: 140, vmpptMax: 950, imppt: 40, isc: 50, nMppt: 3, stringsPerMppt: 2, pacNom: 25000, iacMax: 37.9, available: true },
      { id: "GW30K-SDT-30", pmax: 54000, vmax: 1100, vmpptMin: 140, vmpptMax: 950, imppt: 42, isc: 52.5, nMppt: 3, stringsPerMppt: 2, pacNom: 30000, iacMax: 45.5, available: true },
      { id: "GW33K-SDT-C30", pmax: 59400, vmax: 1100, vmpptMin: 140, vmpptMax: 1000, imppt: 40, isc: 56, nMppt: 3, stringsPerMppt: 2, pacNom: 33000, iacMax: 50.1, available: true },
      { id: "GW36K-SDT-C30", pmax: 64800, vmax: 1100, vmpptMin: 140, vmpptMax: 1000, imppt: 40, isc: 56, nMppt: 3, stringsPerMppt: 2, pacNom: 36000, iacMax: 54.6, available: true },
      { id: "GW40K-SDT-C30", pmax: 72000, vmax: 1100, vmpptMin: 140, vmpptMax: 1000, imppt: 40, isc: 56, nMppt: 3, stringsPerMppt: 2, pacNom: 40000, iacMax: 60.7, available: true },
      { id: "GW40K-SDT-P30", pmax: 72000, vmax: 1100, vmpptMin: 140, vmpptMax: 1000, imppt: 40, isc: 56, nMppt: 4, stringsPerMppt: 2, pacNom: 40000, iacMax: 60.6, available: true },
    ],
  },
  {
    family: "AlphaESS SMILE-G3 T15/T20 (3-fase hybride)",
    source: "alphaess_smile-g3-t15-t20",
    note: "Hybride, 3 MPPT, 1 string/MPPT, 1000 V",
    variants: [
      { id: "SMILE-G3-T15", pmax: 30000, vmax: 1000, vmpptMin: 200, vmpptMax: 850, imppt: 18, isc: 22.5, nMppt: 3, stringsPerMppt: 1, pacNom: 15000, iacMax: 24.0, available: true },
      { id: "SMILE-G3-T20", pmax: 40000, vmax: 1000, vmpptMin: 200, vmpptMax: 850, imppt: 18, isc: 22.5, nMppt: 3, stringsPerMppt: 1, pacNom: 20000, iacMax: 32.0, available: true },
    ],
  },
  {
    family: "AlphaESS SMILE-G3 T4-T10 (3-fase hybride)",
    source: "alphaess_smile-g3-t4-t10",
    note: "Hybride residentieel, 3 MPPT, 1 string/MPPT, 1000 V",
    variants: [
      { id: "SMILE-G3-T4", pmax: 20000, vmax: 1000, vmpptMin: 140, vmpptMax: 950, imppt: 16, isc: 24, nMppt: 3, stringsPerMppt: 1, pacNom: 4000, iacMax: 7.3, available: true },
      { id: "SMILE-G3-T5", pmax: 20000, vmax: 1000, vmpptMin: 140, vmpptMax: 950, imppt: 16, isc: 24, nMppt: 3, stringsPerMppt: 1, pacNom: 5000, iacMax: 9.1, available: true },
      { id: "SMILE-G3-T6", pmax: 20000, vmax: 1000, vmpptMin: 140, vmpptMax: 950, imppt: 16, isc: 24, nMppt: 3, stringsPerMppt: 1, pacNom: 6000, iacMax: 11.0, available: true },
      { id: "SMILE-G3-T8", pmax: 20000, vmax: 1000, vmpptMin: 140, vmpptMax: 950, imppt: 16, isc: 24, nMppt: 3, stringsPerMppt: 1, pacNom: 8000, iacMax: 14.5, available: true },
      { id: "SMILE-G3-T10", pmax: 20000, vmax: 1000, vmpptMin: 140, vmpptMax: 950, imppt: 16, isc: 24, nMppt: 3, stringsPerMppt: 1, pacNom: 10000, iacMax: 18.1, available: true },
    ],
  },
  {
    family: "AlphaESS STORION H30/H50-G3 (3-fase C&I hybride)",
    source: "alphaess_storion-h30-h50",
    note: "Commercieel hybride, 4 MPPT, 2 strings/MPPT",
    variants: [
      { id: "STORION-H30-G3", pmax: 60000, vmax: 1000, vmpptMin: 200, vmpptMax: 850, imppt: 40, isc: 50, nMppt: 4, stringsPerMppt: 2, pacNom: 30000, iacMax: 45.5, available: true },
      { id: "STORION-H50-G3", pmax: 75000, vmax: 1000, vmpptMin: 330, vmpptMax: 850, imppt: 40, isc: 50, nMppt: 4, stringsPerMppt: 2, pacNom: 50000, iacMax: 75.8, available: true },
    ],
  },
  {
    family: "Huawei SUN2000 MB0 (3-fase)",
    source: "SUN2000_MB0",
    note: "Driefase, 2 MPPT, max 2 strings/MPPT (30A bij 2 strings, 20A enkel)",
    variants: [
      { id: "SUN2000-12K-MB0", pmax: 18000, vmax: 1100, vmpptMin: 200, vmpptMax: 1000, imppt: 20, isc: 40, nMppt: 2, stringsPerMppt: 2, pacNom: 12000, iacMax: 19.1, available: true },
      { id: "SUN2000-15K-MB0", pmax: 22500, vmax: 1100, vmpptMin: 200, vmpptMax: 1000, imppt: 20, isc: 40, nMppt: 2, stringsPerMppt: 2, pacNom: 15000, iacMax: 23.9, available: true },
      { id: "SUN2000-17K-MB0", pmax: 25500, vmax: 1100, vmpptMin: 200, vmpptMax: 1000, imppt: 20, isc: 40, nMppt: 2, stringsPerMppt: 2, pacNom: 17000, iacMax: 27.1, available: true },
      { id: "SUN2000-20K-MB0", pmax: 30000, vmax: 1100, vmpptMin: 200, vmpptMax: 1000, imppt: 20, isc: 40, nMppt: 2, stringsPerMppt: 2, pacNom: 20000, iacMax: 31.9, available: true },
      { id: "SUN2000-25K-MB0", pmax: 37500, vmax: 1100, vmpptMin: 200, vmpptMax: 1000, imppt: 20, isc: 40, nMppt: 2, stringsPerMppt: 2, pacNom: 25000, iacMax: 39.9, available: true },
    ],
  },
  {
    family: "Huawei SUN2000 KTL-M2 (3-fase grootverbruik)",
    source: "SUN2000_KTL_M2",
    note: "Driefase utility, 10 MPPT × 2 strings, 1100 V",
    variants: [
      { id: "SUN2000-100KTL-M2", pmax: 150000, vmax: 1100, vmpptMin: 200, vmpptMax: 1000, imppt: 30, isc: 40, nMppt: 10, stringsPerMppt: 2, pacNom: 100000, iacMax: 160.4, available: true },
      { id: "SUN2000-115KTL-M2", pmax: 172500, vmax: 1100, vmpptMin: 200, vmpptMax: 1000, imppt: 30, isc: 40, nMppt: 10, stringsPerMppt: 2, pacNom: 115000, iacMax: 182.3, available: true },
    ],
  },
];

// ----------------------------------------------------------------------------
// AANSLUITING & AFZEKERING
// ----------------------------------------------------------------------------

const STD_FUSES = [10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200];

// Nederlandse aansluitwaarden, van klein tot grootverbruik.
// fase = 1 of 3, amps = ampère per fase.
const CONNECTIONS = [
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

function getConn(connId) {
  return CONNECTIONS.find((c) => c.id === connId) || CONNECTIONS[3];
}

// Minimale afzekering = max. AC-stroom × 1,25, afgerond naar eerstvolgende
// standaardzekering.
function minFuse(iacMax) {
  const required = iacMax * 1.25;
  return STD_FUSES.find((f) => f >= required) || Math.ceil(required);
}

// Past de omvormer-uitgangsstroom binnen de aansluitwaarde per fase?
// (Som van uitgangsstromen van alle omvormers ≤ ampère per fase.)
function inverterFitsConnection(iacMax, connAmpsPerPhase) {
  return iacMax <= connAmpsPerPhase;
}

// ============================================================================
// REKENKERN — deterministisch, geen AI
// ============================================================================

// Voc bij lage temperatuur. β_Voc is negatief (%/°C); bij T < 25 stijgt Voc.
function vocAtTemp(vocStc, betaVocPct, tCell) {
  return vocStc * (1 + (betaVocPct / 100) * (tCell - 25));
}

// Vmp bij hoge temperatuur (voor ondergrens-check MPPT). We gebruiken dezelfde
// β als benadering (Vmp-tempco ≈ Voc-tempco voor deze check).
function vmpAtTemp(vmpStc, betaVocPct, tCell) {
  return vmpStc * (1 + (betaVocPct / 100) * (tCell - 25));
}

function checkConfig({ panel, inverter, nPerString, stringsPerMppt, tMinCold, tMaxHot }) {
  const checks = [];
  const stringsPerMpptN = stringsPerMppt;

  // 1. Spanning bij kou (maatgevend voor Vmax)
  const vocCold = vocAtTemp(panel.voc, panel.betaVoc, tMinCold) * nPerString;
  checks.push({
    label: `Voc bij ${tMinCold}°C (string)`,
    value: `${vocCold.toFixed(0)} V`,
    limit: `< ${inverter.vmax} V`,
    pass: vocCold < inverter.vmax,
  });

  // 2. Voc bij STC (referentie)
  const vocStc = panel.voc * nPerString;
  checks.push({
    label: "Voc bij STC (string)",
    value: `${vocStc.toFixed(0)} V`,
    limit: `< ${inverter.vmax} V`,
    pass: vocStc < inverter.vmax,
  });

  // 3. Vmp binnen MPPT-bereik (bovengrens, koud)
  const vmpCold = vmpAtTemp(panel.vmp, panel.betaVoc, tMinCold) * nPerString;
  checks.push({
    label: `Vmp bij ${tMinCold}°C (string)`,
    value: `${vmpCold.toFixed(0)} V`,
    limit: `≤ ${inverter.vmpptMax} V`,
    pass: vmpCold <= inverter.vmpptMax,
  });

  // 4. Vmp binnen MPPT-bereik (ondergrens, heet)
  const vmpHot = vmpAtTemp(panel.vmp, panel.betaVoc, tMaxHot) * nPerString;
  checks.push({
    label: `Vmp bij ${tMaxHot}°C (string)`,
    value: `${vmpHot.toFixed(0)} V`,
    limit: `≥ ${inverter.vmpptMin} V`,
    pass: vmpHot >= inverter.vmpptMin,
  });

  // 5. Stroom per MPPT (Imp × parallelle strings)
  const impTotal = panel.imp * stringsPerMpptN;
  checks.push({
    label: `Imp per MPPT (${stringsPerMpptN}× string)`,
    value: `${impTotal.toFixed(1)} A`,
    limit: `≤ ${inverter.imppt} A`,
    pass: impTotal <= inverter.imppt,
  });

  // 6. Kortsluitstroom per MPPT
  const iscTotal = panel.isc * stringsPerMpptN;
  checks.push({
    label: `Isc per MPPT (${stringsPerMpptN}× string)`,
    value: `${iscTotal.toFixed(1)} A`,
    limit: `≤ ${inverter.isc} A`,
    pass: iscTotal <= inverter.isc,
  });

  // 7. Strings per MPPT binnen connectorlimiet
  checks.push({
    label: "Strings per MPPT",
    value: `${stringsPerMpptN}`,
    limit: `≤ ${inverter.stringsPerMppt}`,
    pass: stringsPerMpptN <= inverter.stringsPerMppt,
  });

  return checks;
}

function allPass(checks) {
  return checks.every((c) => c.pass);
}

// Zoek voor een gegeven paneel + totaal aantal panelen de omvormers die passen.
// Probeert per omvormer een verdeling te vinden (gelijke strings over MPPT's).
function findMatchingInverters({ panel, totalPanels, tMinCold, tMaxHot, availableInverters }) {
  const results = [];
  const totalWp = totalPanels * panel.wp;
  for (const inv of availableInverters) {
    const maxStringsPerInv = inv.nMppt * inv.stringsPerMppt;
    let best = null;
    // Probeer string-lengte van LANG naar kort: langere strings → minder strings.
    for (let nPer = 40; nPer >= 2; nPer--) {
      const stringsTotal = Math.ceil(totalPanels / nPer);
      const minInvByStrings = Math.ceil(stringsTotal / maxStringsPerInv);
      const minInvByPower = Math.ceil(totalWp / inv.pmax);
      // Minimaal benodigde omvormers: begrensd door strings én door pmax (de
      // fabrikant-max PV-input). pmax is de harde grens — overdimensionering
      // boven 150% is toegestaan zolang het DC-vermogen onder pmax blijft.
      let invCount = Math.max(minInvByStrings, minInvByPower);
      const stringsPerInv = Math.ceil(stringsTotal / invCount);
      const stringsPerMpptUsed = Math.ceil(stringsPerInv / inv.nMppt);
      const checks = checkConfig({ panel, inverter: inv, nPerString: nPer, stringsPerMppt: stringsPerMpptUsed, tMinCold, tMaxHot });
      const wpPerInv = totalWp / invCount;
      const powerOk = wpPerInv <= inv.pmax;
      const dcAcRatio = totalWp / (inv.pacNom * invCount);
      if (allPass(checks) && powerOk) {
        // sweet spot: in 120-150% band met zo min mogelijk omvormers
        const inBand = dcAcRatio >= 1.2 && dcAcRatio <= 1.5;
        const highOverdim = dcAcRatio > 1.5;
        best = { nPerString: nPer, stringsTotal, invCount, stringsPerInv, stringsPerMpptUsed, totalWp, totalAc: inv.pacNom * invCount, dcAcRatio, inBand, highOverdim };
        break;
      }
    }
    if (best) results.push({ inverter: inv, ...best });
  }
  // GoodWe bovenaan; daarbinnen: eerst opties in de 120-150% band, dan minste
  // omvormers, dan dichtst bij 135% (midden van de band).
  results.sort((a, b) => {
    if (!!a.inverter.isGoodwe !== !!b.inverter.isGoodwe) return a.inverter.isGoodwe ? -1 : 1;
    if (a.inBand !== b.inBand) return a.inBand ? -1 : 1;
    if (a.invCount !== b.invCount) return a.invCount - b.invCount;
    return Math.abs(a.dcAcRatio - 1.35) - Math.abs(b.dcAcRatio - 1.35);
  });
  return results;
}

// ----------------------------------------------------------------------------
// LEGPLAN-LOGICA
// Een legplan = lijst strings, elk met {n panelen, paneel, azimuth, helling}.
// We wijzen strings toe aan MPPT's, oriëntatie-bewust, en checken elke MPPT.
// ----------------------------------------------------------------------------

// Automatische toewijzing: groepeer op azimuth, vul MPPT's zo dat strings met
// dezelfde oriëntatie bij elkaar komen. Respecteert stringsPerMppt en nMppt.
function autoAssign(strings, inverter) {
  const slots = inverter.stringsPerMppt;
  const mppts = Array.from({ length: inverter.nMppt }, () => []);
  // sorteer strings: zelfde azimuth bij elkaar, grootste groepen eerst
  const byAz = {};
  strings.forEach((s, i) => {
    const key = `${s.azimuth}`;
    (byAz[key] = byAz[key] || []).push(i);
  });
  const groups = Object.values(byAz).sort((a, b) => b.length - a.length);
  const ordered = groups.flat();
  // vul MPPT's: probeer per MPPT vol te maken met dezelfde oriëntatie
  let mi = 0;
  for (const si of ordered) {
    let placed = false;
    // zoek een MPPT die nog ruimte heeft en (liefst) zelfde azimuth bevat
    const az = strings[si].azimuth;
    let target = mppts.findIndex((m) => m.length < slots && m.length > 0 && strings[m[0]].azimuth === az);
    if (target === -1) target = mppts.findIndex((m) => m.length === 0);
    if (target === -1) target = mppts.findIndex((m) => m.length < slots);
    if (target !== -1) {
      mppts[target].push(si);
      placed = true;
    }
    if (!placed) return { mppts, overflow: true };
  }
  return { mppts, overflow: false };
}

// Multi-omvormer: bepaal hoeveel omvormers van een type nodig zijn voor een
// heel legplan, en of elke string + verdeling elektrisch past.
function checkLegplanMulti(strings, inverter, tMinCold, tMaxHot) {
  if (strings.length === 0) return null;
  const maxStringsPerInv = inverter.nMppt * inverter.stringsPerMppt;
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
  const minInvByStrings = Math.ceil(stringsTotal / maxStringsPerInv);
  const totalWp = strings.reduce((sum, s) => sum + s.n * s.panel.wp, 0);
  const minInvByPower = Math.ceil(totalWp / inverter.pmax);
  // pmax is de harde grens; overdimensionering boven 150% toegestaan zolang
  // het DC-vermogen per omvormer onder pmax blijft.
  let invCount = Math.max(minInvByStrings, minInvByPower);
  const stringsPerInv = Math.ceil(stringsTotal / invCount);
  const wpPerInv = totalWp / invCount;
  const powerOk = wpPerInv <= inverter.pmax;
  const dcAcRatio = totalWp / (inverter.pacNom * invCount);
  const inBand = dcAcRatio >= 1.2 && dcAcRatio <= 1.5;
  const highOverdim = dcAcRatio > 1.5;
  const azimuths = new Set(strings.map((s) => s.azimuth));
  const anyMixed = azimuths.size > 1 && stringsPerInv > inverter.nMppt;
  const pass = allStringsOk && powerOk;
  return { pass, invCount, stringsPerInv, stringsTotal, totalWp, totalAc: inverter.pacNom * invCount, dcAcRatio, inBand, highOverdim, anyMixed };
}

function checkLegplan(strings, inverter, assignment, tMinCold, tMaxHot) {
  const mpptResults = assignment.mppts.map((stringIdxs, mpptNum) => {
    if (stringIdxs.length === 0) {
      return { mpptNum, empty: true, checks: [], strings: [], mixed: false, pass: true };
    }
    const strs = stringIdxs.map((i) => strings[i]);
    const azimuths = [...new Set(strs.map((s) => s.azimuth))];
    const mixed = azimuths.length > 1;
    // worstcase per check: hoogste Voc-string, som van stromen
    const checks = [];
    // Voc koud — neem de string met meeste panelen (hoogste Voc)
    const vocCold = Math.max(...strs.map((s) => vocAtTemp(s.panel.voc, s.panel.betaVoc, tMinCold) * s.n));
    checks.push({ label: `Voc bij ${tMinCold}°C`, value: `${vocCold.toFixed(0)} V`, limit: `< ${inverter.vmax} V`, pass: vocCold < inverter.vmax });
    const vocStc = Math.max(...strs.map((s) => s.panel.voc * s.n));
    checks.push({ label: "Voc STC", value: `${vocStc.toFixed(0)} V`, limit: `< ${inverter.vmax} V`, pass: vocStc < inverter.vmax });
    const vmpCold = Math.max(...strs.map((s) => vmpAtTemp(s.panel.vmp, s.panel.betaVoc, tMinCold) * s.n));
    checks.push({ label: `Vmp bij ${tMinCold}°C`, value: `${vmpCold.toFixed(0)} V`, limit: `≤ ${inverter.vmpptMax} V`, pass: vmpCold <= inverter.vmpptMax });
    const vmpHot = Math.min(...strs.map((s) => vmpAtTemp(s.panel.vmp, s.panel.betaVoc, tMaxHot) * s.n));
    checks.push({ label: `Vmp bij ${tMaxHot}°C`, value: `${vmpHot.toFixed(0)} V`, limit: `≥ ${inverter.vmpptMin} V`, pass: vmpHot >= inverter.vmpptMin });
    // stroom: parallelle strings tellen op
    const impTotal = strs.reduce((sum, s) => sum + s.panel.imp, 0);
    checks.push({ label: `Imp (${strs.length}× string)`, value: `${impTotal.toFixed(1)} A`, limit: `≤ ${inverter.imppt} A`, pass: impTotal <= inverter.imppt });
    const iscTotal = strs.reduce((sum, s) => sum + s.panel.isc, 0);
    checks.push({ label: `Isc (${strs.length}× string)`, value: `${iscTotal.toFixed(1)} A`, limit: `≤ ${inverter.isc} A`, pass: iscTotal <= inverter.isc });
    checks.push({ label: "Strings", value: `${strs.length}`, limit: `≤ ${inverter.stringsPerMppt}`, pass: strs.length <= inverter.stringsPerMppt });
    return { mpptNum, empty: false, checks, strings: strs, stringIdxs, mixed, pass: allPass(checks) };
  });

  const totalWp = strings.reduce((sum, s) => sum + s.n * s.panel.wp, 0);
  const powerOk = totalWp <= inverter.pmax;
  const allAssigned = assignment.mppts.flat().length === strings.length && !assignment.overflow;
  const pass = mpptResults.every((m) => m.pass) && powerOk && allAssigned;
  const anyMixed = mpptResults.some((m) => m.mixed);

  return { mpptResults, totalWp, powerOk, allAssigned, pass, anyMixed };
}

// ============================================================================
// UI
// ============================================================================

const card = {
  background: "var(--color-background-primary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "1rem 1.25rem",
};
const muted = { color: "var(--color-text-secondary)" };
const label = { fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 4 };

export default function PVConfigurator() {
  const [panelDb, setPanelDb] = useState(PANEL_DB);
  const [inverterDb, setInverterDb] = useState(INVERTER_DB);
  const [mode, setMode] = useState("check"); // "check" | "find" | "legplan" | "library"

  const [tMinCold, setTMinCold] = useState(-10);
  const [tMaxHot, setTMaxHot] = useState(70);

  // Hoofdaansluiting: één keuze (fasen + ampère per fase samen)
  const [connId, setConnId] = useState("3x25");

  // check-mode selecties
  const [selPanelId, setSelPanelId] = useState("JAM54D41-430/GB");
  const [selInvId, setSelInvId] = useState("SUN2000-20K-MB0");
  const [nPerString, setNPerString] = useState(25);
  const [stringsPerMppt, setStringsPerMppt] = useState(1);

  // find-mode
  const [findPanelId, setFindPanelId] = useState("JAM54D41-430/GB");
  const [totalPanels, setTotalPanels] = useState(76);

  // legplan-mode: lijst strings
  const [legStrings, setLegStrings] = useState([
    { n: 19, panelId: "JAM54D41-430/GB", azimuth: 323, helling: 5 },
    { n: 19, panelId: "JAM54D41-430/GB", azimuth: 142, helling: 5 },
    { n: 19, panelId: "JAM54D41-430/GB", azimuth: 142, helling: 5 },
    { n: 19, panelId: "JAM54D41-430/GB", azimuth: 142, helling: 5 },
  ]);
  const [legInvId, setLegInvId] = useState("SUN2000-20K-MB0");
  const [legAssignMode, setLegAssignMode] = useState("auto"); // "auto" | "manual"
  const [manualAssign, setManualAssign] = useState(null); // [[idx,...], ...] per MPPT

  const availPanels = useMemo(
    () => panelDb.flatMap((f) => f.variants.filter((v) => v.available).map((v) => ({ ...v, betaVoc: f.betaVoc, vsysMax: f.vsysMax, family: f.family }))),
    [panelDb]
  );
  const conn = useMemo(() => getConn(connId), [connId]);
  // Alle beschikbare omvormers met afzekering en aansluitvlag — niet uitsluiten,
  // alleen markeren (overschrijding = waarschuwing, geen verberging).
  const availInverters = useMemo(
    () =>
      inverterDb.flatMap((f) =>
        f.variants
          .filter((v) => v.available)
          .map((v) => ({
            ...v,
            family: f.family,
            minFuse: minFuse(v.iacMax),
            fitsConn: inverterFitsConnection(v.iacMax, conn.amps),
            isGoodwe: /goodwe/i.test(f.family),
          }))
      ),
    [inverterDb, conn]
  );

  const selPanel = availPanels.find((p) => p.id === selPanelId) || availPanels[0];
  const selInv = availInverters.find((i) => i.id === selInvId) || availInverters[0];

  const checks = useMemo(() => {
    if (!selPanel || !selInv) return [];
    return checkConfig({ panel: selPanel, inverter: selInv, nPerString, stringsPerMppt, tMinCold, tMaxHot });
  }, [selPanel, selInv, nPerString, stringsPerMppt, tMinCold, tMaxHot]);

  const passing = checks.length > 0 && allPass(checks);

  const findPanel = availPanels.find((p) => p.id === findPanelId) || availPanels[0];
  const matches = useMemo(() => {
    if (mode !== "find" || !findPanel) return [];
    return findMatchingInverters({ panel: findPanel, totalPanels, tMinCold, tMaxHot, availableInverters: availInverters });
  }, [mode, findPanel, totalPanels, tMinCold, tMaxHot, availInverters]);

  // Legplan: koppel paneeldata aan elke string
  const legStringsResolved = useMemo(
    () =>
      legStrings.map((s) => ({
        ...s,
        panel: availPanels.find((p) => p.id === s.panelId) || availPanels[0],
      })),
    [legStrings, availPanels]
  );
  const legInv = availInverters.find((i) => i.id === legInvId) || availInverters[0];

  const legAssignment = useMemo(() => {
    if (!legInv) return { mppts: [], overflow: false };
    if (legAssignMode === "manual" && manualAssign) {
      // zorg dat de array de juiste lengte heeft
      const m = Array.from({ length: legInv.nMppt }, (_, i) => manualAssign[i] || []);
      return { mppts: m, overflow: legStrings.length !== m.flat().length };
    }
    return autoAssign(legStringsResolved, legInv);
  }, [legAssignMode, manualAssign, legStringsResolved, legInv, legStrings.length]);

  const legResult = useMemo(() => {
    if (!legInv || legStringsResolved.length === 0) return null;
    return checkLegplan(legStringsResolved, legInv, legAssignment, tMinCold, tMaxHot);
  }, [legInv, legStringsResolved, legAssignment, tMinCold, tMaxHot]);

  // welke omvormers passen op dit hele legplan? Multi-omvormer: bereken aantal
  // benodigde units. Werkt ook als het legplan groter is dan één omvormer.
  const legMatches = useMemo(() => {
    if (mode !== "legplan") return [];
    return availInverters
      .map((inv) => {
        const m = checkLegplanMulti(legStringsResolved, inv, tMinCold, tMaxHot);
        return { inv, m };
      })
      .filter((x) => x.m && x.m.pass)
      .sort((a, b) => {
        if (a.inv.isGoodwe !== b.inv.isGoodwe) return a.inv.isGoodwe ? -1 : 1;
        if (a.m.inBand !== b.m.inBand) return a.m.inBand ? -1 : 1;
        if (a.m.invCount !== b.m.invCount) return a.m.invCount - b.m.invCount;
        return Math.abs(a.m.dcAcRatio - 1.35) - Math.abs(b.m.dcAcRatio - 1.35);
      });
  }, [mode, availInverters, legStringsResolved, tMinCold, tMaxHot]);

  function updateLegString(idx, field, value) {
    setLegStrings((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
    setManualAssign(null);
  }
  function addLegString() {
    setLegStrings((prev) => [...prev, { n: 19, panelId: availPanels[0].id, azimuth: 180, helling: 35 }]);
    setManualAssign(null);
  }
  function removeLegString(idx) {
    setLegStrings((prev) => prev.filter((_, i) => i !== idx));
    setManualAssign(null);
  }
  function assignToMppt(stringIdx, mpptIdx) {
    setLegAssignMode("manual");
    setManualAssign((prev) => {
      const base = prev ? prev.map((a) => [...a]) : Array.from({ length: legInv.nMppt }, () => []);
      // verwijder string overal
      for (const arr of base) {
        const p = arr.indexOf(stringIdx);
        if (p !== -1) arr.splice(p, 1);
      }
      if (mpptIdx >= 0) base[mpptIdx].push(stringIdx);
      return base;
    });
  }

  function toggleVariant(dbType, family, id) {
    const setter = dbType === "panel" ? setPanelDb : setInverterDb;
    setter((prev) =>
      prev.map((f) =>
        f.family !== family ? f : { ...f, variants: f.variants.map((v) => (v.id === id ? { ...v, available: !v.available } : v)) }
      )
    );
  }
  function toggleFamily(dbType, family, value) {
    const setter = dbType === "panel" ? setPanelDb : setInverterDb;
    setter((prev) =>
      prev.map((f) => (f.family !== family ? f : { ...f, variants: f.variants.map((v) => ({ ...v, available: value })) }))
    );
  }

  const tabBtn = (id, text) => (
    <button
      onClick={() => setMode(id)}
      style={{
        padding: "8px 14px",
        border: "0.5px solid var(--color-border-secondary)",
        borderRadius: "var(--border-radius-md)",
        background: mode === id ? "var(--color-background-info)" : "transparent",
        color: mode === id ? "var(--color-text-info)" : "var(--color-text-primary)",
        cursor: "pointer",
        fontSize: 14,
      }}
    >
      {text}
    </button>
  );

  return (
    <div style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-primary)", padding: "1rem 0", maxWidth: 880 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabBtn("check", "Configuratie checken")}
        {tabBtn("find", "Omvormer zoeken")}
        {tabBtn("legplan", "Legplan-check")}
        {tabBtn("library", "Componenten beheren")}
      </div>

      {/* Hoofdaansluiting + temperatuurinstellingen */}
      {mode !== "library" && (
        <>
          <div style={{ ...card, marginBottom: 12, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <div style={label}>Hoofdaansluiting klant</div>
              <select value={connId} onChange={(e) => setConnId(e.target.value)} style={{ width: 130 }}>
                {CONNECTIONS.map((c) => (
                  <option key={c.id} value={c.id}>{c.phases}×{c.amps} A</option>
                ))}
              </select>
              <div style={{ fontSize: 12, ...muted, marginTop: 4 }}>
                {conn.amps} A per fase beschikbaar voor teruglevering
              </div>
            </div>
            <div>
              <div style={label}>Ontwerp-min temp (koud)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="range" min={-25} max={5} step={1} value={tMinCold} onChange={(e) => setTMinCold(+e.target.value)} style={{ width: 140 }} />
                <span style={{ fontWeight: 500, minWidth: 48 }}>{tMinCold}°C</span>
              </div>
            </div>
            <div>
              <div style={label}>Cel-max temp (heet)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="range" min={40} max={85} step={1} value={tMaxHot} onChange={(e) => setTMaxHot(+e.target.value)} style={{ width: 140 }} />
                <span style={{ fontWeight: 500, minWidth: 48 }}>{tMaxHot}°C</span>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11, ...muted, marginBottom: 16 }}>
            Defaults: −10 °C is de gangbare NL-ontwerpondergrens. 70 °C cel-max = worstcase NL-zomer (~40 °C lucht + ~30 °C opwarming onder volle zon).
          </div>
        </>
      )}

      {/* CHECK MODE */}
      {mode === "check" && selPanel && selInv && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div style={card}>
              <div style={label}>Paneel</div>
              <select value={selPanelId} onChange={(e) => setSelPanelId(e.target.value)} style={{ width: "100%", marginBottom: 8 }}>
                {availPanels.map((p) => (
                  <option key={p.id} value={p.id}>{p.id} — {p.wp} Wp</option>
                ))}
              </select>
              <div style={{ fontSize: 12, ...muted }}>
                Voc {selPanel.voc} V · Vmp {selPanel.vmp} V · Isc {selPanel.isc} A · Imp {selPanel.imp} A · β {selPanel.betaVoc}%/°C
              </div>
            </div>
            <div style={card}>
              <div style={label}>Omvormer</div>
              <select value={selInvId} onChange={(e) => setSelInvId(e.target.value)} style={{ width: "100%", marginBottom: 8 }}>
                {availInverters.map((i) => (
                  <option key={i.id} value={i.id}>{i.id}</option>
                ))}
              </select>
              <div style={{ fontSize: 12, ...muted }}>
                Vmax {selInv.vmax} V · MPPT {selInv.vmpptMin}-{selInv.vmpptMax} V · {selInv.imppt} A/{selInv.isc} A · {selInv.nMppt} MPPT × {selInv.stringsPerMppt}
                <br />Max. AC {selInv.iacMax} A → min. afzekering <b style={{ color: "var(--color-text-primary)" }}>{selInv.minFuse} A</b> (1,25×, eerstvolgende standaard)
                {!selInv.fitsConn && (
                  <span style={{ color: "var(--color-text-danger)", display: "block", marginTop: 4 }}>
                    Uitgang {selInv.iacMax} A &gt; aansluiting {conn.amps} A/fase — verdeelkast-aanpassing nodig, zonder accu beperkt rendabel (aftopverliezen).
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ ...card, marginBottom: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={label}>Panelen per string</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="range" min={2} max={40} step={1} value={nPerString} onChange={(e) => setNPerString(+e.target.value)} style={{ width: 160 }} />
                <span style={{ fontWeight: 500, minWidth: 28 }}>{nPerString}</span>
              </div>
            </div>
            <div>
              <div style={label}>Strings per MPPT (parallel)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="range" min={1} max={4} step={1} value={stringsPerMppt} onChange={(e) => setStringsPerMppt(+e.target.value)} style={{ width: 120 }} />
                <span style={{ fontWeight: 500, minWidth: 20 }}>{stringsPerMppt}</span>
              </div>
            </div>
          </div>

          <div
            style={{
              ...card,
              marginBottom: 12,
              borderLeft: `3px solid ${passing ? "var(--color-border-success)" : "var(--color-border-danger)"}`,
              borderRadius: "var(--border-radius-md)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <i className={`ti ${passing ? "ti-check" : "ti-x"}`} style={{ fontSize: 20, color: passing ? "var(--color-text-success)" : "var(--color-text-danger)" }} aria-hidden="true" />
              <span style={{ fontWeight: 500, fontSize: 16 }}>
                {passing ? "Configuratie past binnen alle grenzen" : "Configuratie overschrijdt een of meer grenzen"}
              </span>
            </div>
          </div>

          <div style={{ ...card }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", ...muted }}>
                  <th style={{ padding: "6px 0" }}>Check</th>
                  <th style={{ padding: "6px 0" }}>Waarde</th>
                  <th style={{ padding: "6px 0" }}>Limiet</th>
                  <th style={{ padding: "6px 0", textAlign: "right" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c, i) => (
                  <tr key={i} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={{ padding: "8px 0" }}>{c.label}</td>
                    <td style={{ padding: "8px 0", fontWeight: 500 }}>{c.value}</td>
                    <td style={{ padding: "8px 0", ...muted }}>{c.limit}</td>
                    <td style={{ padding: "8px 0", textAlign: "right" }}>
                      <i className={`ti ${c.pass ? "ti-check" : "ti-x"}`} style={{ color: c.pass ? "var(--color-text-success)" : "var(--color-text-danger)", fontSize: 16 }} aria-label={c.pass ? "ok" : "overschrijding"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* FIND MODE */}
      {mode === "find" && findPanel && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div style={card}>
              <div style={label}>Paneel</div>
              <select value={findPanelId} onChange={(e) => setFindPanelId(e.target.value)} style={{ width: "100%" }}>
                {availPanels.map((p) => (
                  <option key={p.id} value={p.id}>{p.id} — {p.wp} Wp</option>
                ))}
              </select>
            </div>
            <div style={card}>
              <div style={label}>Aantal panelen</div>
              <input type="number" min={1} step={1} value={totalPanels} onChange={(e) => setTotalPanels(Math.max(1, +e.target.value || 0))} style={{ width: 120 }} />
              <div style={{ fontSize: 12, ...muted, marginTop: 4 }}>{(totalPanels * findPanel.wp / 1000).toFixed(2)} kWp totaal</div>
            </div>
          </div>

          {matches.length === 0 ? (
            <div style={{ ...card, ...muted }}>
              Geen enkele beschikbare omvormer past {totalPanels}× {findPanel.id} binnen de grenzen bij {tMinCold}°C. Probeer minder panelen, een hogere ontwerptemperatuur, of zet meer omvormers beschikbaar in "Componenten beheren".
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {matches.map((m, i) => (
                <div key={m.inverter.id} style={{ ...card, border: i === 0 ? "2px solid var(--color-border-info)" : card.border }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <span style={{ fontWeight: 500, fontSize: 15 }}>{m.invCount > 1 ? `${m.invCount}× ` : ""}{m.inverter.id}</span>
                      {m.inverter.isGoodwe && <span style={{ background: "var(--color-background-info)", color: "var(--color-text-info)", fontSize: 11, padding: "2px 8px", borderRadius: "var(--border-radius-md)", marginLeft: 8 }}>GoodWe</span>}
                      <span style={{ fontSize: 12, ...muted, marginLeft: 8 }}>{m.inverter.family}</span>
                    </div>
                    {i === 0 && <span style={{ background: "var(--color-background-info)", color: "var(--color-text-info)", fontSize: 12, padding: "3px 10px", borderRadius: "var(--border-radius-md)" }}>Beste match</span>}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 8 }}>
                    {m.stringsTotal} strings × {m.nPerString} panelen
                    {m.invCount > 1 && <span> · {m.stringsPerInv} strings/omvormer</span>}
                    {" · max "}{m.stringsPerMpptUsed}/MPPT · {(m.totalWp / 1000).toFixed(1)} kWp op {(m.totalAc / 1000).toFixed(1)} kW AC
                    {m.invCount > 1 && <span style={{ ...muted }}> ({m.invCount}× {(m.inverter.pacNom / 1000).toFixed(0)} kW)</span>}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    <span style={muted}>Overdimensionering: </span>
                    <b style={{ color: m.highOverdim ? "var(--color-text-warning)" : "var(--color-text-primary)" }}>{(m.dcAcRatio * 100).toFixed(0)}%</b>
                    <span style={{ fontSize: 12, ...muted }}> · min. afzekering {m.inverter.minFuse} A/omvormer</span>
                  </div>
                  {m.highOverdim && (
                    <div style={{ fontSize: 11, color: "var(--color-text-warning)", marginTop: 4 }}>
                      Boven 150% — toegestaan binnen de omvormerspecs (DC onder pmax), maar reken op aftopverliezen op piekmomenten; zonder accu beperkt rendabel.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 12, ...muted, marginTop: 12 }}>
            Verdeling = gelijke strings over alle MPPT's. Bij gemengde oriëntaties of optimizers kan een andere verdeling wenselijk zijn.
          </div>
        </>
      )}

      {/* LEGPLAN MODE */}
      {mode === "legplan" && legInv && legResult && (
        <>
          <div style={{ ...card, marginBottom: 16, background: "var(--color-background-secondary)", border: "none" }}>
            <div style={{ fontSize: 13 }}>
              <i className="ti ti-photo" style={{ fontSize: 16, verticalAlign: -2, marginRight: 6 }} aria-hidden="true" />
              Heb je een Sollit-stringplan als screenshot? Upload 'm in de chat, dan vul ik de strings hieronder voor je in. Of voer ze handmatig in.
            </div>
          </div>

          {/* Strings invoer */}
          <h3 style={{ fontSize: 16, fontWeight: 500, margin: "8px 0" }}>Strings uit legplan</h3>
          <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
            {legStringsResolved.map((s, i) => {
              const azColors = ["#378ADD", "#D85A30", "#1D9E75", "#BA7517", "#534AB7", "#D4537E"];
              const azList = [...new Set(legStrings.map((x) => x.azimuth))];
              const col = azColors[azList.indexOf(s.azimuth) % azColors.length];
              return (
                <div key={i} style={{ ...card, padding: "10px 14px", borderLeft: `3px solid ${col}`, borderRadius: "var(--border-radius-md)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="number" min={1} max={40} value={s.n} onChange={(e) => updateLegString(i, "n", +e.target.value)} style={{ width: 56 }} />
                    <span style={{ fontSize: 13, ...muted }}>×</span>
                  </div>
                  <select value={s.panelId} onChange={(e) => updateLegString(i, "panelId", e.target.value)} style={{ flex: "1 1 180px", minWidth: 140 }}>
                    {availPanels.map((p) => (
                      <option key={p.id} value={p.id}>{p.id} — {p.wp}Wp</option>
                    ))}
                  </select>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 12, ...muted }}>Az</span>
                    <input type="number" min={0} max={359} value={s.azimuth} onChange={(e) => updateLegString(i, "azimuth", +e.target.value)} style={{ width: 60 }} />°
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 12, ...muted }}>Hel</span>
                    <input type="number" min={0} max={90} value={s.helling} onChange={(e) => updateLegString(i, "helling", +e.target.value)} style={{ width: 50 }} />°
                  </div>
                  <button onClick={() => removeLegString(i)} aria-label="verwijder string" style={{ padding: "4px 8px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", color: "var(--color-text-danger)" }}>
                    <i className="ti ti-trash" style={{ fontSize: 15 }} />
                  </button>
                </div>
              );
            })}
          </div>
          <button onClick={addLegString} style={{ fontSize: 13, padding: "6px 12px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", color: "var(--color-text-primary)", marginBottom: 20 }}>
            <i className="ti ti-plus" style={{ fontSize: 15, verticalAlign: -2, marginRight: 4 }} /> String toevoegen
          </button>

          {/* Omvormer + toewijzing */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div style={card}>
              <div style={label}>Omvormer om te checken</div>
              <select value={legInvId} onChange={(e) => { setLegInvId(e.target.value); setManualAssign(null); }} style={{ width: "100%", marginBottom: 8 }}>
                {availInverters.map((i) => (
                  <option key={i.id} value={i.id}>{i.id}</option>
                ))}
              </select>
              <div style={{ fontSize: 12, ...muted }}>
                {legInv.nMppt} MPPT × {legInv.stringsPerMppt} string · Vmax {legInv.vmax} V · {legInv.imppt} A/MPPT
              </div>
            </div>
            <div style={card}>
              <div style={label}>Toewijzing strings → MPPT</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setLegAssignMode("auto"); setManualAssign(null); }} style={{ flex: 1, fontSize: 13, padding: "6px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", cursor: "pointer", background: legAssignMode === "auto" ? "var(--color-background-info)" : "transparent", color: legAssignMode === "auto" ? "var(--color-text-info)" : "var(--color-text-primary)" }}>Automatisch</button>
                <button onClick={() => setLegAssignMode("manual")} style={{ flex: 1, fontSize: 13, padding: "6px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", cursor: "pointer", background: legAssignMode === "manual" ? "var(--color-background-info)" : "transparent", color: legAssignMode === "manual" ? "var(--color-text-info)" : "var(--color-text-primary)" }}>Handmatig</button>
              </div>
              <div style={{ fontSize: 12, ...muted, marginTop: 6 }}>Automatisch houdt zelfde oriëntatie op zelfde MPPT.</div>
            </div>
          </div>

          {/* Eindoordeel */}
          <div style={{ ...card, marginBottom: 12, borderLeft: `3px solid ${legResult.pass ? "var(--color-border-success)" : "var(--color-border-danger)"}`, borderRadius: "var(--border-radius-md)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <i className={`ti ${legResult.pass ? "ti-check" : "ti-x"}`} style={{ fontSize: 20, color: legResult.pass ? "var(--color-text-success)" : "var(--color-text-danger)" }} aria-hidden="true" />
              <span style={{ fontWeight: 500, fontSize: 16 }}>
                {!legResult.allAssigned ? `Te veel strings voor één ${legInv.id}` : legResult.pass ? `Legplan past op de ${legInv.id}` : "Legplan overschrijdt grenzen op deze omvormer"}
              </span>
            </div>
            {!legResult.allAssigned && legStrings.length > legInv.nMppt * legInv.stringsPerMppt && (
              <div style={{ fontSize: 12, color: "var(--color-text-info)", marginTop: 4 }}>
                {legStrings.length} strings passen niet op één omvormer ({legInv.nMppt * legInv.stringsPerMppt} max). Zie "Passende omvormers" hieronder voor het aantal benodigde units.
              </div>
            )}
            <div style={{ fontSize: 13, ...muted, marginTop: 6 }}>
              {(legResult.totalWp / 1000).toFixed(2)} kWp · {legStrings.reduce((s, x) => s + x.n, 0)} panelen · {(legResult.totalWp / legInv.pacNom).toFixed(2)}× DC/AC (1 omvormer)
              {legResult.anyMixed && <span style={{ color: "var(--color-text-warning)" }}> · let op: gemengde oriëntatie op ≥1 MPPT — optimizers nodig</span>}
              {!legResult.powerOk && <span style={{ color: "var(--color-text-danger)" }}> · DC-vermogen boven omvormerlimiet</span>}
            </div>
            <div style={{ fontSize: 13, marginTop: 8, paddingTop: 8, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
              <span style={muted}>Min. afzekering omvormer: </span>
              <b>{legInv.minFuse} A</b>
              <span style={muted}> (max. AC {legInv.iacMax} A × 1,25)</span>
              {!legInv.fitsConn && <span style={{ color: "var(--color-text-danger)" }}> · uitgangsstroom &gt; aansluitwaarde {conn.amps} A/fase</span>}
            </div>
          </div>

          {/* Verdeelkast / aansluiting */}
          <div style={{ ...card, marginBottom: 16, background: "var(--color-background-warning)", border: "none" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <i className="ti ti-alert-triangle" style={{ fontSize: 18, color: "var(--color-text-warning)", marginTop: 2 }} aria-hidden="true" />
              <div style={{ fontSize: 13, color: "var(--color-text-warning)" }}>
                <b>Let op — verdeelkast klant.</b> De verdeelkast moet de opgetelde stromen aankunnen: de hoofdaansluiting ({conn.phases}×{conn.amps} A) plus de uitgangsstroom van alle omvormers samen.
                <div style={{ marginTop: 4 }}>
                  Aansluiting {conn.phases}×{conn.amps} A + omvormer-uitgang {legInv.iacMax} A
                  {" = "}<b>{conn.amps} A + {legInv.iacMax} A ≈ {(conn.amps + legInv.iacMax).toFixed(0)} A per fase</b> die door de kast moet kunnen lopen.
                  {conn.phases === 1 && <span> (1-fase: alles op één fase)</span>}
                </div>
                {!legInv.fitsConn && (
                  <div style={{ marginTop: 6, fontWeight: 500 }}>
                    Uitgangsstroom ({legInv.iacMax} A) overschrijdt de aansluitwaarde ({conn.amps} A/fase): grote aanpassing in de verdeelkast nodig, en zonder accu niet echt rendabel door aftopverliezen.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Per MPPT */}
          <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            {legResult.mpptResults.map((m) => (
              <div key={m.mpptNum} style={{ ...card, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <span style={{ fontWeight: 500 }}>
                    MPPT {m.mpptNum + 1}
                    {m.empty ? <span style={{ ...muted, fontWeight: 400 }}> — leeg</span> : null}
                    {m.mixed && <span style={{ background: "var(--color-background-warning)", color: "var(--color-text-warning)", fontSize: 11, padding: "2px 8px", borderRadius: "var(--border-radius-md)", marginLeft: 8 }}>gemengd</span>}
                  </span>
                  {!m.empty && <i className={`ti ${m.pass ? "ti-check" : "ti-x"}`} style={{ color: m.pass ? "var(--color-text-success)" : "var(--color-text-danger)", fontSize: 18 }} aria-hidden="true" />}
                </div>
                {!m.empty && (
                  <>
                    <div style={{ fontSize: 12, ...muted, margin: "4px 0 8px" }}>
                      {m.strings.map((s, k) => `${s.n}× ${s.panel.wp}Wp @ ${s.azimuth}°`).join("  +  ")}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
                      {m.checks.map((c, k) => (
                        <span key={k} style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4, color: c.pass ? "var(--color-text-secondary)" : "var(--color-text-danger)" }}>
                          <i className={`ti ${c.pass ? "ti-check" : "ti-x"}`} style={{ fontSize: 13 }} />
                          {c.label}: {c.value} ({c.limit})
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {legAssignMode === "manual" && (
                  <div style={{ marginTop: 8, fontSize: 12, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    <span style={muted}>Wijs string toe:</span>
                    {legStringsResolved.map((s, si) => (
                      <button key={si} onClick={() => assignToMppt(si, m.mpptNum)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", background: m.stringIdxs && m.stringIdxs.includes(si) ? "var(--color-background-info)" : "transparent", color: m.stringIdxs && m.stringIdxs.includes(si) ? "var(--color-text-info)" : "var(--color-text-primary)", cursor: "pointer" }}>
                        S{si + 1} ({s.n}@{s.azimuth}°)
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Welke omvormers passen */}
          <h3 style={{ fontSize: 16, fontWeight: 500, margin: "8px 0" }}>Passende omvormers voor dit legplan</h3>
          {legMatches.length === 0 ? (
            <div style={{ ...card, ...muted, fontSize: 13 }}>
              Geen enkele beschikbare omvormer past dit legplan bij {tMinCold}°C. Overweeg het legplan aan te passen (kortere strings tegen overspanning) of een omvormer met meer MPPT's / strings per MPPT.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {legMatches.map(({ inv, m }, i) => {
                const overdim = m.dcAcRatio * 100;
                const overHigh = m.highOverdim;
                const fits = inverterFitsConnection(inv.iacMax * m.invCount, conn.amps);
                return (
                  <div key={inv.id} style={{ ...card, padding: "10px 14px", border: i === 0 ? "2px solid var(--color-border-info)" : card.border }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
                      <span>
                        <span style={{ fontWeight: 500 }}>{m.invCount > 1 ? `${m.invCount}× ` : ""}{inv.id}</span>
                        {inv.isGoodwe && <span style={{ background: "var(--color-background-info)", color: "var(--color-text-info)", fontSize: 11, padding: "2px 8px", borderRadius: "var(--border-radius-md)", marginLeft: 8 }}>GoodWe</span>}
                        <span style={{ fontSize: 12, ...muted, marginLeft: 8 }}>{inv.family}</span>
                      </span>
                      <span style={{ fontSize: 12, ...muted }}>min. afzekering {inv.minFuse} A/omvormer</span>
                    </div>
                    <div style={{ fontSize: 12, marginTop: 6 }}>
                      <span style={muted}>{m.stringsTotal} strings</span>
                      {m.invCount > 1 && <span style={muted}> over {m.invCount} omvormers ({m.stringsPerInv}/omvormer)</span>}
                      <span style={muted}> · {(m.totalWp / 1000).toFixed(1)} kWp op {(m.totalAc / 1000).toFixed(1)} kW AC</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 4, fontSize: 12 }}>
                      <span>
                        <span style={muted}>Overdimensionering: </span>
                        <b style={{ color: overHigh ? "var(--color-text-warning)" : "var(--color-text-primary)" }}>{overdim.toFixed(0)}%</b>
                      </span>
                      {m.anyMixed && <span style={{ color: "var(--color-text-warning)" }}>let op gemengde oriëntatie</span>}
                      {!fits && <span style={{ color: "var(--color-text-danger)" }}>totaal uitgang {(inv.iacMax * m.invCount).toFixed(0)} A &gt; aansluiting {conn.amps} A/fase</span>}
                    </div>
                    {overHigh && (
                      <div style={{ fontSize: 11, color: "var(--color-text-warning)", marginTop: 4 }}>
                        Boven 150% — toegestaan binnen de omvormerspecs (DC onder pmax), maar reken op aftopverliezen op piekmomenten; zonder accu beperkt rendabel.
                      </div>
                    )}
                    {!fits && (
                      <div style={{ fontSize: 11, color: "var(--color-text-danger)", marginTop: 4 }}>
                        Totale uitgangsstroom boven aansluitwaarde: grote aanpassing in verdeelkast nodig; zonder accu niet echt rendabel door aftopverliezen.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* LIBRARY MODE */}
      {mode === "library" && (
        <>
          <p style={{ fontSize: 13, ...muted, marginTop: 0 }}>
            Vink uit wat je leverancier niet voert. Uitgevinkte varianten verdwijnen uit de keuzelijsten en de zoekfunctie.
          </p>
          {[{ key: "panel", db: panelDb, title: "Panelen" }, { key: "inverter", db: inverterDb, title: "Omvormers" }].map(({ key, db, title }) => (
            <div key={key} style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 500, margin: "8px 0" }}>{title}</h3>
              {db.map((f) => {
                const allOn = f.variants.every((v) => v.available);
                return (
                  <div key={f.family} style={{ ...card, marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 500 }}>{f.family}</div>
                        <div style={{ fontSize: 12, ...muted }}>{f.note}</div>
                      </div>
                      <button
                        onClick={() => toggleFamily(key, f.family, !allOn)}
                        style={{ fontSize: 12, padding: "4px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", color: "var(--color-text-primary)" }}
                      >
                        {allOn ? "Alles uit" : "Alles aan"}
                      </button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                      {f.variants.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => toggleVariant(key, f.family, v.id)}
                          style={{
                            fontSize: 12,
                            padding: "5px 10px",
                            borderRadius: "var(--border-radius-md)",
                            border: "0.5px solid var(--color-border-secondary)",
                            cursor: "pointer",
                            background: v.available ? "var(--color-background-info)" : "transparent",
                            color: v.available ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                            textDecoration: v.available ? "none" : "line-through",
                          }}
                        >
                          {v.id}{key === "panel" ? ` · ${v.wp}Wp` : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}

      <div style={{ fontSize: 11, ...muted, marginTop: 20, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 10 }}>
        Ontwerphulp, geen vervanging voor toetsing door een gekwalificeerd persoon. Controleer geëxtraheerde datasheetwaarden vóór gebruik. Voc-koudecorrectie: Voc(T) = Voc_stc × (1 + β/100 × (T−25)).
      </div>
    </div>
  );
}
