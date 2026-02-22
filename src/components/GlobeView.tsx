"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import Globe, { GlobeMethods } from "react-globe.gl";
import { cities } from "@/data/cities";
import { useGlobeData } from "@/context/GlobeDataContext";
import { getSunPosition } from "@/lib/sun";
import { activityToRingParams } from "@/lib/activity";
import { useGlobeShader } from "@/hooks/useGlobeShader";
import { createOuterGlow } from "@/lib/globe-shader";

// ── Types ──────────────────────────────────────────────────────────

interface CityPoint {
  lat: number;
  lng: number;
  name: string;
  slug: string;
  color: string;
  size: number;
}

interface RingDatum {
  lat: number;
  lng: number;
  maxRadius: number;
  propagationSpeed: number;
  repeatPeriod: number;
  color: (t: number) => string;
}

// ── Constants ──────────────────────────────────────────────────────

const STARS_BG =
  "https://cdn.jsdelivr.net/npm/three-globe@2/example/img/night-sky.png";
const CLOUDS_IMG = "/clouds.png";
const COUNTRY_GEOJSON_URL = "/ne_110m_admin_0_countries.geojson";
const CLOUDS_ALT = 0.004;
const CLOUDS_ROTATION_SPEED = -0.006; // deg/frame

// Small center dots for click targets (rings provide the visual)
const pointsData: CityPoint[] = cities.map((c) => ({
  lat: c.lat,
  lng: c.lng,
  name: c.name,
  slug: c.slug,
  color: "rgba(255, 200, 100, 0.7)",
  size: 0.15,
}));

// ── Component ──────────────────────────────────────────────────────

export default function GlobeView() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const router = useRouter();
  const { activityMap } = useGlobeData();
  const { material, uniforms } = useGlobeShader();

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [globeReady, setGlobeReady] = useState(false);
  const [countriesData, setCountriesData] = useState<object[]>([]);

  // ── Rings data from activity levels ─────────────────────────────

  const ringsData: RingDatum[] = useMemo(() => {
    return cities.map((city) => {
      const activity = activityMap[city.slug] ?? 0.2;
      const params = activityToRingParams(activity);
      return {
        lat: city.lat,
        lng: city.lng,
        ...params,
        color: (t: number) => `rgba(255, 160, 50, ${Math.max(0, 1 - t)})`,
      };
    });
  }, [activityMap]);

  // ── Fetch country boundaries ────────────────────────────────────

  useEffect(() => {
    fetch(COUNTRY_GEOJSON_URL)
      .then((res) => res.json())
      .then((data: { features: object[] }) => {
        const features = data.features.filter(
          (f: { properties?: { ISO_A2?: string } }) =>
            f.properties?.ISO_A2 !== "AQ"
        );
        setCountriesData(features);
      })
      .catch(() => setCountriesData([]));
  }, []);

  // ── Responsive dimensions ───────────────────────────────────────

  useEffect(() => {
    const update = () =>
      setDimensions({
        width: window.innerWidth - 256,
        height: window.innerHeight,
      });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ── Controls setup ──────────────────────────────────────────────

  useEffect(() => {
    if (!globeReady || !globeRef.current) return;
    try {
      const controls = globeRef.current.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.4;
      controls.enableZoom = true;
      globeRef.current.pointOfView({ altitude: 2.5 }, 1000);
    } catch {
      // controls not ready yet
    }
  }, [globeReady]);

  // ── Sun position updates (directional lighting) ─────────────────

  useEffect(() => {
    if (!globeReady || !globeRef.current || !dirLightRef.current) return;
    const globe = globeRef.current;
    const dirLight = dirLightRef.current;

    const updateSun = () => {
      const { lat, lng } = getSunPosition(new Date());

      // Reposition directional light to match sun
      const pos = globe.getCoords(lat, lng, 10);
      if (pos) {
        dirLight.position.set(pos.x, pos.y, pos.z);

        // Update shader sun direction uniform (normalized world-space vector)
        const dir = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
        uniforms.current.sunDirection.value.copy(dir);
      }
    };

    updateSun();
    const id = setInterval(updateSun, 60_000);
    return () => clearInterval(id);
  }, [globeReady, uniforms]);

  // ── Click handler ───────────────────────────────────────────────

  const handlePointClick = useCallback(
    (point: object) => {
      const p = point as CityPoint;
      router.push(`/city/${p.slug}`);
    },
    [router]
  );

  // ── Globe ready: setup materials, clouds, and lighting ──────────

  const handleGlobeReady = useCallback(() => {
    setGlobeReady(true);
    const globe = globeRef.current;
    if (!globe) return;
    const scene = globe.scene();
    const radius = globe.getGlobeRadius();
    if (!scene) return;

    // Adjust lighting (only affects cloud layer now — globe uses custom shader)
    const currentLights = globe.lights();
    const ambLight = currentLights.find(
      (l): l is THREE.AmbientLight => l instanceof THREE.AmbientLight
    );
    const dirLight = currentLights.find(
      (l): l is THREE.DirectionalLight => l instanceof THREE.DirectionalLight
    );

    if (ambLight) ambLight.intensity = 0.4;
    if (dirLight) {
      dirLight.intensity = 1.0;
      dirLightRef.current = dirLight;
    }

    // Outer atmospheric glow
    scene.add(createOuterGlow(radius));

    // Cloud layer
    new THREE.TextureLoader().load(CLOUDS_IMG, (cloudsTexture) => {
      const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(radius * (1 + CLOUDS_ALT), 75, 75),
        new THREE.MeshPhongMaterial({
          map: cloudsTexture,
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
        })
      );
      scene.add(clouds);
      const animate = () => {
        clouds.rotation.y += (CLOUDS_ROTATION_SPEED * Math.PI) / 180;
        requestAnimationFrame(animate);
      };
      animate();
    });
  }, []);

  // ── Render ──────────────────────────────────────────────────────

  if (dimensions.width <= 0 || dimensions.height <= 0) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <p className="text-white/50 text-sm">Loading globe...</p>
      </div>
    );
  }

  return (
    <Globe
      ref={globeRef}
      width={dimensions.width}
      height={dimensions.height}
      globeImageUrl=""
      globeMaterial={material}
      backgroundImageUrl={STARS_BG}
      backgroundColor="#05050a"
      globeCurvatureResolution={3}
      // Country polygons
      polygonsData={countriesData}
      polygonGeoJsonGeometry="geometry"
      polygonCapColor="rgba(0,0,0,0)"
      polygonSideColor="rgba(0,0,0,0)"
      polygonStrokeColor="rgba(255,255,255,0.25)"
      polygonAltitude={0.001}
      // Atmosphere
      showAtmosphere={true}
      atmosphereColor="#5a9fd4"
      atmosphereAltitude={0.18}
      // Pulsing activity rings
      ringsData={ringsData}
      ringLat="lat"
      ringLng="lng"
      ringColor="color"
      ringMaxRadius="maxRadius"
      ringPropagationSpeed="propagationSpeed"
      ringRepeatPeriod="repeatPeriod"
      ringAltitude={0.005}
      ringResolution={48}
      // City center dots (click targets)
      pointsData={pointsData}
      pointLat="lat"
      pointLng="lng"
      pointColor="color"
      pointRadius="size"
      pointAltitude={0.01}
      pointLabel="name"
      onPointClick={handlePointClick}
      onGlobeReady={handleGlobeReady}
      animateIn={true}
    />
  );
}
