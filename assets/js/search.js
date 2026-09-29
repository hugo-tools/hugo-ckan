// Client-side replacement for CKAN's Solr-backed /dataset/ search.
// Understands CKAN's own URL parameters, so links like
// /dataset/?tags=x&res_format=CSV&organization=y keep working.
import * as params from "@params";

const PAGE = 20;
const FACETS = [
  // [url param, index field, label, lookup table in index]
  ["organization", "o", "Organizations", "orgs"],
  ["groups", "g", "Groups", "groups"],
  ["tags", "k", "Tags", null],
  ["res_format", "f", "Formats", null],
  ["license_id", "l", "Licenses", "licenses"],
];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

let db;
const state = { q: "", sort: "score", page: 1, filters: {}, expanded: {} };

function readURL() {
  const u = new URLSearchParams(location.search);
  state.q = u.get("q") || "";
  state.sort = u.get("sort") || (state.q ? "score" : "name");
  state.page = Math.max(1, parseInt(u.get("page") || "1", 10));
  state.filters = {};
  for (const [p] of FACETS) {
    const vals = u.getAll(p);
    if (vals.length) state.filters[p] = vals;
  }
}

function writeURL() {
  const u = new URLSearchParams();
  if (state.q) u.set("q", state.q);
  for (const [p, vals] of Object.entries(state.filters)) vals.forEach((v) => u.append(p, v));
  if (state.sort !== (state.q ? "score" : "name")) u.set("sort", state.sort);
  if (state.page > 1) u.set("page", state.page);
  const qs = u.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
}

function score(d, terms) {
  let total = 0;
  for (const t of terms) {
    let s = 0;
    if (d._t.includes(t)) s += 5;
    if (d._k.some((k) => k.includes(t))) s += 3;
    if (d._n.includes(t)) s += 2;
    if (d._d.includes(t)) s += 1;
    if (!s) return 0; // every term must match somewhere (AND), like CKAN's default q.op
    total += s;
  }
  return total;
}

function matchesFilters(d, skip) {
  for (const [p, field] of FACETS) {
    if (p === skip) continue;
    const want = state.filters[p];
    if (!want) continue;
    const have = asList(d[field]).map(fold);
    if (!want.every((v) => have.includes(fold(v)))) return false;
  }
  return true;
}

function run() {
  const terms = fold(state.q).split(/\s+/).filter(Boolean);
  let hits = [];
  for (const d of db.datasets) {
    const s = terms.length ? score(d, terms) : 1;
    if (s && matchesFilters(d)) hits.push([s, d]);
  }
  const by = {
    score: (a, b) => b[0] - a[0] || a[1].t.localeCompare(b[1].t),
    name: (a, b) => a[1].t.localeCompare(b[1].t),
    "metadata_modified desc": (a, b) => b[1].m.localeCompare(a[1].m),
  }[state.sort] || ((a, b) => a[1].t.localeCompare(b[1].t));
  hits.sort(by);
  return hits.map((h) => h[1]);
}

function facetCounts(hits) {
  const out = {};
  for (const [p, field] of FACETS) {
    const counts = new Map();
    for (const d of hits) for (const v of asList(d[field])) counts.set(v, (counts.get(v) || 0) + 1);
    out[p] = [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0]));
  }
  return out;
}

const label = (table, v) => (table && db[table] && db[table][v]) || v;

function renderFacets(hits) {
  const counts = facetCounts(hits);
  $("#facets").innerHTML = FACETS.map(([p, , title, table]) => {
    const items = counts[p];
    if (!items.length) return "";
    const active = state.filters[p] || [];
    const shown = state.expanded[p] ? items : items.slice(0, 10);
    return `<div class="card facet"><h4>${title}</h4><ul>${shown
      .map(([v, n]) => {
        const on = active.some((a) => fold(a) === fold(v));
        return `<li><a href="#" data-facet="${p}" data-value="${esc(v)}" class="${on ? "active" : ""}">
          <span>${esc(label(table, v))}</span><span class="n">${n}</span></a></li>`;
      })
      .join("")}</ul>${
      items.length > 10
        ? `<button class="more" data-more="${p}">${state.expanded[p] ? "Show less" : `Show all ${items.length}`}</button>`
        : ""
    }</div>`;
  }).join("");
}

