import React, { useState, useMemo, useEffect, useRef } from "react";
import { createAuthClient } from "@neondatabase/neon-js/auth";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { getPanelFamilies, getInverterFamilies, flattenPanels, flattenInverters, mergeCustomComponents, applyLabels } from "../data/loader.js";
import {
  CONNECTIONS,
  getConnection,
  inverterFitsConnection,
  findMatchingInverters,
  autoAssign,
  autoAssignFleet,
  checkLegplan,
  stringVocStc,
  buildStringsFromRoofFaces,
  OVERDIM_MIN,
  OVERDIM_MAX,
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
  padding: "1.25rem 1.5rem",
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

// stringsPerMppt is meestal één getal; bij "Ongelijke MPPT's" is het invoerveld
// een array van ruwe stringwaarden (één per MPPT). Zet dat om naar wat de
// rekenkern verwacht (zie mpptCapacity/totalMpptSlots/minMpptCapacity in
// calculations.js): een array bij echt ongelijke waarden, anders het gedeelde
// getal — zo blijft de database consistent met alle bestaande, uniforme
// omvormers.
function resolveStringsPerMppt(raw) {
  if (!Array.isArray(raw)) return raw === undefined || raw === "" ? { ok: false } : { ok: true, value: Number(raw) };
  if (raw.length === 0 || raw.some((v) => v === undefined || v === "")) return { ok: false };
  const nums = raw.map(Number);
  return { ok: true, value: nums.every((x) => x === nums[0]) ? nums[0] : nums };
}

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

const DESIGN_STEPS = [
  { id: "invoer", label: "Invoer" },
  { id: "indeling", label: "Indeling" },
  { id: "resultaat", label: "Resultaat" },
  { id: "rapport", label: "Rapport" },
];

// Echte per-gebruiker login via Neon Auth (Managed Better Auth) — vervangt
// het vorige gedeelde-wachtwoord-model volledig. Accounts worden door een
// admin aangemaakt (scripts/create-user.mjs), geen zelfregistratie in de UI.
const authClient = createAuthClient(import.meta.env.VITE_NEON_AUTH_URL);

// Elke aanroep haalt een verse, kortlevende JWT op en stuurt 'm mee als
// Bearer-token — api/_auth.js verifieert die tegen de JWKS van dezelfde
// Neon Auth-service.
async function apiFetch(path, opts = {}) {
  // authClient.token() geeft in deze client-versie hetzelfde terug als
  // getSession() (session+user, geen JWT) — de /token-endpoint zelf roepen
  // we daarom rechtstreeks aan, met de sessie-cookie die signIn.email zette.
  const tokenRes = await fetch(`${import.meta.env.VITE_NEON_AUTH_URL}/token`, { credentials: "include" });
  const tokenData = tokenRes.ok ? await tokenRes.json() : null;
  const token = tokenData?.token;
  if (!token) throw new Error("Niet ingelogd — log opnieuw in.");

  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (res.status === 401) {
    throw new Error("Sessie verlopen — log opnieuw in.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Serverfout (${res.status})`);
  }
  return res.json();
}

export default function PVConfigurator() {
  // Login-gate: blokkeert de hele tool tot er een geldige Neon Auth-sessie is.
  const [checkingSession, setCheckingSession] = useState(true);
  const [session, setSession] = useState(null); // { user: { id, name, email } } | null
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState(null);
  const [loginBusy, setLoginBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await authClient.getSession();
      if (data?.user) setSession(data);
      setCheckingSession(false);
    })();
  }, []);

  async function handleLogin() {
    if (!loginEmail.trim() || !loginPassword || loginBusy) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      const { error } = await authClient.signIn.email({ email: loginEmail.trim(), password: loginPassword });
      if (error) {
        setLoginError("E-mailadres of wachtwoord onjuist.");
        return;
      }
      const { data } = await authClient.getSession();
      setSession(data);
    } catch {
      setLoginError("Kon niet verbinden met de server. Probeer het opnieuw.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    await authClient.signOut();
    setSession(null);
  }

  const [panelDb, setPanelDb] = useState(() => getPanelFamilies());
  const [inverterDb, setInverterDb] = useState(() => getInverterFamilies());
  const [mode, setMode] = useState("design"); // "design" | "find" | "library" | "agent"

  const [tMinCold, setTMinCold] = useState(-10);
  const [tMaxHot, setTMaxHot] = useState(70);

  // Hoofdaansluiting: één keuze (fasen + ampère per fase samen)
  const [connId, setConnId] = useState("3x25");

  // Ontwerp checken: samengevoegde flow (was Configuratie checken + Legplan-
  // check) in 3 stappen. Eén datamodel voor beide: een platte strings-lijst
  // + auto/handmatige MPPT-toewijzing, zoals de oude Legplan-check al had.
  const [designStep, setDesignStep] = useState("invoer");
  const [designStrings, setDesignStrings] = useState([
    { n: 19, panelId: "JAM54D41-430/GB", azimuth: 323, helling: 5 },
    { n: 19, panelId: "JAM54D41-430/GB", azimuth: 142, helling: 5 },
    { n: 19, panelId: "JAM54D41-430/GB", azimuth: 142, helling: 5 },
    { n: 19, panelId: "JAM54D41-430/GB", azimuth: 142, helling: 5 },
  ]);
  // Omvormerpark: lijst van { inverterId, count } — ondersteunt een echte mix
  // van verschillende typen, uitgeklapt tot genummerde eenheden (designUnits).
  const [designFleet, setDesignFleet] = useState([{ inverterId: "SUN2000-20K-MB0", count: 1 }]);
  const [designAssignMode, setDesignAssignMode] = useState("auto"); // "auto" | "manual"
  const [designManualAssign, setDesignManualAssign] = useState(null); // [unitIdx][mpptIdx] = [stringIdx,...]

  // Indeling: voorstel voor stringverdeling + omvormer uit een ruw legplan
  // (dakvlakken zonder vooraf bepaalde strings) — vult designStrings/designFleet
  // pas na expliciete "Toepassen", net als de andere extractiestromen.
  const [roofFaces, setRoofFaces] = useState([{ count: 76, azimuth: 180, helling: 35 }]);
  const [roofPanelId, setRoofPanelId] = useState("JAM54D41-430/GB");
  const [roofFixedInvCount, setRoofFixedInvCount] = useState(""); // "" = automatisch optimaliseren
  const [roofImportBusy, setRoofImportBusy] = useState(false);
  const [roofImportError, setRoofImportError] = useState(null);
  const [roofMatches, setRoofMatches] = useState(null); // null tot "Voorstel genereren"

  // Rapport-stap: optioneel legplan-screenshot (dataURL) voor in de
  // monteurs-PDF — puur ter illustratie, wordt niet uitgelezen/geëxtraheerd.
  const [reportImage, setReportImage] = useState(null);

  // Opslaan/laden van gedeelde configuraties (naam + Sollit-ID, verplicht)
  const [savedConfigs, setSavedConfigs] = useState([]);
  const [selectedLoadId, setSelectedLoadId] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saveSollitId, setSaveSollitId] = useState("");
  const [saveStatus, setSaveStatus] = useState(null); // { type: "ok" | "error", message }

  // Omvormer zoeken
  const [findPanelId, setFindPanelId] = useState("JAM54D41-430/GB");
  const [totalPanels, setTotalPanels] = useState(76);
  const [fixedInvCount, setFixedInvCount] = useState(""); // "" = automatisch optimaliseren

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
  // "Ongelijke MPPT's": toont per MPPT een los invoerveld voor Strings/MPPT
  // i.p.v. één uniform getal — voor omvormers met trackers die niet allemaal
  // evenveel strings aankunnen (bijv. 1 op MPPT 1, 2 op MPPT 2).
  const [addAsymmetricMppt, setAddAsymmetricMppt] = useState(false);
  const customFetchStarted = useRef(false);

  // Datasheet-upload: extractie ter bevestiging, nooit direct toegepast (zie
  // CLAUDE.md: datasheet-extractie is het grootste risico van deze tool).
  const [datasheetBusy, setDatasheetBusy] = useState(false);
  const [datasheetError, setDatasheetError] = useState(null);
  const [datasheetDraft, setDatasheetDraft] = useState(null); // { familyName, isNewFamily, betaVoc, vsysMax, note, rows: [...] }

  // Opgeslagen datasheet-bestanden per familie (traceerbaarheid — zie
  // CLAUDE.md: kunnen terugvinden waar een waarde vandaan komt).
  const [datasheetsList, setDatasheetsList] = useState([]);
  const [datasheetUploadBusy, setDatasheetUploadBusy] = useState(null); // familienaam die bezig is, of null
  const datasheetsFetchStarted = useRef(false);

  // Screenshot-import: geëxtraheerde strings ter bevestiging.
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importDraft, setImportDraft] = useState(null); // { rows: [...] } | null

  const availPanels = useMemo(() => flattenPanels(panelDb), [panelDb]);
  const conn = useMemo(() => getConnection(connId), [connId]);
  const baseInverters = useMemo(() => flattenInverters(inverterDb), [inverterDb]);
  // Alle beschikbare omvormers met aansluitvlag — niet uitsluiten, alleen
  // markeren (overschrijding = waarschuwing, geen verberging).
  const availInverters = useMemo(
    () => baseInverters.map((v) => ({ ...v, fitsConn: inverterFitsConnection(v.iacMax, conn.amps) })),
    [baseInverters, conn]
  );

  const findPanel = availPanels.find((p) => p.id === findPanelId) || availPanels[0];
  const matches = useMemo(() => {
    if (mode !== "find" || !findPanel) return [];
    const count = fixedInvCount ? Math.max(1, +fixedInvCount) : undefined;
    return findMatchingInverters({ panel: findPanel, totalPanels, tMinCold, tMaxHot, inverters: availInverters, fixedInvCount: count });
  }, [mode, findPanel, totalPanels, tMinCold, tMaxHot, availInverters, fixedInvCount]);

  // Ontwerp checken: koppel paneeldata aan elke string
  const designStringsResolved = useMemo(
    () =>
      designStrings.map((s) => ({
        ...s,
        panel: availPanels.find((p) => p.id === s.panelId) || availPanels[0],
      })),
    [designStrings, availPanels]
  );
  // Vloot uitklappen tot individuele, doorlopend genummerde eenheden — mag
  // meerdere typen mixen (bijv. 3× GW40K + 1× GW33K wordt eenheid 1-3-4).
  const designUnits = useMemo(() => {
    const list = [];
    let n = 1;
    for (const row of designFleet) {
      const inverter = availInverters.find((i) => i.id === row.inverterId) || availInverters[0];
      if (!inverter) continue;
      for (let k = 0; k < row.count; k++) list.push({ unitNumber: n++, inverterId: inverter.id, inverter });
    }
    return list;
  }, [designFleet, availInverters]);

  const designFleetAssignment = useMemo(() => {
    if (designUnits.length === 0) return { units: [], overflow: false };
    if (designAssignMode === "manual" && designManualAssign) {
      const units = designUnits.map((u, uIdx) => {
        const perUnit = designManualAssign[uIdx] || [];
        return Array.from({ length: u.inverter.nMppt }, (_, mIdx) => perUnit[mIdx] || []);
      });
      return { units, overflow: designStrings.length !== units.flat(2).length };
    }
    return autoAssignFleet(designStringsResolved, designUnits);
  }, [designAssignMode, designManualAssign, designStringsResolved, designUnits, designStrings.length]);

  // checkLegplan blijft ongewijzigd, gewoon één keer per eenheid aangeroepen —
  // maar wel met alleen déze eenheid se eigen strings (lokaal herindexeerd),
  // anders zou checkLegplans systeem-brede totalWp/powerOk/allAssigned per
  // eenheid het totaal van de HELE vloot vergelijken met de limiet van één
  // eenheid.
  const designFleetResults = useMemo(() => {
    if (designUnits.length === 0 || designStringsResolved.length === 0) return [];
    return designUnits.map((unit, uIdx) => {
      const unitMppts = designFleetAssignment.units[uIdx] || [];
      const globalIdxs = unitMppts.flat();
      const unitStrings = globalIdxs.map((gi) => designStringsResolved[gi]);
      const localIndexOf = new Map(globalIdxs.map((gi, li) => [gi, li]));
      const localMppts = unitMppts.map((idxs) => idxs.map((gi) => localIndexOf.get(gi)));
      const result = checkLegplan(unitStrings, unit.inverter, { mppts: localMppts, overflow: false }, tMinCold, tMaxHot);
      return { unit, result };
    });
  }, [designUnits, designStringsResolved, designFleetAssignment, tMinCold, tMaxHot]);

  // DC/AC-overdimensionering per omvormerpark-rij (type + aantal), op basis
  // van het Wp dat op dit moment daadwerkelijk aan die eenheden toegewezen is
  // — zelfde weergave als "Omvormer zoeken", maar dan per rij in de vloot.
  const designFleetRowStats = useMemo(() => {
    const stats = [];
    let uIdx = 0;
    for (const row of designFleet) {
      let assignedWp = 0;
      for (let k = 0; k < row.count; k++) {
        const mppts = designFleetAssignment.units[uIdx + k] || [];
        for (const stringIdxs of mppts) {
          for (const si of stringIdxs) {
            const s = designStringsResolved[si];
            if (s) assignedWp += s.n * s.panel.wp;
          }
        }
      }
      const inverter = designUnits[uIdx]?.inverter;
      const totalAc = inverter ? inverter.pacNom * row.count : 0;
      const dcAcRatio = totalAc > 0 ? assignedWp / totalAc : null;
      stats.push({
        assignedWp,
        totalAc,
        dcAcRatio,
        inBand: dcAcRatio !== null && dcAcRatio >= OVERDIM_MIN && dcAcRatio <= OVERDIM_MAX,
        highOverdim: dcAcRatio !== null && dcAcRatio > OVERDIM_MAX,
      });
      uIdx += row.count;
    }
    return stats;
  }, [designFleet, designUnits, designFleetAssignment, designStringsResolved]);

  const designFleetPass = designFleetResults.length > 0 && !designFleetAssignment.overflow && designFleetResults.every((r) => r.result.pass);
  const designAnyMixed = designFleetResults.some((r) => r.result.anyMixed);
  const designAnyPowerNotOk = designFleetResults.some((r) => !r.result.powerOk);
  const designTotalWp = designStringsResolved.reduce((s, x) => s + x.n * x.panel.wp, 0);
  const totalIacMax = designUnits.reduce((sum, u) => sum + u.inverter.iacMax, 0);
  const fleetFitsConn = designUnits.length === 0 || inverterFitsConnection(totalIacMax, conn.amps);

  // Rapport voor de monteur: label = omvormer.mppt.string, omvormer-cijfer =
  // het doorlopende eenheidsnummer uit designUnits, + Voc STC per string.
  const reportRows = useMemo(() => {
    if (!designFleetAssignment.units.length) return [];
    return designFleetAssignment.units.flatMap((mppts, uIdx) => {
      const unit = designUnits[uIdx];
      return mppts.flatMap((stringIdxs, mIdx) =>
        stringIdxs.map((si, sIdxInMppt) => {
          const s = designStringsResolved[si];
          return {
            label: `${unit.unitNumber}.${mIdx + 1}.${sIdxInMppt + 1}`,
            unitNumber: unit.unitNumber,
            inverterId: unit.inverterId,
            mppt: mIdx + 1,
            n: s.n,
            panelId: s.panelId,
            wp: s.panel.wp,
            vocStc: stringVocStc(s.panel, s.n),
          };
        })
      );
    });
  }, [designFleetAssignment, designUnits, designStringsResolved]);

  async function handleReportImageFile(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setReportImage(dataUrl);
  }

  function handleReportImagePaste(e) {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) handleReportImageFile(file);
  }

  function generateReportPdf() {
    if (reportRows.length === 0) return;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.text(saveName || "PV-installatie", 14, 16);
    let y = 24;
    if (reportImage) {
      const imgProps = doc.getImageProperties(reportImage);
      const w = pageWidth - 28;
      const h = (imgProps.height * w) / imgProps.width;
      doc.addImage(reportImage, imgProps.fileType, 14, y, w, h);
      y += h + 10;
    }
    autoTable(doc, {
      startY: y,
      head: [["Omvormer", "MPPT", "String", "Aantal PV", "Wp", "Voc STC (V)"]],
      body: reportRows.map((r) => [`${r.inverterId} (#${r.unitNumber})`, r.mppt, r.label, r.n, r.wp, r.vocStc.toFixed(1)]),
    });
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      "Ontwerphulp, geen vervanging voor toetsing door een gekwalificeerd persoon.",
      14,
      doc.internal.pageSize.getHeight() - 10
    );
    doc.save(`${(saveName || "pv-installatie").trim().replace(/\s+/g, "-") || "pv-installatie"}.pdf`);
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
      const payload = { strings: designStrings, fleet: designFleet, assignMode: designAssignMode, manualAssign: designManualAssign, tMinCold, tMaxHot, connId };
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
      setDesignStrings(p.strings);
      if (p.fleet) {
        setDesignFleet(p.fleet);
        setDesignManualAssign(p.manualAssign || null);
      } else {
        // Oud formaat: precies één omvormer, geen vloot — normaliseren bij
        // het laden, geen DB-migratie nodig.
        setDesignFleet([{ inverterId: p.inverterId, count: 1 }]);
        setDesignManualAssign(p.manualAssign ? [p.manualAssign] : null);
      }
      setDesignAssignMode(p.assignMode || "auto");
      setTMinCold(p.tMinCold);
      setTMaxHot(p.tMaxHot);
      setConnId(p.connId);
      setDesignStep("resultaat");
      setSaveStatus({
        type: "ok",
        message: `"${data.config.name}" geladen${data.config.created_by_name ? ` (gemaakt door ${data.config.created_by_name})` : ""}.`,
      });
    } catch (e) {
      setSaveStatus({ type: "error", message: e.message });
    }
  }

  function updateDesignString(idx, field, value) {
    setDesignStrings((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
    setDesignManualAssign(null);
  }
  function addDesignString() {
    setDesignStrings((prev) => [...prev, { n: 19, panelId: availPanels[0].id, azimuth: 180, helling: 35 }]);
    setDesignManualAssign(null);
  }
  function removeDesignString(idx) {
    setDesignStrings((prev) => prev.filter((_, i) => i !== idx));
    setDesignManualAssign(null);
  }
  function assignToMppt(stringIdx, unitIdx, mpptIdx) {
    setDesignAssignMode("manual");
    setDesignManualAssign((prev) => {
      const base = prev
        ? prev.map((u) => u.map((arr) => [...arr]))
        : designUnits.map((u) => Array.from({ length: u.inverter.nMppt }, () => []));
      // verwijder string overal, op elke eenheid
      for (const unitArr of base) {
        for (const arr of unitArr) {
          const p = arr.indexOf(stringIdx);
          if (p !== -1) arr.splice(p, 1);
        }
      }
      if (unitIdx >= 0 && mpptIdx >= 0) base[unitIdx][mpptIdx].push(stringIdx);
      return base;
    });
  }

  function addFleetRow() {
    setDesignFleet((prev) => [...prev, { inverterId: availInverters[0].id, count: 1 }]);
    setDesignManualAssign(null);
  }
  function updateFleetRow(idx, field, value) {
    setDesignFleet((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
    setDesignManualAssign(null);
  }
  function removeFleetRow(idx) {
    setDesignFleet((prev) => prev.filter((_, i) => i !== idx));
    setDesignManualAssign(null);
  }

  function updateRoofFace(idx, field, value) {
    setRoofFaces((prev) => prev.map((f, i) => (i === idx ? { ...f, [field]: value } : f)));
    setRoofMatches(null);
  }
  function addRoofFace() {
    setRoofFaces((prev) => [...prev, { count: 20, azimuth: 180, helling: 35 }]);
    setRoofMatches(null);
  }
  function removeRoofFace(idx) {
    setRoofFaces((prev) => prev.filter((_, i) => i !== idx));
    setRoofMatches(null);
  }

  // Screenshot → base64 → /api/parse-roofplan → vult de dakvlak-tabel. Zelfde
  // "nooit direct toepassen"-principe als de andere extractiestromen: dit
  // vult alleen de tabel, "Voorstel genereren" moet nog expliciet.
  async function handleRoofplanUpload(file) {
    setRoofImportError(null);
    setRoofImportBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const [, mediaType, base64] = dataUrl.match(/^data:(.+);base64,(.*)$/) || [];
      if (!base64) throw new Error("Kon het bestand niet lezen.");
      const data = await apiFetch("/api/parse-roofplan", {
        method: "POST",
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      });
      setRoofFaces(data.roofFaces.map((f) => ({ count: f.count ?? 1, azimuth: f.azimuth ?? 180, helling: f.helling ?? 35 })));
      const matchedPanelId = matchExtractedPanel({ wp: data.panelWp, fabrikant: data.panelFabrikant }, availPanels);
      if (matchedPanelId) setRoofPanelId(matchedPanelId);
      setRoofMatches(null);
    } catch (e) {
      setRoofImportError(e.message);
    } finally {
      setRoofImportBusy(false);
    }
  }

  // Zoekt, gegeven de dakvlakken en één gedeeld paneeltype, het best passende
  // omvormertype — hergebruikt findMatchingInverters ongewijzigd (bekijkt het
  // totaal aantal panelen, niet de dakvlak-indeling zelf).
  function generateRoofSuggestion() {
    const panel = availPanels.find((p) => p.id === roofPanelId) || availPanels[0];
    const totalPanels = roofFaces.reduce((s, f) => s + (+f.count || 0), 0);
    const fixedInvCount = roofFixedInvCount ? Math.max(1, +roofFixedInvCount) : undefined;
    setRoofMatches(findMatchingInverters({ panel, totalPanels, tMinCold, tMaxHot, inverters: availInverters, fixedInvCount }));
  }

  function applyRoofSuggestion(match) {
    const strings = buildStringsFromRoofFaces(roofFaces, match.nPerString).map((s) => ({ ...s, panelId: roofPanelId }));
    setDesignStrings(strings);
    setDesignFleet([{ inverterId: match.inverter.id, count: match.invCount }]);
    setDesignManualAssign(null);
    setDesignAssignMode("auto");
    setRoofMatches(null);
  }

  // Vrije vraag/antwoord: stuurt de hele gespreksgeschiedenis + de huidige
  // component-lijsten (mét toggles/labels) + het actieve ontwerp (indien
  // aanwezig) naar /api/agent-chat. De server rekent nooit zelf — elk getal
  // in het antwoord komt uit een tool-aanroep naar de rekenkern.
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
          // De agent is voorlopig single-inverter — bij een echte vloot (>1
          // eenheid) sturen we geen currentDesign mee, zodat de agent niet
          // doet alsof hij een mix kent die hij niet kan doorrekenen.
          currentDesign: designStrings.length > 0 && designUnits.length === 1 ? { strings: designStrings, inverterId: designUnits[0].inverterId } : null,
        }),
      });
      setChatMessages((prev) => [...prev, { role: "assistant", content: data.reply, toolCalls: data.toolCalls }]);
    } catch (e) {
      setChatError(e.message);
    } finally {
      setChatBusy(false);
    }
  }

  // Zoekt in de tool-aanroepen van een agent-antwoord naar een voorgestelde
  // MPPT-toewijzing die alle huidige ontwerp-strings dekt (basisvalidatie —
  // geen elektrische controle, dat doet checkLegplan al zodra 'm toegepast is).
  function findApplicableAssignment(toolCalls) {
    if (!toolCalls) return null;
    for (let i = toolCalls.length - 1; i >= 0; i--) {
      const tc = toolCalls[i];
      let mppts = null;
      if (tc.name === "auto_assign" && tc.output?.mppts) mppts = tc.output.mppts;
      if (tc.name === "check_legplan" && tc.input?.assignment?.mppts) mppts = tc.input.assignment.mppts;
      if (mppts && mppts.flat().length === designStrings.length) return mppts;
    }
    return null;
  }
  function applyAgentAssignment(mppts) {
    // De agent kent alleen het 1-eenheid-geval (zie sendChatMessage) — de
    // voorgestelde mppts zijn dus altijd voor designUnits[0].
    setDesignManualAssign([mppts]);
    setDesignAssignMode("manual");
    setMode("design");
    setDesignStep("resultaat");
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
  // dubbele fetch als zowel de mount-effect als de library-tab-effect
  // vrijwel gelijktijdig zouden vuren.
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

  // Opgeslagen datasheets ophalen (alleen metadata, niet de bestandsinhoud —
  // die haalt viewDatasheet apart op zodra iemand er echt op klikt).
  async function fetchDatasheetsList() {
    if (datasheetsFetchStarted.current) return;
    datasheetsFetchStarted.current = true;
    try {
      const data = await apiFetch("/api/datasheets");
      setDatasheetsList(data.datasheets);
    } catch {
      datasheetsFetchStarted.current = false;
    }
  }

  async function uploadFamilyDatasheet(type, familyName, file) {
    setDatasheetUploadBusy(familyName);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const [, mimeType, base64] = dataUrl.match(/^data:(.+);base64,(.*)$/) || [];
      if (!base64) throw new Error("Kon het bestand niet lezen.");
      await apiFetch("/api/datasheets", {
        method: "POST",
        body: JSON.stringify({ type, familyName, filename: file.name, mimeType, fileBase64: base64 }),
      });
      const data = await apiFetch("/api/datasheets");
      setDatasheetsList(data.datasheets);
    } catch (e) {
      setAddStatus({ type: "error", message: e.message });
    } finally {
      setDatasheetUploadBusy(null);
    }
  }

  // Haalt de volledige bestandsinhoud pas op bij het openen — de lijst zelf
  // bevat alleen metadata, om die aanroep licht te houden.
  async function viewDatasheet(id) {
    try {
      const data = await apiFetch(`/api/datasheets?id=${id}`);
      const d = data.datasheet;
      const win = window.open();
      if (win) win.location.href = `data:${d.mime_type};base64,${d.file_base64}`;
    } catch (e) {
      setAddStatus({ type: "error", message: e.message });
    }
  }

  // Label bewerken/verwijderen op een variant — geldt ongeacht of die variant
  // uit de statische database of via "component toevoegen" komt.
  async function editLabel(type, variantId, currentLabel) {
    const value = window.prompt(`Label voor ${variantId} (leeg = verwijderen):`, currentLabel || "");
    if (value === null) return;
    const newLabel = value.trim();
    try {
      await apiFetch("/api/labels", { method: "POST", body: JSON.stringify({ type, variantId, label: newLabel }) });
      const setter = type === "panel" ? setPanelDb : setInverterDb;
      setter((prev) =>
        prev.map((f) => ({
          ...f,
          variants: f.variants.map((v) => (v.id !== variantId ? v : newLabel ? { ...v, label: newLabel } : { ...v, label: undefined })),
        }))
      );
    } catch (e) {
      setAddStatus({ type: "error", message: e.message });
    }
  }

  useEffect(() => {
    // Pas laden zodra er een geldige sessie is — anders faalt de aanroep
    // (apiFetch vereist een ingelogde gebruiker) nog vóór de login-gate
    // getoond is.
    if (session?.user) fetchCustomComponents();
    if (session?.user) fetchDatasheetsList();
  }, [session]);

  useEffect(() => {
    if (mode === "library") fetchCustomComponents();
    if (mode === "library") fetchDatasheetsList();
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
      if (f.key === "stringsPerMppt" && addType === "inverter") {
        const res = resolveStringsPerMppt(addVariant[f.key]);
        if (!res.ok) {
          setAddStatus({ type: "error", message: `Veld "${f.label}" is verplicht voor elke MPPT.` });
          return;
        }
        variant.stringsPerMppt = res.value;
        continue;
      }
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
      setAddAsymmetricMppt(false);
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

  // Aan: array van `n` losse vakjes, gevuld met het huidige uniforme getal.
  // Uit: terug naar één getal (de eerste waarde die al was ingevuld).
  function toggleAddAsymmetric() {
    const n = Math.max(1, Math.min(20, Math.round(Number(addVariant.nMppt)) || 1));
    setAddAsymmetricMppt((prev) => {
      const next = !prev;
      setAddVariant((v) => {
        if (next) return { ...v, stringsPerMppt: Array.from({ length: n }, () => v.stringsPerMppt ?? "") };
        const arr = Array.isArray(v.stringsPerMppt) ? v.stringsPerMppt : [];
        return { ...v, stringsPerMppt: arr[0] ?? "" };
      });
      return next;
    });
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
        // Als het vision-model al een array teruggaf (ongelijke MPPT's in de
        // datasheet gezien), meteen de per-MPPT-invoer tonen i.p.v. dat de
        // gebruiker het eerst handmatig moet omzetten.
        if (addType === "inverter" && Array.isArray(v.stringsPerMppt)) row.asymmetricMppt = true;
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
  // Zelfde "Ongelijke MPPT's"-toggle als het handmatige formulier, maar per
  // rij — een datasheet kan meerdere vermogensklassen bevatten die niet per
  // se allemaal dezelfde MPPT-indeling hebben.
  function toggleDatasheetRowAsymmetric(idx) {
    setDatasheetDraft((prev) => ({
      ...prev,
      rows: prev.rows.map((r, i) => {
        if (i !== idx) return r;
        const n = Math.max(1, Math.min(20, Math.round(Number(r.nMppt)) || 1));
        const next = !r.asymmetricMppt;
        if (next) return { ...r, asymmetricMppt: true, stringsPerMppt: Array.from({ length: n }, () => r.stringsPerMppt ?? "") };
        const arr = Array.isArray(r.stringsPerMppt) ? r.stringsPerMppt : [];
        return { ...r, asymmetricMppt: false, stringsPerMppt: arr[0] ?? "" };
      }),
    }));
  }
  function updateDatasheetRowMppt(idx, mIdx, value) {
    setDatasheetDraft((prev) => ({
      ...prev,
      rows: prev.rows.map((r, i) => {
        if (i !== idx) return r;
        const n = Math.max(1, Math.min(20, Math.round(Number(r.nMppt)) || 1));
        const arr = Array.isArray(r.stringsPerMppt) ? [...r.stringsPerMppt] : Array.from({ length: n }, () => "");
        arr.length = n;
        arr[mIdx] = value;
        return { ...r, stringsPerMppt: arr };
      }),
    }));
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
        if (f.key === "stringsPerMppt" && addType === "inverter") {
          const res = resolveStringsPerMppt(r[f.key]);
          if (!res.ok) {
            rowOk = false;
            break;
          }
          variant.stringsPerMppt = res.value;
          continue;
        }
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
  async function handleStringplanUpload(file) {
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
      setImportDraft({ rows });
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
    setDesignStrings(importDraft.rows.map((r) => ({ n: r.n, panelId: r.panelId, azimuth: r.azimuth, helling: r.helling })));
    setDesignManualAssign(null);
    setDesignAssignMode("auto");
    setImportDraft(null);
    setImportError(null);
    setDesignStep("indeling");
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

  // Genummerde stap-indicator (Invoer → Indeling → Resultaat) — rustig en
  // luchtig: één duidelijke plek in het scherm die laat zien waar je bent,
  // in plaats van alles onder elkaar op één lange pagina.
  function renderStepIndicator() {
    const currentIdx = DESIGN_STEPS.findIndex((s) => s.id === designStep);
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, marginBottom: 36 }}>
        {DESIGN_STEPS.map((s, i) => (
          <React.Fragment key={s.id}>
            {i > 0 && <div style={{ width: 64, height: "0.5px", background: "var(--color-border-tertiary)", margin: "0 4px 20px" }} />}
            <div
              onClick={() => { if (i <= currentIdx) setDesignStep(s.id); }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: i <= currentIdx ? "pointer" : "default" }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 500,
                  background: i < currentIdx ? "var(--color-background-success)" : i === currentIdx ? "var(--color-background-info)" : "transparent",
                  color: i < currentIdx ? "var(--color-text-success)" : i === currentIdx ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                  border: i === currentIdx || i < currentIdx ? "none" : "0.5px solid var(--color-border-secondary)",
                }}
              >
                {i < currentIdx ? <i className="ti ti-check" style={{ fontSize: 15 }} aria-hidden="true" /> : i + 1}
              </div>
              <span style={{ fontSize: 12, color: i === currentIdx ? "var(--color-text-primary)" : "var(--color-text-secondary)", fontWeight: i === currentIdx ? 500 : 400 }}>
                {s.label}
              </span>
            </div>
          </React.Fragment>
        ))}
      </div>
    );
  }

  // Screenshot-upload + bevestigingstabel, gebruikt in de Invoer-stap.
  function renderStringplanImport() {
    return (
      <div style={{ ...card, marginBottom: 24, background: "var(--color-background-secondary)", border: "none" }}>
        {!importDraft && (
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
                  if (file) handleStringplanUpload(file);
                }}
              />
            </label>
          </div>
        )}
        {importError && !importDraft && <div style={{ fontSize: 12, color: "var(--color-text-danger)", marginTop: 8 }}>{importError}</div>}

        {importDraft && (
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

  if (checkingSession) {
    return (
      <div style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-secondary)", padding: "2rem 0", textAlign: "center" }}>
        Laden…
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-primary)", maxWidth: 360, margin: "10vh auto 0", padding: "0 1rem" }}>
        <div style={card}>
          <h2 style={{ fontSize: 18, fontWeight: 500, margin: "0 0 6px" }}>PV Configurator</h2>
          <p style={{ fontSize: 13, ...muted, marginTop: 0, marginBottom: 16 }}>
            Log in met je account om de tool te gebruiken. Nog geen account? Vraag Bas om er een voor je aan te maken.
          </p>
          <input
            type="email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            placeholder="E-mailadres"
            autoFocus
            disabled={loginBusy}
            style={{ width: "100%", marginBottom: 8 }}
          />
          <input
            type="password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
            placeholder="Wachtwoord"
            disabled={loginBusy}
            style={{ width: "100%", marginBottom: 10 }}
          />
          <button
            onClick={handleLogin}
            disabled={loginBusy || !loginEmail.trim() || !loginPassword}
            style={{ width: "100%", padding: "8px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: loginBusy ? "default" : "pointer", fontWeight: 500, opacity: loginBusy || !loginEmail.trim() || !loginPassword ? 0.6 : 1 }}
          >
            {loginBusy ? "Bezig…" : "Inloggen"}
          </button>
          {loginError && (
            <div style={{ fontSize: 12, color: "var(--color-text-danger)", marginTop: 8 }}>{loginError}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-primary)", padding: "1.5rem 0", maxWidth: 880 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tabBtn("design", "Ontwerp checken")}
          {tabBtn("find", "Omvormer zoeken")}
          {tabBtn("library", "Componenten beheren")}
          {tabBtn("agent", "Agent")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, ...muted }}>
          <span>{session.user.name || session.user.email}</span>
          <button
            onClick={handleLogout}
            style={{ padding: "4px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", color: "var(--color-text-secondary)" }}
          >
            Uitloggen
          </button>
        </div>
      </div>

      {/* Hoofdaansluiting + temperatuurinstellingen */}
      {mode !== "library" && mode !== "agent" && (
        <>
          <div style={{ ...card, marginBottom: 20, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
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
          <div style={{ fontSize: 11, ...muted, marginBottom: 24 }}>
            Defaults: −10 °C is de gangbare NL-ontwerpondergrens. 70 °C cel-max = worstcase NL-zomer (~40 °C lucht + ~30 °C opwarming onder volle zon).
          </div>
        </>
      )}

      {/* ONTWERP CHECKEN */}
      {mode === "design" && (
        <>
          {renderStepIndicator()}

          {/* STAP 1: INVOER */}
          {designStep === "invoer" && (
            <>
              <div style={{ ...card, marginBottom: 20 }}>
                <div style={label}>Laad een eerder opgeslagen configuratie</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <select
                    value={selectedLoadId}
                    onChange={(e) => { setSelectedLoadId(e.target.value); loadSavedConfig(e.target.value); }}
                    style={{ width: 280 }}
                  >
                    <option value="">— kies —</option>
                    {savedConfigs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.sollit_id}){c.created_by_name ? ` — ${c.created_by_name}` : ""}
                      </option>
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
                {saveStatus && (
                  <div style={{ fontSize: 12, marginTop: 8, color: saveStatus.type === "error" ? "var(--color-text-danger)" : "var(--color-text-success)" }}>
                    {saveStatus.message}
                  </div>
                )}
              </div>

              {renderStringplanImport()}

              <h3 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 12px" }}>Of voer strings handmatig in</h3>
              <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
                {designStringsResolved.map((s, i) => {
                  const azColors = ["#378ADD", "#D85A30", "#1D9E75", "#BA7517", "#534AB7", "#D4537E"];
                  const azList = [...new Set(designStrings.map((x) => x.azimuth))];
                  const col = azColors[azList.indexOf(s.azimuth) % azColors.length];
                  return (
                    <div key={i} style={{ ...card, padding: "12px 16px", borderLeft: `3px solid ${col}`, borderRadius: "var(--border-radius-md)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input type="number" min={1} max={40} value={s.n} onChange={(e) => updateDesignString(i, "n", +e.target.value)} style={{ width: 56 }} />
                        <span style={{ fontSize: 13, ...muted }}>×</span>
                      </div>
                      <select value={s.panelId} onChange={(e) => updateDesignString(i, "panelId", e.target.value)} style={{ flex: "1 1 180px", minWidth: 140 }}>
                        {availPanels.map((p) => (
                          <option key={p.id} value={p.id}>{p.id} — {p.wp}Wp{p.label ? ` · ${p.label}` : ""}</option>
                        ))}
                      </select>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, ...muted }}>Az</span>
                        <input type="number" min={0} max={359} value={s.azimuth} onChange={(e) => updateDesignString(i, "azimuth", +e.target.value)} style={{ width: 60 }} />°
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, ...muted }}>Hel</span>
                        <input type="number" min={0} max={90} value={s.helling} onChange={(e) => updateDesignString(i, "helling", +e.target.value)} style={{ width: 50 }} />°
                      </div>
                      <button onClick={() => removeDesignString(i)} aria-label="verwijder string" style={{ padding: "4px 8px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", color: "var(--color-text-danger)" }}>
                        <i className="ti ti-trash" style={{ fontSize: 15 }} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <button onClick={addDesignString} style={{ fontSize: 13, padding: "6px 12px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", color: "var(--color-text-primary)", marginBottom: 28 }}>
                <i className="ti ti-plus" style={{ fontSize: 15, verticalAlign: -2, marginRight: 4 }} /> String toevoegen
              </button>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => setDesignStep("indeling")}
                  style={{ padding: "8px 18px", border: "none", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontWeight: 500 }}
                >
                  Volgende: indeling
                </button>
              </div>
              {designStrings.length === 0 && (
                <div style={{ fontSize: 12, ...muted, marginTop: 8, textAlign: "right" }}>
                  Nog geen strings? In Indeling kun je ook een dakvlak-voorstel laten genereren.
                </div>
              )}
            </>
          )}

          {/* STAP 2: INDELING */}
          {designStep === "indeling" && designUnits.length > 0 && (
            <>
              <div style={{ ...card, marginBottom: 20, background: "var(--color-background-secondary)", border: "none" }}>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>Nog geen stringverdeling? Laat een voorstel doen.</div>
                <div style={{ fontSize: 12, ...muted, marginBottom: 14 }}>
                  Voer de dakvlakken in (aantal panelen + azimuth + helling, nog geen strings) — ik stel een stringverdeling en een passende omvormer voor.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={label}>Paneeltype</div>
                    <select value={roofPanelId} onChange={(e) => { setRoofPanelId(e.target.value); setRoofMatches(null); }} style={{ width: "100%" }}>
                      {availPanels.map((p) => (
                        <option key={p.id} value={p.id}>{p.id} — {p.wp} Wp{p.label ? ` · ${p.label}` : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={label}>Aantal omvormers (optioneel)</div>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={roofFixedInvCount}
                      onChange={(e) => { setRoofFixedInvCount(e.target.value); setRoofMatches(null); }}
                      placeholder="automatisch"
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
                  {roofFaces.map((f, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, ...muted }}>Aantal</span>
                        <input type="number" min={1} value={f.count} onChange={(e) => updateRoofFace(idx, "count", +e.target.value)} style={{ width: 70 }} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, ...muted }}>Az</span>
                        <input type="number" min={0} max={359} value={f.azimuth} onChange={(e) => updateRoofFace(idx, "azimuth", +e.target.value)} style={{ width: 60 }} />°
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, ...muted }}>Hel</span>
                        <input type="number" min={0} max={90} value={f.helling} onChange={(e) => updateRoofFace(idx, "helling", +e.target.value)} style={{ width: 50 }} />°
                      </div>
                      <button
                        onClick={() => removeRoofFace(idx)}
                        disabled={roofFaces.length === 1}
                        aria-label="verwijder dakvlak"
                        style={{ padding: "4px 8px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: roofFaces.length === 1 ? "default" : "pointer", color: "var(--color-text-danger)", opacity: roofFaces.length === 1 ? 0.4 : 1 }}
                      >
                        <i className="ti ti-trash" style={{ fontSize: 14 }} />
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                  <button onClick={addRoofFace} style={{ fontSize: 12, padding: "5px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", color: "var(--color-text-primary)" }}>
                    <i className="ti ti-plus" style={{ fontSize: 13, verticalAlign: -2, marginRight: 4 }} /> Dakvlak toevoegen
                  </button>
                  <label style={{ fontSize: 12, padding: "5px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", cursor: "pointer" }}>
                    {roofImportBusy ? "Bezig met lezen…" : "Dakvlak-screenshot uploaden"}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      disabled={roofImportBusy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) handleRoofplanUpload(file);
                      }}
                    />
                  </label>
                  <button
                    onClick={generateRoofSuggestion}
                    style={{ fontSize: 12, padding: "5px 10px", border: "none", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontWeight: 500 }}
                  >
                    Voorstel genereren
                  </button>
                </div>
                {roofImportError && <div style={{ fontSize: 12, color: "var(--color-text-danger)", marginBottom: 10 }}>{roofImportError}</div>}

                {roofMatches && (
                  roofMatches.length === 0 ? (
                    <div style={{ fontSize: 13, ...muted }}>
                      Geen enkele beschikbare omvormer past dit aantal panelen{roofFixedInvCount ? ` op precies ${roofFixedInvCount} omvormer(s)` : ""} binnen de grenzen bij {tMinCold}°C.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {roofMatches.slice(0, 3).map((m, i) => (
                        <div key={m.inverter.id} style={{ ...card, border: i === 0 ? "2px solid var(--color-border-info)" : card.border }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                            <div>
                              <span style={{ fontWeight: 500, fontSize: 15 }}>{m.invCount > 1 ? `${m.invCount}× ` : ""}{m.inverter.id}</span>
                              {m.inverter.isGoodwe && <span style={{ background: "var(--color-background-info)", color: "var(--color-text-info)", fontSize: 11, padding: "2px 8px", borderRadius: "var(--border-radius-md)", marginLeft: 8 }}>GoodWe</span>}
                            </div>
                            {i === 0 && <span style={{ background: "var(--color-background-info)", color: "var(--color-text-info)", fontSize: 12, padding: "3px 10px", borderRadius: "var(--border-radius-md)" }}>Beste match</span>}
                          </div>
                          <div style={{ fontSize: 13, marginTop: 8 }}>
                            {m.stringsTotal} strings × {m.nPerString} panelen · {(m.totalWp / 1000).toFixed(1)} kWp op {(m.totalAc / 1000).toFixed(1)} kW AC
                          </div>
                          <div style={{ fontSize: 13, marginTop: 4 }}>
                            <span style={muted}>Overdimensionering: </span>
                            <b style={{ color: m.highOverdim ? "var(--color-text-warning)" : "var(--color-text-primary)" }}>{(m.dcAcRatio * 100).toFixed(0)}%</b>
                          </div>
                          <button
                            onClick={() => applyRoofSuggestion(m)}
                            style={{ marginTop: 10, padding: "6px 14px", border: "none", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontWeight: 500, fontSize: 12 }}
                          >
                            Toepassen
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 28 }}>
                <div style={card}>
                  <div style={label}>Omvormerpark</div>
                  <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
                    {designFleet.map((row, idx) => {
                      const stat = designFleetRowStats[idx];
                      return (
                        <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <select value={row.inverterId} onChange={(e) => updateFleetRow(idx, "inverterId", e.target.value)} style={{ flex: 1, minWidth: 0 }}>
                              {availInverters.map((i) => (
                                <option key={i.id} value={i.id}>{i.id}{i.label ? ` · ${i.label}` : ""}</option>
                              ))}
                            </select>
                            <span style={{ fontSize: 12, ...muted }}>×</span>
                            <input
                              type="number"
                              min={1}
                              value={row.count}
                              onChange={(e) => updateFleetRow(idx, "count", Math.max(1, +e.target.value))}
                              style={{ width: 52 }}
                            />
                            <button
                              onClick={() => removeFleetRow(idx)}
                              disabled={designFleet.length === 1}
                              aria-label="verwijder omvormertype"
                              style={{ padding: "4px 8px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: designFleet.length === 1 ? "default" : "pointer", color: "var(--color-text-danger)", opacity: designFleet.length === 1 ? 0.4 : 1 }}
                            >
                              <i className="ti ti-trash" style={{ fontSize: 14 }} />
                            </button>
                          </div>
                          {stat && stat.totalAc > 0 && (
                            <div style={{ fontSize: 11, ...muted, paddingLeft: 2 }}>
                              DC/AC:{" "}
                              <b style={{ color: stat.highOverdim ? "var(--color-text-warning)" : "var(--color-text-primary)" }}>
                                {(stat.dcAcRatio * 100).toFixed(0)}%
                              </b>{" "}
                              ({(stat.assignedWp / 1000).toFixed(1)} kWp / {(stat.totalAc / 1000).toFixed(1)} kW AC)
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={addFleetRow} style={{ fontSize: 12, padding: "4px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", color: "var(--color-text-primary)", marginBottom: 8 }}>
                    <i className="ti ti-plus" style={{ fontSize: 13, verticalAlign: -2, marginRight: 4 }} /> Omvormertype toevoegen
                  </button>
                  <div style={{ fontSize: 12, ...muted }}>
                    Totaal: {designUnits.length} eenhe{designUnits.length === 1 ? "id" : "den"} · {designUnits.reduce((s, u) => s + u.inverter.nMppt, 0)} MPPT-slots
                  </div>
                </div>
                <div style={card}>
                  <div style={label}>Toewijzing strings → MPPT</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => { setDesignAssignMode("auto"); setDesignManualAssign(null); }} style={{ flex: 1, fontSize: 13, padding: "6px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", cursor: "pointer", background: designAssignMode === "auto" ? "var(--color-background-info)" : "transparent", color: designAssignMode === "auto" ? "var(--color-text-info)" : "var(--color-text-primary)" }}>Automatisch</button>
                    <button onClick={() => setDesignAssignMode("manual")} style={{ flex: 1, fontSize: 13, padding: "6px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", cursor: "pointer", background: designAssignMode === "manual" ? "var(--color-background-info)" : "transparent", color: designAssignMode === "manual" ? "var(--color-text-info)" : "var(--color-text-primary)" }}>Handmatig</button>
                  </div>
                  <div style={{ fontSize: 12, ...muted, marginTop: 6 }}>Automatisch houdt zelfde oriëntatie op zelfde MPPT en vult eenheden op volgorde. Bij een mix van typen: gebruik Handmatig om specifieke strings naar een specifiek omvormertype te sturen.</div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 20, marginBottom: 28 }}>
                {designUnits.map((unit, uIdx) => (
                  <div key={uIdx}>
                    <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>
                      Omvormer {unit.unitNumber} <span style={{ ...muted, fontWeight: 400 }}>· {unit.inverterId}</span>
                    </div>
                    <div style={{ display: "grid", gap: 12 }}>
                      {(designFleetAssignment.units[uIdx] || []).map((stringIdxs, mIdx) => (
                        <div key={mIdx} style={{ ...card, padding: "16px 20px" }}>
                          <div style={{ fontWeight: 500, marginBottom: 10 }}>MPPT {mIdx + 1}</div>
                          {stringIdxs.length === 0 ? (
                            <div style={{ fontSize: 13, ...muted }}>Leeg</div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {stringIdxs.map((si) => {
                                const s = designStringsResolved[si];
                                return (
                                  <div key={si} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                                    <span style={{ color: "var(--color-text-secondary)" }}>String {si + 1} · {s.n} panelen</span>
                                    <span style={{ color: "var(--color-text-tertiary)" }}>{s.azimuth}° · {s.helling}°</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {designAssignMode === "manual" && (
                            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid var(--color-border-tertiary)", fontSize: 12, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                              <span style={muted}>Wijs string toe:</span>
                              {designStringsResolved.map((s, si) => (
                                <button key={si} onClick={() => assignToMppt(si, uIdx, mIdx)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", background: stringIdxs.includes(si) ? "var(--color-background-info)" : "transparent", color: stringIdxs.includes(si) ? "var(--color-text-info)" : "var(--color-text-primary)", cursor: "pointer" }}>
                                  S{si + 1} ({s.n}@{s.azimuth}°)
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button onClick={() => setDesignStep("invoer")} style={{ padding: "8px 18px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer" }}>
                  Terug
                </button>
                <button
                  onClick={() => setDesignStep("resultaat")}
                  style={{ padding: "8px 18px", border: "none", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontWeight: 500 }}
                >
                  Volgende: resultaat
                </button>
              </div>
            </>
          )}

          {/* STAP 3: RESULTAAT */}
          {designStep === "resultaat" && designUnits.length > 0 && designFleetResults.length > 0 && (
            <>
              <div
                style={{
                  ...card,
                  marginBottom: 20,
                  background: designFleetPass ? "var(--color-background-success)" : "var(--color-background-danger)",
                  border: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <i
                    className={`ti ${designFleetPass ? "ti-circle-check" : "ti-x"}`}
                    style={{ fontSize: 24, color: designFleetPass ? "var(--color-text-success)" : "var(--color-text-danger)" }}
                    aria-hidden="true"
                  />
                  <span style={{ fontWeight: 500, fontSize: 16, color: designFleetPass ? "var(--color-text-success)" : "var(--color-text-danger)" }}>
                    {designFleetAssignment.overflow
                      ? `Te veel strings voor dit omvormerpark (${designUnits.length} eenhe${designUnits.length === 1 ? "id" : "den"})`
                      : designFleetPass
                      ? `Configuratie past binnen alle grenzen van het omvormerpark`
                      : `Configuratie overschrijdt een of meer grenzen op ≥1 omvormer`}
                  </span>
                </div>
                <div style={{ fontSize: 13, marginTop: 8, color: designFleetPass ? "var(--color-text-success)" : "var(--color-text-danger)" }}>
                  {(designTotalWp / 1000).toFixed(2)} kWp · {designStrings.reduce((s, x) => s + x.n, 0)} panelen · {designUnits.length} omvormereenhe{designUnits.length === 1 ? "id" : "den"}
                  {designAnyMixed && <span> · let op: gemengde oriëntatie op ≥1 MPPT — optimizers nodig</span>}
                  {designAnyPowerNotOk && <span> · DC-vermogen boven omvormerlimiet op ≥1 eenheid</span>}
                </div>
                {(designFleetAssignment.overflow || !designFleetPass) && (
                  <div style={{ fontSize: 12, marginTop: 8, color: "var(--color-text-danger)" }}>
                    Past niet? Pas het omvormerpark in de Indeling-stap aan, of gebruik "Omvormer zoeken" om te zien welke omvormer(s) wél passen bij dit aantal panelen.
                  </div>
                )}
              </div>

              <div style={{ ...card, marginBottom: 20, background: "var(--color-background-warning)", border: "none" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <i className="ti ti-alert-triangle" style={{ fontSize: 18, color: "var(--color-text-warning)", marginTop: 2 }} aria-hidden="true" />
                  <div style={{ fontSize: 13, color: "var(--color-text-warning)" }}>
                    <b>Let op — verdeelkast klant.</b> De verdeelkast moet de opgetelde stromen aankunnen: de hoofdaansluiting ({conn.phases}×{conn.amps} A) plus de uitgangsstroom van alle omvormereenheden samen.
                    <div style={{ marginTop: 4 }}>
                      Aansluiting {conn.phases}×{conn.amps} A + omvormer-uitgang totaal {totalIacMax.toFixed(1)} A ({designUnits.length}×)
                      {" = "}<b>{conn.amps} A + {totalIacMax.toFixed(1)} A ≈ {(conn.amps + totalIacMax).toFixed(0)} A per fase</b> die door de kast moet kunnen lopen.
                      {conn.phases === 1 && <span> (1-fase: alles op één fase)</span>}
                    </div>
                    {!fleetFitsConn && (
                      <div style={{ marginTop: 6, fontWeight: 500 }}>
                        Totale uitgangsstroom ({totalIacMax.toFixed(1)} A) overschrijdt de aansluitwaarde ({conn.amps} A/fase): grote aanpassing in de verdeelkast nodig, en zonder accu niet echt rendabel door aftopverliezen.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {designFleetResults.map(({ unit, result }) => (
                <div key={unit.unitNumber} style={{ marginBottom: 28 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 12px" }}>
                    Omvormer {unit.unitNumber} <span style={{ ...muted, fontWeight: 400 }}>· {unit.inverterId} · Per MPPT</span>
                  </h3>
                  <div style={{ display: "grid", gap: 12 }}>
                    {result.mpptResults.map((m) => (
                      <div key={m.mpptNum} style={{ ...card, padding: "16px 20px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: m.empty ? 0 : 10 }}>
                          <span style={{ fontWeight: 500 }}>
                            MPPT {m.mpptNum + 1}
                            {m.empty ? <span style={{ ...muted, fontWeight: 400 }}> — leeg</span> : null}
                            {m.mixed && <span style={{ background: "var(--color-background-warning)", color: "var(--color-text-warning)", fontSize: 11, padding: "2px 8px", borderRadius: "var(--border-radius-md)", marginLeft: 8 }}>gemengd</span>}
                          </span>
                          {!m.empty && <i className={`ti ${m.pass ? "ti-check" : "ti-x"}`} style={{ color: m.pass ? "var(--color-text-success)" : "var(--color-text-danger)", fontSize: 18 }} aria-hidden="true" />}
                        </div>
                        {!m.empty && (
                          <>
                            <div style={{ fontSize: 12, ...muted, marginBottom: 10 }}>
                              {m.strings.map((s, k) => `${s.n}× ${s.panel.wp}Wp @ ${s.azimuth}°`).join("  +  ")}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {m.checks.map((c, k) => (
                                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: c.pass ? "var(--color-text-secondary)" : "var(--color-text-danger)" }}>
                                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <i className={`ti ${c.pass ? "ti-check" : "ti-x"}`} style={{ fontSize: 14 }} aria-hidden="true" />
                                    {c.label}
                                  </span>
                                  <span>{fmtCheckValue(c)} {fmtCheckLimit(c)}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div style={{ ...card, marginBottom: 20 }}>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div>
                      <div style={label}>Naam</div>
                      <input type="text" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="bijv. Jansen — Dorpsstraat 12" style={{ width: 200 }} />
                    </div>
                    <div>
                      <div style={label}>Sollit ID</div>
                      <input type="text" value={saveSollitId} onChange={(e) => setSaveSollitId(e.target.value)} style={{ width: 100 }} />
                    </div>
                  </div>
                  <button
                    onClick={saveCurrentConfig}
                    style={{ padding: "8px 18px", border: "none", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontWeight: 500 }}
                  >
                    Configuratie opslaan
                  </button>
                </div>
                {saveStatus && (
                  <div style={{ fontSize: 12, marginTop: 12, color: saveStatus.type === "error" ? "var(--color-text-danger)" : "var(--color-text-success)" }}>
                    {saveStatus.message}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button onClick={() => setDesignStep("indeling")} style={{ padding: "8px 18px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer" }}>
                  Terug
                </button>
                <button
                  onClick={() => setDesignStep("rapport")}
                  style={{ padding: "8px 18px", border: "none", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontWeight: 500 }}
                >
                  Volgende: rapport
                </button>
              </div>
            </>
          )}

          {/* STAP 4: RAPPORT */}
          {designStep === "rapport" && designUnits.length > 0 && (
            <>
              <p style={{ fontSize: 13, ...muted, marginTop: 0, marginBottom: 20 }}>
                Genereer een installatie-instructie voor de monteur: een optioneel legplan-plaatje, plus een tabel met
                omvormer, MPPT, stringlabel en de verwachte Voc STC per string — te vergelijken met de stringmeting na aanleg.
              </p>

              <div
                onPaste={handleReportImagePaste}
                tabIndex={0}
                style={{ ...card, marginBottom: 20, background: "var(--color-background-secondary)", border: "none" }}
              >
                <div style={label}>Legplan-plaatje (optioneel)</div>
                {reportImage ? (
                  <div>
                    <img src={reportImage} alt="Legplan" style={{ maxWidth: "100%", borderRadius: "var(--border-radius-md)", marginBottom: 10 }} />
                    <div>
                      <button
                        onClick={() => setReportImage(null)}
                        style={{ padding: "5px 12px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", color: "var(--color-text-danger)", fontSize: 12 }}
                      >
                        Verwijderen
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 13 }}>
                    Klik hier en plak een screenshot vanuit Sollit (Cmd/Ctrl+V), of{" "}
                    <label style={{ padding: "5px 12px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", cursor: "pointer", fontSize: 12, display: "inline-block" }}>
                      upload een bestand
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) handleReportImageFile(file);
                        }}
                      />
                    </label>
                    .
                  </div>
                )}
              </div>

              <h3 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 12px" }}>Omvormer / MPPT / string-overzicht</h3>
              <div style={{ ...card, marginBottom: 24, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                      <th style={{ padding: "6px 8px" }}>Omvormer</th>
                      <th style={{ padding: "6px 8px" }}>MPPT</th>
                      <th style={{ padding: "6px 8px" }}>String</th>
                      <th style={{ padding: "6px 8px" }}>Aantal PV</th>
                      <th style={{ padding: "6px 8px" }}>Wp</th>
                      <th style={{ padding: "6px 8px" }}>Voc STC (V)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.map((r) => (
                      <tr key={r.label} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                        <td style={{ padding: "6px 8px" }}>{r.inverterId} (#{r.unitNumber})</td>
                        <td style={{ padding: "6px 8px" }}>{r.mppt}</td>
                        <td style={{ padding: "6px 8px", fontWeight: 500 }}>{r.label}</td>
                        <td style={{ padding: "6px 8px" }}>{r.n}</td>
                        <td style={{ padding: "6px 8px" }}>{r.wp}</td>
                        <td style={{ padding: "6px 8px" }}>{r.vocStc.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button onClick={() => setDesignStep("resultaat")} style={{ padding: "8px 18px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer" }}>
                  Terug
                </button>
                <button
                  onClick={generateReportPdf}
                  disabled={reportRows.length === 0}
                  style={{ padding: "8px 18px", border: "none", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: reportRows.length === 0 ? "default" : "pointer", fontWeight: 500, opacity: reportRows.length === 0 ? 0.5 : 1 }}
                >
                  PDF genereren
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* OMVORMER ZOEKEN */}
      {mode === "find" && findPanel && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
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
            <div style={card}>
              <div style={label}>Aantal omvormers (optioneel)</div>
              <input
                type="number"
                min={1}
                step={1}
                value={fixedInvCount}
                onChange={(e) => setFixedInvCount(e.target.value)}
                placeholder="automatisch"
                style={{ width: 120 }}
              />
              <div style={{ fontSize: 12, ...muted, marginTop: 4 }}>
                Bijv. omdat het pand een vast aantal aansluitingen heeft — leeg laten optimaliseert naar het minimum aantal.
              </div>
            </div>
          </div>

          {matches.length === 0 ? (
            <div style={{ ...card, ...muted }}>
              Geen enkele beschikbare omvormer past {totalPanels}× {findPanel.id}{fixedInvCount ? ` op precies ${fixedInvCount} omvormer(s)` : ""} binnen de grenzen bij {tMinCold}°C. Probeer minder panelen, een ander aantal omvormers, een hogere ontwerptemperatuur, of zet meer omvormers beschikbaar in "Componenten beheren".
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
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
                  <div style={{ fontSize: 13, marginTop: 10 }}>
                    {m.stringsTotal} strings × {m.nPerString} panelen
                    {m.invCount > 1 && <span> · {m.stringsPerInv} strings/omvormer</span>}
                    {" · max "}{m.stringsPerMpptUsed}/MPPT · {(m.totalWp / 1000).toFixed(1)} kWp op {(m.totalAc / 1000).toFixed(1)} kW AC
                    {m.invCount > 1 && <span style={{ ...muted }}> ({m.invCount}× {(m.inverter.pacNom / 1000).toFixed(0)} kW)</span>}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>
                    <span style={muted}>Overdimensionering: </span>
                    <b style={{ color: m.highOverdim ? "var(--color-text-warning)" : "var(--color-text-primary)" }}>{(m.dcAcRatio * 100).toFixed(0)}%</b>
                    <span style={{ fontSize: 12, ...muted }}> · min. afzekering {m.inverter.minFuse} A/omvormer</span>
                  </div>
                  {m.highOverdim && (
                    <div style={{ fontSize: 11, color: "var(--color-text-warning)", marginTop: 6 }}>
                      Boven 150% — toegestaan binnen de omvormerspecs (DC onder pmax), maar reken op aftopverliezen op piekmomenten; zonder accu beperkt rendabel.
                    </div>
                  )}
                  {!m.inBand && !m.highOverdim && (
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 6 }}>
                      Onder de gebruikelijke 120–150%-band — bijv. omdat een vast aantal omvormers is opgegeven dat groter is dan het minimum.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 12, ...muted, marginTop: 16 }}>
            Verdeling = gelijke strings over alle MPPT's. Bij gemengde oriëntaties of optimizers kan een andere verdeling wenselijk zijn.
          </div>
        </>
      )}

      {/* LIBRARY MODE */}
      {mode === "library" && (
        <>
          <p style={{ fontSize: 13, ...muted, marginTop: 0 }}>
            Vink uit wat je leverancier niet voert. Uitgevinkte varianten verdwijnen uit de keuzelijsten en de zoekfunctie.
          </p>
          {[{ key: "panel", db: panelDb, title: "Panelen" }, { key: "inverter", db: inverterDb, title: "Omvormers" }].map(({ key, db, title }) => (
            <div key={key} style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 500, margin: "8px 0" }}>{title}</h3>
              {db.map((f) => {
                const allOn = f.variants.every((v) => v.available);
                return (
                  <div key={f.family} style={{ ...card, marginBottom: 12 }}>
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
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
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
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12, paddingTop: 10, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                      {datasheetsList.filter((d) => d.type === key && d.family_name === f.family).map((d) => (
                        <button
                          key={d.id}
                          onClick={() => viewDatasheet(d.id)}
                          style={{ fontSize: 11, padding: "4px 8px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", color: "var(--color-text-secondary)", display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          <i className="ti ti-file-text" style={{ fontSize: 13 }} aria-hidden="true" /> {d.filename}
                        </button>
                      ))}
                      <label style={{ fontSize: 11, padding: "4px 8px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-secondary)", cursor: "pointer", color: "var(--color-text-secondary)" }}>
                        {datasheetUploadBusy === f.family ? "Bezig met uploaden…" : "+ Datasheet toevoegen"}
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          style={{ display: "none" }}
                          disabled={datasheetUploadBusy === f.family}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) uploadFamilyDatasheet(key, f.family, file);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          <div style={card}>
            <h3 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 4px" }}>Nieuw component toevoegen</h3>
            <p style={{ fontSize: 12, ...muted, marginTop: 0, marginBottom: 16 }}>
              Gedeeld met alle collega's. Nieuwe componenten starten als "ongecontroleerd" — controleer de waarden tegen de datasheet voordat je ze productief gebruikt.
            </p>

            <div style={{ display: "flex", gap: 24, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
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
            {datasheetError && <div style={{ fontSize: 12, color: "var(--color-text-danger)", marginBottom: 16 }}>{datasheetError}</div>}

            {datasheetDraft && (
              <div style={{ ...card, background: "var(--color-background-secondary)", border: "none", marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>
                  Controleer de uit de datasheet gelezen gegevens vóór toevoegen — een verkeerd gelezen waarde zit anders voorgoed fout in de database.
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
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

                <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                  {datasheetDraft.rows.map((r, i) => (
                    <div key={i} style={{ ...card, padding: "10px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input type="checkbox" checked={r.include} onChange={() => toggleDatasheetRow(i)} />
                      {(addType === "panel" ? PANEL_VARIANT_FIELDS : INVERTER_VARIANT_FIELDS).map((f) =>
                        f.key === "stringsPerMppt" && addType === "inverter" ? (
                          <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ fontSize: 10, ...muted, display: "flex", alignItems: "center", gap: 4 }}>
                              {f.label}
                              <button
                                type="button"
                                onClick={() => toggleDatasheetRowAsymmetric(i)}
                                style={{ fontSize: 9, padding: "0 4px", border: "0.5px solid var(--color-border-secondary)", borderRadius: 4, background: r.asymmetricMppt ? "var(--color-background-info)" : "transparent", color: r.asymmetricMppt ? "var(--color-text-info)" : "var(--color-text-secondary)", cursor: "pointer" }}
                              >
                                ongelijk
                              </button>
                            </span>
                            {r.asymmetricMppt ? (
                              <div style={{ display: "flex", gap: 3 }}>
                                {Array.from({ length: Math.max(1, Math.min(20, Math.round(Number(r.nMppt)) || 1)) }, (_, mIdx) => (
                                  <input
                                    key={mIdx}
                                    type="number"
                                    title={`MPPT ${mIdx + 1}`}
                                    value={(Array.isArray(r.stringsPerMppt) ? r.stringsPerMppt[mIdx] : "") ?? ""}
                                    onChange={(e) => updateDatasheetRowMppt(i, mIdx, e.target.value)}
                                    style={{ width: 30 }}
                                  />
                                ))}
                              </div>
                            ) : (
                              <input
                                type="number"
                                value={r.stringsPerMppt ?? ""}
                                onChange={(e) => updateDatasheetRow(i, "stringsPerMppt", e.target.value)}
                                style={{ width: 70 }}
                              />
                            )}
                          </div>
                        ) : (
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
                        )
                      )}
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
            <div style={{ display: "flex", gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
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
              <div style={{ marginBottom: 16 }}>
                <div style={label}>Bestaande familie</div>
                <select value={addFamilyName} onChange={(e) => setAddFamilyName(e.target.value)} style={{ width: 320 }}>
                  <option value="">— kies —</option>
                  {(addType === "panel" ? panelDb : inverterDb).map((f) => (
                    <option key={f.family} value={f.family}>{f.family}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
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

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 10, marginBottom: 16, maxWidth: 700 }}>
              {(addType === "panel" ? PANEL_VARIANT_FIELDS : INVERTER_VARIANT_FIELDS).map((f) =>
                f.key === "stringsPerMppt" && addType === "inverter" ? (
                  <div key={f.key} style={{ gridColumn: addAsymmetricMppt ? "1 / -1" : undefined }}>
                    <div style={{ ...label, display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{f.label}</span>
                      <button
                        type="button"
                        onClick={toggleAddAsymmetric}
                        style={{ fontSize: 10, padding: "1px 6px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: addAsymmetricMppt ? "var(--color-background-info)" : "transparent", color: addAsymmetricMppt ? "var(--color-text-info)" : "var(--color-text-secondary)", cursor: "pointer" }}
                      >
                        Ongelijke MPPT's
                      </button>
                    </div>
                    {addAsymmetricMppt ? (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {Array.from({ length: Math.max(1, Math.min(20, Math.round(Number(addVariant.nMppt)) || 1)) }, (_, mIdx) => (
                          <input
                            key={mIdx}
                            type="number"
                            title={`MPPT ${mIdx + 1}`}
                            value={(Array.isArray(addVariant.stringsPerMppt) ? addVariant.stringsPerMppt[mIdx] : "") ?? ""}
                            onChange={(e) =>
                              setAddVariant((prev) => {
                                const n = Math.max(1, Math.min(20, Math.round(Number(prev.nMppt)) || 1));
                                const arr = Array.isArray(prev.stringsPerMppt) ? [...prev.stringsPerMppt] : Array.from({ length: n }, () => "");
                                arr.length = n;
                                arr[mIdx] = e.target.value;
                                return { ...prev, stringsPerMppt: arr };
                              })
                            }
                            style={{ width: 44 }}
                          />
                        ))}
                      </div>
                    ) : (
                      <input
                        type="number"
                        value={addVariant.stringsPerMppt ?? ""}
                        onChange={(e) => setAddVariant((prev) => ({ ...prev, stringsPerMppt: e.target.value }))}
                        style={{ width: "100%" }}
                      />
                    )}
                  </div>
                ) : (
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
                )
              )}
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
              <div style={{ fontSize: 12, marginTop: 12, color: addStatus.type === "error" ? "var(--color-text-danger)" : "var(--color-text-success)" }}>
                {addStatus.message}
              </div>
            )}
          </div>
        </>
      )}

      {/* AGENT MODE */}
      {mode === "agent" && (
        <>
          <div style={{ ...card, marginBottom: 20, background: "var(--color-background-secondary)", border: "none" }}>
            <div style={{ fontSize: 13 }}>
              Stel een vrije vraag over stringconfiguraties, omvormerkeuze of paneelverdeling — bijv. "welke omvormer past bij 76 panelen van 430Wp?" of
              "herverdeel mijn huidige strings, zet string 3 en 4 samen". De agent rekent nooit zelf: elk getal in het antwoord komt uit een aanroep naar de
              rekenkern, zichtbaar onder "Toon berekeningen" bij elk antwoord. Stelt de agent een nieuwe MPPT-indeling voor, dan kun je die met één klik
              toepassen op je actieve ontwerp.
            </div>
          </div>

          <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
            {chatMessages.length === 0 && (
              <div style={{ ...card, ...muted, fontSize: 13 }}>Nog geen vragen gesteld in dit gesprek.</div>
            )}
            {chatMessages.map((m, i) => {
              const applicable = m.role === "assistant" && designUnits.length === 1 ? findApplicableAssignment(m.toolCalls) : null;
              return (
                <div
                  key={i}
                  style={{
                    ...card,
                    padding: "12px 16px",
                    background: m.role === "user" ? "var(--color-background-secondary)" : "var(--color-background-primary)",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 500, ...muted, marginBottom: 4 }}>{m.role === "user" ? "Jij" : "Agent"}</div>
                  <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{m.content}</div>
                  {m.toolCalls?.length > 0 && (
                    <details style={{ marginTop: 10 }}>
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
                  {applicable && (
                    <button
                      onClick={() => applyAgentAssignment(applicable)}
                      style={{ marginTop: 10, padding: "6px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", color: "var(--color-text-info)", cursor: "pointer", fontWeight: 500, fontSize: 12 }}
                    >
                      Toepassen op ontwerp
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {chatError && <div style={{ fontSize: 12, color: "var(--color-text-danger)", marginBottom: 16 }}>{chatError}</div>}

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

      <div style={{ fontSize: 11, ...muted, marginTop: 32, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 12 }}>
        Ontwerphulp, geen vervanging voor toetsing door een gekwalificeerd persoon. Controleer geëxtraheerde datasheetwaarden vóór gebruik. Voc-koudecorrectie: Voc(T) = Voc_stc × (1 + β/100 × (T−25)).
      </div>
    </div>
  );
}
