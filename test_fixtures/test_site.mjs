// Node/jsdom smoke test for assets/js/app.js — exercises real rendering code
// (table build, sort, filter, search, detail panel, chip filters) against
// real ESMA-derived fixture data, without needing a live browser.
import { JSDOM } from "jsdom";
import fs from "fs";

const dom = new JSDOM("<!DOCTYPE html><body></body>", { url: "http://localhost/register.html?type=casps", runScripts: "dangerously" });
const { window } = dom;
global.window = window;
global.document = window.document;

const appJs = fs.readFileSync(new URL("../assets/js/app.js", import.meta.url), "utf-8");
const scriptEl = window.document.createElement("script");
scriptEl.textContent = appJs;
window.document.body.appendChild(scriptEl);

// const/let declarations in a classic <script> don't attach to `window` - bridge
// them explicitly so this harness (running as a separate ES module) can reach them.
const bridge = window.document.createElement("script");
bridge.textContent = "window.__b = { REGISTERS, renderRegisterTable, openDetail, cleanServiceLabel, expandCaspServiceEntries, CASP_SERVICES, extractServiceCode, countryName, parseEsmaDate };";
window.document.body.appendChild(bridge);

const { REGISTERS, renderRegisterTable, openDetail, cleanServiceLabel, expandCaspServiceEntries, CASP_SERVICES, extractServiceCode, countryName, parseEsmaDate } = window.__b;

let failures = 0;
function check(label, cond) {
  console.log(`[${cond ? "OK  " : "FAIL"}] ${label}`);
  if (!cond) failures++;
}

// --- pure helpers ---
check("cleanServiceLabel strips letter prefix", cleanServiceLabel("a. providing custody and administration of crypto-assets on behalf of clients") === "Providing custody and administration of crypto-assets on behalf of clients");
check("countryName maps NL", countryName("NL").includes("Nederland"));
check("parseEsmaDate parses dd/mm/yyyy", parseEsmaDate("18/04/2025").getUTCFullYear() === 2025);
check("parseEsmaDate handles blank", parseEsmaDate("") === null);
check("CASP_SERVICES has all 10 canonical MiCAR services (a-j)", CASP_SERVICES.length === 10);
check("extractServiceCode reads the leading letter", extractServiceCode("a. providing custody and administration of crypto-assets on behalf of clients") === "a");
check("extractServiceCode falls back to keyword match when no letter prefix", extractServiceCode("exchange of crypto-assets for funds") === "c");
check("extractServiceCode returns null for unrecognisable text", extractServiceCode("something completely unrelated") === null);

// --- render each register with real fixture data ---
for (const key of Object.keys(REGISTERS)) {
  const data = JSON.parse(fs.readFileSync(`/tmp/site_test_data/data/${REGISTERS[key].file}.json`, "utf-8"));
  const root = document.createElement("div");
  document.body.appendChild(root);
  let threw = null;
  try {
    renderRegisterTable(root, REGISTERS[key], data.records);
  } catch (e) {
    threw = e;
  }
  check(`${key}: renderRegisterTable runs without throwing`, !threw);
  if (threw) console.error(threw);

  const rows = root.querySelectorAll("tbody tr");
  check(`${key}: renders ${data.records.length || "0 (empty state)"} row(s)`,
    data.records.length ? rows.length === data.records.length : root.querySelector(".empty-row") !== null);

  // every "Naam"-style column should truncate via .cell-ellipsis, not stretch the table
  const nameCol = REGISTERS[key].columns.find((c) => c.ellipsis);
  if (nameCol && data.records.length) {
    check(`${key}: ellipsis column ("${nameCol.label}") renders a .cell-ellipsis span`, root.querySelector(".cell-ellipsis") !== null);
  }

  if (data.records.length) {
    const target = data.records[0];
    const term = (target.commercial_name || target.name || "").split(" ")[0];
    const search = root.querySelector('input[type="search"]');
    search.value = term;
    search.dispatchEvent(new window.Event("input"));
    const visibleRows = root.querySelectorAll("tbody tr:not(.empty-row)");
    check(`${key}: search for "${term}" narrows results (${visibleRows.length} row(s), was ${data.records.length})`, visibleRows.length >= 1 && visibleRows.length <= data.records.length);
    search.value = "";
    search.dispatchEvent(new window.Event("input"));

    const firstHeader = root.querySelector("thead th");
    let sortThrew = null;
    try {
      firstHeader.dispatchEvent(new window.Event("click", { bubbles: true }));
      firstHeader.dispatchEvent(new window.Event("click", { bubbles: true }));
    } catch (e) { sortThrew = e; }
    check(`${key}: column sort (asc/desc) runs without throwing`, !sortThrew);

    let detailThrew = null;
    try {
      openDetail(REGISTERS[key], target);
    } catch (e) { detailThrew = e; }
    check(`${key}: openDetail runs without throwing`, !detailThrew);
    const overlay = document.getElementById("detail-overlay");
    check(`${key}: detail overlay opens and has content`, overlay && overlay.classList.contains("open") && overlay.querySelector("#detail-body").innerHTML.length > 20);
  }
}

