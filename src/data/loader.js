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
