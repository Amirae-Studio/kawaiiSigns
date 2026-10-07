"use client";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Layer } from "@/lib/types";

interface Props {
  layers: Layer[]; selectedId: string | null;
  onSelect: (id: string) => void; onChange: (id: string, patch: Partial<Layer>) => void;
}

export function LayerPanel({ layers, selectedId, onSelect, onChange }: Props) {
  return (
    <Card className="w-72 gap-2 rounded-3xl border-white/80 bg-white/75 p-4 shadow-xl shadow-rose-200/50 backdrop-blur">
      <h3 className="text-sm font-semibold text-[#4a2c3a]/70">Parts · {layers.length}</h3>
      <ScrollArea className="h-52 pr-2">
        <ul className="space-y-1">
          {layers.map((l) => (
            <li key={l.id} onClick={() => onSelect(l.id)}
              className={cn("flex items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-rose-50",
                l.id === selectedId && "bg-rose-100 ring-1 ring-rose-300")}>
              <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-full border-2 border-white shadow ring-1 ring-black/10"
                style={{ background: l.color }} onClick={(e) => e.stopPropagation()}>
                <input type="color" value={l.color} onChange={(e) => onChange(l.id, { color: e.target.value })}
                  className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label={`${l.name} colour`} />
              </label>
              <Input value={l.name} onChange={(e) => onChange(l.id, { name: e.target.value })}
                className="h-7 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-1" />
              <Button size="icon" variant="ghost" className="size-7 text-[#4a2c3a]/60"
                onClick={(e) => { e.stopPropagation(); onChange(l.id, { visible: !l.visible }); }}>
                {l.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </Button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </Card>
  );
}
