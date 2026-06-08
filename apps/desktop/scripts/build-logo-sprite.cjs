/**
 * Reconstruct a clean low-res pixel sprite (SVG of <rect>s) from the high-res,
 * anti-aliased brand PNG so we can animate it part-by-part (Claude-mascot style).
 *
 * The source PNG (modus-logo.png) is LEFT UNTOUCHED — it stays the canonical
 * logo used across the app. This tool only EMITS a new vector asset + a matrix.
 *
 * Pipeline:
 *   1. Decode the 8-bit palette PNG (zlib inflate + PNG unfilter).
 *   2. Downsample to an N×N grid by majority-opaque vote per block.
 *   3. k-means the opaque cell colors into a tiny design palette, snap cells.
 *   4. Greedy-merge same-color cells into rectangles (Aseprite-style meshing).
 *   5. Emit an SVG (viewBox 0 0 N N, crispEdges), rects tagged with grid coords
 *      and pre-bucketed into <g> regions (eyes / body / legs) for easy hand-grouping.
 *
 * Usage:  node apps/desktop/scripts/build-logo-sprite.cjs [N]
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ASSET_DIR = path.join(__dirname, "../src/renderer/src/assets");
const SRC_PNG = path.join(ASSET_DIR, "modus-logo.png");

/* ── 1. Decode 8-bit palette PNG ─────────────────────────────────────── */
function decodePalettePng(file) {
  const buf = fs.readFileSync(file);
  let p = 8;
  let width = 0,
    height = 0;
  const palette = [];
  const trns = [];
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "PLTE") {
      for (let i = 0; i < data.length; i += 3) palette.push([data[i], data[i + 1], data[i + 2]]);
    } else if (type === "tRNS") {
      for (let i = 0; i < data.length; i++) trns[i] = data[i];
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width;
  const idx = Buffer.alloc(width * height);
  const paeth = (a, b, c) => {
    const pp = a + b - c;
    const pa = Math.abs(pp - a),
      pb = Math.abs(pp - b),
      pc = Math.abs(pp - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let q = 0;
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[q++];
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const rb = raw[q++];
      const a = x >= 1 ? cur[x - 1] : 0;
      const b = prev[x];
      const c = x >= 1 ? prev[x - 1] : 0;
      let v;
      switch (f) {
        case 1:
          v = rb + a;
          break;
        case 2:
          v = rb + b;
          break;
        case 3:
          v = rb + ((a + b) >> 1);
          break;
        case 4:
          v = rb + paeth(a, b, c);
          break;
        default:
          v = rb;
      }
      cur[x] = v & 0xff;
    }
    cur.copy(idx, y * width);
    cur.copy(prev);
  }
  return { width, height, palette, trns, idx };
}

/* ── 2. Downsample to N×N by majority-opaque vote ────────────────────── */
function downsample(img, N) {
  const { width, palette, trns, idx } = img;
  const B = width / N;
  const alphaOf = (pi) => (trns[pi] === undefined ? 255 : trns[pi]);
  const cells = []; // cells[gy][gx] = [r,g,b] | null
  for (let gy = 0; gy < N; gy++) {
    const row = [];
    for (let gx = 0; gx < N; gx++) {
      const tally = new Map();
      let opaque = 0;
      let total = 0;
      for (let yy = 0; yy < B; yy++) {
        const base = (gy * B + yy) * width + gx * B;
        for (let xx = 0; xx < B; xx++) {
          const pi = idx[base + xx];
          total++;
          if (alphaOf(pi) >= 128) {
            opaque++;
            tally.set(pi, (tally.get(pi) || 0) + 1);
          }
        }
      }
      if (opaque * 2 < total) {
        row.push(null);
        continue;
      }
      let best = -1,
        bc = -1;
      for (const [k, v] of tally)
        if (v > bc) {
          bc = v;
          best = k;
        }
      row.push(palette[best].slice());
    }
    cells.push(row);
  }
  return cells;
}

