# ESMA MiCAR Register Tracker

Doorzoekbare spiegel van de 5 officiële ESMA MiCAR-registers (whitepapers, ART-uitgevers,
EMT-uitgevers, CASPs, non-compliant entiteiten) plus het AFM-cryptoregister (CASPs
vergund/genotificeerd in Nederland), automatisch bijgewerkt via GitHub Actions.

Zie `ESMA_MiCAR_Register_Tracker_Ontwerp.md` voor het volledige ontwerp (datamodel, site-architectuur, UI).
Deze repo bevat zowel de **scraper** als de **site** (statisch, voor GitHub Pages).

## Wat de scraper doet

`scraper/fetch_esma.py`:

1. Downloadt de 5 officiële CSV's rechtstreeks van esma.europa.eu, én het AFM-cryptoregister
   (een los `.xlsx`-bestand van afm.nl — zie "AFM-register" hieronder) rechtstreeks van
   afm.nl.
2. Normaliseert elk bestand naar JSON (`data/*.json`), waarbij herhaalde rijen per
   entiteit (CASPs-diensten, whitepapers per uitgever) worden gegroepeerd tot één record
   met een array-veld.
3. Vergelijkt de nieuwe stand met de vorige commit van `/data` en bepaalt wat is
   toegevoegd, gewijzigd of verdwenen — inclusief een veldniveau-omschrijving voor CASPs/AFM
   (bv. "Bewaring toegevoegd aan dienstverlening", "nu ook aangeboden in: BE, DE") die ook in
   de Slack-melding terechtkomt (zie "Slack-meldingen" hieronder).
4. Schrijft `data/meta.json` (laatst gecontroleerd, aantallen per register) en
   `data/history/changelog.json` (append-only wijzigingslog).

### AFM-register

