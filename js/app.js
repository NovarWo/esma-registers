/* ESMA MiCAR Register Tracker — shared front-end logic.
 * No build step, no framework: plain fetch() over the data/*.json files that
 * scraper/fetch_esma.py maintains, rendered with vanilla DOM APIs.
 */

const COUNTRY_NAMES = {
  AT: "Oostenrijk", BE: "België", BG: "Bulgarije", CY: "Cyprus", CZ: "Tsjechië",
  DE: "Duitsland", DK: "Denemarken", EE: "Estland", EL: "Griekenland", GR: "Griekenland",
  ES: "Spanje", FI: "Finland", FR: "Frankrijk", HR: "Kroatië", HU: "Hongarije",
  IE: "Ierland", IS: "IJsland", IT: "Italië", LI: "Liechtenstein", LT: "Litouwen",
  LU: "Luxemburg", LV: "Letland", MT: "Malta", NL: "Nederland", NO: "Noorwegen",
  PL: "Polen", PT: "Portugal", RO: "Roemenië", SE: "Zweden", SI: "Slovenië",
  SK: "Slowakije", GB: "Verenigd Koninkrijk", CH: "Zwitserland",
};

// EL ("Griekenland" in older EU documents) has no matching flag - alias to GR.
const FLAG_ALIAS = { EL: "GR" };

function countryName(code) {
  if (!code) return "—";
  const c = code.trim().toUpperCase();
  return COUNTRY_NAMES[c] ? `${COUNTRY_NAMES[c]} (${c})` : c;
}

function flagEmoji(code) {
  if (!code) return "";
  let cc = code.trim().toUpperCase();
  cc = FLAG_ALIAS[cc] || cc;
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
}

// Compact "flag + code" cell with the full country name as a hover tooltip.
function countryCell(code) {
  if (!code) return "—";
  const flag = flagEmoji(code);
  return `<span class="flag-cell" title="${escapeHtml(countryName(code))}">${flag ? `<span class="flag-cell__emoji">${flag}</span> ` : ""}${escapeHtml(code.toUpperCase())}</span>`;
}

// ESMA's "Competent Authority" field is a long official name, usually ending
// in a parenthesised abbreviation, e.g. "Austrian Financial Market Authority
// (FMA)". Show just the abbreviation, full name on hover.
function shortAuthority(name) {
  if (!name) return "—";
  const m = /\(([^()]+)\)\s*$/.exec(name.trim());
  return m ? m[1].trim() : name.trim();
}

function authorityCell(name) {
  if (!name) return "—";
  const short = shortAuthority(name);
  return short === name.trim() ? escapeHtml(name) : `<span title="${escapeHtml(name)}">${escapeHtml(short)}</span>`;
}

function shortDomain(url) {
  if (!url) return null;
  const clean = url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].split("?")[0];
  return clean || null;
}

function websiteCell(url) {
  if (!url) return "—";
  const domain = shortDomain(url);
  const clean = url.trim();
  const href = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(domain || clean)}</a>`;
}

function cleanServiceLabel(s) {
  if (!s) return "";
  return s.replace(/^\s*[a-j]\s*[.)]\s*/i, "").trim().replace(/^./, (c) => c.toUpperCase());
}

// ESMA dates are dd/mm/yyyy — parse to a sortable Date, tolerant of blanks.
function parseEsmaDate(s) {
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
}

function formatTimestamp(iso) {
  if (!iso) return "onbekend";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("nl-NL", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Kon ${path} niet laden (${res.status})`);
  return res.json();
}

function statusBadge(status) {
  if (status === "active") return `<span class="badge badge--success">Actief</span>`;
  if (status === "withdrawn") return `<span class="badge badge--neutral">Ingetrokken</span>`;
  return `<span class="badge badge--neutral">Onbekend</span>`;
}

function el(tag, attrs = {}, html) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (html !== undefined) node.innerHTML = html;
  return node;
}

