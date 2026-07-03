# Bouwplan — concrete eerste stappen in Claude Code

Dit zijn de eerste opdrachten die je aan Claude Code kunt geven, in volgorde. Elke stap is afgerond te testen voordat je verder gaat.

## Stap 0 — Project opstarten

```
npm install
npm test        # 12 tests moeten slagen — dit bewijst dat de rekenkern klopt
```

Als de tests slagen, staat het fundament. Begin pas daarna met de UI.

## Stap 1 — UI overzetten uit het prototype

Er staat een werkend UI-prototype in `src/components/PVConfigurator.prototype.jsx` (de artifact-versie). Het heeft de database nog inline. Opdracht voor Claude Code:

> "Maak `src/components/PVConfigurator.jsx` op basis van het prototype, maar laad panelen en omvormers via `src/data/loader.js` in plaats van de inline database, en importeer alle berekeningen uit `src/core/calculations.js`. Verwijder de gedupliceerde reken- en datacode uit de component."

Daarna een minimale Vite-entry (`index.html` + `src/main.jsx`) zodat `npm run dev` de configurator toont.

## Stap 2 — Database-beheer met opslag

De "Componenten beheren"-tab wijzigt nu alleen state in het geheugen. Opdracht:

> "Laat wijzigingen in de componenten-beschikbaarheid en handmatige datasheet-correcties opslaan, zodat ze bewaard blijven tussen sessies. Begin met localStorage; ontwerp de opslaglaag zo dat 'm later naar een echte database verplaatst kan worden."

Voeg ook de `verified`-vlag toe aan de UI: toon welke families nog niet handmatig gecontroleerd zijn.

## Stap 3 — Sollit-screenshot import

Zie `docs/sollit-import.md`. Opdracht:

> "Bouw de Sollit-import volgens docs/sollit-import.md: een backend-endpoint dat een screenshot naar Claude stuurt en strings terugkrijgt, plus een upload-knop in de legplan-tab. Toon de geëxtraheerde strings altijd ter controle voordat ze worden gebruikt."

## Stap 4 — Datasheet-controle workflow

Het grootste risico is verkeerd geëxtraheerde datasheetwaarden. Opdracht:

> "Bouw een controle-workflow: voor elke nog niet-geverifieerde component toon je de geëxtraheerde waarden naast de bron, zodat een mens ze kan bevestigen of corrigeren. Pas na bevestiging gaat verified op true."

## Stap 5 — Website voor collega's

Pas als het bovenstaande staat. Aandachtspunten: authenticatie, wie de API-kosten draagt, en een prominente disclaimer dat de tool ontwerphulp is en geen goedkeuring vervangt.

## Verfijningen voor later

- **Echte omvormer-mix** in voorstellen (bijv. 5× groot + 1× klein om exact uit te komen), nu alleen identieke omvormers.
- **Per-unit string-toewijzing** bij grote systemen: nu wordt het aantal units berekend, maar niet welke string op welke MPPT van welke unit komt.
- **Rapportage**: een nette PDF-export per project met de volledige onderbouwing.
