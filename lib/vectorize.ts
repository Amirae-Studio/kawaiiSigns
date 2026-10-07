import type { FrameResult, Layer, ParsedSvg } from "./types";

export type Shape = "original" | "square" | "circle";
export interface Swatch { rgb: [number, number, number]; share: number }
const S = 640;
const MIN_SHARE_MAIN = 0.008;  // Main mode: >0.8% coverage required
const MIN_SHARE_DEEP = 0.003;  // Deep mode: >0.3% — keeps smaller distinct regions
const hexOf = (r: number, g: number, b: number) => "#" + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
export const rgbHex = (c: number[]) => hexOf(c[0], c[1], c[2]);
const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export interface Crop { x: number; y: number; s: number }
/** Default crop = the WHOLE image fits inside (nothing is cut). */
export const defaultCrop = (b: ImageBitmap, shape: Shape): Crop | null => {
  if (shape === "original") return null;
  const s = shape === "circle" ? Math.hypot(b.width, b.height) : Math.max(b.width, b.height);
  return { s, x: (b.width - s) / 2, y: (b.height - s) / 2 };
};
export function bitmapUrl(b: ImageBitmap) {
  const k = Math.min(1, 1024 / Math.max(b.width, b.height)), c = document.createElement("canvas");
  c.width = Math.round(b.width * k); c.height = Math.round(b.height * k);
  c.getContext("2d")!.drawImage(b, 0, 0, c.width, c.height); return c.toDataURL();
}

/** Apply the user's crop box (square/circle) or keep the whole image (original); optionally cut the background. */
export function frameImage(bmp: ImageBitmap, shape: Shape, crop: Crop | null, cut: boolean, tol: number): ImageData {
  const k = crop ? S / crop.s : S / Math.max(bmp.width, bmp.height);
  const w = crop ? S : Math.round(bmp.width * k), h = crop ? S : Math.round(bmp.height * k);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  if (crop && shape === "circle") { ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2, 0, 7); ctx.clip(); }
  if (crop) ctx.drawImage(bmp, -crop.x * k, -crop.y * k, bmp.width * k, bmp.height * k);
  else ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] < 128 ? 0 : 255;
  return cut ? cutBackground(img, tol) : img;
}

/** Background = dominant colour along the visible border; flood-fill it away, then trim the fringe. */
function cutBackground(src: ImageData, tol: number): ImageData {
  const { width: w, height: h } = src;
  const out = new ImageData(new Uint8ClampedArray(src.data), w, h), d = out.data;
  const op = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0;
  const border = (p: number) => { const x = p % w, y = (p - x) / w; return !(op(x - 1, y) && op(x + 1, y) && op(x, y - 1) && op(x, y + 1)); };
  const seeds: number[] = [], votes = new Map<number, number>();
  for (let p = 0; p < w * h; p++) if (d[p * 4 + 3] && border(p)) {
    seeds.push(p); const k = ((d[p * 4] >> 4) << 8) | ((d[p * 4 + 1] >> 4) << 4) | (d[p * 4 + 2] >> 4);
    votes.set(k, (votes.get(k) ?? 0) + 1);
  }
  if (!seeds.length) return out;
  const top = [...votes].sort((a, b) => b[1] - a[1])[0][0];
  const bg = [(top >> 8) * 16 + 8, ((top >> 4) & 15) * 16 + 8, (top & 15) * 16 + 8];
  const near = (p: number) => d[p * 4 + 3] > 0 && Math.hypot(d[p * 4] - bg[0], d[p * 4 + 1] - bg[1], d[p * 4 + 2] - bg[2]) < tol;
  const seen = new Uint8Array(w * h), stack: number[] = [];
  const push = (p: number) => { if (!seen[p] && near(p)) { seen[p] = 1; stack.push(p); } };
  seeds.forEach(push);
  while (stack.length) {
    const p = stack.pop()!, x = p % w;
    d[p * 4 + 3] = 0;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (p >= w) push(p - w); if (p < w * (h - 1)) push(p + w);
  }
  const fringe: number[] = [];
  for (let p = 0; p < w * h; p++) if (d[p * 4 + 3] && border(p)) fringe.push(p);
  fringe.forEach((p) => (d[p * 4 + 3] = 0));
  return out;
}