// --------------------------------------------------------------------------
// CASP services (MiCAR Art. 3(1)(16), letters a-j) — a fixed, canonical list.
// ESMA's `ac_serviceCode` field carries these as free-text sentences that
// start with the letter code (e.g. "a. providing custody..."), and — this is
// the quirk that broke the table earlier — sometimes pipe-joins ALL of a
// CASP's services into that single field on one row instead of repeating the
// row per service. We match on the leading letter, not the sentence text, so
// grouping is robust regardless of which shape the source row takes.
// --------------------------------------------------------------------------

function svgIcon(path) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

const CASP_SERVICES = [
  { code: "a", label: "Bewaring", full: "Bewaring en administratie van crypto-activa namens cliënten", icon: svgIcon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>') },
  { code: "b", label: "Handelsplatform", full: "Exploiteren van een handelsplatform voor crypto-activa", icon: svgIcon('<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>') },
  { code: "c", label: "Wisselen — fiat", full: "Wisselen van crypto-activa voor geld", icon: svgIcon('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>') },
  { code: "d", label: "Wisselen — crypto", full: "Wisselen van crypto-activa voor andere crypto-activa", icon: svgIcon('<path d="m17 3 4 4-4 4"/><path d="M3 7h18"/><path d="m7 21-4-4 4-4"/><path d="M21 17H3"/>') },
  { code: "e", label: "Orderuitvoering", full: "Uitvoeren van orders voor crypto-activa namens cliënten", icon: svgIcon('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/>') },
  { code: "f", label: "Plaatsing", full: "Plaatsen van crypto-activa", icon: svgIcon('<path d="m3 11 18-8-8 18-2-8-8-2Z"/>') },
  { code: "g", label: "Orderdoorgifte", full: "Ontvangen en doorgeven van orders voor crypto-activa namens cliënten", icon: svgIcon('<circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="m8.1 10.9 7.8-3.8M8.1 13.1l7.8 3.8"/>') },
  { code: "h", label: "Advies", full: "Advies verlenen over crypto-activa", icon: svgIcon('<path d="M21 11.5a8.4 8.4 0 0 1-4.7 7.6 8.4 8.4 0 0 1-3.8.9h-.5A8.5 8.5 0 0 1 3 11.5 8.5 8.5 0 0 1 11.5 3h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M11.5 8v4l2.5 1.5"/>') },
  { code: "i", label: "Vermogensbeheer", full: "Portefeuillebeheer van crypto-activa", icon: svgIcon('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>') },
  { code: "j", label: "Overdracht", full: "Overdrachtsdiensten voor crypto-activa namens cliënten", icon: svgIcon('<path d="M4 12h16"/><path d="m14 6 6 6-6 6"/>') },
];
const CASP_SERVICE_BY_CODE = Object.fromEntries(CASP_SERVICES.map((s) => [s.code, s]));

// Most ESMA rows lead each service with its letter code ("a. providing
// custody..."), but some (e.g. real-world entries like "Stratos Europe Ltd")
// omit the letter entirely. Fall back to matching on the official English
// MiCAR service wording so those still resolve to a canonical service.
const CASP_SERVICE_KEYWORDS = [
  { code: "a", re: /custody/i },
  { code: "b", re: /trading platform/i },
  { code: "c", re: /exchange of crypto-assets? for funds/i },
  { code: "d", re: /exchange of crypto-assets? for other crypto/i },
  { code: "e", re: /execution of orders/i },
  { code: "f", re: /placing of crypto-assets/i },
  { code: "g", re: /reception and transmission/i },
  { code: "h", re: /advice on crypto-assets/i },
  { code: "i", re: /portfolio management/i },
  { code: "j", re: /transfer services/i },
];

function extractServiceCode(rawPart) {
  const m = /^\s*([a-j])\s*[.)]/i.exec(rawPart || "");
  if (m) return m[1].toLowerCase();
  const hit = CASP_SERVICE_KEYWORDS.find(({ re }) => re.test(rawPart || ""));
  return hit ? hit.code : null;
}

