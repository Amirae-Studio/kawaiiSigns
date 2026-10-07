"use client";
import { useCallback, useEffect, useState } from "react";
import { Box, Palette, Sparkles, Upload } from "lucide-react";
import { Dropzone } from "@/components/ui/Dropzone";
import { FrameModal } from "@/components/ui/FrameModal";
import { Studio } from "@/components/ui/Studio";
import type { FrameResult } from "@/lib/types";

import { parseDirectSvg } from "@/lib/vectorize";

const STEPS = [
  { Icon: Upload, t: "Drop a picture", d: "SVG, PNG, JPG or WEBP" }, { Icon: Sparkles, t: "Frame & cut out", d: "Circle, square or original" },
  { Icon: Palette, t: "Swap colours", d: "Mix your own palette" }, { Icon: Box, t: "Spin it in 3D", d: "Add text, tweak, admire" },
];

export default function Page() {
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [result, setResult] = useState<FrameResult | null>(null);
  const [drag, setDrag] = useState(false);
  const pick = useCallback(async (f: File) => {
    if (f.name.toLowerCase().endsWith(".svg") || f.type === "image/svg+xml") {
      try {
        const text = await f.text();
        const parsed = parseDirectSvg(text);
        if (parsed.layers.length > 0) {
          setResult(parsed);
          return;
        }
      } catch (e) {
        console.error("Direct SVG parsing failed, falling back to bitmap:", e);
      }
    }
    setBmp(await createImageBitmap(f));
  }, []);

  useEffect(() => {
    const over = (e: DragEvent) => { e.preventDefault(); setDrag(true); };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDrag(false); };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const f = e.dataTransfer?.files[0];
      if (f && (f.type.startsWith("image/") || f.name.toLowerCase().endsWith(".svg") || f.type === "image/svg+xml")) pick(f);
    };
    const paste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/") || x.name.toLowerCase().endsWith(".svg") || x.type === "image/svg+xml");
      if (f) pick(f);
    };
    window.addEventListener("dragover", over); window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop); window.addEventListener("paste", paste);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); window.removeEventListener("paste", paste); };
  }, [pick]);

  if (result) return <Studio {...result} onBack={() => setResult(null)} />;
  return (
    <main className="min-h-screen bg-gradient-to-br from-[#fff4ea] via-[#ffe8df] to-[#ffdce6] text-[#4a2c3a]">
      <nav className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-5 text-lg font-semibold"><span className="grid size-9 place-items-center rounded-xl bg-rose-100 text-rose-500"><Sparkles className="size-5" /></span>Kawaii 3D</nav>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-12 md:grid-cols-2">
        <div>
          <h1 className="text-5xl font-semibold leading-[1.05] md:text-6xl">Turn any picture into a tiny 3D keepsake.</h1>
          <p className="mt-5 max-w-md text-lg text-[#4a2c3a]/70">Drop in a logo, doodle or photo. We trace it, let you recolour every shade, and build a chunky layered model you can spin around.</p>
        </div>
        <div className="rounded-[2rem] border border-white/80 bg-white/70 p-6 shadow-xl shadow-rose-200/50 backdrop-blur">
          <h2 className="mb-3 text-sm font-semibold">Start with an image</h2>
          <Dropzone onFile={pick} />
          <p className="mt-3 text-xs text-[#4a2c3a]/60">You can also drop anywhere on this page, or paste with Ctrl+V.</p>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-16 sm:grid-cols-2 md:grid-cols-4">
        {STEPS.map(({ Icon, t, d }) => (
          <div key={t} className="rounded-3xl bg-white/60 p-5"><Icon className="mb-3 size-6 text-rose-400" /><b className="block">{t}</b><span className="text-sm text-[#4a2c3a]/60">{d}</span></div>
        ))}
      </section>
      {drag && <div className="pointer-events-none fixed inset-4 z-40 grid place-items-center rounded-[2rem] border-4 border-dashed border-rose-400 bg-rose-100/70 text-2xl font-semibold text-rose-500 backdrop-blur-sm">Drop your image here</div>}
      {bmp && <FrameModal bmp={bmp} onClose={() => setBmp(null)} onDone={setResult} />}
    </main>
  );
}
