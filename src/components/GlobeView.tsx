"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import Globe, { GlobeMethods } from "react-globe.gl";
import { cities } from "@/data/cities";

interface CityPoint {
  lat: number;
  lng: number;
  name: string;
  slug: string;
  color: string;
  size: number;
}

const pointsData: CityPoint[] = cities.map((c) => ({
  lat: c.lat,
  lng: c.lng,
  name: c.name,
  slug: c.slug,
  color: "rgba(255, 180, 80, 0.9)",
  size: c.dataTier === 1 ? 0.5 : c.dataTier === 2 ? 0.35 : 0.25,
}));

const GLOBE_IMG =
  "https://cdn.jsdelivr.net/npm/three-globe@2/example/img/earth-night.jpg";
const BUMP_IMG =
  "https://cdn.jsdelivr.net/npm/three-globe@2/example/img/earth-topology.png";
const STARS_BG =
  "https://cdn.jsdelivr.net/npm/three-globe@2/example/img/night-sky.png";
const WATER_IMG =
  "https://cdn.jsdelivr.net/npm/three-globe@2/example/img/earth-water.png";
const CLOUDS_IMG = "/clouds.png";
const COUNTRY_GEOJSON_URL = "/ne_110m_admin_0_countries.geojson";
const CLOUDS_ALT = 0.004;
const CLOUDS_ROTATION_SPEED = -0.006; // deg/frame

export default function GlobeView() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const router = useRouter();
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [globeReady, setGlobeReady] = useState(false);
  const [countriesData, setCountriesData] = useState<object[]>([]);

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

  const handlePointClick = useCallback(
    (point: object) => {
      const p = point as CityPoint;
      router.push(`/city/${p.slug}`);
    },
    [router]
  );

  const handleGlobeReady = useCallback(() => {
    setGlobeReady(true);
    const globe = globeRef.current;
    if (!globe) return;
    const scene = globe.scene();
    const radius = globe.getGlobeRadius();
    if (!scene) return;

    // Custom globe material: bumpScale + specular for water
    const globeMaterial = (globe as { globeMaterial?: () => THREE.Material }).globeMaterial?.();
    if (globeMaterial && "bumpScale" in globeMaterial) {
      (globeMaterial as THREE.MeshPhongMaterial).bumpScale = 10;
      new THREE.TextureLoader().load(WATER_IMG, (texture) => {
        const mat = globeMaterial as THREE.MeshPhongMaterial;
        mat.specularMap = texture;
        mat.specular = new THREE.Color("grey");
        mat.shininess = 15;
      });
    }

    // Cloud layer
    new THREE.TextureLoader().load(CLOUDS_IMG, (cloudsTexture) => {
      const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(radius * (1 + CLOUDS_ALT), 75, 75),
        new THREE.MeshPhongMaterial({
          map: cloudsTexture,
          transparent: true,
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
      globeImageUrl={GLOBE_IMG}
      bumpImageUrl={BUMP_IMG}
      backgroundImageUrl={STARS_BG}
      backgroundColor="#05050a"
      globeCurvatureResolution={3}
      polygonsData={countriesData}
      polygonGeoJsonGeometry="geometry"
      polygonCapColor="rgba(0,0,0,0)"
      polygonSideColor="rgba(0,0,0,0)"
      polygonStrokeColor="rgba(255,255,255,0.25)"
      polygonAltitude={0.001}
      showAtmosphere={true}
      atmosphereColor="#6b9bc7"
      atmosphereAltitude={0.18}
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