/**
 * Pick up to n distinct dominant colours (histogram + k-means).
 *
 * tight=false  (Main mode)  – original thresholds: merges two similar reds/greens into one,
 *                              gives clean colour boundaries with few palette entries.
 * tight=true   (Deep mode)  – fine 128-level quantisation, tiny MERGE_DIST: every visually
 *                              distinct shade survives as its own palette entry.
 */
export function buildPalette(img: ImageData, n: number, tight = false): Swatch[] {
  const d = img.data, w = img.width, ht = img.height;
  const MIN_SH   = tight ? MIN_SHARE_DEEP : MIN_SHARE_MAIN;
  const SEED_D   = tight ? 18 : 90;   // min RGB distance between two seed candidates
  const MERGE_D  = tight ? 18 : 70;   // post-kmeans dedup distance

  // Only flat-colour pixels update k-means centroids: anti-aliased / JPEG edge pixels
  // would invent muddy in-between colours if included.
  const flat = new Uint8Array(w * ht);
  for (let y = 0; y < ht; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (!d[i + 3]) continue;
    let ok = 1;
    for (const j of [x < w - 1 ? i + 4 : -1, y < ht - 1 ? i + w * 4 : -1]) if (j >= 0 && d[j + 3] && Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]) > 60) ok = 0;
    flat[i >> 2] = ok;
  }

  // Seeding histogram.
  // Main (>>3): 32 levels/channel = 8-unit bins — fast, enough for well-separated colours.
  // Deep (>>1): 128 levels/channel = 2-unit bins — distinguishes two reds ~20 units apart.
  const seedHist = new Map<number, number>();
  if (tight) {
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      // 7 bits per channel packed into 21 bits
      const k = ((d[i] >> 1) << 14) | ((d[i + 1] >> 1) << 7) | (d[i + 2] >> 1);
      seedHist.set(k, (seedHist.get(k) ?? 0) + 1);
    }
  } else {
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      seedHist.set(k, (seedHist.get(k) ?? 0) + 1);
    }
  }
  const cols = tight
    ? [...seedHist].sort((a, b) => b[1] - a[1]).map(([k]) => [(k >> 14) * 2 + 1, ((k >> 7) & 0x7f) * 2 + 1, (k & 0x7f) * 2 + 1])
    : [...seedHist].sort((a, b) => b[1] - a[1]).map(([k]) => [(k >> 10) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4]);

  let pal: number[][] = [];
  for (const c of cols) { if (pal.length >= n) break; if (pal.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > SEED_D)) pal.push(c); }

  // k-means centroid updates on flat pixels only — keeps centroids on pure interior colours.
  let count: number[] = [];
  for (let round = 0; round < 4; round++) {
    for (let it = 0; it < 3; it++) {
      const sum = pal.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < d.length; i += 4) if (flat[i >> 2]) { const j = nearest(pal, d, i); sum[j][0] += d[i]; sum[j][1] += d[i + 1]; sum[j][2] += d[i + 2]; sum[j][3]++; }
      pal = pal.map((p, j) => (sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : p));
      count = sum.map((x) => x[3]);
    }
    const flatTot = count.reduce((x, y) => x + y, 0) || 1;
    const keep = pal.map((_, j) => j).filter((j) => count[j] / flatTot >= MIN_SH);
    if (keep.length === pal.length || keep.length === 0 || round === 3) break;
    pal = keep.map((j) => pal[j]);
  }

  // Recompute final shares from ALL opaque pixels so small regions that have
  // few flat pixels (e.g. a small star) get their true proportional share.
  const allCount = new Array(pal.length).fill(0) as number[];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    allCount[nearest(pal, d, i)]++;
  }
  const allTot = allCount.reduce((a, b) => a + b, 0) || 1;

  // Post k-means dedup: centroids can drift together after iterating.
  // Sort by true coverage (biggest first), then drop any colour within MERGE_D
  // of an already-kept colour — its pixels will remap to the dominant neighbour in snap().
  const raw = pal.map((p, j) => ({ rgb: p as [number, number, number], share: allCount[j] / allTot }))
    .sort((a, b) => b.share - a.share);
  const deduped: typeof raw = [];
  for (const sw of raw) {
    if (deduped.every((kk) => Math.hypot(kk.rgb[0] - sw.rgb[0], kk.rgb[1] - sw.rgb[1], kk.rgb[2] - sw.rgb[2]) > MERGE_D))
      deduped.push(sw);
  }
  return deduped;
}

