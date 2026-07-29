# ESMA MiCAR Register Tracker

Doorzoekbare spiegel van de 5 officiële ESMA MiCAR-registers (whitepapers, ART-uitgevers,
EMT-uitgevers, CASPs, non-compliant entiteiten), automatisch bijgewerkt via GitHub Actions.

Zie `ESMA_MiCAR_Register_Tracker_Ontwerp.md` voor het volledige ontwerp (datamodel, site-architectuur, UI).
Dit onderdeel van de repo bevat de **scraper** — de site zelf volgt in een volgende stap.

## Wat de scraper doet

`scraper/fetch_esma.py`:

1. Downloadt de 5 officiële CSV's rechtstreeks van esma.europa.eu.
2. Normaliseert elk bestand naar JSON (`data/*.json`), waarbij herhaalde rijen per
   entiteit (CASPs-diensten, whitepapers per uitgever) worden gegroepeerd tot één record
   met een array-veld.
3. Vergelijkt de nieuwe stand met de vorige commit van `/data` en bepaalt wat is
   toegevoegd, gewijzigd of verdwenen.
4. Schrijft `data/meta.json` (laatst gecontroleerd, aantallen per register) en
   `data/history/changelog.json` (append-only wijzigingslog).

## Automatisering

`.github/workflows/scrape.yml` draait de scraper via een cron-schedule (~07:00 en ~19:00
Europe/Amsterdam — GitHub Actions cron is UTC, dus er zit tot 1 uur drift in door
zomer-/wintertijd) en via handmatige trigger (`workflow_dispatch`, te vinden onder de
"Actions"-tab van de repo). Bij een wijziging committeert en pusht de workflow
`/data` automatisch — zonder wijziging gebeurt er niets (behalve dat `meta.json`'s
`last_checked` bijwerkt, ook gecommit).

**Let op:** ESMA ververst het interim-register zelf maar wekelijks. Twee checks per dag
is dus vaker dan de bron zelf verandert — dat is bewust, om een update zo snel mogelijk
op te pikken zodra hij verschijnt.

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
4. (Volgende stap) Site + GitHub Pages inrichten die `data/*.json` uitleest.

## Verificatie

De parsing/groepering/diff-logica is getest tegen echte fragmenten van alle 5 ESMA-CSV's
(zie `test_fixtures/`, incl. `run_tests.py`) — o.a. correcte groepering van meerdere
diensten per CASP, meerdere whitepapers per EMT-/ART-uitgever, deduplicatie van een
letterlijk dubbele rij in het non-compliant register, en correcte detectie van
toegevoegde/gewijzigde/verwijderde records tussen twee runs. Alle checks slagen.
`test_fixtures/` is alleen voor lokale verificatie en hoeft niet mee de deploy in —
`data/` staat momenteel op lege placeholders totdat de workflow voor het eerst draait.

## Data-attributie

Bron: [ESMA Interim MiCA Register](https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica).
De whitepapers in dit register zijn niet beoordeeld of goedgekeurd door een toezichthouder;
afwezigheid uit het non-compliant register is geen bewijs van vergunning.
