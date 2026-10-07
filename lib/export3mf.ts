import JSZip from "jszip";
import * as THREE from "three";
import type { Group, Part } from "./build";

const BED = 256, GAP = 8;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function meshXml(geo: THREE.BufferGeometry, M: THREE.Matrix4) {
  const pos = geo.attributes.position, v = new THREE.Vector3(), map = new Map<string, number>(), verts: string[] = [], idx: number[] = [], tris: string[] = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(M);
    const a = `x="${v.x.toFixed(3)}" y="${v.y.toFixed(3)}" z="${v.z.toFixed(3)}"`;
    let id = map.get(a);
    if (id === undefined) { id = verts.length; map.set(a, id); verts.push(`<vertex ${a}/>`); }
    idx.push(id);
  }
  for (let i = 0; i < idx.length; i += 3) if (idx[i] !== idx[i + 1] && idx[i + 1] !== idx[i + 2] && idx[i] !== idx[i + 2]) tris.push(`<triangle v1="${idx[i]}" v2="${idx[i + 1]}" v3="${idx[i + 2]}"/>`);
  return `<mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh>`;
}

/** Each group is laid flat (thinnest side down) and arranged on a 256mm bed; parts of one group stay registered as one multi-part object. k = mm per world unit. */
export async function build3mf(groups: Group[], colorOf: (p: Part) => string, k: number): Promise<Blob> {
  const cols = [...new Set(groups.flatMap((g) => g.parts.map(colorOf)))];
  let x = 10, y = 10, rowH = 0, nid = 2;
  const res: string[] = [], items: string[] = [];
  for (const g of groups) {
    const geos = g.parts.map((p) => p.printGeo ?? p.geo), b = new THREE.Box3();
    geos.forEach((q) => { q.computeBoundingBox(); b.union(q.boundingBox!); });
    const sz = b.getSize(new THREE.Vector3()), R = new THREE.Matrix4();
    if (sz.x <= sz.y && sz.x <= sz.z) R.makeRotationY(Math.PI / 2);
    else if (sz.y <= sz.z) R.makeRotationX(Math.PI / 2);
    const rb = b.clone().applyMatrix4(R), w = (rb.max.x - rb.min.x) * k, d = (rb.max.y - rb.min.y) * k;
    if (x + w > BED - 10 && x > 10) { x = 10; y += rowH + GAP; rowH = 0; }
    const M = new THREE.Matrix4().makeTranslation(x - rb.min.x * k, y - rb.min.y * k, -rb.min.z * k)
      .multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(R);
    x += w + GAP; rowH = Math.max(rowH, d);
    const ids = g.parts.map((p, i) => {
      const id = nid++;
      res.push(`<object id="${id}" type="model" pid="1" pindex="${cols.indexOf(colorOf(p))}" name="${esc(p.name)}">${meshXml(geos[i], M)}</object>`);
      return id;
    });
    if (ids.length === 1) items.push(`<item objectid="${ids[0]}"/>`);
    else {
      const id = nid++;
      res.push(`<object id="${id}" type="model" name="${esc(g.name)}"><components>${ids.map((i) => `<component objectid="${i}"/>`).join("")}</components></object>`);
      items.push(`<item objectid="${id}"/>`);
    }
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Kawaii 3D sign</metadata><resources><basematerials id="1">${cols.map((c, i) => `<base name="Colour ${i + 1}" displaycolor="${c.toUpperCase()}"/>`).join("")}</basematerials>${res.join("")}</resources><build>${items.join("")}</build></model>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`);
  zip.file("3D/3dmodel.model", model);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml" });
}
