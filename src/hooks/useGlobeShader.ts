import { useEffect, useMemo, useRef } from "react";
import type { ShaderMaterial } from "three";
import {
  createDayNightMaterial,
  loadGlobeTextures,
  type GlobeUniforms,
} from "@/lib/globe-shader";

/**
 * Creates and manages the custom day/night ShaderMaterial for the globe.
 * Returns a stable material reference (for the `globeMaterial` prop) and
 * a ref to the live uniforms (for sun-position updates).
 */
export function useGlobeShader() {
  const { material, uniforms } = useMemo(() => createDayNightMaterial(), []);
  const uniformsRef = useRef<GlobeUniforms>(uniforms);

  useEffect(() => {
    const disposeTextures = loadGlobeTextures(uniforms);

    return () => {
      disposeTextures();
      material.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    material: material as ShaderMaterial,
    uniforms: uniformsRef,
  };
}
