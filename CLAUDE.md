# Instructies voor Claude Code

Dit project is een PV-configurator: een ontwerphulp die controleert of een stringconfiguratie van zonnepanelen binnen de elektrische grenzen van een omvormer past, en omvormers voorstelt.

## Belangrijkste regel: de rekenkern is heilig

`src/core/calculations.js` bevat pure, deterministische functies. Dit is het fundament waar installatieadviezen op rusten.

- **Wijzig nooit een berekening zonder de tests te draaien** (`npm test`). Alle tests moeten slagen.
- **Voeg geen AI, willekeur of side-effects toe aan de rekenkern.** Dezelfde invoer moet altijd dezelfde uitkomst geven.
- Als je een berekening aanpast, voeg een testcase toe die het nieuwe gedrag vastlegt.

De referentiecases in `tests/calculations.test.js` komen uit echte ontwerpdiscussies (o.a. 76× JA Solar 430 op een AlphaESS T20, en een 1400-paneel systeem). Ze mogen niet breken.

## De fysica die je moet kennen

De maatgevende check is bijna altijd de **Voc-koudecorrectie**: bij lage temperatuur stijgt de open-klemspanning, en de som over een string mag de max. ingangsspanning van de omvormer niet overschrijden.

```
Voc(T) = Voc_stc × (1 + β_Voc/100 × (T − 25))
```

β_Voc is negatief. In Nederland is −10 °C de gangbare ontwerpondergrens. Een veelgemaakte fout (die deze tool juist voorkomt) is rekenen met alleen STC-waarden — dan lijkt een string te passen die bij vorst over de grens gaat.

## Optimalisatiedoel bij omvormer zoeken

Bij het voorstellen van omvormers: **zo min mogelijk omvormers**, met een DC/AC-overdimensionering liefst in de band **120–150%**. Pak in de basis één omvormer als dat in die band kan; alleen meer omvormers als het niet anders kan. GoodWe is de voorkeursfabrikant en staat bovenaan bij gelijke geschiktheid.

## Datasheet-extractie: het grootste risico

De component-database (`src/data/*.json`) is uit datasheets geëxtraheerd. Elke familie heeft `"verified": false` tot een mens de waarden tegen de originele datasheet heeft gecontroleerd. **Een verkeerd ingelezen Voc zit voor altijd fout in de database** en levert verkeerde adviezen. Bij het toevoegen van componenten: bouw altijd een controlestap in, zet `verified` pas op `true` na handmatige controle.

Sommige `iacMax`-waarden (max. AC-stroom) zijn berekend uit `pacNom / 400V / √3` waar de datasheet de waarde niet expliciet gaf. Die hebben extra controle nodig.

## Projectstructuur

- `src/core/` — rekenkern (pure functies, getest). Raak niet aan zonder tests.
- `src/data/` — component-database (JSON) + loader.
- `src/components/` — React-UI (nog te bouwen vanuit het artifact-prototype).
- `tests/` — testgevallen.
- `docs/` — feature-docs, o.a. de Sollit-screenshot import.

## Volgende stappen (zie README voor het volledige stappenplan)

1. UI-componenten bouwen vanuit het artifact-prototype (`pv-configurator.jsx` in de oorspronkelijke output).
2. Sollit-screenshot import (`docs/sollit-import.md`) — vereist een backend-endpoint.
3. Persistente opslag van database-correcties en gebruikersselecties.
4. Website voor collega's, met prominente disclaimer.

## Toon en taal

De UI is Nederlandstalig, informeel ("je/jij"). De gebruiker (Bas) is een hands-on installateur die de fysica begrijpt; wees technisch precies maar niet betuttelend. De tool is een ontwerphulp, geen vervanging voor toetsing door een gekwalificeerd persoon — die boodschap moet zichtbaar blijven.
