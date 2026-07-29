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

  // Per-column filters generalise beyond CASPs too: non_compliant's
  // "authority" column shows the shortened name (via shortAuthority) as the
  // select option label, not the raw long ESMA competent-authority string.
  if (key === "non_compliant" && data.records.length) {
    const authoritySelect = root.querySelector('tr.col-filter-row th.col-filter-cell[data-key="authority"] .col-filter-select');
    check(`${key}: authority column has a select filter`, authoritySelect !== null);
    if (authoritySelect) {
      const optionTexts = [...authoritySelect.options].map((o) => o.textContent);
      check(`${key}: authority select shows the short "AFM" label, not the full raw name`,
        optionTexts.includes("AFM") && !optionTexts.some((t) => t.includes("Netherlands Authority for the Financial Markets")));
    }
  }
}

// --------------------------------------------------------------------------
// CASPs-specific regression checks: the pipe-joined-services-in-one-row bug,
// icons-only-for-offered-services, and the per-column filter row (text,
// select, and the OR-logic chip popover for Diensten).
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
check("Bitpanda's Diensten cell shows ONLY offered services (no dimmed icons for the other 7)", dienstenCell.querySelectorAll(".service-icon").length === 3);
check("Bitpanda's Diensten cell has no stray pipe characters", !dienstenCell.textContent.includes("|"));

// Stratos Europe Ltd (commercial name "Tradu") is a real-world row whose
// pipe-joined services have NO letter prefixes at all — confirms the keyword
// fallback recovers them anyway.
const stratosRow = [...caspsRoot.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes("Tradu"));
check("Stratos/Tradu row found in the table", stratosRow !== undefined);
const stratosActive = stratosRow.children[4].querySelectorAll(".service-icon.is-active");
check("Stratos (no letter-prefixed services) still resolves via keyword fallback", stratosActive.length > 0);

// --- Per-column filter row: every column gets its own filter control -----
const filterCells = caspsRoot.querySelectorAll("tr.col-filter-row th.col-filter-cell");
check("Every CASPs column has a filter cell (7 columns)", filterCells.length === REGISTERS.casps.columns.length);

const cellFor = (key) => caspsRoot.querySelector(`tr.col-filter-row th.col-filter-cell[data-key="${key}"]`);
check("Naam column gets a free-text filter input", cellFor("name").querySelector(".col-filter-input") !== null);
check("Land column gets a select filter", cellFor("country").querySelector(".col-filter-select") !== null);
check("Toezichthouder column gets a select filter", cellFor("authority").querySelector(".col-filter-select") !== null);
check("Status column gets a select filter", cellFor("status").querySelector(".col-filter-select") !== null);
check("Diensten column gets a chip-popover filter, not a select", cellFor("services").querySelector(".col-filter-chips") !== null);

// Text filter on "Naam": narrows to the matching CASP only.
const nameInput = cellFor("name").querySelector(".col-filter-input");
nameInput.value = "bitpanda";
nameInput.dispatchEvent(new window.Event("input"));
check("Text filter on Naam narrows to exactly Bitpanda", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 1
  && caspsRoot.querySelector("tbody tr").textContent.includes("Bitpanda"));
nameInput.value = "";
nameInput.dispatchEvent(new window.Event("input"));
check("Clearing the Naam filter restores all 6 CASPs", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 6);

// Select filter on "Land": all sample CASPs happen to be NL-free (AT/CY/CZ/DE),
// so filtering on "AT" should narrow to the 3 Austrian entries.
const countrySelect = cellFor("country").querySelector(".col-filter-select");
countrySelect.value = "AT";
countrySelect.dispatchEvent(new window.Event("change"));
check("Select filter on Land='AT' narrows to the 3 Austrian CASPs", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 3);
countrySelect.value = "";
countrySelect.dispatchEvent(new window.Event("change"));
check("Clearing the Land filter restores all 6 CASPs", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 6);

// Chip-popover filter on "Diensten": fixed canonical option set (10 services),
// not derived from the data (which is what caused the earlier combinatorial-
// explosion dropdown bug), combined with OR logic.
const chipsWrap = cellFor("services").querySelector(".col-filter-chips");
const chipsBtn = chipsWrap.querySelector(".col-filter-chips__btn");
const popover = chipsWrap.querySelector(".chip-popover");
check("Diensten popover is closed by default", !popover.classList.contains("open"));
chipsBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
check("Clicking the Diensten filter button opens the popover", popover.classList.contains("open"));
const chipButtons = popover.querySelectorAll(".chip-popover__btn");
check("Diensten popover has exactly 10 chips (the canonical MiCAR services)", chipButtons.length === 10);

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
check("Filter button shows a '1' count badge while a service is selected", chipsBtn.querySelector(".col-filter-chips__count").textContent === "1");
exchangeBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
check("After adding 'Wisselen — fiat' (OR): Bitpanda (has 'c') now shown too", countRowsWithName(caspsRoot, "Bitpanda") === 1);
check("OR filter still shows Trade Republic (has 'e', not 'c')", countRowsWithName(caspsRoot, "Trade Republic") === 1);
check("OR filter still hides Cryptonow (has neither 'e' nor 'c')", countRowsWithName(caspsRoot, "Cryptonow") === 0);
check("After OR of 2 codes: 3 CASPs match (Trade Republic, Bitpanda, Bybit)", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 3);

// Reset via the popover's "Alles wissen" link.
popover.querySelector(".chip-popover__clear").dispatchEvent(new window.Event("click", { bubbles: true }));
check("'Alles wissen' resets the Diensten filter (all 6 CASPs shown again)", caspsRoot.querySelectorAll("tbody tr:not(.empty-row)").length === 6);
check("Filter button count badge is hidden again after reset", chipsBtn.querySelector(".col-filter-chips__count").hidden === true);

console.log(failures === 0 ? "\nALL SITE TESTS PASSED" : `\n${failures} SITE TEST(S) FAILED`);
process.exit(failures ? 1 : 0);
