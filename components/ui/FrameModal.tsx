"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, RectangleHorizontal, Scissors, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { buildPalette, findBackground, frameImage, parseSvgLayers, rgbHex, silhouetteD, snap, toDataUrl, traceSnapped, bitmapUrl, defaultCrop, type Crop, type Shape } from "@/lib/vectorize";
import type { FrameResult, ParsedSvg } from "@/lib/types";

const SHAPES: { id: Shape; label: string; Icon: typeof Circle }[] = [
  { id: "original", label: "Original", Icon: RectangleHorizontal }, { id: "square", label: "Square", Icon: Square }, { id: "circle", label: "Circle", Icon: Circle },
];
const lum = (h: string) => { const v = parseInt(h.slice(1), 16); return ((v >> 16) & 255) * 0.2126 + ((v >> 8) & 255) * 0.7152 + (v & 255) * 0.0722; };
const checker = "bg-[conic-gradient(#fff_25%,#f6e4e4_0_50%,#fff_0_75%,#f6e4e4_0)] bg-[length:22px_22px]";

export function FrameModal({ bmp, onClose, onDone }: { bmp: ImageBitmap; onClose: () => void; onDone: (r: FrameResult) => void }) {
  const [shape, setShape] = useState<Shape>("original");
  const [crop, setCrop] = useState<Crop | null>(null);       // live (while dragging)
  const [applied, setApplied] = useState<Crop | null>(null); // used for tracing
  const [view, setView] = useState<"crop" | "preview">("preview");
  const srcUrl = useMemo(() => bitmapUrl(bmp), [bmp]);
  const choose = (id: Shape) => { const c = defaultCrop(bmp, id); setShape(id); setCrop(c); setApplied(c); setView(c ? "crop" : "preview"); };
  const [cut, setCut] = useState(true);
  const [colorMode, setColorMode] = useState<"main" | "deep">("main");
  const MAX_COLORS = colorMode === "deep" ? 16 : 8;
  const [map, setMap] = useState<Record<number, string>>({});
  const [sel, setSel] = useState<number | null>(null);
  const [peel, setPeel] = useState(50);
  const [out, setOut] = useState<{ svg: string; res: ParsedSvg } | null>(null);

  const framed = useMemo(() => frameImage(bmp, shape, applied, false, 0), [bmp, shape, applied]);
  const original = useMemo(() => toDataUrl(framed), [framed]);
  const pal = useMemo(() => buildPalette(framed, cut ? MAX_COLORS + 1 : MAX_COLORS, colorMode === "deep"), [framed, cut, colorMode, MAX_COLORS]);
  const bgIdx = useMemo(() => (cut ? findBackground(framed, pal) : -1), [cut, framed, pal]);   // hidden from the list when cut out
  const snapRef = useRef<ImageData | null>(null);
  const hex = pal.map((p, i) => map[i] ?? rgbHex(p.rgb));
  useEffect(() => { setMap({}); setSel(null); }, [pal]);

  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      const sn = snap(framed, pal, hex, cut, 220, colorMode === "deep" ? 6 : 2); snapRef.current = sn;
      const svg = await traceSnapped(sn, hex);
      if (!stale) setOut({ svg, res: parseSvgLayers(svg) });
    }, 200);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framed, pal, map, cut, colorMode]);

  const set = (i: number, h: string) => setMap((m) => ({ ...m, [i]: h }));
  const svgUrl = out ? "data:image/svg+xml;utf8," + encodeURIComponent(out.svg) : "";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#4a2c3a]/40 p-4 backdrop-blur-sm">
      <div className="grid max-h-[94vh] w-full max-w-5xl gap-6 overflow-auto rounded-[2rem] bg-[#fffaf6] p-6 text-[#4a2c3a] shadow-2xl md:grid-cols-[1fr_340px]">
        <div>
          <h2 className="text-2xl font-semibold">Frame it up</h2>
          <p className="mb-3 text-sm text-[#4a2c3a]/60">Drag the handle: left is your photo, right is the vector cut-out.</p>
          {view === "crop" && crop ? <CropBox bmp={bmp} src={srcUrl} crop={crop} setCrop={setCrop} round={shape === "circle"} /> : (
          <div className={`relative aspect-square overflow-hidden rounded-3xl border border-rose-100 ${checker}`}>
            {out && <img src={svgUrl} alt="Vector preview" className="absolute inset-0 size-full object-contain" />}
            <img src={original} alt="Original" className="absolute inset-0 size-full object-contain" style={{ clipPath: `inset(0 ${100 - peel}% 0 0)` }} />
            <div className="pointer-events-none absolute inset-y-0 w-1 -translate-x-1/2 bg-white shadow-lg" style={{ left: `${peel}%` }}>
              <span className="absolute top-1/2 -translate-x-[40%] -translate-y-1/2 rounded-full bg-white p-1.5 text-rose-400 shadow"><Scissors className="size-4" /></span>
            </div>
            <input type="range" min={0} max={100} value={peel} onChange={(e) => setPeel(+e.target.value)} aria-label="Compare original and cut-out" className="absolute inset-0 size-full cursor-ew-resize opacity-0" />
          </div>)}
          {crop && (view === "crop"
            ? <Button onClick={() => { setApplied(crop); setView("preview"); }} className="mt-3 w-full rounded-2xl bg-rose-400 hover:bg-rose-500">Apply crop</Button>
            : <Button variant="outline" onClick={() => setView("crop")} className="mt-3 w-full rounded-2xl">Adjust crop</Button>)}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between"><span className="text-sm font-semibold">Shape</span><button onClick={onClose} aria-label="Close" className="rounded-full p-1 hover:bg-rose-100"><X className="size-5" /></button></div>
          <div className="grid grid-cols-3 gap-2">
            {SHAPES.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => choose(id)} className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-xs transition ${shape === id ? "border-rose-400 bg-rose-100 text-rose-600" : "border-rose-100 bg-white hover:bg-rose-50"}`}><Icon className="size-5" />{label}</button>
            ))}
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-rose-100 bg-white p-3 text-sm"><span className="flex items-center gap-2"><Scissors className="size-4 text-rose-400" />Remove background</span><Switch checked={cut} onCheckedChange={setCut} /></div>

          <div>
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              Colours <span className="text-xs font-normal text-[#4a2c3a]/60">{pal.length} found</span>
            </div>
            {/* Main / Deep toggle */}
            <div className="mb-2 flex gap-1 rounded-xl bg-rose-100 p-0.5 text-xs font-medium">
              {(["main", "deep"] as const).map((m) => (
                <button key={m} onClick={() => { setColorMode(m); setSel(null); setMap({}); }}
                  className={`flex-1 rounded-[10px] py-1 capitalize transition-all ${
                    colorMode === m ? "bg-white text-rose-500 shadow" : "text-[#4a2c3a]/60 hover:text-[#4a2c3a]"
                  }`}>
                  {m === "main" ? "Main" : "Deep"}
                </button>
              ))}
            </div>
            {/* Mode description note */}
            <p className="mt-1.5 text-[11px] leading-snug text-[#4a2c3a]/55">
              {colorMode === "main"
                ? "Main — fast scan, up to 8 colours. Best for most logos."
                : "Deep — fine 128-level scan, up to 16 colours. Captures subtle gradients."}
            </p>
            {colorMode === "deep" && (
              <div className="mt-1.5 flex items-start gap-1.5 rounded-xl bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-700">
                <span className="mt-px shrink-0">⚠️</span>
                <span>Deep mode may cause <strong>colour mismatch</strong> and <strong>colour bleed</strong> on some logos — nearby shades can bleed into each other or map to the wrong region. Switch to Main if colours look off.</span>
              </div>
            )}
            <div className="mt-1 flex flex-wrap gap-2">
              {pal.map((p, i) => (
                <button key={i} onClick={() => setSel(i === sel ? null : i)}
                  title={`${i === bgIdx ? "Background · " : ""}${Math.round(p.share * 100)}%`}
                  className={`relative size-10 rounded-full border-2 border-white shadow ring-2 transition ${sel === i ? "scale-110 ring-rose-400" : i === bgIdx ? "ring-dashed ring-[#4a2c3a]/30" : "ring-black/10"}`}
                  style={{ background: hex[i] }}>
                  {i === bgIdx && <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 size-3 rounded-full border border-white bg-[#4a2c3a]/40" title="Background" />}
                </button>
              ))}
            </div>
            {sel !== null ? (
              <div className="mt-3 space-y-2 rounded-2xl bg-rose-50 p-3">
                <p className="text-xs">Change this colour to one you already have:</p>
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set(hex)].filter((h) => h !== hex[sel]).map((h) => <button key={h} onClick={() => set(sel, h)} className="size-7 rounded-full border-2 border-white shadow ring-1 ring-black/10" style={{ background: h }} aria-label={h} />)}
                </div>
                <div className="flex items-center justify-between text-xs">or pick your own
                  <input type="color" value={hex[sel]} onChange={(e) => set(sel, e.target.value)} className="h-8 w-14 cursor-pointer rounded-lg" />
                </div>
                <button className="text-xs text-rose-500 underline" onClick={() => setMap((m) => { const c = { ...m }; delete c[sel]; return c; })}>Reset this colour</button>
              </div>
            ) : <p className="mt-2 text-xs text-[#4a2c3a]/60">Tap a colour to swap it.</p>}
          </div>

          <Button disabled={!out} className="h-11 w-full rounded-2xl bg-rose-400 text-base hover:bg-rose-500"
            onClick={async () => out && onDone({ ...out.res, slabD: await silhouetteD(snapRef.current!), ink: hex.filter((_, i) => i !== bgIdx).reduce((a, b) => (lum(b) < lum(a) ? b : a)) })}>Make my 3D model</Button>
        </div>
      </div>
    </div>
  );
}

const CORNERS: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

/** Drag the box to move it, drag a corner to resize. The box may go past the image (empty area stays transparent). */
function CropBox({ bmp, src, crop, setCrop, round }: { bmp: ImageBitmap; src: string; crop: Crop; setCrop: (c: Crop) => void; round: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ m: "move" | [number, number]; c: Crop; p: number[] } | null>(null);
  const L = Math.max(bmp.width, bmp.height, crop.s) * 1.4, ox = bmp.width / 2 - L / 2, oy = bmp.height / 2 - L / 2;
  const pct = (v: number) => `${(v / L) * 100}%`;
  const toImg = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [ox + ((e.clientX - r.left) / r.width) * L, oy + ((e.clientY - r.top) / r.height) * L]; };
  const down = (m: "move" | [number, number]) => (e: React.PointerEvent) => { e.stopPropagation(); ref.current!.setPointerCapture(e.pointerId); drag.current = { m, c: crop, p: toImg(e) }; };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const [px, py] = toImg(e);
    if (d.m === "move") return setCrop({ ...d.c, x: d.c.x + px - d.p[0], y: d.c.y + py - d.p[1] });
    const [sx, sy] = d.m, ax = d.c.x + (sx > 0 ? 0 : d.c.s), ay = d.c.y + (sy > 0 ? 0 : d.c.s);
    const side = Math.max(40, Math.abs(px - ax), Math.abs(py - ay));
    setCrop({ s: side, x: sx > 0 ? ax : ax - side, y: sy > 0 ? ay : ay - side });
  };
  return (
    <div ref={ref} onPointerMove={move} onPointerUp={() => (drag.current = null)} className={`relative aspect-square touch-none select-none overflow-hidden rounded-3xl border border-rose-100 ${checker}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" draggable={false} className="absolute max-w-none" style={{ left: pct(-ox), top: pct(-oy), width: pct(bmp.width), height: pct(bmp.height) }} />
      <div onPointerDown={down("move")} className={`absolute cursor-move border-2 border-white shadow-[0_0_0_999px_rgba(74,44,58,.5)] ${round ? "rounded-full" : ""}`}
        style={{ left: pct(crop.x - ox), top: pct(crop.y - oy), width: pct(crop.s), height: pct(crop.s) }}>
        {CORNERS.map(([sx, sy]) => (
          <span key={`${sx}${sy}`} onPointerDown={down([sx, sy])} className="absolute size-5 rounded-md border-2 border-rose-400 bg-white shadow"
            style={{ left: sx > 0 ? "100%" : 0, top: sy > 0 ? "100%" : 0, transform: "translate(-50%,-50%)", cursor: sx * sy > 0 ? "nwse-resize" : "nesw-resize" }} />
        ))}
      </div>
    </div>
  );
}