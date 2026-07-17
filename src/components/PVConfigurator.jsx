import React, { useState, useMemo, useEffect, useRef } from "react";
import { getPanelFamilies, getInverterFamilies, flattenPanels, flattenInverters, mergeCustomComponents, applyLabels } from "../data/loader.js";
import {
  CONNECTIONS,
  getConnection,
  minFuse,
  inverterFitsConnection,
  findMatchingInverters,
  autoAssign,
  checkLegplanMulti,
  checkLegplan,
} from "../core/calculations.js";

// ============================================================================
// UI
// ----------------------------------------------------------------------------
// Alle natuurkunde/optimalisatie komt uit src/core/calculations.js, alle
// componentdata uit src/data/*.json (via loader.js). Dit bestand bevat alleen
// weergave: layout, styling, en het vertalen van rekenresultaten naar tekst.
// ============================================================================

const card = {
  background: "var(--color-background-primary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "1rem 1.25rem",
};
const muted = { color: "var(--color-text-secondary)" };
const label = { fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 4 };

// Vergelijkingsoperator per check-key, voor weergave naast de limiet
// (checkConfig/checkLegplan geven alleen de rauwe limietwaarde + pass terug).
const CHECK_OPS = { vocCold: "<", vocStc: "<", vmpCold: "≤", vmpHot: "≥", imp: "≤", isc: "≤", strings: "≤" };

function fmtCheckValue(c) {
  const decimals = c.unit === "V" ? 0 : c.unit === "A" ? 1 : 0;
  return `${c.value.toFixed(decimals)}${c.unit ? " " + c.unit : ""}`;
}
function fmtCheckLimit(c) {
  const decimals = c.unit === "V" ? 0 : c.unit === "A" ? 1 : 0;
  const op = CHECK_OPS[c.key] || "≤";
  return `${op} ${c.limit.toFixed(decimals)}${c.unit ? " " + c.unit : ""}`;
}

// Variant-velden voor het "component toevoegen"-formulier — zelfde velden
// als in src/data/panels.json / inverters.json, zodat api/components.js
// zonder verdere aanpassing kan valideren en mergen.
const PANEL_VARIANT_FIELDS = [
  { key: "id", label: "Type-aanduiding" },
  { key: "wp", label: "Wp" },
  { key: "voc", label: "Voc (V)", step: "0.01" },
  { key: "vmp", label: "Vmp (V)", step: "0.01" },
  { key: "isc", label: "Isc (A)", step: "0.01" },
  { key: "imp", label: "Imp (A)", step: "0.01" },
];
const INVERTER_VARIANT_FIELDS = [
  { key: "id", label: "Type-aanduiding" },
  { key: "pmax", label: "Pmax DC (W)" },
  { key: "vmax", label: "Vmax (V)" },
  { key: "vmpptMin", label: "MPPT min (V)" },
  { key: "vmpptMax", label: "MPPT max (V)" },
  { key: "imppt", label: "I MPPT (A)", step: "0.1" },
  { key: "isc", label: "Isc (A)", step: "0.1" },
  { key: "nMppt", label: "# MPPT" },
  { key: "stringsPerMppt", label: "Strings/MPPT" },
  { key: "pacNom", label: "Pac nom (W)" },
  { key: "iacMax", label: "Iac max (A)", step: "0.1" },
];

// Zoekt bij een uit een screenshot geëxtraheerde string ({ wp, fabrikant })
// de bijpassende database-variant. Eén match → gebruiken; 0 of >1 → aan de
// gebruiker laten kiezen (zie docs/sollit-import.md, "geen aannames").
function matchExtractedPanel(extracted, availPanels) {
  if (!extracted.wp) return null;
  const candidates = availPanels.filter((p) => {
    const wpOk = Math.abs(p.wp - extracted.wp) <= 2;
    if (!wpOk) return false;
    if (!extracted.fabrikant) return true;
    const fam = p.family.toLowerCase();
    const fab = String(extracted.fabrikant).toLowerCase();
    return fam.includes(fab) || fab.includes(fam.split(" ")[0]);
  });
  return candidates.length === 1 ? candidates[0].id : null;
}

// Herbouwt de per-MPPT/string-grid van "Configuratie checken" bij het wisselen
// van omvormer: behoudt bestaande waarden waar de slot nog bestaat, vult
// nieuwe slots met een startwaarde, laat overtollige slots vervallen.
function resizeCheckStrings(prev, inv) {
  return Array.from({ length: inv.nMppt }, (_, mIdx) =>
    Array.from({ length: inv.stringsPerMppt }, (_, sIdx) => (prev[mIdx] && prev[mIdx][sIdx]) || { n: 25, azimuth: 180, helling: 35 })
  );
}

// Gedeeld wachtwoord voor /api/* — eenmalig gevraagd bij het eerste gebruik
// van opslaan/laden, daarna onthouden in deze browser. Geen accounts, alleen
// bescherming tegen misbruik van de publieke, niet-ingelogde link.
const APP_KEY_STORAGE = "pvconfigurator_app_key";

async function apiFetch(path, opts = {}) {
  let key = localStorage.getItem(APP_KEY_STORAGE);
  if (!key) {
    key = window.prompt("Wachtwoord voor collega's (eenmalig, wordt onthouden in deze browser):") || "";
    localStorage.setItem(APP_KEY_STORAGE, key);
  }
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.headers || {}), "x-app-key": key, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (res.status === 401) {
    localStorage.removeItem(APP_KEY_STORAGE);
    throw new Error("Wachtwoord onjuist — probeer opnieuw op te slaan/laden.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Serverfout (${res.status})`);
  }
  return res.json();
}

