# PV Configurator

Een ontwerphulp voor het samenstellen en controleren van PV-installaties: gegeven panelen en omvormers, controleren of een stringconfiguratie binnen alle elektrische grenzen valt, en de juiste omvormer(s) voorstellen.

> **Belangrijk:** dit is een ontwerphulp, geen vervanging voor toetsing door een gekwalificeerd installateur. Controleer geëxtraheerde datasheetwaarden voordat je ze productief gebruikt.

## Wat het doet

- **Configuratie checken** — kies paneel + omvormer + stringlengte, krijg een pass/fail per elektrische grens (Voc koud/STC, Vmp koud/heet, stroom per MPPT, kortsluitstroom, strings per MPPT).
- **Omvormer zoeken** — geef paneel + aantal panelen, krijg de best passende omvormer(s), inclusief multi-omvormer advies voor grote systemen. Optimalisatiedoel: zo min mogelijk omvormers met een DC/AC-overdimensionering in de band 120–150%.
- **Legplan-check** — voer de strings uit een legplan (bijv. uit Sollit) in, krijg een oriëntatie-bewuste MPPT-toewijzing en omvormeradvies.
- **Componenten beheren** — zet per leverancier aan/uit welke varianten beschikbaar zijn.
- **Hoofdaansluiting** — bepaalt minimale afzekering per omvormer en waarschuwt voor verdeelkast-belasting en aftopverliezen.

## Architectuur

Het kernprincipe: **deterministische rekenkern, gescheiden van UI en AI**. De natuurkundige berekeningen (spanning bij temperatuur, stroom per MPPT) zijn pure functies zonder enige AI — dezelfde invoer geeft altijd dezelfde uitkomst. Dat is essentieel: een tool waar installaties op gebaseerd worden mag niet "soms" een ander antwoord geven.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Datasheets     │────▶│  Component-DB    │────▶│  UI (React)     │
│  (PDF, eenmalig)│     │  (JSON, src/data)│     │  src/components │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
        │                                                  │
        │ AI-extractie                                     │ roept aan
        │ (Claude, met                          ┌──────────▼────────┐
        │  handmatige                           │   REKENKERN       │
        │  controle)                            │   src/core        │
        ▼                                       │  (pure functies,  │
   src/data/*.json                              │   getest)         │
                                                └───────────────────┘
```

- `src/core/` — de rekenkern. Pure functies, volledig getest. **Wijzig hier niets zonder de tests te draaien.**
- `src/data/` — de component-database (panelen + omvormers) als JSON.
- `src/components/` — de React-UI.
- `tests/` — testgevallen, inclusief de bekende referentiecases (76× JA Solar 430 op T20, 1400-paneel systeem).

## Aan de slag

```bash
npm install
npm test          # draai de rekenkern-tests — moeten allemaal slagen
npm run dev       # start de ontwikkelserver
```

## Stappenplan (volgorde van bouwen)

1. **Rekenkern + tests** (`src/core`, `tests`) — het fundament. Klaar als alle referentiecases slagen.
2. **Component-database vullen** (`src/data`) — datasheets extraheren, elke waarde één keer handmatig controleren tegen de PDF.
3. **UI** (`src/components`) — de vier modi. Begin met "configuratie checken", dat is het simpelst.
4. **Sollit-screenshot import** — een vision-model leest het stringplan en vult de strings in. Vereist een backend-endpoint (zie `docs/sollit-import.md`).
5. **Persistente opslag** — database en gebruikersselecties bewaren (bestand, later database).
6. **Website voor collega's** — deploy, authenticatie, en de aansprakelijkheidsdisclaimer prominent.

## Bekende beperkingen / aandachtspunten

- **Datasheet-extractie is het grootste risico**, niet de rekenkern. Een verkeerd ingelezen Voc zit voor altijd fout in de database. Bouw een verplichte controlestap in stap 2.
- **iacMax-waarden** zijn deels berekend (pacNom / 400V / √3) waar de datasheet de AC-stroom niet expliciet gaf. Controleer tegen datasheet.
- **Multi-omvormer verdeling** gaat nu uit van identieke omvormers met gelijke strings. Een echte mix (5× groot + 1× klein) is een toekomstige verfijning.
- **Aansprakelijkheid**: zodra collega's dit voor echte installaties gebruiken, moet de disclaimer duidelijk zijn dat het ontwerphulp is, geen goedkeuring.

## De fysica in het kort

Voc-koudecorrectie (de kritieke check die spanningsoverschrijding voorkomt):

```
Voc(T) = Voc_stc × (1 + β_Voc/100 × (T − 25))
```

β_Voc is negatief, dus bij lage temperatuur stijgt Voc. In Nederland is −10 °C de gangbare ontwerpondergrens. De som van Voc over een string mag de max. ingangsspanning van de omvormer niet overschrijden — dit is meestal de maatgevende grens voor de maximale stringlengte.
