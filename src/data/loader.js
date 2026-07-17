// Laadt de component-database uit JSON en verrijkt met afgeleide velden.
import panelsData from "../data/panels.json";
import invertersData from "../data/inverters.json";
import { minFuse } from "../core/calculations.js";

// Platte lijst beschikbare panelen uit een families-array, met
// familie-eigenschappen meegekopieerd. Herbruikbaar voor zowel de statische
// database als een in-memory (UI-state) kopie ervan.
export function flattenPanels(families) {
  return families.flatMap((f) =>
    f.variants
      .filter((v) => v.available)
      .map((v) => ({ ...v, betaVoc: f.betaVoc, vsysMax: f.vsysMax, family: f.family }))
  );
}

// Platte lijst beschikbare omvormers uit een families-array, met afgeleide
// afzekering en GoodWe-vlag.
export function flattenInverters(families) {
  return families.flatMap((f) =>
    f.variants
      .filter((v) => v.available)
      .map((v) => ({
        ...v,
        family: f.family,
        minFuse: minFuse(v.iacMax),
        isGoodwe: /goodwe/i.test(f.family),
      }))
  );
}

export function getAvailablePanels() {
  return flattenPanels(panelsData.families);
}

export function getAvailableInverters() {
  return flattenInverters(invertersData.families);
}

// Volledige families (voor de "Componenten beheren"-tab).
export function getPanelFamilies() {
  return panelsData.families;
}
export function getInverterFamilies() {
  return invertersData.families;
}

// Mixt door gebruikers toegevoegde componenten (uit /api/components) door de
// statische families heen. Puur en side-effect-vrij: geen mutatie van
// staticFamilies. Nieuwe families krijgen altijd verified:false — een
// datasheet-controle blijft een menselijke stap (zie CLAUDE.md). Toegevoegde
// varianten in een bestaande familie krijgen een custom-vlag zodat de UI ze
// als "nog niet gecontroleerd" kan tonen, ook als de familie zelf al
// verified is.
export function mergeCustomComponents(staticFamilies, customRows, type) {
  const rows = customRows.filter((r) => r.type === type);
  const families = staticFamilies.map((f) => ({ ...f, variants: [...f.variants] }));

  for (const row of rows) {
    const variant = { ...row.variant, available: true, custom: true };
    if (row.is_new_family) {
      const existing = families.find((f) => f.family === row.family_name);
      if (existing) {
        existing.variants.push(variant);
      } else {
        families.push({
          family: row.family_name,
          source: null,
          verified: false,
          custom: true,
          ...(row.family_meta || {}),
          variants: [variant],
        });
      }
    } else {
      const target = families.find((f) => f.family === row.family_name);
      if (target) target.variants.push(variant);
    }
  }

  return families;
}

// Plakt gedeelde labels (uit /api/labels) op variants, ongeacht of die
// variant uit de statische JSON komt of via mergeCustomComponents is
// toegevoegd — labels worden los bijgehouden, niet in de familie-data zelf.
export function applyLabels(families, labelRows, type) {
  const byId = new Map(labelRows.filter((r) => r.type === type).map((r) => [r.variant_id, r.label]));
  if (byId.size === 0) return families;
  return families.map((f) => ({
    ...f,
    variants: f.variants.map((v) => (byId.has(v.id) ? { ...v, label: byId.get(v.id) } : v)),
  }));
}
