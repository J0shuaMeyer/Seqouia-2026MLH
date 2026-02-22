#!/usr/bin/env python3
"""
build-populartimes.py

Fetches weekly popular-times patterns for every POI that has a google_place_id.
Uses the `populartimes` library (pip install populartimes).

Output:  src/data/populartimes/{slug}.json

Usage:   python3 scripts/build-populartimes.py
Env:     MAPS_PLATFORM_API_KEY in .env
"""

import json
import os
import ssl
import sys
import time
from pathlib import Path

# Fix macOS Python SSL certificate issue
try:
    import certifi
    os.environ["SSL_CERT_FILE"] = certifi.where()
except ImportError:
    pass

# Also try the macOS-specific fix
if sys.platform == "darwin":
    try:
        ssl._create_default_https_context = ssl._create_unverified_context
    except AttributeError:
        pass

try:
    import populartimes
except ImportError:
    print("Missing dependency. Install with:")
    print("  pip install --upgrade git+https://github.com/m-wrzr/populartimes")
    sys.exit(1)


ROOT = Path(__file__).resolve().parent.parent
POIS_DIR = ROOT / "src" / "data" / "pois"
OUT_DIR = ROOT / "src" / "data" / "populartimes"
ENV_FILE = ROOT / ".env"

RATE_LIMIT_S = 1  # 1 second between calls


def load_api_key() -> str:
    """Load API key from environment or .env file."""
    key = os.environ.get("MAPS_PLATFORM_API_KEY")
    if key:
        return key

    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith("MAPS_PLATFORM_API_KEY"):
                _, _, val = line.partition("=")
                return val.strip()

    print("Missing MAPS_PLATFORM_API_KEY in environment or .env")
    sys.exit(1)


def fetch_populartimes_data(api_key: str, place_id: str) -> dict | None:
    """Fetch popular times for a single place. Returns dict or None on failure."""
    try:
        result = populartimes.get_id(api_key, place_id)
        return result
    except Exception as e:
        print(f"    Error: {e}")
        return None


def main():
    api_key = load_api_key()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    poi_files = sorted(POIS_DIR.glob("*.json"))
    total = 0
    fetched = 0
    skipped = 0
    no_data = 0

    for poi_file in poi_files:
        slug = poi_file.stem
        pois = json.loads(poi_file.read_text())

        print(f"\n── {slug} ({len(pois)} POIs) ──")

        city_data = {}

        for poi in pois:
            total += 1
            name = poi["name"]
            place_id = poi.get("google_place_id", "")

            if not place_id:
                skipped += 1
                print(f"  ⊘ {name} (no place_id)")
                continue

            print(f"  → {name} ...", end=" ", flush=True)

            result = fetch_populartimes_data(api_key, place_id)

            if result and result.get("populartimes"):
                city_data[name] = {
                    "google_place_id": place_id,
                    "category": poi.get("category", "other"),
                    "populartimes": result["populartimes"],
                    "current_popularity": result.get("current_popularity", 0),
                }
                fetched += 1
                cp = result.get("current_popularity", "n/a")
                print(f"✓ (current: {cp})")
            else:
                city_data[name] = {
                    "google_place_id": place_id,
                    "category": poi.get("category", "other"),
                    "populartimes": None,
                    "current_popularity": 0,
                }
                no_data += 1
                print("✗ (no data)")

            time.sleep(RATE_LIMIT_S)

        out_path = OUT_DIR / f"{slug}.json"
        out_path.write_text(json.dumps(city_data, indent=2) + "\n")
        print(f"  → Saved {out_path}")

    print(f"\n── Summary ──")
    print(f"  Total: {total}  Fetched: {fetched}  Skipped: {skipped}  No data: {no_data}")


if __name__ == "__main__":
    main()