function nearest(pal: number[][], d: Uint8ClampedArray, i: number) {
  let b = 0, bd = 1e9;
  pal.forEach((p, j) => { const e = (p[0] - d[i]) ** 2 + (p[1] - d[i + 1]) ** 2 + (p[2] - d[i + 2]) ** 2; if (e < bd) { bd = e; b = j; } });
  return b;
}

/** 3x3 majority filter on the colour labels: removes ragged edges and 1px specks. */
function modeFilter(src: Int16Array, w: number, h: number, k: number) {
  const out = src.slice(), cnt = new Int16Array(k);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x; if (src[p] < 0) continue;
    cnt.fill(0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = src[p + dy * w + dx]; if (l >= 0) cnt[l]++; }
    let best = src[p]; for (let c = 0; c < k; c++) if (cnt[c] > cnt[best]) best = c;
    out[p] = best;
  }
  return out;
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Blobs smaller than minPx take the colour that surrounds them most (kills specks and stray dots). */
function mergeIslands(lab: Int16Array, w: number, h: number, k: number, minPx: number) {
  const seen = new Uint8Array(w * h), cnt = new Int32Array(k), stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || lab[s] < 0) continue;
    const L = lab[s], comp = [s]; seen[s] = 1; stack.push(s); cnt.fill(0);
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p - x) / w;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx, l = lab[q];
        if (l === L) { if (!seen[q]) { seen[q] = 1; stack.push(q); comp.push(q); } } else if (l >= 0) cnt[l]++;
      }
    }
    if (comp.length >= minPx) continue;
    let best = -1; for (let c = 0; c < k; c++) if (cnt[c] > (best < 0 ? 0 : cnt[best])) best = c;
    // best=-1 means the island has no opaque neighbours (surrounded by transparency after bg cut)
    // → make it transparent too, removing floating colour specks near cut edges.
    for (const q of comp) lab[q] = best;
  }
}

function labelsOf(img: ImageData, pal: Swatch[]) {
  const ps = pal.map((p) => p.rgb), lab = new Int16Array(img.width * img.height).fill(-1);
  for (let i = 0; i < lab.length; i++) if (img.data[i * 4 + 3]) lab[i] = nearest(ps, img.data, i * 4);
  return lab;
}
const onRim = (lab: Int16Array, p: number, w: number) => {
  const x = p % w, y = (p - x) / w;
  return x === 0 || y === 0 || x === w - 1 || lab[p - 1] < 0 || lab[p + 1] < 0 || lab[p - w] < 0 || lab[p + w] < 0 || p + w >= lab.length;
};
/** The colour that touches the outside of the picture most = the background. */
function rimLabel(lab: Int16Array, w: number, k: number) {
  const cnt = new Int32Array(k);
  for (let p = 0; p < lab.length; p++) if (lab[p] >= 0 && onRim(lab, p, w)) cnt[lab[p]]++;
  let best = 0; for (let c = 1; c < k; c++) if (cnt[c] > cnt[best]) best = c;
  return best;
}
export const findBackground = (img: ImageData, pal: Swatch[]) => rimLabel(labelsOf(img, pal), img.width, pal.length);

/**
 * Repaint every pixel with its (possibly remapped) palette colour.
 * cutBg: the outside background colour becomes transparent.
 * filterPasses: how many 3x3 majority-filter passes to run.
 *   Main mode → 2 passes (fast, enough for well-separated colours).
 *   Deep mode → 6 passes (needed to clean jagged edges between close colours).
 */
