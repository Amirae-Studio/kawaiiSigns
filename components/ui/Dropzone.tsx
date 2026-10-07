"use client";
import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dropzone({ onFile, name }: { onFile: (f: File) => void; name?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (f?: File) => {
    if (!f) return;
    const isImageOrSvg = f.type.startsWith("image/") || f.type === "image/svg+xml" || f.name.toLowerCase().endsWith(".svg");
    if (isImageOrSvg) onFile(f);
  };
  return (
    <div role="button" tabIndex={0} onClick={() => input.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); take(e.dataTransfer.files[0]); }}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-rose-300/70 bg-rose-50/60 p-4 transition",
        "hover:bg-rose-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400",
        over && "scale-[1.02] border-rose-400 bg-rose-100")}>
      <span className="grid size-12 place-items-center rounded-xl bg-white text-rose-400 shadow-sm"><ImagePlus /></span>
      <span className="text-sm leading-tight">
        <b className="block text-[#4a2c3a]">{name ?? "Drop a logo or image"}</b>
        <span className="text-[#4a2c3a]/60">or <u className="text-rose-500">browse</u> · SVG, PNG, JPG, WEBP</span>
      </span>
      <input ref={input} type="file" accept="image/*,.svg" hidden onChange={(e) => take(e.target.files?.[0])} />
    </div>
  );
}