function renderResults(hits) {
  const n = hits.length;
  $("#count").innerHTML = `<b>${n.toLocaleString()}</b> dataset${n === 1 ? "" : "s"} found${
    state.q ? ` for “${esc(state.q)}”` : ""
  }`;
  const pages = Math.max(1, Math.ceil(n / PAGE));
  state.page = Math.min(state.page, pages);
  const slice = hits.slice((state.page - 1) * PAGE, state.page * PAGE);
  $("#results").innerHTML =
    slice
      .map(
        (d) => `<li class="dataset-item">
      <h3><a href="${d.u}">${esc(d.t)}</a></h3>
      <div class="small muted">${d.o ? esc(label("orgs", d.o)) + " · " : ""}updated ${d.m}</div>
      ${d.d ? `<p>${esc(d.d)}</p>` : ""}
      <div class="badges">${d.f.map((f) => `<span class="badge" data-format="${esc(f)}">${esc(f)}</span>`).join("")}</div>
    </li>`
      )
      .join("") || `<li class="muted">No datasets match. Try removing a filter.</li>`;

  let pager = "";
  if (pages > 1) {
    const btn = (p, text = p) =>
      p === state.page ? `<li><span class="current">${text}</span></li>` : `<li><a href="#" data-page="${p}">${text}</a></li>`;
    const nums = [...new Set([1, 2, state.page - 1, state.page, state.page + 1, pages - 1, pages])]
      .filter((p) => p >= 1 && p <= pages)
      .sort((a, b) => a - b);
    let prev = 0;
    for (const p of nums) {
      if (p - prev > 1) pager += `<li><span>…</span></li>`;
      pager += btn(p);
      prev = p;
    }
    if (state.page > 1) pager = btn(state.page - 1, "‹ Prev") + pager;
    if (state.page < pages) pager += btn(state.page + 1, "Next ›");
  }
  $("#pager").innerHTML = `<ul class="pager">${pager}</ul>`;

  const chips = [];
  for (const [p, , , table] of FACETS)
    for (const v of state.filters[p] || [])
      chips.push(`<a href="#" data-facet="${p}" data-value="${esc(v)}">${esc(label(table, v))} ✕</a>`);
  $("#active-filters").innerHTML = chips.join("");
}

function render() {
  const hits = run();
  renderFacets(hits);
  renderResults(hits);
  writeURL();
}

function toggle(p, v) {
  const cur = state.filters[p] || [];
  const next = cur.some((a) => fold(a) === fold(v)) ? cur.filter((a) => fold(a) !== fold(v)) : [...cur, v];
  if (next.length) state.filters[p] = next;
  else delete state.filters[p];
  state.page = 1;
}

async function init() {
  readURL();
  $("#q").value = state.q;
  $("#sort").value = state.sort;
  const res = await fetch(params.index);
  db = await res.json();
  for (const d of db.datasets) {
    d._t = fold(d.t);
    d._n = fold(d.n);
    d._d = fold(d.d);
    d._k = d.k.map(fold);
  }
  render();

  let timer;
  $("#q").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const had = !!state.q;
      state.q = $("#q").value.trim();
      if (!had && state.q && state.sort === "name") state.sort = $("#sort").value = "score";
      state.page = 1;
      render();
    }, 150);
  });
  $("#search-form").addEventListener("submit", (e) => e.preventDefault());
  $("#sort").addEventListener("change", () => {
    state.sort = $("#sort").value;
    render();
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-facet],[data-page],[data-more]");
    if (!a) return;
    e.preventDefault();
    if (a.dataset.facet) toggle(a.dataset.facet, a.dataset.value);
    else if (a.dataset.page) {
      state.page = +a.dataset.page;
      scrollTo({ top: 0 });
    } else state.expanded[a.dataset.more] = !state.expanded[a.dataset.more];
    render();
  });
}

init().catch((err) => {
  $("#count").textContent = "Search index failed to load; showing the full list instead.";
  console.error(err);
});