export function snap(img: ImageData, pal: Swatch[], hex: string[], cutBg = false, minIsland = 220, filterPasses = 2): ImageData {
  const { width: w, height: ht } = img, k = pal.length;
  let lab = labelsOf(img, pal);

  // When two palette entries share the same hex (user merged them or they drifted
  // to the same value) collapse them to one label BEFORE filtering so no jagged
  // boundary forms between them.
  const canonical = new Int16Array(k);
  const firstIdx = new Map<string, number>();
  for (let i = 0; i < k; i++) {
    const hx = hex[i];
    if (!firstIdx.has(hx)) firstIdx.set(hx, i);
    canonical[i] = firstIdx.get(hx)!;
  }
  if (canonical.some((c, i) => c !== i))
    for (let p = 0; p < lab.length; p++) if (lab[p] >= 0) lab[p] = canonical[lab[p]];

  for (let pass = 0; pass < filterPasses; pass++) lab = modeFilter(lab, w, ht, k);

  if (cutBg) {                       // flood the background label inwards from the outside edge
    const bg = rimLabel(lab, w, k), stack: number[] = [];
    for (let p = 0; p < lab.length; p++) if (lab[p] === bg && onRim(lab, p, w)) stack.push(p);
    while (stack.length) {
      const p = stack.pop()!; if (lab[p] !== bg) continue;
      lab[p] = -1; const x = p % w;
      if (x > 0) stack.push(p - 1); if (x < w - 1) stack.push(p + 1); if (p >= w) stack.push(p - w); if (p < w * (ht - 1)) stack.push(p + w);
    }
  }
  mergeIslands(lab, w, ht, k, minIsland);
  const out = new ImageData(w, ht), o = out.data, rgbs = hex.map(hexRgb);
  for (let i = 0; i < w * ht; i++) if (lab[i] >= 0) { const c = rgbs[lab[i]]; o[i * 4] = c[0]; o[i * 4 + 1] = c[1]; o[i * 4 + 2] = c[2]; o[i * 4 + 3] = 255; }
  return out;
}

async function trace(img: ImageData, pal: { r: number; g: number; b: number; a: number }[], smooth: number, omit: number) {
  const ImageTracer = (await import("imagetracerjs")).default;
  return ImageTracer.imagedataToSVG(img, { pal, colorsampling: 0, colorquantcycles: 1, ltres: smooth, qtres: smooth, pathomit: omit, blurradius: 0, strokewidth: 0, roundcoords: 1, layering: 0 });
}
export const traceSnapped = (img: ImageData, hex: string[], smooth = 1.5, omit = 12) =>
  trace(img, [...new Set(hex)].map((h) => { const [r, g, b] = hexRgb(h); return { r, g, b, a: 255 }; }).concat({ r: 0, g: 0, b: 0, a: 0 }), smooth, omit);

/** Outline of everything visible = solid body under the colours. */
export async function silhouetteD(img: ImageData): Promise<string> {
  const m = new ImageData(img.width, img.height);
  for (let i = 3; i < m.data.length; i += 4) m.data[i] = img.data[i] > 127 ? 255 : 0;
  const svg = await trace(m, [{ r: 0, g: 0, b: 0, a: 255 }, { r: 0, g: 0, b: 0, a: 0 }], 1, 20);
  return parseSvgLayers(svg).layers.map((l) => l.d).join(" ");
}

export const toDataUrl = (img: ImageData) => {
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0); return c.toDataURL();
};

export function colorToHex(color: string): string | null {
  if (!color || color === "none" || color === "transparent") return null;
  const trimmed = color.trim().toLowerCase();
  if (trimmed.startsWith("#")) {
    if (trimmed.length === 4) {
      return "#" + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3];
    }
    if (trimmed.length === 7) return trimmed;
  }
  const rgbMatch = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return hexOf(+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]);
  }
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = color;
    const computed = ctx.fillStyle;
    if (computed.startsWith("#")) {
      return computed.length === 4 ? "#" + computed[1] + computed[1] + computed[2] + computed[2] + computed[3] + computed[3] : computed;
    }
    const m = computed.match(/\d+/g);
    return m && m.length >= 3 ? hexOf(+m[0], +m[1], +m[2]) : null;
  } catch {
    return null;
  }
}

