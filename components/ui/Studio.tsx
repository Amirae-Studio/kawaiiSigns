"use client";
import { useDeferredValue, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Download, Flag, Monitor, Scissors, Triangle } from "lucide-react";
import { buildGroups } from "@/lib/build";
import { LayerPanel } from "@/components/ui/LayerPanel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { FrameResult, Layer, ModelSettings, PlateShape, SignStyle } from "@/lib/types";

const STYLES: { id: SignStyle; label: string; Icon: typeof Flag }[] = [
  { id: "diecut", label: "Die-cut", Icon: Scissors }, { id: "blade", label: "Blade", Icon: Flag }, { id: "aframe", label: "A-frame", Icon: Triangle }, { id: "desk", label: "Desk", Icon: Monitor },
];
const SHAPES: { id: PlateShape; label: string; cls: string }[] = [
  { id: "rect", label: "Rect", cls: "h-5 w-5 rounded-md" }, { id: "round", label: "Round", cls: "h-5 w-5 rounded-full" },
  { id: "pill", label: "Pill", cls: "h-6 w-3 rounded-full" }, { id: "arch", label: "Arch", cls: "h-5 w-4 rounded-t-full" },
];
const tile = (on: boolean) => `flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] transition ${on ? "bg-white text-rose-500 shadow" : "text-[#4a2c3a]/60 hover:bg-white/60"}`;

const Viewer3D = dynamic(() => import("@/components/ui/Viewer3D"), { ssr: false });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-rose-100 px-5 py-4 last:border-0">
      <h2 className="text-sm font-semibold text-[#4a2c3a]">{title}</h2>{children}
    </section>
  );
}
function Field({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="grid grid-cols-[84px_1fr_38px] items-center gap-2 text-xs text-[#4a2c3a]/70">
      <Label className="text-xs font-normal">{label}</Label>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(typeof v === "number" ? v : v[0])} />
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}
function Colour({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between text-xs text-[#4a2c3a]/70">{label}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-12 cursor-pointer rounded-lg border-2 border-white bg-transparent shadow ring-1 ring-black/10" />
    </label>
  );
}


export function Studio({ layers: init, width, height, slabD, ink, onBack }: FrameResult & { onBack: () => void }) {
  const [layers, setLayers] = useState<Layer[]>(() => init.map((l) => ({ ...l, visible: l.color.toLowerCase() !== ink.toLowerCase() })));   // the ink colour is the lower outline layer, not a raised piece
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelSettings>({ style: "diecut", shape: "rect", depth: 0.12, plate: 0.18, pad: 0.35, radius: 0.2, hole: false, bodyColor: "#fffaf6", standColor: "#4a2c3a", slab: 0.17, outline: 20, gap: 2, edgeColor: ink });
  const patch = (id: string, p: Partial<Layer>) => setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const m = <K extends keyof ModelSettings>(k: K, v: ModelSettings[K]) => setModel((o) => ({ ...o, [k]: v }));
  const [mm, setMm] = useState(70);
  const [busy, setBusy] = useState(false);
  const dm = useDeferredValue(model);
  const gk = layers.map((l) => l.id + l.visible).join();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => buildGroups(layers, slabD, width, height, dm), [gk, slabD, width, height, dm]);
  const print = async () => {
    setBusy(true);
    try {
      const { build3mf } = await import("@/lib/export3mf");
      const blob = await build3mf(groups, (p) => layers.find((l) => l.id === p.layerId)?.color ?? p.color, mm / 4);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "kawaii-sign.3mf"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } finally { setBusy(false); }
  };
  return (
    <main className="flex h-screen gap-4 bg-gradient-to-br from-[#fff4ea] via-[#ffe8df] to-[#ffdce6] p-4 text-[#4a2c3a]">
      <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white/70 shadow-xl shadow-rose-200/50 backdrop-blur">
        <div className="p-4 pb-0"><Button variant="ghost" size="sm" onClick={onBack} className="rounded-full"><ArrowLeft className="size-4" /> Back to colours</Button></div>
        <ScrollArea className="min-h-0 flex-1">
          <Section title="Sign style">
            <Field label="Size (mm)" value={mm} min={30} max={150} step={5} onChange={setMm} />
            <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-rose-50 p-1.5">
              {STYLES.map(({ id, label, Icon }) => <button key={id} onClick={() => m("style", id)} className={tile(model.style === id)}><Icon className="size-5" />{label}</button>)}
            </div>
            {model.style !== "diecut" ? (<>
              <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-rose-50 p-1.5">
                {SHAPES.map(({ id, label, cls }) => <button key={id} onClick={() => m("shape", id)} className={tile(model.shape === id)}><span className={`border-2 border-current ${cls}`} />{label}</button>)}
              </div>
              <Field label="Border" value={model.pad} min={0.05} max={1} step={0.05} onChange={(v) => m("pad", v)} />
              <Field label="Depth" value={model.plate} min={0.05} max={0.5} step={0.01} onChange={(v) => m("plate", v)} />
              {model.shape === "rect" && <Field label="Corner radius" value={model.radius} min={0} max={1} step={0.05} onChange={(v) => m("radius", v)} />}
              <div className="flex items-center justify-between text-xs">Keyring / cable hole<Switch checked={model.hole} onCheckedChange={(v) => m("hole", v)} /></div>
              <Colour label="Body colour" value={model.bodyColor} onChange={(v) => m("bodyColor", v)} />
              <Colour label="Stand / bracket colour" value={model.standColor} onChange={(v) => m("standColor", v)} />
            </>) : (<>
              <Field label="Base thickness" value={model.slab} min={0.04} max={0.5} step={0.02} onChange={(v) => m("slab", v)} />
              <Field label="Base border" value={model.outline} min={0} max={40} step={0.5} onChange={(v) => m("outline", v)} />
              <Colour label="Base colour" value={model.bodyColor} onChange={(v) => m("bodyColor", v)} />
            </>)}
            <Field label="Colour gap" value={model.gap} min={0} max={8} step={0.5} onChange={(v) => m("gap", v)} />
            <Colour label="Outline colour" value={model.edgeColor} onChange={(v) => m("edgeColor", v)} />
            <Field label="Colour layer" value={model.depth} min={0.04} max={0.4} step={0.02} onChange={(v) => m("depth", v)} />
          </Section>
        </ScrollArea>
        <div className="border-t border-rose-100 p-4">
          <Button onClick={print} disabled={busy} className="h-11 w-full rounded-2xl bg-rose-400 text-base hover:bg-rose-500"><Download className="size-4" />{busy ? "Preparing…" : "Print · download .3mf"}</Button>
          <p className="mt-2 text-center text-[11px] text-[#4a2c3a]/60">Every part is laid flat on the plate, ready to slice.</p>
        </div>
      </aside>
      <section className="relative min-w-0 flex-1">
        <Viewer3D groups={groups} layers={layers} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="absolute bottom-2 left-2 z-10"><LayerPanel layers={layers} selectedId={selectedId} onSelect={setSelectedId} onChange={patch} /></div>
      </section>
    </main>
  );
}