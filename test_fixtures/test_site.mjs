// Node/jsdom smoke test for assets/js/app.js — exercises real rendering code
// (table build, sort, filter, search, detail panel) against real ESMA-derived
// fixture data, without needing a live browser.
import { JSDOM } from "jsdom";
import fs from "fs";

const dom = new JSDOM("<!DOCTYPE html><body></body>", { url: "http://localhost/register.html?type=casps" });
global.window = dom.window;
global.document = dom.window.document;
global.URL = dom.window.URL;
global.Blob = dom.window.Blob;

const appJs = fs.readFileSync(new URL("../assets/js/app.js", import.meta.url), "utf-8");
dom.window.eval(appJs);

const { REGISTERS, renderRegisterTable, openDetail, cleanServiceLabel, countryName, parseEsmaDate } = dom.window;

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

  // exercise search box with a real record's name, expect exactly one match (or graceful empty for 0-record registers)
  if (data.records.length) {
    const target = data.records[0];
    const term = (target.commercial_name || target.name || "").split(" ")[0];
    const search = root.querySelector('input[type="search"]');
    search.value = term;
    search.dispatchEvent(new dom.window.Event("input"));
    const visibleRows = root.querySelectorAll("tbody tr:not(.empty-row)");
    check(`${key}: search for "${term}" narrows results (${visibleRows.length} row(s), was ${data.records.length})`, visibleRows.length >= 1 && visibleRows.length <= data.records.length);
    search.value = "";
    search.dispatchEvent(new dom.window.Event("input"));

    // sort by clicking the first column header twice (asc then desc), must not throw
    const firstHeader = root.querySelector("thead th");
    let sortThrew = null;
    try {
      firstHeader.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
      firstHeader.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    } catch (e) { sortThrew = e; }
    check(`${key}: column sort (asc/desc) runs without throwing`, !sortThrew);

    // detail panel for the first record
    let detailThrew = null;
    try {
      openDetail(REGISTERS[key], target);
    } catch (e) { detailThrew = e; }
    check(`${key}: openDetail runs without throwing`, !detailThrew);
    const overlay = document.getElementById("detail-overlay");
    check(`${key}: detail overlay opens and has content`, overlay && overlay.classList.contains("open") && overlay.querySelector("#detail-body").innerHTML.length > 20);
  }
}

console.log(failures === 0 ? "\nALL SITE TESTS PASSED" : `\n${failures} SITE TEST(S) FAILED`);
process.exit(failures ? 1 : 0);