function svgShapeToPath(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "path") return el.getAttribute("d");
  if (tag === "rect") {
    const x = parseFloat(el.getAttribute("x") ?? "0");
    const y = parseFloat(el.getAttribute("y") ?? "0");
    const w = parseFloat(el.getAttribute("width") ?? "0");
    const h = parseFloat(el.getAttribute("height") ?? "0");
    const rx = parseFloat(el.getAttribute("rx") ?? "0");
    const ry = parseFloat(el.getAttribute("ry") ?? el.getAttribute("rx") ?? "0");
    if (w <= 0 || h <= 0) return null;
    if (rx > 0 || ry > 0) {
      const r = Math.min(rx || ry, w / 2, h / 2);
      return `M ${x + r} ${y} L ${x + w - r} ${y} A ${r} ${r} 0 0 1 ${x + w} ${y + r} L ${x + w} ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} L ${x + r} ${y + h} A ${r} ${r} 0 0 1 ${x} ${y + h - r} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
    }
    return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
  }
  if (tag === "circle") {
    const cx = parseFloat(el.getAttribute("cx") ?? "0");
    const cy = parseFloat(el.getAttribute("cy") ?? "0");
    const r = parseFloat(el.getAttribute("r") ?? "0");
    if (r <= 0) return null;
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
  }
  if (tag === "ellipse") {
    const cx = parseFloat(el.getAttribute("cx") ?? "0");
    const cy = parseFloat(el.getAttribute("cy") ?? "0");
    const rx = parseFloat(el.getAttribute("rx") ?? "0");
    const ry = parseFloat(el.getAttribute("ry") ?? "0");
    if (rx <= 0 || ry <= 0) return null;
    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
  }
  if (tag === "polygon" || tag === "polyline") {
    const ptsStr = el.getAttribute("points");
    if (!ptsStr) return null;
    const nums = ptsStr.trim().split(/[\s,]+/).map(parseFloat).filter((n) => !isNaN(n));
    if (nums.length < 4) return null;
    let d = `M ${nums[0]} ${nums[1]}`;
    for (let i = 2; i < nums.length; i += 2) {
      d += ` L ${nums[i]} ${nums[i + 1]}`;
    }
    return tag === "polygon" ? d + " Z" : d;
  }
  if (tag === "line") {
    const x1 = parseFloat(el.getAttribute("x1") ?? "0");
    const y1 = parseFloat(el.getAttribute("y1") ?? "0");
    const x2 = parseFloat(el.getAttribute("x2") ?? "0");
    const y2 = parseFloat(el.getAttribute("y2") ?? "0");
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  return null;
}

export function parseSvgLayers(svg: string): ParsedSvg {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const byColor = new Map<string, string[]>();

  const getEffectiveFill = (el: Element): string | null => {
    let cur: Element | null = el;
    while (cur) {
      const style = cur.getAttribute("style") ?? "";
      const styleFill = style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1];
      if (styleFill) return colorToHex(styleFill);
      const fillAttr = cur.getAttribute("fill");
      if (fillAttr) return colorToHex(fillAttr);
      cur = cur.parentElement;
    }
    return "#000000";
  };

  const getEffectiveOpacity = (el: Element): number => {
    let op = 1;
    let cur: Element | null = el;
    while (cur) {
      const oAttr = cur.getAttribute("opacity");
      if (oAttr) op *= parseFloat(oAttr);
      const style = cur.getAttribute("style") ?? "";
      const styleOp = style.match(/(?:^|;)\s*opacity\s*:\s*([^;]+)/i)?.[1];
      if (styleOp) op *= parseFloat(styleOp);
      cur = cur.parentElement;
    }
    return isNaN(op) ? 1 : op;
  };

  const shapes = doc.querySelectorAll("path, rect, circle, ellipse, polygon, polyline");
  shapes.forEach((el) => {
    const d = svgShapeToPath(el);
    const color = getEffectiveFill(el);
    const opacity = getEffectiveOpacity(el);
    if (!d || !color || opacity < 0.2) return;
    byColor.set(color, [...(byColor.get(color) ?? []), d]);
  });

  const viewBox = root.getAttribute("viewBox");
  let w = parseFloat(root.getAttribute("width") ?? "0");
  let h = parseFloat(root.getAttribute("height") ?? "0");
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(parseFloat);
    if (parts.length >= 4) {
      if (!w || isNaN(w)) w = parts[2];
      if (!h || isNaN(h)) h = parts[3];
    }
  }
  if (!w || isNaN(w)) w = 500;
  if (!h || isNaN(h)) h = 500;

  const layers: Layer[] = [...byColor].map(([color, ds], i) => ({
    id: `layer-${i}`,
    name: `Colour ${i + 1}`,
    d: ds.join(" "),
    color,
    visible: true,
  }));

  return { layers, width: w, height: h };
}

export function parseDirectSvg(svgText: string): FrameResult {
  const parsed = parseSvgLayers(svgText);
  const allD = parsed.layers.map((l) => l.d).join(" ");
  // Select the darkest color as default ink/outline
  const lum = (h: string) => {
    const v = parseInt(h.replace("#", ""), 16);
    return ((v >> 16) & 255) * 0.2126 + ((v >> 8) & 255) * 0.7152 + (v & 255) * 0.0722;
  };
  const colors = parsed.layers.map((l) => l.color);
  const ink = colors.length ? colors.reduce((a, b) => (lum(b) < lum(a) ? b : a)) : "#1f1b24";

  return {
    ...parsed,
    slabD: allD,
    ink,
  };
}