import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { extrudePaths, fromSvg, intersect, offset, smooth, subtract, tidy, union, area, type Paths } from "./geom2d";
import type { Layer, ModelSettings, PlateShape } from "./types";

export interface Part { id: string; name: string; color: string; geo: THREE.BufferGeometry; printGeo?: THREE.BufferGeometry; layerId?: string }
export interface Group { name: string; parts: Part[] }

const clean = (g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute("uv"); n.deleteAttribute("normal"); return n; };
const finish = (g: THREE.BufferGeometry) => { g.computeVertexNormals(); return g; };
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => clean(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
function plateGeo(kind: PlateShape, w: number, h: number, r: number, thick: number, hole: boolean) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2, PI = Math.PI;
  if (kind === "round") s.absellipse(0, 0, w / 2, h / 2, 0, PI * 2, false, 0);
  else if (kind === "arch") { s.moveTo(x, y); s.lineTo(-x, y); s.lineTo(-x, h / 2 - w / 2); s.absarc(0, h / 2 - w / 2, w / 2, 0, PI, false); s.lineTo(x, y); }
  else {
    const q = Math.min(kind === "pill" ? Math.min(w, h) / 2 : r, w / 2, h / 2);
    s.moveTo(x + q, y); s.lineTo(-x - q, y); s.absarc(-x - q, y + q, q, -PI / 2, 0, false);
    s.lineTo(-x, -y - q); s.absarc(-x - q, -y - q, q, 0, PI / 2, false);
    s.lineTo(x + q, -y); s.absarc(x + q, -y - q, q, PI / 2, PI, false);
    s.lineTo(x, y + q); s.absarc(x + q, y + q, q, PI, PI * 1.5, false);
  }
  if (hole) { const p = new THREE.Path(); p.absarc(0, h / 2 - 0.22, 0.09, 0, PI * 2, true); s.holes.push(p); }
  return new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 24 });
}

/** One source of truth: the viewer draws these groups and the 3MF export prints them. Units = world units. */
export function buildGroups(layers: Layer[], slabD: string, width: number, height: number, m: ModelSettings): Group[] {
  const s = 4 / Math.max(width, height), W = width * s, H = height * s, T = m.plate;
  const diecut = m.style === "diecut", hole = m.hole && !diecut, top = hole ? 0.4 : 0;
  const pw0 = W + 2 * m.pad, ph0 = H + 2 * m.pad + top;
  const PW = m.shape === "round" ? pw0 * 1.3 : pw0;
  const PH = m.shape === "round" ? ph0 * 1.3 : m.shape === "arch" ? ph0 + pw0 * 0.25 : ph0;
  const ay = -top / 2 - (m.shape === "arch" ? pw0 * 0.125 : 0);
  // Stack (bottom -> top): base, outline, then colours. Polygon maths guarantees colours never overlap or touch.
  const tf = (x: number, y: number): [number, number] => [x * s - W / 2, ay + H / 2 - y * s];
  const gapW = m.gap * s, minF = 0.0001, baseZ = diecut ? m.slab : 0, oh = m.depth * 0.5;
  const ex = (cs: Paths, h: number, z: number) => { const g = extrudePaths(cs, h, z); return g ? finish(clean(g)) : null; };
  const trace = (d: string) => fromSvg(d, tf);
  // minimum inset to prevent adjacent co-planar side faces from z-fighting (in SVG units)
  const minInset = 0.3 * s;
  
  let sil = trace(slabD);
  const face: Part[] = [];
  const add = (id: string, name: string, color: string, geo: THREE.BufferGeometry | null, layerId?: string) => { if (geo) face.push({ id, name, color, geo, layerId }); };

  // Calculate combined visible area if slabD is empty
  if (!sil.length) {
    for (const l of layers) {
      if (l.d) sil = union(sil, trace(l.d));
    }
  }

  let ink = sil;
  if (diecut) {
    const grow = m.outline * s, close = Math.max(0.05, grow * 0.5);
    const outer = grow > 0 ? offset(offset(sil, grow + close), -close) : sil; // smooth die-cut base
    add("base", "Base", m.bodyColor, ex(outer, m.slab, 0));
    ink = intersect(sil, outer);
  } else {
    add("body", "Body", m.bodyColor, finish(clean(plateGeo(m.shape, PW, PH, m.radius, T, hole).translate(0, 0, -T))));
  }

  if (gapW > 0) {
    // Outline fills the full depth so it forms a solid wall between colours
    add("outline", "Outline", m.edgeColor, ex(ink, m.depth, baseZ));
  }

  let occ: Paths = [];
  // Process layers in order; ensure no overlaps or gaps
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l.d || !l.visible) continue;
    const rawCs = trace(l.d);
    if (!rawCs.length) continue;
    
    let cs = subtract(rawCs, occ);
    if (!cs.length) continue;
    occ = union(occ, cs);

    if (gapW > 0) {
      cs = offset(cs, -(gapW / 2 + minInset));
    } else {
      // Even with no explicit gap, inset by the minimum to stop side-face bleed
      cs = offset(cs, -minInset);
    }
    
    if (area(cs) > 1e-5) {
      // Colours sit on top of the outline (which now occupies 0→m.depth)
      const zPos = baseZ + m.depth;
      const layerDepth = m.depth;
      add(l.id, l.name, l.color, ex(cs, layerDepth, zPos), l.id);
    }
  }
  const out: Group[] = [{ name: diecut ? "Sticker" : "Face", parts: face }];
  const one = (name: string, geo: THREE.BufferGeometry, printGeo?: THREE.BufferGeometry) =>
    out.push({ name, parts: [{ id: name, name, color: m.standColor, geo: finish(geo), printGeo: printGeo && finish(printGeo) }] });

  if (m.style === "desk") {            // wedge prop behind the sign
    const yb = -PH / 2, wd = PW * 0.5, prof = new THREE.Shape();
    prof.moveTo(T, yb); prof.lineTo(1.2, yb); prof.lineTo(T, yb + PH * 0.6);
    const raw = clean(new THREE.ExtrudeGeometry(prof, { depth: wd, bevelEnabled: false }));
    one("Desk stand", raw.clone().rotateY(Math.PI / 2).translate(-wd / 2, 0, 0), raw);
  }
  if (m.style === "blade") {           // wall plate + two arms (side mount)
    const x0 = PW / 2;
    one("Wall plate", box(0.12, PH * 0.9, 0.8, x0 + 1.06, 0, -T / 2));
    one("Arm top", box(1.1, 0.14, 0.16, x0 + 0.45, PH * 0.3, -T / 2));
    one("Arm bottom", box(1.1, 0.14, 0.16, x0 + 0.45, -PH * 0.3, -T / 2));
  }
  if (m.style === "aframe") {          // hinged back leg
    const th = 0.45, L = PH / Math.cos(th), lw = PW * 0.9, lt = Math.max(T * 0.8, 0.06);
    one("Back leg", clean(new THREE.BoxGeometry(lw, L, lt).translate(0, -L / 2, 0).rotateX(th).translate(0, PH / 2, -T)), box(lw, L, lt, 0, 0, 0));
  }
  return out;
}