// Splits every service row (defensively re-splitting on "|" in case the row
// bundles several services into one field) and buckets each part into either
// a known MiCAR service code or an "unknown" fallback so nothing is silently
// dropped even if ESMA's export doesn't match the expected letter-prefix shape.
function expandCaspServiceEntries(services) {
  const known = new Map(); // code -> { countries: Set, comments: Set }
  const unknown = [];
  for (const s of services || []) {
    const parts = (s.service || "").split("|").map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const code = extractServiceCode(part);
      if (code && CASP_SERVICE_BY_CODE[code]) {
        if (!known.has(code)) known.set(code, { countries: new Set(), comments: new Set() });
        const entry = known.get(code);
        (s.countries || []).forEach((c) => entry.countries.add(c));
        if (s.comments) entry.comments.add(s.comments);
      } else if (part) {
        unknown.push({ label: cleanServiceLabel(part), countries: s.countries || [], comments: s.comments });
      }
    }
  }
  return { known, unknown };
}

// Only the services a CASP actually offers get an icon — a dimmed icon for
// each of the other ~9 services just added noise without adding information.
function renderServiceIcons(known) {
  const offered = CASP_SERVICES.filter((svc) => known.has(svc.code));
  if (!offered.length) return "—";
  const icons = offered.map((svc) => `<span class="service-icon is-active" title="${escapeHtml(svc.label)}">${svc.icon}</span>`).join("");
  return `<span class="service-icons">${icons}</span>`;
}

function caspServiceSummary(r) {
  const { known, unknown } = expandCaspServiceEntries(r.services);
  const labels = [...known.keys()].map((code) => CASP_SERVICE_BY_CODE[code].label).concat(unknown.map((u) => u.label));
  return labels.length ? labels.join("; ") : "—";
}

function caspServiceDetailItems(r) {
  const { known, unknown } = expandCaspServiceEntries(r.services);
  const items = CASP_SERVICES.filter((svc) => known.has(svc.code)).map((svc) => {
    const info = known.get(svc.code);
    const countries = [...info.countries];
    const comments = [...info.comments].filter(Boolean);
    return `${svc.icon}<strong>${escapeHtml(svc.label)}</strong> — <span class="detail-service-desc">${escapeHtml(svc.full)}</span>${countries.length ? `<br>Landen: ${countries.join(", ")}` : ""}${comments.length ? `<br><em>${escapeHtml(comments.join(" · "))}</em>` : ""}`;
  });
  const extra = unknown.map((u) => `${escapeHtml(u.label)}${u.countries?.length ? ` — ${u.countries.join(", ")}` : ""}`);
  return [...items, ...extra];
}

// --------------------------------------------------------------------------
// Register configuration — one entry per data/<key>.json file.
// --------------------------------------------------------------------------

