import React, { useState, useMemo } from "react";
import { getPanelFamilies, getInverterFamilies, flattenPanels, flattenInverters } from "../data/loader.js";
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

// Herbouwt de per-MPPT/string-grid van "Configuratie checken" bij het wisselen
// van omvormer: behoudt bestaande waarden waar de slot nog bestaat, vult
// nieuwe slots met een startwaarde, laat overtollige slots vervallen.
function resizeCheckStrings(prev, inv) {
  return Array.from({ length: inv.nMppt }, (_, mIdx) =>
    Array.from({ length: inv.stringsPerMppt }, (_, sIdx) => (prev[mIdx] && prev[mIdx][sIdx]) || { n: 25, azimuth: 180, helling: 35 })
  );
}

export default function PVConfigurator() {
  const [panelDb, setPanelDb] = useState(() => getPanelFamilies());
  const [inverterDb, setInverterDb] = useState(() => getInverterFamilies());
  const [mode, setMode] = useState("check"); // "check" | "find" | "legplan" | "library"

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

          <div style={{ ...card, marginBottom: 16, background: "var(--color-background-secondary)", border: "none" }}>
            <div style={{ fontSize: 13 }}>
              <i className="ti ti-photo" style={{ fontSize: 16, verticalAlign: -2, marginRight: 6 }} aria-hidden="true" />
              Heb je een Sollit-stringplan als screenshot? Upload 'm in de chat, dan vul ik de strings hieronder voor je in. Of voer ze handmatig in.
            </div>
          </div>

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
                        <div style={{ fontWeight: 500 }}>{f.family}</div>
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
