export interface Layer { id: string; name: string; d: string; color: string; visible: boolean }
export type SignStyle = "diecut" | "blade" | "aframe" | "desk";
export type PlateShape = "rect" | "round" | "pill" | "arch";
export interface ModelSettings {
  style: SignStyle; shape: PlateShape; depth: number; plate: number; pad: number; radius: number; hole: boolean;
  bodyColor: string; standColor: string; slab: number; outline: number; gap: number; edgeColor: string;
}
export type TextPos = "top" | "middle" | "bottom";
export interface TextSettings { enabled: boolean; headline: string; color: string; size: number; pos: TextPos; x: number; y: number; depth: number }
export interface ParsedSvg { layers: Layer[]; width: number; height: number }
export interface FrameResult extends ParsedSvg { slabD: string; ink: string }