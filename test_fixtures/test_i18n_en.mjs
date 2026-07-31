// Verifies the English translation set actually takes effect end-to-end
// (not just that the dictionary has EN keys) — pre-seed localStorage with
// lang=en before app.js runs, since REGISTERS/CASP_SERVICES are built once
// at load time using whatever getLang() returns at that moment.
import { JSDOM } from "jsdom";
import fs from "fs";

const dom = new JSDOM("<!DOCTYPE html><body></body>", { url: "http://localhost/register.html?type=casps", runScripts: "dangerously" });
const { window } = dom;
global.window = window;
global.document = window.document;
window.localStorage.setItem("esma-tracker-lang", "en");

for (const rel of ["../assets/js/i18n.js", "../assets/js/app.js"]) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), "utf-8");
  const s = window.document.createElement("script");
  s.textContent = src;
  window.document.body.appendChild(s);
}
const bridge = window.document.createElement("script");
bridge.textContent = "window.__b = { REGISTERS, CASP_SERVICES, countryName, getLang, t, statusBadge };";
window.document.body.appendChild(bridge);
const { REGISTERS, CASP_SERVICES, countryName, getLang, t, statusBadge } = window.__b;

let failures = 0;
function check(label, cond) {
  console.log(`[${cond ? "OK  " : "FAIL"}] ${label}`);
  if (!cond) failures++;
}

check("getLang() picks up the pre-seeded 'en' value", getLang() === "en");
check("Register labels are in English", REGISTERS.casps.shortLabel === "CASPs" && REGISTERS.art.shortLabel === "ART issuers" && REGISTERS.non_compliant.label === "Non-compliant entities");
check("Column labels are in English", REGISTERS.casps.columns.find((c) => c.key === "name").label === "Name" && REGISTERS.casps.columns.find((c) => c.key === "country").label === "Country");
check("Country names are in English", countryName("NL").includes("Netherlands") && countryName("DE").includes("Germany"));
check("CASP service labels are in English", CASP_SERVICES.find((s) => s.code === "a").label === "Custody");
check("Status badge text is in English", statusBadge("active").includes("Active") && statusBadge("withdrawn").includes("Withdrawn"));
check("t() for filters.searchPlaceholder is in English", t("filters.searchPlaceholder") === "Search by name, LEI, website…");

console.log(failures === 0 ? "\nALL EN I18N TESTS PASSED" : `\n${failures} EN I18N TEST(S) FAILED`);
process.exit(failures ? 1 : 0);