/* ── 3. k-means colour quantisation ──────────────────────────────────── */
function quantise(cells, K) {
  const pts = [];
  for (const row of cells) for (const c of row) if (c) pts.push(c);
  // seed: K most-distinct frequent colours
  const seeds = [pts[0]];
  while (seeds.length < K) {
    let far = null,
      farD = -1;
    for (const c of pts) {
      let d = Infinity;
      for (const s of seeds) d = Math.min(d, dist2(c, s));
      if (d > farD) {
        farD = d;
        far = c;
      }
    }
    seeds.push(far.slice());
  }
  let cent = seeds.map((s) => s.slice());
  for (let iter = 0; iter < 12; iter++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (const c of pts) {
      let bi = 0,
        bd = Infinity;
      for (let i = 0; i < cent.length; i++) {
        const d = dist2(c, cent[i]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      sum[bi][0] += c[0];
      sum[bi][1] += c[1];
      sum[bi][2] += c[2];
      sum[bi][3]++;
    }
    cent = sum.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cent[i]));
  }
  cent = cent.map((c) => c.map(Math.round));
  // snap
  const snapped = cells.map((row) =>
    row.map((c) => {
      if (!c) return null;
      let bi = 0,
        bd = Infinity;
      for (let i = 0; i < cent.length; i++) {
        const d = dist2(c, cent[i]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      return bi;
    }),
  );
  return { centroids: cent, snapped };
}
function dist2(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
const hex = (c) =>
  `#${c.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("")}`;

/* ── 4a. Label cells into semantic parts via per-row run signature ─────
 * The silhouette is one connected blob, so a naive greedy mesh makes tall
 * strips that straddle eyes/body/legs. Instead we read the structure: count
 * horizontal runs per row — 2 runs = the two top nubs (eyes), 1 run = the
 * body bar, 3 runs = the legs. Consecutive rows with the same run-count form
 * a band; each run in a band becomes a named part (eye-l/eye-r, body,
 * leg-1/2/3). Greedy merge is then constrained to never cross a part. */
function rowRuns(snapped, y, N) {
  const runs = [];
  let start = -1;
  for (let x = 0; x <= N; x++) {
    const filled = x < N && snapped[y][x] != null;
    if (filled && start < 0) start = x;
    else if (!filled && start >= 0) {
      if (x - start >= 2) runs.push([start, x - 1]); // ignore 1px noise for signature
      start = -1;
    }
  }
  return runs;
}
function labelParts(snapped, N) {
  const label = Array.from({ length: N }, () => new Array(N).fill(null));
  // group consecutive rows by run-count into bands
  const bands = [];
  let cur = null;
  for (let y = 0; y < N; y++) {
    const runs = rowRuns(snapped, y, N);
    if (runs.length === 0) {
      cur = null;
      continue;
    }
    if (cur && cur.count === runs.length) cur.rows.push(y);
    else {
      cur = { count: runs.length, rows: [y] };
      bands.push(cur);
    }
  }
  const roleFor = (count) =>
    count === 2 ? "eye" : count === 1 ? "body" : count === 3 ? "leg" : "part";
  const order = [];
  for (const band of bands) {
    const role = roleFor(band.count);
    // collect column windows for each run index across the band (union)
    const wins = [];
    for (const y of band.rows) {
      rowRuns(snapped, y, N).forEach((r, i) => {
        wins[i] = wins[i] ? [Math.min(wins[i][0], r[0]), Math.max(wins[i][1], r[1])] : r.slice();
      });
    }
    wins.forEach((w, i) => {
      const suffix =
        band.count === 2 ? ["l", "r"][i] : band.count === 3 ? ["1", "2", "3"][i] : String(i + 1);
      const id = band.count === 1 ? role : `${role}-${suffix ?? i + 1}`;
      const partId = order.includes(id) ? `${id}-${order.length}` : id;
      order.push(partId);
      for (const y of band.rows) {
        for (let x = 0; x < N; x++) {
          if (snapped[y][x] != null && x >= w[0] - 1 && x <= w[1] + 1) label[y][x] = partId;
        }
      }
    });
  }
  // any unlabeled filled cell (noise) -> nearest part on its row, else "body"
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      if (snapped[y][x] != null && label[y][x] == null) label[y][x] = "body";
  return { label, order };
}

/* ── 4b. Greedy rectangle merge, constrained to one part + one colour ── */
function mergeRects(snapped, label, N) {
  const seen = Array.from({ length: N }, () => new Array(N).fill(false));
  const rects = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const ci = snapped[y][x];
      if (ci == null || seen[y][x]) continue;
      const part = label[y][x];
      let w = 1;
      while (x + w < N && snapped[y][x + w] === ci && !seen[y][x + w] && label[y][x + w] === part)
        w++;
      let h = 1;
      grow: while (y + h < N) {
        for (let k = 0; k < w; k++) {
          if (snapped[y + h][x + k] !== ci || seen[y + h][x + k] || label[y + h][x + k] !== part)
            break grow;
        }
        h++;
      }
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) seen[y + yy][x + xx] = true;
      rects.push({ x, y, w, h, ci, part });
    }
  }
  return rects;
}

