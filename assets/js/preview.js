// Resource preview: CKAN's server-side "views" re-done in the browser.
// Prefers the source portal's DataStore API when the resource has one;
// otherwise fetches the file itself (works when the host sends CORS headers).
const MAX_BYTES = 2_000_000;
const MAX_ROWS = 200;
const el = document.getElementById("preview");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const note = (html) => (el.innerHTML = `<p class="muted">${html}</p>`);

function table(fields, rows, total) {
  el.innerHTML = `<p class="small muted">Showing ${rows.length.toLocaleString()}${
    total ? ` of ${total.toLocaleString()}` : ""} rows</p>
  <div class="table-wrap"><table><thead><tr>${fields.map((f) => `<th>${esc(f)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function parseCSV(text) {
  const firstLine = text.slice(0, text.indexOf("\n"));
  const sep = [";", ",", "\t", "|"].reduce((a, b) => (firstLine.split(b).length > firstLine.split(a).length ? b : a));
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length && rows.length <= MAX_ROWS; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0]);
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = +res.headers.get("content-length");
  if (len > MAX_BYTES * 5) throw new Error(`file is ${(len / 1e6).toFixed(1)} MB, too large to preview`);
  const text = await res.text();
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function loadLeaflet() {
  const v = "1.9.4";
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${v}/leaflet.min.css`;
  document.head.append(css);
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${v}/leaflet.min.js`;
    s.onload = () => ok(window.L);
    s.onerror = fail;
    document.head.append(s);
  });
}

async function geojson(url) {
  const [data, L] = await Promise.all([fetchText(url).then(JSON.parse), loadLeaflet()]);
  el.innerHTML = `<div id="map"></div>`;
  const map = L.map("map");
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap contributors",
  }).addTo(map);
  const layer = L.geoJSON(data, {
    pointToLayer: (_, ll) => L.circleMarker(ll, { radius: 5, weight: 1 }),
    onEachFeature: (f, l) => f.properties && l.bindPopup(
      `<table>${Object.entries(f.properties).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`),
  }).addTo(map);
  map.fitBounds(layer.getBounds(), { maxZoom: 16 });
}

async function main() {
  const { url, format, datastore } = el.dataset;
  if (datastore) {
    try {
      const res = await (await fetch(datastore)).json();
      const fields = res.result.fields.map((f) => f.id).filter((f) => f !== "_id");
      return table(fields, res.result.records.map((r) => fields.map((f) => r[f])), res.result.total);
    } catch { /* fall through to fetching the file */ }
  }
  const fmt = format || (url.match(/\.(\w+)(\?|$)/)?.[1] ?? "").toLowerCase();
  if (fmt === "geojson") return geojson(url);
  if (fmt === "csv" || fmt === "tsv") {
    const rows = parseCSV(await fetchText(url));
    return table(rows[0] || [], rows.slice(1, MAX_ROWS + 1));
  }
  if (fmt === "json") {
    const text = await fetchText(url);
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch {}
    return (el.innerHTML = `<pre>${esc(pretty.slice(0, 100_000))}${pretty.length > 100_000 ? "\n…" : ""}</pre>`);
  }
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(fmt))
    return (el.innerHTML = `<img src="${esc(url)}" alt="">`);
  note(`No preview available for ${esc(fmt.toUpperCase() || "this")} resources. Use the download link above.`);
}

main().catch((e) => note(`Preview unavailable (${esc(e.message)}). The file's host may not allow
  cross-origin requests; use the download link above.`));