Naast de 5 ESMA-registers scraped dit project ook het
[AFM-cryptoregister](https://www.afm.nl/en/sector/registers/vergunningenregisters/cryptopartijen)
(`data/afm_casps.json`, zichtbaar op de site onder "AFM"). Dit is het register van CASPs die
een MiCAR-vergunning of -notificatie hebben bij de AFM zelf (of die vanuit een andere lidstaat
naar Nederland passporten) — voor een in Nederland gevestigde en vergunde CASP is dit vaak
relevanter en eerder bijgewerkt dan ESMA's EU-brede, ietwat trager gepubliceerde
verzamelregister.

De AFM publiceert dit register als een los `.xlsx`-bestand (geen CSV-API zoals ESMA), dus
`fetch_afm_rows()`/`normalize_afm()` in `fetch_esma.py` gebruiken `openpyxl` om het in te
lezen. AFM herformatteert dit bestand af en toe (kolomvolgorde, titelregels) — de parser zoekt
daarom dynamisch naar de rij die begint met "Entity name" in plaats van een vaste rij-offset
aan te nemen.

## Automatisering

`.github/workflows/scrape.yml` draait de scraper via een cron-schedule (~07:00 en ~19:00
Europe/Amsterdam — GitHub Actions cron is UTC, dus er zit tot 1 uur drift in door
zomer-/wintertijd) en via handmatige trigger (`workflow_dispatch`, te vinden onder de
"Actions"-tab van de repo). Bij een wijziging committeert en pusht de workflow
`/data` automatisch — zonder wijziging gebeurt er niets (behalve dat `meta.json`'s
`last_checked` bijwerkt, ook gecommit).

**Let op:** ESMA ververst het interim-register zelf maar wekelijks (het AFM-register wisselt
vaker). Twee checks per dag is dus vaker dan de ESMA-bron zelf verandert — dat is bewust, om
een update zo snel mogelijk op te pikken zodra hij verschijnt.

## Slack-meldingen

De workflow post een Slack-bericht zodra een run een échte wijziging vindt (nieuw/gewijzigd/
verwijderd record in één van de 6 registers) — niet bij elke run, want elke run herschrijft
`generated_at`/`last_checked` sowieso (zie `steps.scrape.outputs.real_changes` in
`scrape.yml`). Het bericht noemt per wijziging de partij, het register, en — waar mogelijk —
wát er precies veranderde (bv. welke dienst is toegevoegd, welke landen erbij).

Eenmalige setup:

1. Maak in Slack (via **Workflow Builder** → "New Workflow" → trigger "From a webhook") een
   workflow met één tekstvariabele, genaamd `message`, die die variabele in een "Send a
   message"-stap post naar het gewenste kanaal.
2. Kopieer de webhook-URL die Workflow Builder je geeft (`https://hooks.slack.com/triggers/...`).
3. Zet die URL als GitHub-repository-secret: **Settings → Secrets and variables → Actions →
   New repository secret**, naam `SLACK_WEBHOOK_URL`.

Zonder dit secret slaat de workflow de Slack-stap stilzwijgend over (`continue-on-error`) —
de rest van de scrape/site-update blijft gewoon werken.

## De site

Volledig statisch (geen build-stap, geen backend) — vanilla HTML/CSS/JS die `data/*.json`
rechtstreeks met `fetch()` uitleest:

- `index.html` — dashboard met aantallen per register en de meest recente wijzigingen.
- `register.html?type=afm_casps|casps|art|emt|whitepapers|non_compliant` — doorzoekbare/
  filterbare/sorteerbare tabel per register, met een detailpaneel per record en CSV-export
  van de huidige selectie.
- `changelog.html` — volledige wijzigingsgeschiedenis, filterbaar op register en type
  (nieuw/gewijzigd/verwijderd).
- `assets/js/app.js` — alle rendering/filter/sort/zoek-logica; `assets/css/style.css` —
  styling.

Werkt direct via GitHub Pages zodra Pages op de repo-root (branch `main`) is ingesteld
(**Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**).

## Lokaal draaien

```bash
cd scraper
pip install -r requirements.txt
python fetch_esma.py
```

Dit vult (of werkt bij) de `data/`-map in de repo-root.

## Setup checklist

1. Maak de GitHub-repo aan (publiek of privé — GitHub Pages werkt met beide op een
   account/organisatie met Pages-toegang) en push deze inhoud.
2. Onder **Settings → Actions → General → Workflow permissions**: zet op
   "Read and write permissions" (nodig zodat de workflow naar `data/` kan pushen).
3. Draai de workflow eenmalig handmatig (Actions-tab → "ESMA MiCAR register scrape" →
   "Run workflow") om de eerste snapshot te vullen.
4. Onder **Settings → Pages**: source op "Deploy from a branch", branch `main`, map `/ (root)`.
   De site (`index.html` e.v.) verschijnt dan op de Pages-URL van de repo.

## Verificatie

De parsing/groepering/diff-logica is getest tegen echte fragmenten van alle 5 ESMA-CSV's
(zie `test_fixtures/`, incl. `run_tests.py`) — o.a. correcte groepering van meerdere
diensten per CASP, meerdere whitepapers per EMT-/ART-uitgever, deduplicatie van een
letterlijk dubbele rij in het non-compliant register, en correcte detectie van
toegevoegde/gewijzigde/verwijderde records tussen twee runs. `normalize_afm()` is apart
getest tegen echte rijen uit het live AFM-register (vergunning, notificatie, cross-border/
incoming passport, ingetrokken vergunning, gemengde hoofdletters in landcodes) om te
verifiëren dat de datums, diensten-codes en EU-paspoortlanden correct worden geparsed. Alle
checks slagen.

De front-end (`assets/js/app.js`) is los daarvan getest met een jsdom-harnas tegen dezelfde
echte ESMA-fragmenten plus AFM-fixturedata: per register is gecontroleerd dat de tabel
rendert, zoeken de resultaten terecht versmalt, kolomsortering (op/neer) niet crasht, en het
detailpaneel correct opent — voor alle 6 registers, inclusief het lege ART-register. Voor het
AFM-register is bovendien gecontroleerd dat AFM's "(x) omschrijving"-format voor diensten
correct wordt herkend door dezelfde dienst-iconen als bij CASPs, en dat het vergunningstype
(vergunning/notificatie/cross-border) correct wordt vertaald en filterbaar is. Alle checks
slagen.

`test_fixtures/` is alleen voor lokale verificatie en hoeft niet mee de deploy in —
`data/` staat momenteel op lege placeholders totdat de workflow voor het eerst draait.

## Data-attributie

Bronnen: [ESMA Interim MiCA Register](https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica)
en het [AFM-cryptoregister](https://www.afm.nl/en/sector/registers/vergunningenregisters/cryptopartijen).
De whitepapers in dit register zijn niet beoordeeld of goedgekeurd door een toezichthouder;
afwezigheid uit het non-compliant register is geen bewijs van vergunning.