export default function PVConfigurator() {
  const [panelDb, setPanelDb] = useState(() => getPanelFamilies());
  const [inverterDb, setInverterDb] = useState(() => getInverterFamilies());
  const [mode, setMode] = useState("check"); // "check" | "find" | "legplan" | "library" | "agent"

  const [tMinCold, setTMinCold] = useState(-10);
  const [tMaxHot, setTMaxHot] = useState(70);

  // Hoofdaansluiting: één keuze (fasen + ampère per fase samen)
  const [connId, setConnId] = useState("3x25");

  // check-mode selecties
  const [selPanelId, setSelPanelId] = useState("JAM54D41-430/GB");
  const [selInvId, setSelInvId] = useState("SUN2000-20K-MB0");
  // Per-MPPT/string grid: checkStrings[mpptIndex][stringIndex] = { n, azimuth, helling }.
  // n = 0 betekent: slot ongebruikt (minder strings dan de omvormer maximaal aankan).
  const [checkStrings, setCheckStrings] = useState(() =>
    resizeCheckStrings([], { nMppt: 2, stringsPerMppt: 2 })
  );

  // Opslaan/laden van gedeelde configuraties (naam + Sollit-ID, verplicht)
  const [savedConfigs, setSavedConfigs] = useState([]);
  const [selectedLoadId, setSelectedLoadId] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saveSollitId, setSaveSollitId] = useState("");
  const [saveStatus, setSaveStatus] = useState(null); // { type: "ok" | "error", message }

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

  // Herverdeel-agent: stelt alleen een manualAssign-waarde voor, checkLegplan
  // (rekenkern, ongewijzigd) blijft het enige oordeel over of het klopt.
  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null); // { type, message }

  // Vrije vraag/antwoord-agent (tabblad "Agent"): elk antwoord komt tot stand
  // via tool-aanroepen naar de rekenkern, nooit door de agent zelf te laten
  // rekenen. chatMessages: [{ role: "user"|"assistant", content, toolCalls? }]
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState(null);

  // Componenten beheren: formulier voor nieuwe componenten
  const [addType, setAddType] = useState("panel"); // "panel" | "inverter"
  const [addFamilyMode, setAddFamilyMode] = useState("existing"); // "existing" | "new"
  const [addFamilyName, setAddFamilyName] = useState("");
  const [addBetaVoc, setAddBetaVoc] = useState("");
  const [addVsysMax, setAddVsysMax] = useState("");
  const [addNote, setAddNote] = useState("");
  const [addVariant, setAddVariant] = useState({});
  const [addStatus, setAddStatus] = useState(null);
  const customFetchStarted = useRef(false);

  // Datasheet-upload: extractie ter bevestiging, nooit direct toegepast (zie
  // CLAUDE.md: datasheet-extractie is het grootste risico van deze tool).
  const [datasheetBusy, setDatasheetBusy] = useState(false);
  const [datasheetError, setDatasheetError] = useState(null);
  const [datasheetDraft, setDatasheetDraft] = useState(null); // { familyName, isNewFamily, betaVoc, vsysMax, note, rows: [...] }

  // Screenshot-import: geëxtraheerde strings ter bevestiging, per tab apart
  // (check-mode en legplan-mode hebben een verschillend doel-datamodel).
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importDraft, setImportDraft] = useState(null); // { target: "check"|"legplan", rows: [...] }

  const availPanels = useMemo(() => flattenPanels(panelDb), [panelDb]);
  const conn = useMemo(() => getConnection(connId), [connId]);
  const baseInverters = useMemo(() => flattenInverters(inverterDb), [inverterDb]);
  // Alle beschikbare omvormers met aansluitvlag — niet uitsluiten, alleen
  // markeren (overschrijding = waarschuwing, geen verberging).
  const availInverters = useMemo(
    () => baseInverters.map((v) => ({ ...v, fitsConn: inverterFitsConnection(v.iacMax, conn.amps) })),
    [baseInverters, conn]
  );

  const selPanel = availPanels.find((p) => p.id === selPanelId) || availPanels[0];
  const selInv = availInverters.find((i) => i.id === selInvId) || availInverters[0];

  // Platte strings-lijst + vaste MPPT-toewijzing uit de grid (lege slots, n=0,
  // tellen niet mee — checkLegplan is generiek over elke assignment-vorm).
  const checkFlat = useMemo(() => {
    const flatStrings = [];
    const mppts = checkStrings.map((mpptStrings) =>
      mpptStrings.reduce((idxs, s) => {
        if (s.n > 0) {
          idxs.push(flatStrings.length);
          flatStrings.push({ ...s, panel: selPanel });
        }
        return idxs;
      }, [])
    );
    return { flatStrings, assignment: { mppts, overflow: false } };
  }, [checkStrings, selPanel]);

  const checkResult = useMemo(() => {
    if (!selInv || !selPanel) return null;
    return checkLegplan(checkFlat.flatStrings, selInv, checkFlat.assignment, tMinCold, tMaxHot);
  }, [selInv, selPanel, checkFlat, tMinCold, tMaxHot]);

  const findPanel = availPanels.find((p) => p.id === findPanelId) || availPanels[0];
  const matches = useMemo(() => {
    if (mode !== "find" || !findPanel) return [];
    return findMatchingInverters({ panel: findPanel, totalPanels, tMinCold, tMaxHot, inverters: availInverters });
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

  function updateCheckString(mIdx, sIdx, field, value) {
    setCheckStrings((prev) =>
      prev.map((mpptStrings, mi) => (mi !== mIdx ? mpptStrings : mpptStrings.map((s, si) => (si !== sIdx ? s : { ...s, [field]: value }))))
    );
  }

  async function refreshSavedConfigs() {
    try {
      const data = await apiFetch("/api/configs");
      setSavedConfigs(data.configs);
    } catch (e) {
      setSaveStatus({ type: "error", message: e.message });
    }
  }

  async function saveCurrentConfig() {
    if (!saveName.trim() || !saveSollitId.trim()) {
      setSaveStatus({ type: "error", message: "Naam en Sollit ID zijn verplicht." });
      return;
    }
    try {
      const payload = { panelId: selPanelId, inverterId: selInvId, checkStrings, tMinCold, tMaxHot, connId };
      await apiFetch("/api/configs", {
        method: "POST",
        body: JSON.stringify({ name: saveName.trim(), sollitId: saveSollitId.trim(), payload }),
      });
      setSaveStatus({ type: "ok", message: `Opgeslagen als "${saveName.trim()}".` });
      setSaveName("");
      setSaveSollitId("");
      refreshSavedConfigs();
    } catch (e) {
      setSaveStatus({ type: "error", message: e.message });
    }
  }

  async function loadSavedConfig(id) {
    if (!id) return;
    try {
      const data = await apiFetch(`/api/configs/${id}`);
      const p = data.config.payload;
      setSelPanelId(p.panelId);
      setSelInvId(p.inverterId);
      setCheckStrings(p.checkStrings);
      setTMinCold(p.tMinCold);
      setTMaxHot(p.tMaxHot);
      setConnId(p.connId);
      setSaveStatus({ type: "ok", message: `"${data.config.name}" geladen.` });
    } catch (e) {
      setSaveStatus({ type: "error", message: e.message });
    }
  }

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

  // Verzamelt de falende checks uit een checkLegplan-resultaat als leesbare
  // regels, voor teruggave aan de agent bij een herkansing.
  function failureMessages(mpptResults) {
    const msgs = [];
    for (const m of mpptResults) {
      if (m.empty || m.pass) continue;
      for (const c of m.checks) {
        if (!c.pass) msgs.push(`MPPT ${m.mpptNum + 1}: ${c.label} = ${fmtCheckValue(c)} (${fmtCheckLimit(c)})`);
      }
    }
    return msgs;
  }

  // Vraagt de agent om een MPPT-indeling voor te stellen op basis van een
  // vrije-tekst-instructie. Het voorstel wordt via checkLegplan (rekenkern,
  // ongewijzigd) gevalideerd — bij een elektrische fout krijgt de agent één
  // herkansing met de concrete overschrijding; daarna wordt getoond wat er
  // is, mét eventuele falende checks zichtbaar (geen stille aannames).
  async function runReassignAgent() {
    if (!agentInstruction.trim()) {
      setAgentStatus({ type: "error", message: "Geef eerst een instructie." });
      return;
    }
    setAgentBusy(true);
    setAgentStatus(null);
    try {
      const payload = {
        strings: legStringsResolved.map((s) => ({ n: s.n, azimuth: s.azimuth, helling: s.helling, wp: s.panel.wp })),
        nMppt: legInv.nMppt,
        stringsPerMppt: legInv.stringsPerMppt,
        currentAssignment: { mppts: legAssignment.mppts },
        instruction: agentInstruction.trim(),
      };
      let data = await apiFetch("/api/reassign-strings", { method: "POST", body: JSON.stringify(payload) });
      let result = checkLegplan(legStringsResolved, legInv, { mppts: data.mppts, overflow: false }, tMinCold, tMaxHot);
      let attempts = 1;
      if (!result.pass) {
        const failures = failureMessages(result.mpptResults);
        data = await apiFetch("/api/reassign-strings", {
          method: "POST",
          body: JSON.stringify({ ...payload, previousAttempt: { mppts: data.mppts, failures } }),
        });
        result = checkLegplan(legStringsResolved, legInv, { mppts: data.mppts, overflow: false }, tMinCold, tMaxHot);
        attempts = 2;
      }
      setLegAssignMode("manual");
      setManualAssign(data.mppts);
      setAgentStatus({
        type: result.pass ? "ok" : "error",
        message: result.pass
          ? `Voorstel toegepast (${attempts === 1 ? "in één keer" : "na één herkansing"}) — voldoet aan alle elektrische grenzen.`
          : `Voorstel toegepast na ${attempts} poging(en), voldoet nog niet aan alle grenzen — zie de rode checks hieronder. Pas zelf verder aan of probeer een andere instructie.`,
      });
    } catch (e) {
      setAgentStatus({ type: "error", message: e.message });
    } finally {
      setAgentBusy(false);
    }
  }

  // Vrije vraag/antwoord: stuurt de hele gespreksgeschiedenis + de huidige
  // component-lijsten (mét toggles/labels, zoals de gebruiker ze nu ziet)
  // naar /api/agent-chat. De server rekent nooit zelf — elk getal in het
  // antwoord komt uit een tool-aanroep naar de rekenkern (zie api/agent-chat.js).
  async function sendChatMessage() {
    if (!chatInput.trim() || chatBusy) return;
    const userMessage = { role: "user", content: chatInput.trim() };
    const nextMessages = [...chatMessages, userMessage];
    setChatMessages(nextMessages);
    setChatInput("");
    setChatError(null);
    setChatBusy(true);
    try {
      const data = await apiFetch("/api/agent-chat", {
        method: "POST",
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          panels: availPanels,
          inverters: availInverters,
          tMinCold,
          tMaxHot,
        }),
      });
      setChatMessages((prev) => [...prev, { role: "assistant", content: data.reply, toolCalls: data.toolCalls }]);
    } catch (e) {
      setChatError(e.message);
    } finally {
      setChatBusy(false);
    }
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

  // Haalt door collega's toegevoegde componenten op en mixt ze door de
  // lokale families-state. Ref-guard i.p.v. een geladen-vlag: voorkomt een
  // dubbele fetch als zowel de mount-effect (wachtwoord al bekend) als de
  // library-tab-effect vrijwel gelijktijdig zouden vuren.
  async function fetchCustomComponents() {
    if (customFetchStarted.current) return;
    customFetchStarted.current = true;
    try {
      const [componentsData, labelsData] = await Promise.all([apiFetch("/api/components"), apiFetch("/api/labels")]);
      setPanelDb((prev) => applyLabels(mergeCustomComponents(prev, componentsData.components, "panel"), labelsData.labels, "panel"));
      setInverterDb((prev) => applyLabels(mergeCustomComponents(prev, componentsData.components, "inverter"), labelsData.labels, "inverter"));
    } catch (e) {
      customFetchStarted.current = false; // opnieuw proberen toestaan (bijv. na fout wachtwoord)
      setAddStatus({ type: "error", message: e.message });
    }
  }

  // Label bewerken/verwijderen op een variant — geldt ongeacht of die variant
  // uit de statische database of via "component toevoegen" komt.
  async function editLabel(type, variantId, currentLabel) {
    const value = window.prompt(`Label voor ${variantId} (leeg = verwijderen):`, currentLabel || "");
    if (value === null) return;
    const label = value.trim();
    try {
      await apiFetch("/api/labels", { method: "POST", body: JSON.stringify({ type, variantId, label }) });
      const setter = type === "panel" ? setPanelDb : setInverterDb;
      setter((prev) =>
        prev.map((f) => ({
          ...f,
          variants: f.variants.map((v) => (v.id !== variantId ? v : label ? { ...v, label } : { ...v, label: undefined })),
        }))
      );
    } catch (e) {
      setAddStatus({ type: "error", message: e.message });
    }
  }

  useEffect(() => {
    // Alleen automatisch laden als het wachtwoord al bekend is — anders niet
    // meteen bij opstarten om een prompt vragen, zoals ook opgeslagen
    // configuraties pas laden na een expliciete actie.
    if (localStorage.getItem(APP_KEY_STORAGE)) fetchCustomComponents();
  }, []);

  useEffect(() => {
    if (mode === "library") fetchCustomComponents();
  }, [mode]);

  // Gedeeld door het handmatige formulier en de datasheet-bevestigingstabel:
  // POST + lokaal mergen. Eén variant per aanroep, meerdere varianten uit
  // één datasheet worden er dus na elkaar doorheen geloopt.
  async function postComponent({ type, familyName, isNewFamily, familyMeta, variant }) {
    const data = await apiFetch("/api/components", {
      method: "POST",
      body: JSON.stringify({ type, familyName, isNewFamily, familyMeta, variant }),
    });
    const setter = type === "panel" ? setPanelDb : setInverterDb;
    setter((prev) => mergeCustomComponents(prev, [data.component], type));
    return data.component;
  }

  async function submitAddComponent() {
    if (!addFamilyName.trim()) {
      setAddStatus({ type: "error", message: "Kies of vul een familienaam in." });
      return;
    }
    const fields = addType === "panel" ? PANEL_VARIANT_FIELDS : INVERTER_VARIANT_FIELDS;
    const variant = {};
    for (const f of fields) {
      const raw = addVariant[f.key];
      if (raw === undefined || raw === "") {
        setAddStatus({ type: "error", message: `Veld "${f.label}" is verplicht.` });
        return;
      }
      variant[f.key] = f.key === "id" ? raw : Number(raw);
    }
    const isNewFamily = addFamilyMode === "new";
    if (isNewFamily && addType === "panel" && (addBetaVoc === "" || addVsysMax === "")) {
      setAddStatus({ type: "error", message: "Nieuwe panelfamilie vereist β Voc en Vsys max." });
      return;
    }
    const familyMeta = isNewFamily
      ? addType === "panel"
        ? { betaVoc: Number(addBetaVoc), vsysMax: Number(addVsysMax), ...(addNote.trim() ? { note: addNote.trim() } : {}) }
        : { ...(addNote.trim() ? { note: addNote.trim() } : {}) }
      : null;

    try {
      await postComponent({ type: addType, familyName: addFamilyName.trim(), isNewFamily, familyMeta, variant });
      setAddStatus({ type: "ok", message: `Toegevoegd — nog niet gecontroleerd tegen de datasheet.` });
      setAddVariant({});
      if (isNewFamily) {
        setAddFamilyName("");
        setAddBetaVoc("");
        setAddVsysMax("");
        setAddNote("");
      }
    } catch (e) {
      setAddStatus({ type: "error", message: e.message });
    }
  }

  // Datasheet → base64 → /api/parse-datasheet → bevestigingstabel met (vaak
  // meerdere) variant-rijen. Niets wordt toegevoegd zonder expliciete
  // "Geselecteerde toevoegen"-klik — datasheet-extractie is het grootste
  // risico van deze tool (zie CLAUDE.md), dus geen automatische verified:true.
  async function handleDatasheetUpload(file) {
    setDatasheetError(null);
    setDatasheetBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const [, mediaType, base64] = dataUrl.match(/^data:(.+);base64,(.*)$/) || [];
      if (!base64) throw new Error("Kon het bestand niet lezen.");
      const data = await apiFetch("/api/parse-datasheet", {
        method: "POST",
        body: JSON.stringify({ fileBase64: base64, mediaType, type: addType }),
      });
      const dbList = addType === "panel" ? panelDb : inverterDb;
      const existing = dbList.find((f) => f.family.toLowerCase() === String(data.familyName || "").toLowerCase());
      const fields = addType === "panel" ? PANEL_VARIANT_FIELDS : INVERTER_VARIANT_FIELDS;
      const rows = data.variants.map((v) => {
        const row = { include: true, iacMaxComputed: addType === "inverter" && !!v.iacMaxComputed };
        for (const f of fields) row[f.key] = v[f.key] ?? "";
        return row;
      });
      setDatasheetDraft({
        familyName: existing ? existing.family : data.familyName || "",
        isNewFamily: !existing,
        betaVoc: addType === "panel" ? data.betaVoc ?? "" : "",
        vsysMax: addType === "panel" ? data.vsysMax ?? "" : "",
        note: "",
        rows,
      });
    } catch (e) {
      setDatasheetError(e.message);
    } finally {
      setDatasheetBusy(false);
    }
  }

  function updateDatasheetMeta(field, value) {
    setDatasheetDraft((prev) => ({ ...prev, [field]: value }));
  }
  function updateDatasheetRow(idx, field, value) {
    setDatasheetDraft((prev) => ({ ...prev, rows: prev.rows.map((r, i) => (i !== idx ? r : { ...r, [field]: value })) }));
  }
  function toggleDatasheetRow(idx) {
    setDatasheetDraft((prev) => ({ ...prev, rows: prev.rows.map((r, i) => (i !== idx ? r : { ...r, include: !r.include })) }));
  }

  async function applyDatasheetDraft() {
    const draft = datasheetDraft;
    if (!draft.familyName.trim()) {
      setDatasheetError("Familienaam is verplicht.");
      return;
    }
    const fields = addType === "panel" ? PANEL_VARIANT_FIELDS : INVERTER_VARIANT_FIELDS;
    if (draft.isNewFamily && addType === "panel" && (draft.betaVoc === "" || draft.vsysMax === "")) {
      setDatasheetError("Nieuwe panelfamilie vereist β Voc en Vsys max.");
      return;
    }
    const familyMeta = draft.isNewFamily
      ? addType === "panel"
        ? { betaVoc: Number(draft.betaVoc), vsysMax: Number(draft.vsysMax), ...(draft.note.trim() ? { note: draft.note.trim() } : {}) }
        : { ...(draft.note.trim() ? { note: draft.note.trim() } : {}) }
      : null;

    const included = draft.rows.filter((r) => r.include);
    if (included.length === 0) {
      setDatasheetError("Selecteer minstens één variant om toe te voegen.");
      return;
    }
    let added = 0;
    let skipped = 0;
    for (const r of included) {
      const variant = {};
      let rowOk = true;
      for (const f of fields) {
        if (r[f.key] === undefined || r[f.key] === "") {
          rowOk = false;
          break;
        }
        variant[f.key] = f.key === "id" ? r[f.key] : Number(r[f.key]);
      }
      if (!rowOk) {
        skipped++;
        continue; // onvolledig gelezen — niet gokken, gebruiker moet aanvullen en opnieuw proberen
      }
      try {
        await postComponent({ type: addType, familyName: draft.familyName.trim(), isNewFamily: draft.isNewFamily, familyMeta, variant });
        added++;
      } catch (e) {
        setDatasheetError(`${e.message} (${added} van ${included.length} al toegevoegd vóór deze fout)`);
        return;
      }
    }
    setAddStatus({
      type: "ok",
      message: `${added} variant(en) toegevoegd uit datasheet — nog niet gecontroleerd.${skipped ? ` ${skipped} overgeslagen wegens onvolledige gegevens.` : ""}`,
    });
    setDatasheetDraft(null);
    setDatasheetError(null);
  }

  // Screenshot → base64 → /api/parse-stringplan → matching → bevestigingsdraft.
  // Niets wordt toegepast zonder expliciete "Toepassen"-klik (zie
  // docs/sollit-import.md: OCR/vision kan een cijfer verkeerd lezen).
  async function handleStringplanUpload(file, target) {
    setImportError(null);
    setImportBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const [, mediaType, base64] = dataUrl.match(/^data:(.+);base64,(.*)$/) || [];
      if (!base64) throw new Error("Kon het bestand niet lezen.");
      const data = await apiFetch("/api/parse-stringplan", {
        method: "POST",
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      });
      const rows = data.strings.map((s) => ({
        n: s.n ?? 1,
        azimuth: s.azimuth ?? 180,
        helling: s.helling ?? 35,
        panelId: matchExtractedPanel(s, availPanels) || availPanels[0].id,
        extractedWp: s.wp,
        extractedFabrikant: s.fabrikant,
      }));
      setImportDraft({ target, rows });
    } catch (e) {
      setImportError(e.message);
    } finally {
      setImportBusy(false);
    }
  }

  function updateImportRow(idx, field, value) {
    setImportDraft((prev) => ({ ...prev, rows: prev.rows.map((r, i) => (i !== idx ? r : { ...r, [field]: value })) }));
  }
  function removeImportRow(idx) {
    setImportDraft((prev) => ({ ...prev, rows: prev.rows.filter((_, i) => i !== idx) }));
  }

  function applyImportDraft() {
    if (!importDraft) return;
    const rows = importDraft.rows;
    if (importDraft.target === "legplan") {
      setLegStrings(rows.map((r) => ({ n: r.n, panelId: r.panelId, azimuth: r.azimuth, helling: r.helling })));
      setManualAssign(null);
    } else {
      const resolved = rows.map((r) => ({ ...r, panel: availPanels.find((p) => p.id === r.panelId) || availPanels[0] }));
      const assignment = autoAssign(resolved, selInv);
      if (assignment.overflow) {
        setImportError(
          `${rows.length} strings passen niet op de ${selInv.nMppt} MPPT × ${selInv.stringsPerMppt} van ${selInv.id}. Gebruik Legplan-check voor grotere systemen, of pas de omvormer aan.`
        );
        return;
      }
      const grid = Array.from({ length: selInv.nMppt }, (_, mIdx) =>
        Array.from({ length: selInv.stringsPerMppt }, (_, sIdx) => {
          const stringIdx = assignment.mppts[mIdx]?.[sIdx];
          return stringIdx !== undefined ? { n: rows[stringIdx].n, azimuth: rows[stringIdx].azimuth, helling: rows[stringIdx].helling } : { n: 0, azimuth: 180, helling: 35 };
        })
      );
      setCheckStrings(grid);
    }
    setImportDraft(null);
    setImportError(null);
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

  // Screenshot-upload + bevestigingstabel, gedeeld tussen "Configuratie
  // checken" en "Legplan-check" (die verschillen alleen in wat er met
  // applyImportDraft() gebeurt na bevestigen).
  function renderStringplanImport(target) {
    const draftActive = importDraft && importDraft.target === target;
    return (
      <div style={{ ...card, marginBottom: 16, background: "var(--color-background-secondary)", border: "none" }}>
        {!draftActive && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, flexWrap: "wrap" }}>
            <i className="ti ti-photo" style={{ fontSize: 16 }} aria-hidden="true" />
            <span>Heb je een Sollit-legplan als screenshot? Upload 'm, dan vul ik de strings hieronder in. Of voer ze handmatig in.</span>
            <label style={{ padding: "5px 12px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", cursor: "pointer", fontSize: 12 }}>
              {importBusy ? "Bezig met lezen…" : "Screenshot uploaden"}
              <input
                type="file"
                accept="image/*"
                disabled={importBusy}
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) handleStringplanUpload(file, target);
                }}
              />
            </label>
          </div>
        )}
        {importError && !draftActive && <div style={{ fontSize: 12, color: "var(--color-text-danger)", marginTop: 8 }}>{importError}</div>}

        {draftActive && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
              Controleer de geëxtraheerde strings vóór toepassen — OCR kan een cijfer verkeerd lezen.
            </div>
            <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
              {importDraft.rows.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                  <input type="number" min={1} max={40} value={r.n} onChange={(e) => updateImportRow(i, "n", +e.target.value)} style={{ width: 50 }} />
                  <span style={muted}>×</span>
                  <select value={r.panelId} onChange={(e) => updateImportRow(i, "panelId", e.target.value)} style={{ flex: "1 1 160px", minWidth: 140 }}>
                    {availPanels.map((p) => (
                      <option key={p.id} value={p.id}>{p.id} — {p.wp}Wp{p.label ? ` · ${p.label}` : ""}</option>
                    ))}
                  </select>
                  {r.extractedWp && (
                    <span style={{ fontSize: 11, ...muted }}>
                      (gelezen: {r.extractedFabrikant || "?"} {r.extractedWp}Wp)
                    </span>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 12, ...muted }}>Az</span>
                    <input type="number" min={0} max={359} value={r.azimuth} onChange={(e) => updateImportRow(i, "azimuth", +e.target.value)} style={{ width: 56 }} />°
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 12, ...muted }}>Hel</span>
                    <input type="number" min={0} max={90} value={r.helling} onChange={(e) => updateImportRow(i, "helling", +e.target.value)} style={{ width: 46 }} />°
                  </div>
                  <button onClick={() => removeImportRow(i)} aria-label="verwijder rij" style={{ padding: "2px 6px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", color: "var(--color-text-danger)" }}>
                    <i className="ti ti-trash" style={{ fontSize: 13 }} />
                  </button>
                </div>
              ))}
            </div>
            {importError && <div style={{ fontSize: 12, color: "var(--color-text-danger)", marginBottom: 8 }}>{importError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={applyImportDraft} style={{ padding: "6px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontWeight: 500, fontSize: 13 }}>
                Toepassen
              </button>
              <button onClick={() => { setImportDraft(null); setImportError(null); }} style={{ padding: "6px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", fontSize: 13 }}>
                Annuleren
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-primary)", padding: "1rem 0", maxWidth: 880 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabBtn("check", "Configuratie checken")}
        {tabBtn("find", "Omvormer zoeken")}
        {tabBtn("legplan", "Legplan-check")}
        {tabBtn("library", "Componenten beheren")}
        {tabBtn("agent", "Agent")}
      </div>

      {/* Hoofdaansluiting + temperatuurinstellingen */}
      {mode !== "library" && mode !== "agent" && (
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
          <div style={{ ...card, marginBottom: 12, display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <div style={label}>Laad opgeslagen configuratie</div>
              <div style={{ display: "flex", gap: 6 }}>
                <select
                  value={selectedLoadId}
                  onChange={(e) => { setSelectedLoadId(e.target.value); loadSavedConfig(e.target.value); }}
                  style={{ width: 220 }}
                >
                  <option value="">— kies —</option>
                  {savedConfigs.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.sollit_id})</option>
                  ))}
                </select>
                <button
                  onClick={refreshSavedConfigs}
                  title="Vernieuw lijst"
                  style={{ padding: "4px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer" }}
                >
                  <i className="ti ti-refresh" style={{ fontSize: 15 }} />
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <div style={label}>Naam</div>
                <input type="text" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="bijv. Jansen — Dorpsstraat 12" style={{ width: 180 }} />
              </div>
              <div>
                <div style={label}>Sollit ID</div>
                <input type="text" value={saveSollitId} onChange={(e) => setSaveSollitId(e.target.value)} style={{ width: 100 }} />
              </div>
              <button
                onClick={saveCurrentConfig}
                style={{ padding: "6px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontWeight: 500 }}
              >
                Opslaan
              </button>
            </div>
            {saveStatus && (
              <div style={{ width: "100%", fontSize: 12, color: saveStatus.type === "error" ? "var(--color-text-danger)" : "var(--color-text-success)" }}>
                {saveStatus.message}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div style={card}>
              <div style={label}>Paneel</div>
              <select value={selPanelId} onChange={(e) => setSelPanelId(e.target.value)} style={{ width: "100%", marginBottom: 8 }}>
                {availPanels.map((p) => (
                  <option key={p.id} value={p.id}>{p.id} — {p.wp} Wp{p.label ? ` · ${p.label}` : ""}</option>
                ))}
              </select>
              {selPanel.label && (
                <span style={{ fontSize: 11, background: "var(--color-background-info)", color: "var(--color-text-info)", padding: "2px 8px", borderRadius: "var(--border-radius-md)", display: "inline-block", marginBottom: 6 }}>
                  {selPanel.label}
                </span>
              )}
              <div style={{ fontSize: 12, ...muted }}>
                Voc {selPanel.voc} V · Vmp {selPanel.vmp} V · Isc {selPanel.isc} A · Imp {selPanel.imp} A · β {selPanel.betaVoc}%/°C
              </div>
            </div>
            <div style={card}>
              <div style={label}>Omvormer</div>
              <select
                value={selInvId}
                onChange={(e) => {
                  setSelInvId(e.target.value);
                  const newInv = availInverters.find((i) => i.id === e.target.value);
                  if (newInv) setCheckStrings((prev) => resizeCheckStrings(prev, newInv));
                }}
                style={{ width: "100%", marginBottom: 8 }}
              >
                {availInverters.map((i) => (
                  <option key={i.id} value={i.id}>{i.id}{i.label ? ` · ${i.label}` : ""}</option>
                ))}
              </select>
              {selInv.label && (
                <span style={{ fontSize: 11, background: "var(--color-background-info)", color: "var(--color-text-info)", padding: "2px 8px", borderRadius: "var(--border-radius-md)", display: "inline-block", marginBottom: 6 }}>
                  {selInv.label}
                </span>
              )}
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

          {renderStringplanImport("check")}

          <h3 style={{ fontSize: 16, fontWeight: 500, margin: "8px 0" }}>Strings per MPPT</h3>
          <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            {checkStrings.map((mpptStrings, mIdx) => (
              <div key={mIdx} style={{ ...card, padding: "12px 14px" }}>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>MPPT {mIdx + 1}</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {mpptStrings.map((s, sIdx) => (
                    <div key={sIdx} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, ...muted, minWidth: 54 }}>String {sIdx + 1}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, ...muted }}>Panelen</span>
                        <input
                          type="number"
                          min={0}
                          max={40}
                          value={s.n}
                          onChange={(e) => updateCheckString(mIdx, sIdx, "n", Math.max(0, +e.target.value || 0))}
                          style={{ width: 56 }}
                        />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, ...muted }}>Az</span>
                        <input type="number" min={0} max={359} value={s.azimuth} onChange={(e) => updateCheckString(mIdx, sIdx, "azimuth", +e.target.value)} style={{ width: 60 }} />°
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, ...muted }}>Hel</span>
                        <input type="number" min={0} max={90} value={s.helling} onChange={(e) => updateCheckString(mIdx, sIdx, "helling", +e.target.value)} style={{ width: 50 }} />°
                      </div>
                      {s.n === 0 && <span style={{ fontSize: 11, ...muted }}>(ongebruikt)</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {checkResult && (
            <>
              <div
                style={{
                  ...card,
                  marginBottom: 12,
                  borderLeft: `3px solid ${checkResult.pass ? "var(--color-border-success)" : "var(--color-border-danger)"}`,
                  borderRadius: "var(--border-radius-md)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <i className={`ti ${checkResult.pass ? "ti-check" : "ti-x"}`} style={{ fontSize: 20, color: checkResult.pass ? "var(--color-text-success)" : "var(--color-text-danger)" }} aria-hidden="true" />
                  <span style={{ fontWeight: 500, fontSize: 16 }}>
                    {checkResult.pass ? "Configuratie past binnen alle grenzen" : "Configuratie overschrijdt een of meer grenzen"}
                  </span>
                </div>
                <div style={{ fontSize: 13, ...muted, marginTop: 6 }}>
                  {(checkResult.totalWp / 1000).toFixed(2)} kWp · {checkFlat.flatStrings.reduce((sum, x) => sum + x.n, 0)} panelen
                  {checkResult.anyMixed && <span style={{ color: "var(--color-text-warning)" }}> · let op: gemengde oriëntatie op ≥1 MPPT — optimizers nodig</span>}
                  {!checkResult.powerOk && <span style={{ color: "var(--color-text-danger)" }}> · DC-vermogen boven omvormerlimiet</span>}
                </div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {checkResult.mpptResults.map((m) => (
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
                              {c.label}: {fmtCheckValue(c)} ({fmtCheckLimit(c)})
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
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
                  <option key={p.id} value={p.id}>{p.id} — {p.wp} Wp{p.label ? ` · ${p.label}` : ""}</option>
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
          {renderStringplanImport("legplan")}

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
                      <option key={p.id} value={p.id}>{p.id} — {p.wp}Wp{p.label ? ` · ${p.label}` : ""}</option>
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
                  <option key={i.id} value={i.id}>{i.id}{i.label ? ` · ${i.label}` : ""}</option>
                ))}
              </select>
              {legInv.label && (
                <span style={{ fontSize: 11, background: "var(--color-background-info)", color: "var(--color-text-info)", padding: "2px 8px", borderRadius: "var(--border-radius-md)", display: "inline-block", marginBottom: 6 }}>
                  {legInv.label}
                </span>
              )}
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

          {/* Herverdeel-agent */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={label}>Agent: herverdeel strings op instructie</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                value={agentInstruction}
                onChange={(e) => setAgentInstruction(e.target.value)}
                placeholder="bijv. 'zet string 3 en 4 samen' of 'verdeel zo gelijkmatig mogelijk'"
                style={{ flex: "1 1 320px", minWidth: 240 }}
                disabled={agentBusy}
              />
              <button
                onClick={runReassignAgent}
                disabled={agentBusy}
                style={{ padding: "6px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: agentBusy ? "default" : "pointer", fontWeight: 500, fontSize: 13, opacity: agentBusy ? 0.6 : 1 }}
              >
                {agentBusy ? "Bezig…" : "Agent toepassen"}
              </button>
            </div>
            <div style={{ fontSize: 11, ...muted, marginTop: 6 }}>
              De agent stelt alleen een indeling voor — of die elektrisch klopt, bepaalt de rekenkern hieronder, net als bij een handmatige toewijzing.
            </div>
            {agentStatus && (
              <div style={{ fontSize: 12, marginTop: 8, color: agentStatus.type === "error" ? "var(--color-text-danger)" : "var(--color-text-success)" }}>
                {agentStatus.message}
              </div>
            )}
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
                          {c.label}: {fmtCheckValue(c)} ({fmtCheckLimit(c)})
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
                        <div style={{ fontWeight: 500 }}>
                          {f.family}
                          {f.custom && (
                            <span style={{ background: "var(--color-background-warning)", color: "var(--color-text-warning)", fontSize: 11, padding: "2px 8px", borderRadius: "var(--border-radius-md)", marginLeft: 8 }}>
                              toegevoegd — ongecontroleerd
                            </span>
                          )}
                        </div>
                        {f.note && <div style={{ fontSize: 12, ...muted }}>{f.note}</div>}
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
                        <span key={v.id} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                          <button
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
                            {v.custom && !f.custom && <span style={{ marginLeft: 4, fontSize: 10, color: "var(--color-text-warning)" }}>(nieuw)</span>}
                            {v.label && <span style={{ marginLeft: 4, fontSize: 10, color: "var(--color-text-info)" }}>· {v.label}</span>}
                          </button>
                          <button
                            onClick={() => editLabel(key, v.id, v.label)}
                            title="Label bewerken"
                            style={{ fontSize: 11, padding: "5px 6px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", background: "transparent", cursor: "pointer", color: "var(--color-text-secondary)" }}
                          >
                            <i className="ti ti-tag" style={{ fontSize: 13 }} aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          <div style={card}>
            <h3 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 4px" }}>Nieuw component toevoegen</h3>
            <p style={{ fontSize: 12, ...muted, marginTop: 0, marginBottom: 12 }}>
              Gedeeld met alle collega's. Nieuwe componenten starten als "ongecontroleerd" — controleer de waarden tegen de datasheet voordat je ze productief gebruikt.
            </p>

            <div style={{ display: "flex", gap: 24, marginBottom: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <div style={label}>Type</div>
                <select
                  value={addType}
                  onChange={(e) => { setAddType(e.target.value); setAddFamilyName(""); setAddVariant({}); setAddStatus(null); setDatasheetDraft(null); setDatasheetError(null); }}
                  style={{ width: 130 }}
                >
                  <option value="panel">Paneel</option>
                  <option value="inverter">Omvormer</option>
                </select>
              </div>
              <div>
                <div style={label}>Datasheet uploaden</div>
                <label style={{ display: "inline-block", padding: "6px 12px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", fontSize: 13 }}>
                  {datasheetBusy ? "Bezig met lezen…" : "PDF of foto uploaden"}
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    disabled={datasheetBusy}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) handleDatasheetUpload(file);
                    }}
                  />
                </label>
              </div>
            </div>
            {datasheetError && <div style={{ fontSize: 12, color: "var(--color-text-danger)", marginBottom: 12 }}>{datasheetError}</div>}

            {datasheetDraft && (
              <div style={{ ...card, background: "var(--color-background-secondary)", border: "none", marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>
                  Controleer de uit de datasheet gelezen gegevens vóór toevoegen — een verkeerd gelezen waarde zit anders voorgoed fout in de database.
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
                  <div>
                    <div style={label}>Familienaam {datasheetDraft.isNewFamily ? "(nieuw)" : "(bestaand — match gevonden)"}</div>
                    <input type="text" value={datasheetDraft.familyName} onChange={(e) => updateDatasheetMeta("familyName", e.target.value)} style={{ width: 280 }} />
                  </div>
                  {datasheetDraft.isNewFamily && addType === "panel" && (
                    <>
                      <div>
                        <div style={label}>β Voc (%/°C)</div>
                        <input type="number" step="0.01" value={datasheetDraft.betaVoc} onChange={(e) => updateDatasheetMeta("betaVoc", e.target.value)} style={{ width: 90 }} />
                      </div>
                      <div>
                        <div style={label}>Vsys max (V)</div>
                        <input type="number" value={datasheetDraft.vsysMax} onChange={(e) => updateDatasheetMeta("vsysMax", e.target.value)} style={{ width: 90 }} />
                      </div>
                    </>
                  )}
                </div>

                <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                  {datasheetDraft.rows.map((r, i) => (
                    <div key={i} style={{ ...card, padding: "10px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input type="checkbox" checked={r.include} onChange={() => toggleDatasheetRow(i)} />
                      {(addType === "panel" ? PANEL_VARIANT_FIELDS : INVERTER_VARIANT_FIELDS).map((f) => (
                        <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: 10, ...muted }}>{f.label}</span>
                          <input
                            type={f.key === "id" ? "text" : "number"}
                            step={f.step}
                            value={r[f.key] ?? ""}
                            onChange={(e) => updateDatasheetRow(i, f.key, e.target.value)}
                            style={{ width: f.key === "id" ? 140 : 70 }}
                          />
                        </div>
                      ))}
                      {r.iacMaxComputed && (
                        <span style={{ fontSize: 11, color: "var(--color-text-warning)" }}>iacMax berekend (pacNom/400V/√3), niet in datasheet — extra controleren</span>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={applyDatasheetDraft}
                    style={{ padding: "6px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontWeight: 500, fontSize: 13 }}
                  >
                    Geselecteerde toevoegen
                  </button>
                  <button
                    onClick={() => { setDatasheetDraft(null); setDatasheetError(null); }}
                    style={{ padding: "6px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", fontSize: 13 }}
                  >
                    Annuleren
                  </button>
                </div>
              </div>
            )}

            {!datasheetDraft && (
            <>
            <div style={{ display: "flex", gap: 24, marginBottom: 12, flexWrap: "wrap" }}>
              <div>
                <div style={label}>Familie</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => { setAddFamilyMode("existing"); setAddFamilyName(""); setAddStatus(null); }}
                    style={{ fontSize: 13, padding: "6px 12px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", cursor: "pointer", background: addFamilyMode === "existing" ? "var(--color-background-info)" : "transparent", color: addFamilyMode === "existing" ? "var(--color-text-info)" : "var(--color-text-primary)" }}
                  >
                    Bestaande
                  </button>
                  <button
                    onClick={() => { setAddFamilyMode("new"); setAddFamilyName(""); setAddStatus(null); }}
                    style={{ fontSize: 13, padding: "6px 12px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", cursor: "pointer", background: addFamilyMode === "new" ? "var(--color-background-info)" : "transparent", color: addFamilyMode === "new" ? "var(--color-text-info)" : "var(--color-text-primary)" }}
                  >
                    Nieuwe
                  </button>
                </div>
              </div>
            </div>

            {addFamilyMode === "existing" ? (
              <div style={{ marginBottom: 12 }}>
                <div style={label}>Bestaande familie</div>
                <select value={addFamilyName} onChange={(e) => setAddFamilyName(e.target.value)} style={{ width: 320 }}>
                  <option value="">— kies —</option>
                  {(addType === "panel" ? panelDb : inverterDb).map((f) => (
                    <option key={f.family} value={f.family}>{f.family}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
                <div>
                  <div style={label}>Nieuwe familienaam</div>
                  <input type="text" value={addFamilyName} onChange={(e) => setAddFamilyName(e.target.value)} style={{ width: 240 }} />
                </div>
                {addType === "panel" && (
                  <>
                    <div>
                      <div style={label}>β Voc (%/°C)</div>
                      <input type="number" step="0.01" value={addBetaVoc} onChange={(e) => setAddBetaVoc(e.target.value)} style={{ width: 90 }} />
                    </div>
                    <div>
                      <div style={label}>Vsys max (V)</div>
                      <input type="number" value={addVsysMax} onChange={(e) => setAddVsysMax(e.target.value)} style={{ width: 90 }} />
                    </div>
                  </>
                )}
                <div>
                  <div style={label}>Notitie (optioneel)</div>
                  <input type="text" value={addNote} onChange={(e) => setAddNote(e.target.value)} style={{ width: 200 }} />
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8, marginBottom: 12, maxWidth: 700 }}>
              {(addType === "panel" ? PANEL_VARIANT_FIELDS : INVERTER_VARIANT_FIELDS).map((f) => (
                <div key={f.key}>
                  <div style={label}>{f.label}</div>
                  <input
                    type={f.key === "id" ? "text" : "number"}
                    step={f.step}
                    value={addVariant[f.key] ?? ""}
                    onChange={(e) => setAddVariant((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    style={{ width: "100%" }}
                  />
                </div>
              ))}
            </div>

            <button
              onClick={submitAddComponent}
              style={{ padding: "6px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontWeight: 500 }}
            >
              Toevoegen
            </button>
            </>
            )}
            {addStatus && (
              <div style={{ fontSize: 12, marginTop: 8, color: addStatus.type === "error" ? "var(--color-text-danger)" : "var(--color-text-success)" }}>
                {addStatus.message}
              </div>
            )}
          </div>
        </>
      )}

      {/* AGENT MODE */}
      {mode === "agent" && (
        <>
          <div style={{ ...card, marginBottom: 12, background: "var(--color-background-secondary)", border: "none" }}>
            <div style={{ fontSize: 13 }}>
              Stel een vrije vraag over stringconfiguraties, omvormerkeuze of paneelverdeling — bijv. "welke omvormer past bij 76 panelen van 430Wp?" of
              "verdeel 111 panelen over 6 strings". De agent rekent nooit zelf: elk getal in het antwoord komt uit een aanroep naar de rekenkern, zichtbaar
              onder "Toon berekeningen" bij elk antwoord.
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
            {chatMessages.length === 0 && (
              <div style={{ ...card, ...muted, fontSize: 13 }}>Nog geen vragen gesteld in dit gesprek.</div>
            )}
            {chatMessages.map((m, i) => (
              <div
                key={i}
                style={{
                  ...card,
                  padding: "10px 14px",
                  background: m.role === "user" ? "var(--color-background-secondary)" : "var(--color-background-primary)",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 500, ...muted, marginBottom: 4 }}>{m.role === "user" ? "Jij" : "Agent"}</div>
                <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.content}</div>
                {m.toolCalls?.length > 0 && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ fontSize: 11, ...muted, cursor: "pointer" }}>Toon berekeningen ({m.toolCalls.length})</summary>
                    <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                      {m.toolCalls.map((tc, k) => (
                        <div key={k} style={{ fontSize: 11, fontFamily: "monospace", background: "var(--color-background-secondary)", padding: "6px 8px", borderRadius: "var(--border-radius-md)", overflowX: "auto" }}>
                          <div style={{ fontWeight: 500 }}>{tc.name}({JSON.stringify(tc.input)})</div>
                          <div style={{ ...muted, marginTop: 2 }}>→ {JSON.stringify(tc.output)}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>

          {chatError && <div style={{ fontSize: 12, color: "var(--color-text-danger)", marginBottom: 12 }}>{chatError}</div>}

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMessage();
                }
              }}
              placeholder="bijv. 'welke omvormer past bij 76 panelen van 430Wp?'"
              style={{ flex: "1 1 auto" }}
              disabled={chatBusy}
            />
            <button
              onClick={sendChatMessage}
              disabled={chatBusy || !chatInput.trim()}
              style={{ padding: "6px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: chatBusy ? "default" : "pointer", fontWeight: 500, opacity: chatBusy || !chatInput.trim() ? 0.6 : 1 }}
            >
              {chatBusy ? "Bezig…" : "Versturen"}
            </button>
          </div>
          {chatMessages.length > 0 && (
            <button
              onClick={() => { setChatMessages([]); setChatError(null); }}
              style={{ fontSize: 12, padding: "4px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", color: "var(--color-text-secondary)" }}
            >
              Nieuw gesprek
            </button>
          )}
        </>
      )}

      <div style={{ fontSize: 11, ...muted, marginTop: 20, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 10 }}>
        Ontwerphulp, geen vervanging voor toetsing door een gekwalificeerd persoon. Controleer geëxtraheerde datasheetwaarden vóór gebruik. Voc-koudecorrectie: Voc(T) = Voc_stc × (1 + β/100 × (T−25)).
      </div>
    </div>
  );
}
