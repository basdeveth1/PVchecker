import Anthropic from "@anthropic-ai/sdk";
import { checkAuth } from "./_auth.js";
import { checkConfig, allPass, findMatchingInverters, checkLegplanMulti, autoAssign, checkLegplan, distributeCounts } from "../src/core/calculations.js";

const client = new Anthropic(); // ANTHROPIC_API_KEY uit env

const STRINGS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      n: { type: "integer", description: "aantal panelen in deze string" },
      panelId: { type: "string" },
      azimuth: { type: "number", description: "graden, voor oriëntatie-groepering" },
    },
    required: ["n", "panelId", "azimuth"],
  },
};

const TOOLS = [
  {
    name: "check_config",
    description:
      "Controleert of een stringlengte (panelen in serie) en aantal strings per MPPT elektrisch past op een gekozen paneel+omvormer-combinatie.",
    input_schema: {
      type: "object",
      properties: {
        panelId: { type: "string" },
        inverterId: { type: "string" },
        nPerString: { type: "integer" },
        stringsPerMppt: { type: "integer" },
        tMinCold: { type: "number" },
        tMaxHot: { type: "number" },
      },
      required: ["panelId", "inverterId", "nPerString", "stringsPerMppt"],
    },
  },
  {
    name: "find_matching_inverters",
    description:
      "Zoekt, gegeven een paneeltype en totaal aantal panelen, welke omvormer(s) passen: aantal eenheden, strings, DC/AC-overdimensionering. Sorteert op voorkeur (GoodWe eerst, in de 120-150%-band, minste omvormers).",
    input_schema: {
      type: "object",
      properties: {
        panelId: { type: "string" },
        totalPanels: { type: "integer" },
        inverterIds: { type: "array", items: { type: "string" }, description: "optioneel: beperk tot deze omvormer-ids; leeg = alle beschikbare" },
        tMinCold: { type: "number" },
        tMaxHot: { type: "number" },
      },
      required: ["panelId", "totalPanels"],
    },
  },
  {
    name: "check_legplan_multi",
    description: "Geeft voor een lijst strings (mogelijk over meerdere omvormer-eenheden) het benodigde aantal eenheden en of het elektrisch klopt.",
    input_schema: {
      type: "object",
      properties: { strings: STRINGS_SCHEMA, inverterId: { type: "string" }, tMinCold: { type: "number" }, tMaxHot: { type: "number" } },
      required: ["strings", "inverterId"],
    },
  },
  {
    name: "auto_assign",
    description: "Wijst een lijst strings automatisch toe aan de MPPT's van één omvormer (houdt gelijke oriëntatie bij elkaar).",
    input_schema: {
      type: "object",
      properties: { strings: STRINGS_SCHEMA, inverterId: { type: "string" } },
      required: ["strings", "inverterId"],
    },
  },
  {
    name: "check_legplan",
    description: "Controleert een specifieke strings-naar-MPPT-toewijzing (bijv. uit auto_assign) op één omvormer, per MPPT.",
    input_schema: {
      type: "object",
      properties: {
        strings: STRINGS_SCHEMA,
        inverterId: { type: "string" },
        assignment: {
          type: "object",
          properties: { mppts: { type: "array", items: { type: "array", items: { type: "integer" } } } },
          required: ["mppts"],
        },
        tMinCold: { type: "number" },
        tMaxHot: { type: "number" },
      },
      required: ["strings", "inverterId", "assignment"],
    },
  },
  {
    name: "distribute_counts",
    description: "Verdeelt een totaal (bijv. panelen) zo gelijkmatig mogelijk over een aantal delen (bijv. strings of omvormers) als het totaal niet exact deelbaar is.",
    input_schema: {
      type: "object",
      properties: { total: { type: "integer" }, parts: { type: "integer" } },
      required: ["total", "parts"],
    },
  },
];

function resolvePanel(panelId, panels) {
  const p = panels.find((p) => p.id === panelId);
  if (!p) throw new Error(`Onbekend paneel-id: "${panelId}".`);
  return p;
}
function resolveInverter(inverterId, inverters) {
  const inv = inverters.find((i) => i.id === inverterId);
  if (!inv) throw new Error(`Onbekend omvormer-id: "${inverterId}".`);
  return inv;
}
function resolveStrings(strings, panels) {
  return strings.map((s) => ({ n: s.n, azimuth: s.azimuth, panel: resolvePanel(s.panelId, panels) }));
}

