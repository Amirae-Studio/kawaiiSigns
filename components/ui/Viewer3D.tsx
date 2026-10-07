"use client";
import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Group } from "@/lib/build";
import type { Layer } from "@/lib/types";

interface Props { groups: Group[]; layers: Layer[]; selectedId: string | null; onSelect: (id: string | null) => void }

function Model({ groups, layers, selectedId, onSelect }: Props) {
  const box = useMemo(() => {
    const b = new THREE.Box3();
    groups.forEach((g) => g.parts.forEach((p) => { p.geo.computeBoundingBox(); b.union(p.geo.boundingBox!); }));
    return b;
  }, [groups]);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  return (
    <>
      <group rotation={[-0.2, 0.2, 0]}>
        <group position={[-c.x, -c.y, -c.z]}>
          {groups.flatMap((g) => g.parts.map((p) => {
            const l = p.layerId ? layers.find((x) => x.id === p.layerId) : undefined;
            return (
              <mesh key={p.id} geometry={p.geo} onClick={p.layerId ? (e) => { e.stopPropagation(); onSelect(p.layerId!); } : undefined}>
                <meshStandardMaterial color={l?.color ?? p.color} roughness={0.8} emissive={p.layerId && p.layerId === selectedId ? "#ff6f91" : "#000"} emissiveIntensity={0.35} />
              </mesh>
            );
          }))}
        </group>
      </group>
      <ContactShadows position={[0, -size.y / 2 - 0.05, 0]} opacity={0.35} blur={2.5} scale={12} />
    </>
  );
}

export default function Viewer3D(props: Props) {
  return (
    <Canvas flat camera={{ position: [0, 0, 10], fov: 35 }} dpr={[1, 2]} onPointerMissed={() => props.onSelect(null)}>
      <ambientLight intensity={1.4} />
      <directionalLight position={[4, 6, 8]} intensity={2.4} />
      <directionalLight position={[-5, -2, 4]} intensity={0.5} color="#ffd6e0" />
      {props.groups.length > 0 && <Model {...props} />}
      <OrbitControls makeDefault enableDamping enablePan={false} minDistance={3} maxDistance={18} />
    </Canvas>
  );
}