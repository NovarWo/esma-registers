#!/usr/bin/env python3
"""
Local test harness for scraper/fetch_esma.py — validates the parsing/grouping/diff
logic against real ESMA CSV excerpts, without making any network calls.

Not part of the shipped repo; lives in test_fixtures/ for one-off local verification.
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scraper"))
FIXTURES = Path(__file__).resolve().parent

import fetch_esma as fe  # noqa: E402

# IMPORTANT: redirect the module's data dirs to a throwaway tmp location so this
# test run never touches the real repo's data/ folder (which should stay pristine
# until the first real GitHub Actions run).
_TMP = Path(tempfile.mkdtemp(prefix="esma-tracker-test-"))
fe.DATA_DIR = _TMP / "data"
fe.HISTORY_DIR = fe.DATA_DIR / "history"

FILES = {
    "OTHER": FIXTURES / "OTHER_sample.csv",
    "ARTZZ": FIXTURES / "ARTZZ_sample.csv",
    "EMTWP": FIXTURES / "EMTWP_sample.csv",
    "CASPS": FIXTURES / "CASPS_sample.csv",
    "NCASP": FIXTURES / "NCASP_sample.csv",
}


def fake_fetcher(register_code: str):
    text = FILES[register_code].read_text(encoding="utf-8")
    return fe.parse_csv_text(text)


def reset_data_dir():
    if fe.DATA_DIR.exists():
        shutil.rmtree(fe.DATA_DIR)


def load(register):
    with (fe.DATA_DIR / f"{register}.json").open(encoding="utf-8") as f:
        return json.load(f)["records"]


def find(records, name):
    matches = [r for r in records if r.get("name") == name]
    assert len(matches) == 1, f"expected exactly one record named {name!r}, found {len(matches)}"
    return matches[0]


def check(label, condition):
    status = "OK  " if condition else "FAIL"
    print(f"[{status}] {label}")
    if not condition:
        global failures
        failures += 1


failures = 0

print("=== Run 1: first scrape (empty data dir) ===")
reset_data_dir()
rc = fe.run(fetcher=fake_fetcher)
check("exit code 0", rc == 0)

casps = load("casps")
emt = load("emt")
whitepapers = load("whitepapers")
ncasp = load("non_compliant")
art = load("art")

bitpanda = find(casps, "Bitpanda GmbH")
check("Bitpanda GmbH: pipe-joined single-row services split into 3 items", len(bitpanda["services"]) == 3)
check("Bitpanda GmbH: each split service is a clean single label (no stray '|')", all("|" not in s["service"] for s in bitpanda["services"]))
check("Bitpanda GmbH status active (no end date)", bitpanda["status"] == "active")

trade_republic = find(casps, "Trade Republic Bank GmbH")
check("Trade Republic Bank grouped to 4 services", len(trade_republic["services"]) == 4)

stratos = find(casps, "Stratos Europe Ltd")
check("Stratos Europe Ltd status withdrawn (has end date)", stratos["status"] == "withdrawn")

check("CASPs: 6 unique entities from 11 sample rows", len(casps) == 6)

allunity = find(emt, "AllUnity GmbH")
check("AllUnity GmbH grouped to 3 whitepapers", len(allunity["whitepapers"]) == 3)

circle = find(emt, "Circle Internet Financial Europe SAS")
check("Circle grouped to 2 whitepapers", len(circle["whitepapers"]) == 2)

quantoz = find(emt, "Quantoz Payments B.V")
check("Quantoz grouped to 3 whitepapers", len(quantoz["whitepapers"]) == 3)

check("ART register empty (0 issuers, matches real state)", len(art) == 0)

crm = find(whitepapers, "Crypto Risk Metrics GmbH")
check("Crypto Risk Metrics GmbH grouped to 5 whitepapers", len(crm["whitepapers"]) == 5)

biogena = find(whitepapers, "Biogena GmbH & Co KG")
check("Biogena whitepaper carries linked CASP name", biogena["whitepapers"][0]["casp_name"] == "Tangany GmbH")

check("NCASP: exact duplicate row (DFG789) deduped", len(ncasp) == 5)
dobibo_entries = [r for r in ncasp if r["name"] == "Dobibo"]
check("NCASP: two distinct Dobibo incidents kept (different decision dates)", len(dobibo_entries) == 2)

meta = json.loads((fe.DATA_DIR / "meta.json").read_text(encoding="utf-8"))
check("meta.json has record_counts for all 5 registers", set(meta["record_counts"]) == set(fe.SOURCES))

changelog = json.loads((fe.DATA_DIR / "history" / "changelog.json").read_text(encoding="utf-8"))
total_records = len(casps) + len(emt) + len(art) + len(whitepapers) + len(ncasp)
added = [c for c in changelog if c["type"] == "added"]
check(f"changelog: {total_records} 'added' entries on first run", len(added) == total_records)

print("\n=== Run 2: identical data again (should report zero changes) ===")
rc = fe.run(fetcher=fake_fetcher)
check("exit code 0", rc == 0)
changelog2 = json.loads((fe.DATA_DIR / "history" / "changelog.json").read_text(encoding="utf-8"))
check("changelog unchanged after identical re-run", len(changelog2) == len(changelog))

print("\n=== Run 3: mutate one CASP (new service added) + remove one CASP row ===")
casps_text = FILES["CASPS"].read_text(encoding="utf-8")
# Give Bitpanda a 4th service line (a change), drop the Cryptonow GmbH row entirely (a removal)
mutated = casps_text + (
    'Austrian Financial Market Authority (FMA),AT,Bitpanda GmbH,5493007WZ7IFULIL8G21,AT,Bitpanda,'
    '"Stella-Klein-Löw-Weg 17, 1020 Vienna, Austria",https://www.bitpanda.com,,09/04/2025,,'
    'j. providing transfer services for crypto-assets on behalf of clients,AT|BE|BG,,18/06/2026,\n'
)
mutated = "\n".join(line for line in mutated.splitlines() if "Cryptonow GmbH" not in line)
mutated_path = FIXTURES / "_CASPS_mutated.csv"
mutated_path.write_text(mutated, encoding="utf-8")


def fake_fetcher_mutated(register_code: str):
    if register_code == "CASPS":
        return fe.parse_csv_text(mutated_path.read_text(encoding="utf-8"))
    return fake_fetcher(register_code)


rc = fe.run(fetcher=fake_fetcher_mutated)
check("exit code 0", rc == 0)
changelog3 = json.loads((fe.DATA_DIR / "history" / "changelog.json").read_text(encoding="utf-8"))
new_entries = changelog3[len(changelog2):]
change_types = {(c["type"], c["name"]) for c in new_entries}
check("diff detected Bitpanda GmbH as 'changed'", ("changed", "Bitpanda GmbH") in change_types)
check("diff detected Cryptonow GmbH as 'removed'", ("removed", "Cryptonow GmbH") in change_types)
check("exactly 2 changes detected in run 3", len(new_entries) == 2)

print(f"\n{'ALL TESTS PASSED' if failures == 0 else f'{failures} TEST(S) FAILED'}")
sys.exit(1 if failures else 0)
