// Dry-run test of changelog.html's runtime logic: the 7-day rolling window,
// reverse-chronological order, and the register/type dropdown filters.
// Loads i18n.js + app.js for real, then re-implements changelog.html's init()
// against synthetic fetch() data (real fetch() needs a server; this doesn't).
import { JSDOM } from "jsdom";
import fs from "fs";

const dom = new JSDOM("<!DOCTYPE html><body><div id='changelog-toolbar'><span id='changelog-count'></span></div><div id='changelog-list'></div></body>", {
  url: "http://localhost/changelog.html", runScripts: "dangerously",
});
const { window } = dom;
global.window = window;
global.document = window.document;

for (const rel of ["../assets/js/i18n.js", "../assets/js/app.js"]) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), "utf-8");
  const s = window.document.createElement("script");
  s.textContent = src;
  window.document.body.appendChild(s);
}
const bridge = window.document.createElement("script");
bridge.textContent = "window.__b = { REGISTERS, buildDropdownFilter, changelogTypeLabel, changelogItemHtml, el, t };";
window.document.body.appendChild(bridge);
const { REGISTERS, buildDropdownFilter, changelogTypeLabel, changelogItemHtml, el, t } = window.__b;

let failures = 0;
function check(label, cond) {
  console.log(`[${cond ? "OK  " : "FAIL"}] ${label}`);
  if (!cond) failures++;
}

const now = Date.now();
const days = (n) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
// changelog.json is append-only, so real data is chronologically ascending
// (oldest first) — the synthetic fixture below mirrors that ordering, since
// the render logic assumes it and reverses to get newest-first.
const synthetic = [
  { type: "added", register: "casps", name: "Old CASP (10 days ago)", timestamp: days(10) },
  { type: "added", register: "art", name: "Boundary ART (7.1 days ago)", timestamp: days(7.1) },
  { type: "changed", register: "emt", name: "Recent EMT (6.9 days ago)", timestamp: days(6.9) },
  { type: "added", register: "casps", name: "Recent CASP (2 days ago)", timestamp: days(2) },
  { type: "removed", register: "non_compliant", name: "Recent NCASP (1 day ago)", timestamp: days(1) },
];
// 5 entries total; 2 fall outside the 7-day window (10d and 7.1d ago), so 3 remain.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const cutoff = now - SEVEN_DAYS_MS;
let changelog = synthetic.filter((c) => new Date(c.timestamp).getTime() >= cutoff).slice().reverse();

check("7-day window excludes the 10-day-old entry", !changelog.some((c) => c.name.includes("Old CASP")));
check("7-day window excludes the 7.1-day-old (just past cutoff) entry", !changelog.some((c) => c.name.includes("Boundary ART")));
check("7-day window includes the 6.9-day-old entry (just within cutoff)", changelog.some((c) => c.name.includes("Recent EMT")));
check("7-day window includes the 2-day and 1-day-old entries", changelog.some((c) => c.name.includes("Recent CASP")) && changelog.some((c) => c.name.includes("Recent NCASP")));
check("Reverse-chronological: most recent (1 day ago) entry comes first", changelog[0].name.includes("Recent NCASP"));
check("Reverse-chronological: oldest kept entry (6.9 days ago) comes last", changelog[changelog.length - 1].name.includes("Recent EMT"));

const toolbar = document.getElementById("changelog-toolbar");
const countEl = document.getElementById("changelog-count");
const listEl = document.getElementById("changelog-list");

let registerFilter = null;
let typeFilter = null;
const registerDropdown = buildDropdownFilter({
  label: t("changelogPage.filterRegisterLabel"), options: Object.keys(REGISTERS),
  getValue: (k) => k, getLabel: (k) => REGISTERS[k].shortLabel,
  onChange: (v) => { registerFilter = v; render(); },
});
const typeDropdown = buildDropdownFilter({
  label: t("changelogPage.filterTypeLabel"), options: ["added", "changed", "removed"],
  getValue: (v) => v, getLabel: (v) => changelogTypeLabel(v), searchable: false,
  onChange: (v) => { typeFilter = v; render(); },
});
toolbar.insertBefore(registerDropdown.el, countEl);
toolbar.insertBefore(typeDropdown.el, countEl);

function render() {
  const filtered = changelog.filter((c) => (!registerFilter || c.register === registerFilter) && (!typeFilter || c.type === typeFilter));
  countEl.textContent = t("changelogPage.count", filtered.length);
  listEl.innerHTML = "";
  if (!filtered.length) { listEl.innerHTML = `<p class="filter-note">${t("changelogPage.emptyFiltered")}</p>`; return; }
  for (const c of filtered) listEl.appendChild(el("div", { class: "changelog-item" }, changelogItemHtml(c)));
}
render();

check("Changelog toolbar has Register + Type dropdowns (not native selects)", toolbar.querySelectorAll(".col-filter-dropdown").length === 2);
check("Count message reflects the 3 in-window entries", countEl.textContent.includes("3"));
check("All 3 in-window items render in the list", listEl.querySelectorAll(".changelog-item").length === 3);

const caspsOption = [...registerDropdown.list.querySelectorAll(".col-filter-dropdown__option")].find((o) => o.textContent.includes("CASPs"));
caspsOption.dispatchEvent(new window.Event("click", { bubbles: true }));
check("Filtering by Register=CASPs narrows to just the 1 in-window CASP entry", listEl.querySelectorAll(".changelog-item").length === 1 && listEl.textContent.includes("Recent CASP"));

const allOption = registerDropdown.list.querySelector(".col-filter-dropdown__option");
allOption.dispatchEvent(new window.Event("click", { bubbles: true }));
check("Resetting Register back to 'Alle' restores all 3 in-window entries", listEl.querySelectorAll(".changelog-item").length === 3);

const removedOption = [...typeDropdown.list.querySelectorAll(".col-filter-dropdown__option")].find((o) => o.textContent === changelogTypeLabel("removed"));
removedOption.dispatchEvent(new window.Event("click", { bubbles: true }));
check("Filtering by Type=removed narrows to just the 1 removed entry", listEl.querySelectorAll(".changelog-item").length === 1 && listEl.textContent.includes("Recent NCASP"));

console.log(failures === 0 ? "\nALL CHANGELOG TESTS PASSED" : `\n${failures} CHANGELOG TEST(S) FAILED`);
process.exit(failures ? 1 : 0);
