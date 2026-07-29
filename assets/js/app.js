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

function countryName(code) {
  if (!code) return "—";
  const c = code.trim().toUpperCase();
  return COUNTRY_NAMES[c] ? `${COUNTRY_NAMES[c]} (${c})` : c;
}

function cleanServiceLabel(s) {
  if (!s) return "";
  return s.replace(/^\s*[a-j]\.\s*/i, "").trim().replace(/^./, (c) => c.toUpperCase());
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
  }) + " UTC".replace("UTC", ""); // iso is already UTC; toLocaleString uses browser tz
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
// Register configuration — one entry per data/<key>.json file.
// --------------------------------------------------------------------------

const REGISTERS = {
  casps: {
    label: "Crypto-asset service providers",
    shortLabel: "CASPs",
    file: "casps",
    searchFields: (r) => [r.name, r.commercial_name, r.lei, r.website],
    columns: [
      { key: "name", label: "Naam", value: (r) => r.commercial_name || r.name || "—" },
      { key: "lei", label: "LEI", value: (r) => r.lei || "—" },
      { key: "country", label: "Land", value: (r) => countryName(r.home_member_state) },
      {
        key: "services", label: "Diensten",
        value: (r) => (r.services || []).map((s) => cleanServiceLabel(s.service)).join(", ") || "—",
        sortValue: (r) => (r.services || []).length, wrap: true,
      },
      {
        key: "authorisation_date", label: "Datum autorisatie",
        value: (r) => r.authorisation_date || "—", sortValue: (r) => parseEsmaDate(r.authorisation_date),
      },
      { key: "status", label: "Status", render: (r) => statusBadge(r.status), sortValue: (r) => r.status },
    ],
    filters: [
      { key: "home_member_state", label: "Lidstaat", type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName },
      { key: "status", label: "Status", type: "select", valueFn: (r) => r.status, formatFn: (v) => (v === "active" ? "Actief" : v === "withdrawn" ? "Ingetrokken" : v) },
      {
        key: "service", label: "Dienst", type: "select",
        valueFn: (r) => (r.services || []).map((s) => cleanServiceLabel(s.service)),
        multi: true,
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
    ], "Diensten", (r.services || []).map((s) =>
      `${cleanServiceLabel(s.service)}${s.countries?.length ? ` — ${s.countries.join(", ")}` : ""}${s.comments ? `<br><em>${escapeHtml(s.comments)}</em>` : ""}`
    )),
  },

  art: {
    label: "Uitgevers van asset-referenced tokens (ART)",
    shortLabel: "ART-uitgevers",
    file: "art",
    searchFields: (r) => [r.name, r.commercial_name, r.lei, r.website],
    columns: [
      { key: "name", label: "Naam", value: (r) => r.commercial_name || r.name || "—" },
      { key: "lei", label: "LEI", value: (r) => r.lei || "—" },
      { key: "country", label: "Land", value: (r) => countryName(r.home_member_state) },
      { key: "credit_institution", label: "Kredietinstelling", value: (r) => r.credit_institution || "—" },
      {
        key: "whitepapers", label: "Whitepapers",
        value: (r) => `${(r.whitepapers || []).length}`, sortValue: (r) => (r.whitepapers || []).length,
      },
      { key: "authorisation_date", label: "Datum autorisatie", value: (r) => r.authorisation_date || "—", sortValue: (r) => parseEsmaDate(r.authorisation_date) },
      { key: "status", label: "Status", render: (r) => statusBadge(r.status), sortValue: (r) => r.status },
    ],
    filters: [
      { key: "home_member_state", label: "Lidstaat", type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName },
      { key: "status", label: "Status", type: "select", valueFn: (r) => r.status, formatFn: (v) => (v === "active" ? "Actief" : v === "withdrawn" ? "Ingetrokken" : v) },
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
    searchFields: (r) => [r.name, r.commercial_name, r.lei, r.website],
    columns: [
      { key: "name", label: "Naam", value: (r) => r.commercial_name || r.name || "—" },
      { key: "lei", label: "LEI", value: (r) => r.lei || "—" },
      { key: "country", label: "Land", value: (r) => countryName(r.home_member_state) },
      { key: "institution_type", label: "Type instelling", value: (r) => r.institution_type || "—" },
      {
        key: "whitepapers", label: "Whitepapers",
        value: (r) => `${(r.whitepapers || []).length}`, sortValue: (r) => (r.whitepapers || []).length,
      },
      { key: "authorisation_date", label: "Datum autorisatie", value: (r) => r.authorisation_date || "—", sortValue: (r) => parseEsmaDate(r.authorisation_date) },
      { key: "status", label: "Status", render: (r) => statusBadge(r.status), sortValue: (r) => r.status },
    ],
    filters: [
      { key: "home_member_state", label: "Lidstaat", type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName },
      { key: "institution_type", label: "Type instelling", type: "select", valueFn: (r) => r.institution_type },
      { key: "status", label: "Status", type: "select", valueFn: (r) => r.status, formatFn: (v) => (v === "active" ? "Actief" : v === "withdrawn" ? "Ingetrokken" : v) },
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
    searchFields: (r) => [r.name, r.lei],
    columns: [
      { key: "name", label: "Naam issuer/aanbieder", value: (r) => r.name || "—" },
      { key: "lei", label: "LEI", value: (r) => r.lei || "—" },
      { key: "country", label: "Land", value: (r) => countryName(r.home_member_state) },
      {
        key: "casp", label: "Betrokken CASP",
        value: (r) => (r.whitepapers || []).find((w) => w.casp_name)?.casp_name || "—",
      },
      {
        key: "whitepapers", label: "Whitepapers",
        value: (r) => `${(r.whitepapers || []).length}`, sortValue: (r) => (r.whitepapers || []).length,
      },
    ],
    filters: [
      { key: "home_member_state", label: "Lidstaat", type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName },
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
    searchFields: (r) => [r.name, r.lei, r.website],
    columns: [
      { key: "name", label: "Naam", value: (r) => r.name || "—" },
      { key: "country", label: "Land", value: (r) => countryName(r.home_member_state) },
      { key: "competent_authority", label: "Bevoegde autoriteit", value: (r) => r.competent_authority || "—", wrap: true },
      { key: "reason", label: "Reden", value: (r) => r.reason || "—", wrap: true },
      { key: "decision_date", label: "Besluitdatum", value: (r) => r.decision_date || "—", sortValue: (r) => parseEsmaDate(r.decision_date) },
    ],
    filters: [
      { key: "home_member_state", label: "Lidstaat", type: "select", valueFn: (r) => r.home_member_state, formatFn: countryName },
      { key: "competent_authority", label: "Bevoegde autoriteit", type: "select", valueFn: (r) => r.competent_authority },
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

  const toolbar = el("div", { class: "toolbar" });
  const searchInput = el("input", { type: "search", placeholder: "Zoek op naam, LEI, website…" });
  toolbar.appendChild(searchInput);

  const filterState = {};
  for (const f of config.filters || []) {
    let options;
    if (f.multi) {
      options = [...new Set(records.flatMap((r) => f.valueFn(r) || []))].sort();
    } else {
      options = [...new Set(records.map((r) => f.valueFn(r)).filter(Boolean))].sort();
    }
    const select = el("select", { "data-key": f.key });
    select.appendChild(el("option", { value: "" }, `${f.label}: alle`));
    for (const opt of options) {
      select.appendChild(el("option", { value: opt }, f.formatFn ? escapeHtml(f.formatFn(opt)) : escapeHtml(opt)));
    }
    select.addEventListener("change", () => {
      activeFilters[f.key] = select.value || null;
      applyAndRender();
    });
    filterState[f.key] = select;
    toolbar.appendChild(select);
  }

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
      for (const f of config.filters || []) {
        const wanted = activeFilters[f.key];
        if (!wanted) continue;
        const val = f.valueFn(r);
        if (f.multi) {
          if (!(val || []).includes(wanted)) return false;
        } else if (val !== wanted) return false;
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
          const td = el("td", col.wrap ? { class: "wrap-cell" } : {});
          td.innerHTML = col.render ? col.render(r) : escapeHtml(col.value(r));
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
