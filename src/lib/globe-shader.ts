/**
 * Custom GLSL day/night shader for the globe.
 * Blends a daytime "blue marble" texture with a nighttime city-lights
 * texture based on real-time sun position, with bump mapping and
 * Fresnel rim glow.
 */

import * as THREE from "three";

// ── CDN texture URLs ────────────────────────────────────────────────

const CDN = "https://cdn.jsdelivr.net/npm/three-globe@2/example/img";
const DAY_URL = `${CDN}/earth-blue-marble.jpg`;
const NIGHT_URL = `${CDN}/earth-night.jpg`;
const BUMP_URL = `${CDN}/earth-topology.png`;

// ── GLSL Vertex Shader ──────────────────────────────────────────────

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    // Transform normal to world space (includes globe's -PI/2 Y rotation)
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ── GLSL Fragment Shader ────────────────────────────────────────────

const fragmentShader = /* glsl */ `
  uniform sampler2D dayTexture;
  uniform sampler2D nightTexture;
  uniform sampler2D bumpTexture;
  uniform vec3 sunDirection;   // normalized world-space direction TO the sun
  uniform float bumpScale;
  uniform float ambientNight;  // minimum brightness on the night side

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    // ── Bump-mapped normal (screen-space derivatives) ───────────
    float h = texture2D(bumpTexture, vUv).r;
    vec3 dpdx = dFdx(vWorldPosition);
    vec3 dpdy = dFdy(vWorldPosition);
    float dhdx = dFdx(h);
    float dhdy = dFdy(h);
    vec3 bumpedNormal = normalize(
      vWorldNormal + bumpScale * (dhdx * normalize(cross(dpdy, vWorldNormal))
                                + dhdy * normalize(cross(vWorldNormal, dpdx)))
    );

    // ── Day / Night blend ───────────────────────────────────────
    float cosAngle = dot(bumpedNormal, sunDirection);
    // smoothstep across ~17° twilight band
    float blend = smoothstep(-0.1, 0.2, cosAngle);

    vec3 dayColor = texture2D(dayTexture, vUv).rgb;
    vec3 nightColor = texture2D(nightTexture, vUv).rgb;

    // Boost city lights slightly so they pop on the dark side
    nightColor *= ambientNight;

    vec3 color = mix(nightColor, dayColor, blend);

    // ── Subtle Fresnel rim glow (atmospheric edge) ──────────────
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = 1.0 - dot(viewDir, bumpedNormal);
    fresnel = pow(fresnel, 3.0);
    color += vec3(0.25, 0.5, 0.9) * fresnel * 0.08;

    gl_FragColor = vec4(color, 1.0);

    // Three.js color management: convert linear → sRGB for display
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ── Material factory ────────────────────────────────────────────────

export interface GlobeUniforms {
  [key: string]: THREE.IUniform;
  dayTexture: THREE.IUniform<THREE.Texture | null>;
  nightTexture: THREE.IUniform<THREE.Texture | null>;
  bumpTexture: THREE.IUniform<THREE.Texture | null>;
  sunDirection: THREE.IUniform<THREE.Vector3>;
  bumpScale: THREE.IUniform<number>;
  ambientNight: THREE.IUniform<number>;
}

export function createDayNightMaterial(): {
  material: THREE.ShaderMaterial;
  uniforms: GlobeUniforms;
} {
  const uniforms: GlobeUniforms = {
    dayTexture: { value: null },
    nightTexture: { value: null },
    bumpTexture: { value: null },
    sunDirection: { value: new THREE.Vector3(1, 0, 0) },
    bumpScale: { value: 3.0 },
    ambientNight: { value: 1.5 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
  });

  return { material, uniforms };
}

// ── Texture loader ──────────────────────────────────────────────────

export function loadGlobeTextures(uniforms: GlobeUniforms): () => void {
  const loader = new THREE.TextureLoader();
  const textures: THREE.Texture[] = [];

  const load = (
    url: string,
    target: keyof Pick<GlobeUniforms, "dayTexture" | "nightTexture" | "bumpTexture">,
    colorSpace: THREE.ColorSpace
  ) => {
    loader.load(url, (tex) => {
      tex.colorSpace = colorSpace;
      uniforms[target].value = tex;
      textures.push(tex);
    });
  };

  load(DAY_URL, "dayTexture", THREE.SRGBColorSpace);
  load(NIGHT_URL, "nightTexture", THREE.SRGBColorSpace);
  load(BUMP_URL, "bumpTexture", THREE.LinearSRGBColorSpace);

  // Cleanup function
  return () => {
    textures.forEach((t) => t.dispose());
  };
}

// ── Outer glow (atmospheric halo) ───────────────────────────────────

const glowVertexShader = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFragmentShader = /* glsl */ `
  uniform vec3 glowColor;
  uniform float coefficient;
  uniform float power;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float intensity = pow(coefficient - dot(viewDir, vWorldNormal), power);
    gl_FragColor = vec4(glowColor, intensity * 0.35);
  }
`;

export function createOuterGlow(globeRadius: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(globeRadius * 1.15, 64, 64);
  const material = new THREE.ShaderMaterial({
    vertexShader: glowVertexShader,
    fragmentShader: glowFragmentShader,
    uniforms: {
      glowColor: { value: new THREE.Color("#4a90d9") },
      coefficient: { value: 0.6 },
      power: { value: 4.0 },
    },
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  return new THREE.Mesh(geometry, material);
}