const REGISTERS = {
  casps: {
    label: "Crypto-asset service providers",
    shortLabel: "CASPs",
    file: "casps",
    searchFields: (r) => [r.name, r.commercial_name, r.lei, r.website, r.competent_authority],
    columns: [
      { key: "name", label: "Naam", value: (r) => r.commercial_name || r.name || "—", ellipsis: true },
      { key: "lei", label: "LEI", value: (r) => r.lei || "—" },
      {
        key: "country", label: "Land", value: (r) => countryName(r.home_member_state), render: (r) => countryCell(r.home_member_state),
        filter: { type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName },
      },
      {
        key: "authority", label: "Toezichthouder", value: (r) => r.competent_authority || "—", render: (r) => authorityCell(r.competent_authority),
        filter: { type: "select", valueFn: (r) => r.competent_authority, formatFn: shortAuthority },
      },
      {
        key: "services", label: "Diensten",
        value: caspServiceSummary,
        render: (r) => renderServiceIcons(expandCaspServiceEntries(r.services).known),
        sortValue: (r) => { const { known, unknown } = expandCaspServiceEntries(r.services); return known.size + unknown.length; },
        filter: {
          type: "chips", options: CASP_SERVICES,
          matchFn: (r, selectedCodes) => {
            const { known } = expandCaspServiceEntries(r.services);
            return selectedCodes.some((code) => known.has(code));
          },
        },
      },
      { key: "website", label: "Website", value: (r) => r.website || "—", render: (r) => websiteCell(r.website) },
      {
        key: "status", label: "Status", value: (r) => (r.status === "active" ? "Actief" : r.status === "withdrawn" ? "Ingetrokken" : "—"), render: (r) => statusBadge(r.status),
        filter: { type: "select", valueFn: (r) => r.status, formatFn: (v) => (v === "active" ? "Actief" : v === "withdrawn" ? "Ingetrokken" : v) },
      },
    ],
    detail: (r) => detailArticle(r, [
      ["Bevoegde autoriteit", r.competent_authority],
      ["Lidstaat", countryName(r.home_member_state)],
      ["LEI", r.lei],
      ["Land hoofdkantoor", countryName(r.head_office_country)],
      ["Adres", r.address],
      ["Website", linkify(r.website)],
      ["Website platform", linkify(r.platform_website)],
      ["Datum autorisatie", r.authorisation_date],
      ["Datum intrekking", r.withdrawal_date || "—"],
    ], "Diensten", caspServiceDetailItems(r)),
  },

  art: {
    label: "Uitgevers van asset-referenced tokens (ART)",
    shortLabel: "ART-uitgevers",
    file: "art",
    searchFields: (r) => [r.name, r.commercial_name, r.lei, r.website, r.competent_authority],
    columns: [
      { key: "name", label: "Naam", value: (r) => r.commercial_name || r.name || "—", ellipsis: true },
      { key: "lei", label: "LEI", value: (r) => r.lei || "—" },
      {
        key: "country", label: "Land", value: (r) => countryName(r.home_member_state), render: (r) => countryCell(r.home_member_state),
        filter: { type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName },
      },
      {
        key: "authority", label: "Toezichthouder", value: (r) => r.competent_authority || "—", render: (r) => authorityCell(r.competent_authority),
        filter: { type: "select", valueFn: (r) => r.competent_authority, formatFn: shortAuthority },
      },
      { key: "credit_institution", label: "Kredietinstelling", value: (r) => r.credit_institution || "—" },
      {
        key: "whitepapers", label: "Whitepapers",
        value: (r) => `${(r.whitepapers || []).length}`, sortValue: (r) => (r.whitepapers || []).length,
      },
      {
        key: "status", label: "Status", value: (r) => (r.status === "active" ? "Actief" : r.status === "withdrawn" ? "Ingetrokken" : "—"), render: (r) => statusBadge(r.status),
        filter: { type: "select", valueFn: (r) => r.status, formatFn: (v) => (v === "active" ? "Actief" : v === "withdrawn" ? "Ingetrokken" : v) },
      },
    ],
    detail: (r) => detailArticle(r, [
      ["Bevoegde autoriteit", r.competent_authority],
      ["Lidstaat", countryName(r.home_member_state)],
      ["LEI", r.lei],
      ["Adres", r.address],
      ["Website", linkify(r.website)],
      ["Kredietinstelling", r.credit_institution || "—"],
      ["Datum autorisatie", r.authorisation_date],
      ["Datum intrekking", r.withdrawal_date || "—"],
    ], "Whitepapers", (r.whitepapers || []).map((w) =>
      `${linkify(w.url)}${w.start_date ? ` — start aanbieding: ${w.start_date}` : ""}${w.offer_countries?.length ? `<br>Landen: ${w.offer_countries.join(", ")}` : ""}`
    )),
  },

  emt: {
    label: "Uitgevers van e-money tokens (EMT)",
    shortLabel: "EMT-uitgevers",
    file: "emt",
    searchFields: (r) => [r.name, r.commercial_name, r.lei, r.website, r.competent_authority],
    columns: [
      { key: "name", label: "Naam", value: (r) => r.commercial_name || r.name || "—", ellipsis: true },
      { key: "lei", label: "LEI", value: (r) => r.lei || "—" },
      {
        key: "country", label: "Land", value: (r) => countryName(r.home_member_state), render: (r) => countryCell(r.home_member_state),
        filter: { type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName },
      },
      {
        key: "authority", label: "Toezichthouder", value: (r) => r.competent_authority || "—", render: (r) => authorityCell(r.competent_authority),
        filter: { type: "select", valueFn: (r) => r.competent_authority, formatFn: shortAuthority },
      },
      {
        key: "institution_type", label: "Type instelling", value: (r) => r.institution_type || "—",
        filter: { type: "select", valueFn: (r) => r.institution_type },
      },
      {
        key: "whitepapers", label: "Whitepapers",
        value: (r) => `${(r.whitepapers || []).length}`, sortValue: (r) => (r.whitepapers || []).length,
      },
      {
        key: "status", label: "Status", value: (r) => (r.status === "active" ? "Actief" : r.status === "withdrawn" ? "Ingetrokken" : "—"), render: (r) => statusBadge(r.status),
        filter: { type: "select", valueFn: (r) => r.status, formatFn: (v) => (v === "active" ? "Actief" : v === "withdrawn" ? "Ingetrokken" : v) },
      },
    ],
    detail: (r) => detailArticle(r, [
      ["Bevoegde autoriteit", r.competent_authority],
      ["Lidstaat", countryName(r.home_member_state)],
      ["LEI", r.lei],
      ["Adres", r.address],
      ["Website", linkify(r.website)],
      ["Type instelling", r.institution_type || "—"],
      ["Vrijstelling art. 48(4)", r.exemption_48_4 || "—"],
      ["Vrijstelling art. 48(5)", r.exemption_48_5 || "—"],
      ["Datum autorisatie", r.authorisation_date],
      ["Datum intrekking", r.withdrawal_date || "—"],
    ], "Whitepapers", (r.whitepapers || []).map((w) =>
      `${linkify(w.url)}${w.start_date ? ` — start aanbieding: ${w.start_date}` : ""}${w.comments ? `<br><em>${escapeHtml(w.comments)}</em>` : ""}`
    )),
  },

  whitepapers: {
    label: "Whitepapers (overige crypto-assets)",
    shortLabel: "Whitepapers",
    file: "whitepapers",
    searchFields: (r) => [r.name, r.lei, r.competent_authority],
    columns: [
      { key: "name", label: "Naam issuer/aanbieder", value: (r) => r.name || "—", ellipsis: true },
      { key: "lei", label: "LEI", value: (r) => r.lei || "—" },
      {
        key: "country", label: "Land", value: (r) => countryName(r.home_member_state), render: (r) => countryCell(r.home_member_state),
        filter: { type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName },
      },
      {
        key: "authority", label: "Toezichthouder", value: (r) => r.competent_authority || "—", render: (r) => authorityCell(r.competent_authority),
        filter: { type: "select", valueFn: (r) => r.competent_authority, formatFn: shortAuthority },
      },
      {
        key: "casp", label: "Betrokken CASP",
        value: (r) => (r.whitepapers || []).find((w) => w.casp_name)?.casp_name || "—", ellipsis: true,
      },
      {
        key: "whitepapers", label: "Whitepapers",
        value: (r) => `${(r.whitepapers || []).length}`, sortValue: (r) => (r.whitepapers || []).length,
      },
    ],
    detail: (r) => detailArticle(r, [
      ["Bevoegde autoriteit", r.competent_authority],
      ["Lidstaat", countryName(r.home_member_state)],
      ["LEI", r.lei],
    ], "Whitepapers", (r.whitepapers || []).map((w) =>
      `${linkify(w.url)}${w.casp_name ? ` — via CASP: ${w.casp_name}` : ""}${w.offer_countries?.length ? `<br>Landen: ${w.offer_countries.join(", ")}` : ""}${w.comments ? `<br><em>${escapeHtml(w.comments)}</em>` : ""}`
    )),
  },

  non_compliant: {
    label: "Non-compliant entiteiten",
    shortLabel: "Non-compliant",
    file: "non_compliant",
    searchFields: (r) => [r.name, r.lei, r.website, r.competent_authority],
    columns: [
      { key: "name", label: "Naam", value: (r) => r.name || "—", ellipsis: true },
      {
        key: "country", label: "Land", value: (r) => countryName(r.home_member_state), render: (r) => countryCell(r.home_member_state),
        filter: { type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName },
      },
      {
        key: "authority", label: "Toezichthouder", value: (r) => r.competent_authority || "—", render: (r) => authorityCell(r.competent_authority),
        filter: { type: "select", valueFn: (r) => r.competent_authority, formatFn: shortAuthority },
      },
      { key: "reason", label: "Reden", value: (r) => r.reason || "—", ellipsis: true, maxWidth: 280 },
      { key: "decision_date", label: "Besluitdatum", value: (r) => r.decision_date || "—", sortValue: (r) => parseEsmaDate(r.decision_date) },
    ],
    detail: (r) => detailArticle(r, [
      ["Bevoegde autoriteit", r.competent_authority],
      ["Lidstaat", countryName(r.home_member_state)],
      ["LEI", r.lei || "—"],
      ["Website", linkify(r.website)],
      ["Artikel 17-inbreuk (ESMA)", r.article_17_infringement || "—"],
      ["Reden", r.reason || "—"],
      ["Besluitdatum", r.decision_date || "—"],
      ["Opmerkingen", r.comments || "—"],
    ]),
  },
};