/* ── 5. Emit SVG grouped by semantic part ────────────────────────────── */
function buildSvg(rects, centroids, order, N) {
  const rectLine = (r) =>
    `      <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${hex(centroids[r.ci])}"/>`;
  const groups = order.map((id) => {
    const rs = rects.filter((r) => r.part === id);
    return `    <g id="${id}">\n${rs.map(rectLine).join("\n")}\n    </g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges" role="img" aria-label="Modus">
  <!-- Auto-generated from modus-logo.png by scripts/build-logo-sprite.cjs.
       Parts are segmented from the silhouette's per-row run signature
       (2 runs = eyes, 1 = body, 3 = legs). Refine groups/anchors by hand,
       then animate each <g> with motion (transform-only, GPU-composited). -->
  <g id="modus-bot">
${groups.join("\n")}
  </g>
</svg>
`;
}

/* ── ASCII colour map (one char per centroid) ────────────────────────── */
function asciiMap(snapped, _N) {
  const glyphs = "#@%*+=:.";
  return snapped
    .map((row) => row.map((c) => (c == null ? " " : (glyphs[c] ?? "?"))).join(""))
    .join("\n");
}

/* ── Run ─────────────────────────────────────────────────────────────── */
const img = decodePalettePng(SRC_PNG);
const N = Number(process.argv[2]) || 32;
const K = Number(process.argv[3]) || 4;
const cells = downsample(img, N);
const { centroids, snapped } = quantise(cells, K);
const { label, order } = labelParts(snapped, N);
const rects = mergeRects(snapped, label, N);
const svg = buildSvg(rects, centroids, order, N);

console.log(`grid ${N}x${N}, K=${K}`);
console.log(`palette: ${centroids.map(hex).join("  ")}`);
console.log(`parts: ${order.join(", ")}`);
console.log(`rects after merge: ${rects.length}`);
console.log("\nASCII colour map (glyph per palette index):\n");
console.log(asciiMap(snapped, N));

const outSvg = path.join(ASSET_DIR, "modus-logo.svg");
const outJson = path.join(ASSET_DIR, "modus-logo.sprite.json");
fs.writeFileSync(outSvg, svg, "utf8");
fs.writeFileSync(
  outJson,
  `${JSON.stringify({ grid: N, palette: centroids.map(hex), cells: snapped }, null, 0)}\n`,
  "utf8",
);
console.log(`\nwrote ${path.relative(process.cwd(), outSvg)}`);
console.log(`wrote ${path.relative(process.cwd(), outJson)}`);