// Elke tool is een dunne wrapper om een bestaande, ongewijzigde rekenkern-
// export — de agent voert zelf geen berekening uit, hij roept alleen deze
// functies aan met de argumenten die hij kiest.
function executeTool(name, input, { panels, inverters, tMinCold, tMaxHot }) {
  const cold = input.tMinCold ?? tMinCold;
  const hot = input.tMaxHot ?? tMaxHot;
  switch (name) {
    case "check_config": {
      const panel = resolvePanel(input.panelId, panels);
      const inverter = resolveInverter(input.inverterId, inverters);
      const checks = checkConfig({ panel, inverter, nPerString: input.nPerString, stringsPerMppt: input.stringsPerMppt, tMinCold: cold, tMaxHot: hot });
      return { checks, pass: allPass(checks) };
    }
    case "find_matching_inverters": {
      const panel = resolvePanel(input.panelId, panels);
      const pool = input.inverterIds?.length ? inverters.filter((i) => input.inverterIds.includes(i.id)) : inverters;
      const matches = findMatchingInverters({ panel, totalPanels: input.totalPanels, tMinCold: cold, tMaxHot: hot, inverters: pool });
      return matches.map((m) => ({
        inverterId: m.inverter.id,
        invCount: m.invCount,
        nPerString: m.nPerString,
        stringsTotal: m.stringsTotal,
        stringsPerInv: m.stringsPerInv,
        stringsPerMpptUsed: m.stringsPerMpptUsed,
        totalWp: m.totalWp,
        totalAc: m.totalAc,
        dcAcRatio: m.dcAcRatio,
        inBand: m.inBand,
        highOverdim: m.highOverdim,
      }));
    }
    case "check_legplan_multi": {
      const strings = resolveStrings(input.strings, panels);
      const inverter = resolveInverter(input.inverterId, inverters);
      return checkLegplanMulti(strings, inverter, cold, hot);
    }
    case "auto_assign": {
      const strings = resolveStrings(input.strings, panels);
      const inverter = resolveInverter(input.inverterId, inverters);
      return autoAssign(strings, inverter);
    }
    case "check_legplan": {
      const strings = resolveStrings(input.strings, panels);
      const inverter = resolveInverter(input.inverterId, inverters);
      return checkLegplan(strings, inverter, input.assignment, cold, hot);
    }
    case "distribute_counts":
      return distributeCounts(input.total, input.parts);
    default:
      throw new Error(`Onbekende tool: ${name}`);
  }
}

function buildSystemPrompt(panels, inverters, tMinCold, tMaxHot) {
  const panelLines = panels
    .map((p) => `${p.id}: ${p.wp}Wp, Voc ${p.voc}V, Vmp ${p.vmp}V, Isc ${p.isc}A, Imp ${p.imp}A, β ${p.betaVoc}%/°C (${p.family})`)
    .join("\n");
  const invLines = inverters
    .map(
      (i) =>
        `${i.id}: ${i.nMppt} MPPT × ${i.stringsPerMppt} strings, Vmax ${i.vmax}V, MPPT-bereik ${i.vmpptMin}-${i.vmpptMax}V, ${i.imppt}A/${i.isc}A, Pmax ${i.pmax}W, Pac ${i.pacNom}W${i.isGoodwe ? " (GoodWe)" : ""} (${i.family})`
    )
    .join("\n");

  return `Je bent een PV-ontwerpassistent binnen een tool voor zonnepaneel-installateurs. Je helpt met vragen over stringconfiguraties, omvormerkeuze en paneelverdeling.

BELANGRIJKE REGEL: je rekent nooit zelf. Voor elk getal in je antwoord roep je een van de beschikbare tools aan — dat zijn exacte, deterministische functies uit de rekenkern van de tool. Bestaat er geen tool die past bij de vraag, zeg dat expliciet in plaats van zelf te schatten of te gokken.

Standaard ontwerptemperaturen (tenzij de vraag iets anders aangeeft): ${tMinCold}°C (koud) / ${tMaxHot}°C (heet).

Beschikbare panelen:
${panelLines}

Beschikbare omvormers:
${invLines}

Geef aan het eind een helder, beknopt antwoord in het Nederlands. Vermeld expliciet welke aannames je deed (bijv. welk paneel of welke omvormer je koos als de vraag dat niet specificeerde).`;
}

const MAX_ROUNDS = 8;

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { messages, panels, inverters, tMinCold, tMaxHot } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0 || !Array.isArray(panels) || !Array.isArray(inverters)) {
    res.status(400).json({ error: "messages, panels en inverters zijn verplicht." });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY ontbreekt op de server." });
    return;
  }

  const system = buildSystemPrompt(panels, inverters, tMinCold, tMaxHot);
  const conversation = messages.map((m) => ({ role: m.role, content: m.content }));
  const toolCalls = [];

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const msg = await client.messages.create({
        model: process.env.ANTHROPIC_REASSIGN_MODEL || "claude-sonnet-5",
        max_tokens: 2048,
        system,
        tools: TOOLS,
        messages: conversation,
      });

      if (msg.stop_reason !== "tool_use") {
        const reply = msg.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        res.status(200).json({ reply, toolCalls });
        return;
      }

      conversation.push({ role: "assistant", content: msg.content });
      const toolResults = [];
      for (const block of msg.content) {
        if (block.type !== "tool_use") continue;
        let output;
        let isError = false;
        try {
          output = executeTool(block.name, block.input, { panels, inverters, tMinCold, tMaxHot });
        } catch (e) {
          output = { error: e.message };
          isError = true;
        }
        toolCalls.push({ name: block.name, input: block.input, output });
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output), is_error: isError });
      }
      conversation.push({ role: "user", content: toolResults });
    }

    res.status(200).json({
      reply: "De agent kon binnen het maximale aantal stappen geen definitief antwoord vormen. Probeer de vraag concreter of kleiner te maken.",
      toolCalls,
    });
  } catch (e) {
    res.status(502).json({ error: `Model aanroepen mislukt: ${e.message}`, toolCalls });
  }
}