function linkify(url) {
  if (!url || url === "—") return "—";
  const clean = url.trim();
  const href = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(clean)}</a>`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function detailArticle(record, fieldPairs, subitemsTitle, subitemsHtml) {
  let html = `<dl>`;
  for (const [label, value] of fieldPairs) {
    html += `<dt>${escapeHtml(label)}</dt><dd>${value || "—"}</dd>`;
  }
  html += `</dl>`;
  if (subitemsTitle && subitemsHtml && subitemsHtml.length) {
    html += `<h3>${escapeHtml(subitemsTitle)} (${subitemsHtml.length})</h3><ul class="subitems">`;
    html += subitemsHtml.map((s) => `<li>${s}</li>`).join("");
    html += `</ul>`;
  }
  return html;
}

// --------------------------------------------------------------------------
// Generic table + filter/search/sort component
// --------------------------------------------------------------------------

function renderRegisterTable(root, config, records) {
  let filtered = records.slice();
  let sortKey = null;
  let sortDir = 1;
  const activeFilters = {};
  let searchTerm = "";
  const openPopovers = [];

  const toolbar = el("div", { class: "toolbar" });
  const searchInput = el("input", { type: "search", placeholder: "Zoek op naam, LEI, website…" });
  toolbar.appendChild(searchInput);

  const countLabel = el("span", { class: "toolbar__count" });
  const exportBtn = el("button", { class: "btn", type: "button" }, "Exporteer CSV");
  toolbar.appendChild(exportBtn);
  toolbar.appendChild(countLabel);
  root.appendChild(toolbar);

  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", { class: "data" });
  const thead = el("thead");
  const headRow = el("tr");
  for (const col of config.columns) {
    const th = el("th", { "data-key": col.key }, `${escapeHtml(col.label)} <span class="arrow"></span>`);
    th.addEventListener("click", () => {
      if (sortKey === col.key) sortDir = -sortDir;
      else { sortKey = col.key; sortDir = 1; }
      applyAndRender();
    });
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  // Every column gets its own filter, right below its header: a text input by
  // default, or a select / OR-logic chip popover for columns that declare
  // `filter: {...}`. This replaces the old toolbar-level filters, which only
  // covered a handful of hand-picked columns.
  const filterRow = el("tr", { class: "col-filter-row" });
  for (const col of config.columns) {
    const cell = el("th", { class: "col-filter-cell", "data-key": col.key });
    const fc = col.filter || { type: "text" };

    if (fc.type === "select") {
      const options = [...new Set(records.map((r) => fc.valueFn(r)).filter(Boolean))].sort();
      const select = el("select", { class: "col-filter-select" });
      select.appendChild(el("option", { value: "" }, "Alle"));
      for (const opt of options) {
        select.appendChild(el("option", { value: opt }, fc.formatFn ? escapeHtml(fc.formatFn(opt)) : escapeHtml(opt)));
      }
      select.addEventListener("click", (e) => e.stopPropagation());
      select.addEventListener("change", () => {
        activeFilters[col.key] = select.value || null;
        applyAndRender();
      });
      cell.appendChild(select);
    } else if (fc.type === "chips") {
      activeFilters[col.key] = [];
      const wrap = el("div", { class: "col-filter-chips" });
      const btn = el("button", { type: "button", class: "col-filter-chips__btn" },
        `<span>${escapeHtml(col.label)}</span><span class="col-filter-chips__count" hidden></span>`);
      const countBadge = btn.querySelector(".col-filter-chips__count");
      const popover = el("div", { class: "chip-popover" });
      const clearBtn = el("button", { type: "button", class: "chip-popover__clear" }, "Alles wissen");
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        activeFilters[col.key] = [];
        updateChipVisual();
        applyAndRender();
      });
      popover.appendChild(clearBtn);
      const chipButtons = [];
      for (const opt of fc.options) {
        const chip = el("button", { type: "button", class: "chip-popover__btn", title: opt.full ? escapeHtml(opt.full) : "" },
          `${opt.icon || ""}<span>${escapeHtml(opt.label)}</span>`);
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          const list = activeFilters[col.key];
          const idx = list.indexOf(opt.code);
          if (idx === -1) list.push(opt.code); else list.splice(idx, 1);
          updateChipVisual();
          applyAndRender();
        });
        chipButtons.push({ chip, code: opt.code });
        popover.appendChild(chip);
      }
      function updateChipVisual() {
        const n = activeFilters[col.key].length;
        btn.classList.toggle("has-selection", n > 0);
        countBadge.hidden = n === 0;
        countBadge.textContent = String(n);
        for (const { chip, code } of chipButtons) chip.classList.toggle("is-active", activeFilters[col.key].includes(code));
      }
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = !popover.classList.contains("open");
        for (const p of openPopovers) p.classList.remove("open");
        if (willOpen) popover.classList.add("open");
      });
      wrap.appendChild(btn);
      wrap.appendChild(popover);
      cell.appendChild(wrap);
      openPopovers.push(popover);
    } else {
      const input = el("input", { type: "text", class: "col-filter-input", placeholder: "Filter…" });
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("input", () => {
        activeFilters[col.key] = input.value.trim().toLowerCase();
        applyAndRender();
      });
      cell.appendChild(input);
    }
    filterRow.appendChild(cell);
  }
  thead.appendChild(filterRow);
  document.addEventListener("click", () => { for (const p of openPopovers) p.classList.remove("open"); });

  const tbody = el("tbody");
  table.appendChild(thead);
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  root.appendChild(tableWrap);

  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    applyAndRender();
  });

  function applyAndRender() {
    filtered = records.filter((r) => {
      if (searchTerm) {
        const haystack = (config.searchFields(r) || []).join(" ").toLowerCase();
        if (!haystack.includes(searchTerm)) return false;
      }
      for (const col of config.columns) {
        const fc = col.filter || { type: "text" };
        const active = activeFilters[col.key];
        if (fc.type === "select") {
          if (active && fc.valueFn(r) !== active) return false;
        } else if (fc.type === "chips") {
          if (active && active.length && !fc.matchFn(r, active)) return false;
        } else if (active) {
          const text = String(col.value(r) ?? "").toLowerCase();
          if (!text.includes(active)) return false;
        }
      }
      return true;
    });

    if (sortKey) {
      const col = config.columns.find((c) => c.key === sortKey);
      const getVal = col.sortValue || col.value;
      filtered.sort((a, b) => {
        const va = getVal(a), vb = getVal(b);
        if (va === vb) return 0;
        if (va === null || va === undefined || va === "") return 1;
        if (vb === null || vb === undefined || vb === "") return -1;
        return va > vb ? sortDir : -sortDir;
      });
    }

    for (const th of headRow.children) {
      const arrow = th.querySelector(".arrow");
      arrow.textContent = th.dataset.key === sortKey ? (sortDir === 1 ? "▲" : "▼") : "";
    }

    tbody.innerHTML = "";
    if (!filtered.length) {
      const tr = el("tr", { class: "empty-row" });
      tr.appendChild(el("td", { colspan: config.columns.length }, "Geen records gevonden voor deze zoekopdracht/filters."));
      tbody.appendChild(tr);
    } else {
      for (const r of filtered) {
        const tr = el("tr");
        for (const col of config.columns) {
          const td = el("td");
          if (col.render) {
            td.innerHTML = col.render(r);
          } else if (col.ellipsis) {
            const text = col.value(r);
            const style = col.maxWidth ? ` style="max-width:${col.maxWidth}px"` : "";
            td.innerHTML = `<span class="cell-ellipsis" title="${escapeHtml(text)}"${style}>${escapeHtml(text)}</span>`;
          } else {
            td.innerHTML = escapeHtml(col.value(r));
          }
          tr.appendChild(td);
        }
        tr.addEventListener("click", () => openDetail(config, r));
        tbody.appendChild(tr);
      }
    }
    countLabel.textContent = `${filtered.length} van ${records.length} records`;
  }

  exportBtn.addEventListener("click", () => exportCsv(config, filtered));

  applyAndRender();
}

function exportCsv(config, rows) {
  const headers = config.columns.map((c) => c.label);
  const lines = [headers.join(",")];
  for (const r of rows) {
    const cells = config.columns.map((c) => {
      const v = c.value ? c.value(r) : "";
      return `"${String(v).replace(/"/g, '""')}"`;
    });
    lines.push(cells.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: `esma-${config.file}-export.csv` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --------------------------------------------------------------------------
// Detail overlay
// --------------------------------------------------------------------------

function ensureOverlay() {
  let overlay = document.getElementById("detail-overlay");
  if (overlay) return overlay;
  overlay = el("div", { class: "overlay", id: "detail-overlay" });
  const panel = el("div", { class: "detail" });
  panel.appendChild(el("button", { class: "detail__close", type: "button", "aria-label": "Sluiten" }, "&times;"));
  panel.appendChild(el("h2", { id: "detail-title" }));
  panel.appendChild(el("div", { class: "detail__meta", id: "detail-meta" }));
  panel.appendChild(el("div", { id: "detail-body" }));
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDetail(); });
  panel.querySelector(".detail__close").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });
  return overlay;
}

function openDetail(config, record) {
  const overlay = ensureOverlay();
  overlay.querySelector("#detail-title").textContent = record.commercial_name || record.name || "Details";
  overlay.querySelector("#detail-meta").textContent = config.label;
  overlay.querySelector("#detail-body").innerHTML = config.detail(record);
  overlay.classList.add("open");
}

function closeDetail() {
  const overlay = document.getElementById("detail-overlay");
  if (overlay) overlay.classList.remove("open");
}

// --------------------------------------------------------------------------
// Shared page chrome
// --------------------------------------------------------------------------

function highlightNav(current) {
  document.querySelectorAll(".topnav__links a").forEach((a) => {
    if (a.dataset.nav === current) a.classList.add("active");
  });
}
