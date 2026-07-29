#!/usr/bin/env python3
"""
ESMA MiCAR Register Tracker - scraper.

Downloads the 5 official ESMA "Interim MiCA Register" CSV files, normalises
each into a JSON file per register, diffs the result against the previous
snapshot committed in /data, and writes a changelog + meta file.

Designed to run twice a day via GitHub Actions. ESMA itself only republishes
the interim register on a weekly basis, so most runs will find "no change" -
that is expected, not a bug.

Source:
https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable

import requests

BASE_URL = "https://www.esma.europa.eu/sites/default/files/2024-12/{}.csv"

# register key (used for filenames / URLs in the site) -> ESMA CSV file stem
SOURCES = {
    "whitepapers": "OTHER",
    "art": "ARTZZ",
    "emt": "EMTWP",
    "casps": "CASPS",
    "non_compliant": "NCASP",
}

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
HISTORY_DIR = DATA_DIR / "history"

TIMEOUT = 30
USER_AGENT = "BTCDirect-ESMA-MiCAR-Tracker/1.0 (compliance monitoring; contact: compliance@btcdirect.eu)"


# --------------------------------------------------------------------------
# Fetch + raw CSV parsing
# --------------------------------------------------------------------------

def fetch_csv_text(register_code: str) -> str:
    url = BASE_URL.format(register_code)
    resp = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    # ESMA files are UTF-8 with a leading BOM
    return resp.content.decode("utf-8-sig")


def parse_csv_text(text: str) -> list[dict]:
    """Parse ESMA's CSV text into a list of dicts, tolerant of their export quirks
    (trailing empty/unnamed columns, blank trailing rows, stray whitespace)."""
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict] = []
    for raw_row in reader:
        clean = {}
        for key, value in raw_row.items():
            if not key or not key.strip():
                continue  # drop ESMA's trailing unnamed columns
            clean[key.strip()] = value.strip() if isinstance(value, str) else value
        if any(clean.values()):
            rows.append(clean)
    return rows


def fetch_csv(register_code: str) -> list[dict]:
    return parse_csv_text(fetch_csv_text(register_code))


# --------------------------------------------------------------------------
# Normalisation helpers
# --------------------------------------------------------------------------

def record_id(*parts) -> str:
    key = "|".join((p or "").strip() for p in parts)
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def split_pipe(value: str | None) -> list[str]:
    if not value:
        return []
    return [v.strip() for v in value.split("|") if v.strip()]


def status_from(end_date: str | None) -> str:
    return "withdrawn" if end_date else "active"


def group_rows(rows: Iterable[dict], key_fn: Callable[[dict], object],
               item_field: str, item_fn: Callable[[dict], dict | None]) -> list[dict]:
    """Group repeated ESMA rows (one row per service / whitepaper) into one
    record per entity, with the repeated bit collected into an array field.
    The first row seen for a key supplies the entity-level fields."""
    grouped: dict[object, dict] = {}
    order: list[object] = []
    for row in rows:
        key = key_fn(row)
        if key not in grouped:
            grouped[key] = {"_base": row, item_field: []}
            order.append(key)
        item = item_fn(row)
        if item:
            grouped[key][item_field].append(item)
    result = []
    for key in order:
        bucket = grouped[key]
        record = dict(bucket["_base"])
        record[item_field] = bucket[item_field]
        result.append(record)
    return result


# --------------------------------------------------------------------------
# Per-register normalisers
# --------------------------------------------------------------------------

def normalize_casps(rows: list[dict]) -> list[dict]:
    def key_fn(r):
        return r.get("ae_lei") or (r.get("ae_lei_name", ""), r.get("ae_competentAuthority", ""))

    def item_fn(r):
        code = r.get("ac_serviceCode")
        if not code:
            return None
        return {
            "service": code,
            "countries": split_pipe(r.get("ac_serviceCode_cou")),
            "comments": r.get("ac_comments") or None,
            "last_update": r.get("ac_lastupdate") or None,
        }

    grouped = group_rows(rows, key_fn, "services", item_fn)
    records = []
    for r in grouped:
        end_date = r.get("ac_authorisationEndDate")
        records.append({
            "id": record_id("casps", r.get("ae_lei"), r.get("ae_lei_name"), r.get("ae_competentAuthority")),
            "competent_authority": r.get("ae_competentAuthority") or None,
            "home_member_state": r.get("ae_homeMemberState") or None,
            "name": r.get("ae_lei_name") or None,
            "lei": r.get("ae_lei") or None,
            "head_office_country": r.get("ae_lei_cou_code") or None,
            "commercial_name": r.get("ae_commercial_name") or None,
            "address": r.get("ae_address") or None,
            "website": r.get("ae_website") or None,
            "platform_website": r.get("ae_website_platform") or None,
            "authorisation_date": r.get("ac_authorisationNotificationDate") or None,
            "withdrawal_date": end_date or None,
            "status": status_from(end_date),
            "services": r["services"],
        })
    return records


def normalize_art_or_emt(rows: list[dict], register: str) -> list[dict]:
    is_emt = register == "emt"

    def key_fn(r):
        return r.get("ae_lei") or (r.get("ae_lei_name", ""), r.get("ae_competentAuthority", ""))

    def item_fn(r):
        url = r.get("wp_url")
        if not url:
            return None
        item = {
            "url": url,
            "start_date": r.get("wp_authorisationNotificationDate") or None,
            "dti": r.get("ae_DTI") or None,
            "dti_ffg": r.get("ae_DTI_FFG") or None,
            "comments": r.get("wp_comments") or None,
            "last_update": r.get("wp_lastupdate") or None,
        }
        if not is_emt:
            item["offer_countries"] = split_pipe(r.get("wp_url_cou"))
        return item

    grouped = group_rows(rows, key_fn, "whitepapers", item_fn)
    records = []
    for r in grouped:
        end_date = r.get("ac_authorisationEndDate")
        rec = {
            "id": record_id(register, r.get("ae_lei"), r.get("ae_lei_name"), r.get("ae_competentAuthority")),
            "competent_authority": r.get("ae_competentAuthority") or None,
            "home_member_state": r.get("ae_homeMemberState") or None,
            "name": r.get("ae_lei_name") or None,
            "lei": r.get("ae_lei") or None,
            "head_office_country": r.get("ae_lei_cou_code") or None,
            "commercial_name": r.get("ae_commercial_name") or None,
            "address": r.get("ae_address") or None,
            "website": r.get("ae_website") or None,
            "authorisation_date": r.get("ac_authorisationNotificationDate") or None,
            "withdrawal_date": end_date or None,
            "status": status_from(end_date),
            "whitepapers": r["whitepapers"],
        }
        if is_emt:
            rec["institution_type"] = r.get("ae_authorisation_other_emt") or None
            rec["exemption_48_4"] = r.get("ae_exemption48_4") or None
            rec["exemption_48_5"] = r.get("ae_exemption48_5") or None
        else:
            rec["credit_institution"] = r.get("ae_credit_institution") or None
        records.append(rec)
    return records


def normalize_whitepapers(rows: list[dict]) -> list[dict]:
    def key_fn(r):
        return r.get("ae_lei") or r.get("ae_lei_name", "")

    def item_fn(r):
        url = r.get("wp_url")
        if not url:
            return None
        return {
            "url": url,
            "casp_name": r.get("ae_lei_name_casp") or None,
            "casp_lei": r.get("ae_lei_casp") or None,
            "offer_countries": split_pipe(r.get("ae_offerCode_cou")),
            "dti": r.get("ae_DTI") or None,
            "dti_ffg": r.get("ae_DTI_FFG") or None,
            "comments": r.get("wp_comments") or None,
            "last_update": r.get("wp_lastupdate") or None,
        }

    grouped = group_rows(rows, key_fn, "whitepapers", item_fn)
    records = []
    for r in grouped:
        records.append({
            "id": record_id("whitepapers", r.get("ae_lei"), r.get("ae_lei_name")),
            "competent_authority": r.get("ae_competentAuthority") or None,
            "home_member_state": r.get("ae_homeMemberState") or None,
            "name": r.get("ae_lei_name") or None,
            "lei": r.get("ae_lei") or None,
            "head_office_country": r.get("ae_lei_cou_code") or None,
            "whitepapers": r["whitepapers"],
        })
    return records


def normalize_non_compliant(rows: list[dict]) -> list[dict]:
    seen: set[str] = set()
    records = []
    for r in rows:
        rid = record_id("ncasp", r.get("ae_lei"), r.get("ae_lei_name"),
                         r.get("ae_decision_date"), r.get("ae_website"))
        if rid in seen:
            continue  # exact duplicate row present in ESMA's own export
        seen.add(rid)
        records.append({
            "id": rid,
            "competent_authority": r.get("ae_competentAuthority") or None,
            "home_member_state": r.get("ae_homeMemberState") or None,
            "name": r.get("ae_lei_name") or None,
            "lei": r.get("ae_lei") or None,
            "head_office_country": r.get("ae_lei_cou_code") or None,
            "website": r.get("ae_website") or None,
            "article_17_infringement": r.get("ae_infrigment") or None,
            "reason": r.get("ae_reason") or None,
            "decision_date": r.get("ae_decision_date") or None,
            "comments": r.get("ae_comments") or None,
            "last_update": r.get("ae_lastupdate") or None,
        })
    return records


NORMALIZERS: dict[str, Callable[[list[dict]], list[dict]]] = {
    "whitepapers": normalize_whitepapers,
    "art": lambda rows: normalize_art_or_emt(rows, "art"),
    "emt": lambda rows: normalize_art_or_emt(rows, "emt"),
    "casps": normalize_casps,
    "non_compliant": normalize_non_compliant,
}


# --------------------------------------------------------------------------
# Diff + persistence
# --------------------------------------------------------------------------

def load_previous(register: str) -> dict[str, dict]:
    path = DATA_DIR / f"{register}.json"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    return {rec["id"]: rec for rec in data.get("records", [])}


def diff_records(register: str, previous: dict[str, dict], current: list[dict]) -> list[dict]:
    changes = []
    current_ids = set()
    for rec in current:
        current_ids.add(rec["id"])
        old = previous.get(rec["id"])
        if old is None:
            changes.append({"type": "added", "register": register, "id": rec["id"], "name": rec.get("name")})
        elif old != rec:
            changes.append({"type": "changed", "register": register, "id": rec["id"], "name": rec.get("name")})
    for old_id, old_rec in previous.items():
        if old_id not in current_ids:
            changes.append({"type": "removed", "register": register, "id": old_id, "name": old_rec.get("name")})
    return changes


def run(fetcher: Callable[[str], list[dict]] = fetch_csv) -> int:
    """Runs one full scrape cycle. `fetcher` is injectable for tests."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    all_changes: list[dict] = []
    counts: dict[str, int] = {}
    errors: dict[str, str] = {}

    for register, code in SOURCES.items():
        try:
            rows = fetcher(code)
        except Exception as exc:  # one register failing shouldn't kill the whole run
            errors[register] = str(exc)
            print(f"[warn] failed to fetch {register} ({code}): {exc}", file=sys.stderr)
            continue

        previous = load_previous(register)
        current = NORMALIZERS[register](rows)
        changes = diff_records(register, previous, current)
        all_changes.extend(changes)
        counts[register] = len(current)

        out_path = DATA_DIR / f"{register}.json"
        with out_path.open("w", encoding="utf-8") as f:
            json.dump(
                {"register": register, "generated_at": now, "records": current},
                f, ensure_ascii=False, indent=2,
            )

        if changes:
            print(f"[info] {register}: {len(changes)} change(s), {len(current)} total record(s)")
        else:
            print(f"[info] {register}: no change ({len(current)} records)")

    meta_path = DATA_DIR / "meta.json"
    meta = {}
    if meta_path.exists():
        with meta_path.open(encoding="utf-8") as f:
            meta = json.load(f)
    meta["last_checked"] = now
    meta["record_counts"] = counts
    if errors:
        meta["last_errors"] = errors
    else:
        meta.pop("last_errors", None)
    if all_changes:
        meta["last_change_at"] = now
    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    changelog_path = HISTORY_DIR / "changelog.json"
    changelog = []
    if changelog_path.exists():
        with changelog_path.open(encoding="utf-8") as f:
            changelog = json.load(f)
    for change in all_changes:
        changelog.append({**change, "timestamp": now})
    with changelog_path.open("w", encoding="utf-8") as f:
        json.dump(changelog, f, ensure_ascii=False, indent=2)

    print(f"[info] done - {len(all_changes)} total change(s) across all registers")

    if len(errors) == len(SOURCES):
        return 1  # every single register failed - a real failure, not "no change"
    return 0


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()
