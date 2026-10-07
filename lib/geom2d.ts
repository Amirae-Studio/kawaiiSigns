import ClipperLib from "clipper-lib";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

/** Polygon maths (union / subtract / offset) like the CrossSection ops in the reference code. World units, y up. */
export type Paths = { X: number; Y: number }[][];
const SC = 100000, C = ClipperLib, loader = new SVGLoader();

function run(type: number, a: Paths, b: Paths = [], fill = C.PolyFillType.pftNonZero): Paths {
  if (!a.length && !b.length) return [];
  const c = new C.Clipper();
  if (a.length) c.AddPaths(a, C.PolyType.ptSubject, true);
  if (b.length) c.AddPaths(b, C.PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(type, out, fill, fill);
  return C.Clipper.CleanPolygons(out, 0.0001 * SC);
}
export const union = (a: Paths, b: Paths) => run(C.ClipType.ctUnion, a, b);
export const subtract = (a: Paths, b: Paths) => run(C.ClipType.ctDifference, a, b);
export const intersect = (a: Paths, b: Paths) => run(C.ClipType.ctIntersection, a, b);

/** SVG path (y down) -> clean polygons. Even-odd, so holes become holes. */
export function fromSvg(d: string, tf: (x: number, y: number) => [number, number]): Paths {
  if (!d || !d.trim()) return [];
  try {
    const data = loader.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`);
    const raw: Paths = [];
    for (const p of data.paths) {
      for (const sp of p.subPaths) {
        const pts = sp.getPoints(24);
        if (pts.length < 3) continue;
        const poly = pts.map((v) => {
          const [x, y] = tf(v.x, v.y);
          return { X: Math.round(x * SC), Y: Math.round(y * SC) };
        });
        raw.push(poly);
      }
    }
    if (!raw.length) return [];
    return run(C.ClipType.ctUnion, raw, [], C.PolyFillType.pftEvenOdd);
  } catch (err) {
    console.error("Error parsing SVG path:", err);
    return [];
  }
}

/** Grow (d > 0) or shrink (d < 0) with rounded corners. */
export function offset(a: Paths, d: number): Paths {
  if (!a.length || Math.abs(d) < 1e-6) return a;
  const co = new C.ClipperOffset(2, 0.0005 * SC);
  co.AddPaths(a, C.JoinType.jtRound, C.EndType.etClosedPolygon);
  const out: Paths = [];
  co.Execute(out, d * SC);
  return C.Clipper.CleanPolygons(out, 0.0001 * SC);
}

/** Open + close: drops slivers thinner than d and fills cracks narrower than d. */
export const tidy = (a: Paths, d: number) => {
  if (!a.length || d <= 0) return a;
  return offset(offset(offset(offset(a, -d / 2), d / 2), d / 2), -d / 2);
};

export const area = (a: Paths) => Math.abs(a.reduce((s, p) => s + C.Clipper.Area(p), 0)) / (SC * SC);

/** Polygons (with holes) -> extruded solid from z to z+depth. */
export function extrudePaths(a: Paths, depth: number, z = 0): THREE.BufferGeometry | null {
  if (!a.length || depth <= 0) return null;
  const c = new C.Clipper(), tree = new C.PolyTree();
  c.AddPaths(a, C.PolyType.ptSubject, true);
  c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  
  const pts = (n: any) => n.Contour().map((p: { X: number; Y: number }) => new THREE.Vector2(p.X / SC, p.Y / SC));
  const shapes: THREE.Shape[] = [];
  
  const walk = (n: any) => {
    const contour = pts(n);
    if (contour.length >= 3) {
      const sh = new THREE.Shape(contour);
      n.Childs().forEach((h: any) => {
        const hPts = pts(h);
        if (hPts.length >= 3) {
          sh.holes.push(new THREE.Path(hPts));
        }
        h.Childs().forEach(walk);
      });
      shapes.push(sh);
    }
  };
  
  tree.Childs().forEach(walk);
  if (!shapes.length) return null;
  return new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 24 }).translate(0, 0, z);
}

/** Resample outlines to an even spacing, then relax them so pixel stair-steps become smooth curves. */
export function smooth(a: Paths, step: number, iters = 4): Paths {
  if (!a.length || iters <= 0) return a;
  const st = step * SC;
  const out = a.map((poly) => {
    let cur: { X: number; Y: number }[] = [];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const dist = Math.hypot(q.X - p.X, q.Y - p.Y);
      const n = Math.max(1, Math.min(100, Math.round(dist / st)));
      for (let k = 0; k < n; k++) {
        cur.push({ X: p.X + ((q.X - p.X) * k) / n, Y: p.Y + ((q.Y - p.Y) * k) / n });
      }
    });
    if (cur.length < 8) return poly;
    for (let it = 0; it < iters; it++) {
      const prev = cur, len = prev.length;
      cur = prev.map((p, i) => {
        const u = prev[(i + len - 1) % len], v = prev[(i + 1) % len];
        return { X: p.X * 0.6 + (u.X + v.X) * 0.2, Y: p.Y * 0.6 + (u.Y + v.Y) * 0.2 };
      });
    }
    return cur.map((p) => ({ X: Math.round(p.X), Y: Math.round(p.Y) }));
  });
  return run(C.ClipType.ctUnion, out);
}