// --------------------------------------------------------------------------
// CASPs-specific regression checks: the pipe-joined-services-in-one-row bug,
// the icon rendering, and the new chip filter's fixed option set + OR logic.
// --------------------------------------------------------------------------
const caspsData = JSON.parse(fs.readFileSync("/tmp/site_test_data/data/casps.json", "utf-8"));
const caspsRoot = window.document.createElement("div");
window.document.body.appendChild(caspsRoot);
renderRegisterTable(caspsRoot, REGISTERS.casps, caspsData.records);

const bpRow = [...caspsRoot.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes("Bitpanda"));
const dienstenCell = bpRow.children[4]; // name, lei, country, authority, services
check("Bitpanda's Diensten cell renders as icons, not a text blob", dienstenCell.querySelector(".service-icons") !== null);
const activeIcons = dienstenCell.querySelectorAll(".service-icon.is-active");
check(`Bitpanda has exactly 3 active service icons (a, c, d)`, activeIcons.length === 3);
check("Bitpanda's Diensten cell has no stray pipe characters", !dienstenCell.textContent.includes("|"));

// Stratos Europe Ltd (commercial name "Tradu") is a real-world row whose
// pipe-joined services have NO letter prefixes at all — confirms the keyword
// fallback recovers them anyway.
const stratosRow = [...caspsRoot.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes("Tradu"));
check("Stratos/Tradu row found in the table", stratosRow !== undefined);
const stratosActive = stratosRow.children[4].querySelectorAll(".service-icon.is-active");
check("Stratos (no letter-prefixed services) still resolves via keyword fallback", stratosActive.length > 0);

// Chip filter: fixed canonical option set (10 services + "Alle"), not derived
// from the data (which is what caused the combinatorial-explosion dropdown bug).
const chipFilter = caspsRoot.querySelector(".chip-filter");
check("Chip filter renders", chipFilter !== null);
const chipButtons = chipFilter.querySelectorAll(".chip-filter__btn");
check("Chip filter has exactly 11 buttons (Alle + 10 canonical services)", chipButtons.length === 11);

// OR logic: selecting two services should show CASPs offering EITHER one, not
// only CASPs offering both. Per the fixture: only Trade Republic Bank offers
// "Orderuitvoering" (e); Bitpanda/Bybit (but not Cryptonow) offer "Wisselen —
// fiat" (c). Selecting both must union these sets, not intersect them.
const countRowsWithName = (root, name) => [...root.querySelectorAll("tbody tr:not(.empty-row)")].filter((tr) => tr.textContent.includes(name)).length;
const executionBtn = [...chipButtons].find((b) => b.textContent.includes("Orderuitvoering"));
const exchangeBtn = [...chipButtons].find((b) => b.textContent.includes("Wisselen — fiat"));
executionBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
check("After selecting 'Orderuitvoering' only: Trade Republic (has 'e') is shown", countRowsWithName(caspsRoot, "Trade Republic") === 1);
check("After selecting 'Orderuitvoering' only: Bitpanda (no 'e') is hidden", countRowsWithName(caspsRoot, "Bitpanda") === 0);
check("After selecting 'Orderuitvoering' only: exactly 1 CASP matches", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 1);
exchangeBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
check("After adding 'Wisselen — fiat' (OR): Bitpanda (has 'c') now shown too", countRowsWithName(caspsRoot, "Bitpanda") === 1);
check("OR filter still shows Trade Republic (has 'e', not 'c')", countRowsWithName(caspsRoot, "Trade Republic") === 1);
check("OR filter still hides Cryptonow (has neither 'e' nor 'c')", countRowsWithName(caspsRoot, "Cryptonow") === 0);
check("After OR of 2 codes: 3 CASPs match (Trade Republic, Bitpanda, Bybit)", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 3);
// Reset via "Alle"
chipFilter.querySelector(".chip-filter__btn").dispatchEvent(new window.Event("click", { bubbles: true }));
check("Clicking 'Alle' resets the filter (all 6 CASPs shown again)", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 6);

console.log(failures === 0 ? "\nALL SITE TESTS PASSED" : `\n${failures} SITE TEST(S) FAILED`);
process.exit(failures ? 1 : 0);
