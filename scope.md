# Sequoia

**A real-time interface for seeing where people are — right now — across the world's largest cities.**

---

## Vision

Sequoia transforms a traditional globe-based map into a living visualization of real-time human presence. Rather than displaying static geography, it renders cities as dynamic systems shaped by real-time public signals — crowdsourced traffic reports, foot traffic density, public transit activity, and environmental conditions — synthesizing them into an interpretable activity index.

From a global 3D perspective, users observe cities pulsing with varying levels of presence and connectivity. Drilling into a specific city transitions to a 2D micro view that highlights activity pressure across H3 hexagonal zones, illustrating where people actually are right now. Over time, this naturally reveals how populations move and shift throughout the day.

---

## User Flow

1. **3D Globe (macro view):** A slowly rotating globe with real-time air traffic arcs (OpenSky) and ship positions (AIS). 27 megacities appear as glowing markers, pulsing proportionally to their aggregate activity level.
2. **Left Sidebar:** A scrollable list of all supported cities (from `cities_list.csv`). Click any city to navigate.
3. **Animated Transition:** Clicking a city triggers a zoom animation from the globe into the city.
4. **2D City Drill-down (micro view — the hero):** Full-screen MapLibre + deck.gl view with H3 hex grid overlay. Hexes are colored blue (quiet) → yellow (moderate) → red (intense) based on relative activity pressure. Data layer toggles let users isolate traffic, foot traffic, or weather. A city-level "pulse" percentage shows overall activity.
5. **Back to Globe:** A back button returns to the 3D globe view.

---

## Activity Index

**Method:** Relative Pressure Ranking + City Pulse

- Events from all data sources are spatially binned into **H3 hexagons** (Uber's hierarchical hex grid system)
- Each hex gets a raw count/weight of events within it
- Hexes are ranked against all other hexes in the same city → percentile ranking
- Visualization: percentile drives hex color (blue → yellow → red)
- A **city-level aggregate pulse** provides the absolute "how active is this city overall" signal (displayed as a percentage)
- The pulse value also drives the city marker glow intensity on the 3D globe

**Graceful degradation:** Cities with fewer data sources still get ranked on whatever data is available. Lagos with only weather + air traffic still renders a meaningful hex map.

---

## Data Sources

### Primary (must-have for hackathon MVP)

| Source | Signal | Method | What It Tells Us |
|--------|--------|--------|-----------------|
| **Waze Live Reports** | Traffic incidents, congestion, driver density | Scrape live map endpoints + cache | Where drivers are right now |
| **BestTime API** | Venue/area foot traffic busyness | REST API | Where pedestrians are right now |
| **WeatherAPI** | Temperature, precipitation, conditions | REST API | Environmental context affecting presence |

### Globe Data Sources

| Source | Signal | Method |
|--------|--------|--------|
| **OpenSky Network** | Real-time aircraft positions | REST API (free, no auth for basic) |
| **aisstream.io** | Real-time ship positions via AIS | WebSocket (free, API key) |

### Stretch Goals

| Source | Signal | What It Adds |
|--------|--------|-------------|
| **MTA GTFS Real-time** | Subway/bus activity in NYC | Public transit rider density |
| **Gemini AI** | Natural language city interpretation | "What's happening in NYC right now" descriptions |

---

## City Coverage

**Hackathon launch city:** New York City (richest data across all sources)

**Full city list** (27 megacities by population, defined in `cities_list.csv`):
Jakarta, Dhaka, Tokyo, Delhi, Shanghai, Guangzhou, Cairo, Manila, Kolkata, Seoul, Karachi, Mumbai, Sao Paulo, Bangkok, Mexico City, Beijing, Lahore, Istanbul, Moscow, Ho Chi Minh City, Buenos Aires, New York City, Shenzhen, Bengaluru, Osaka, Lagos, Los Angeles

**Note:** `cities_list.csv` should be extended with columns: `lat`, `lng`, `timezone`, `data_tier` (indicating expected data richness per city).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16, React 19 |
| Styling | Tailwind CSS |
| Animation | Framer Motion |
| Global State | Zustand |
| Data Fetching | TanStack Query (caching, retry, refetch intervals) |
| 3D Globe | react-globe.gl |
| 2D Map | MapLibre GL |
| Hex Overlays | deck.gl (H3HexagonLayer) |
| Spatial Binning | H3 (Uber's hex grid library) |
| Server API | Vercel Route Handlers |
| Deployment | Vercel |

---

## Architecture

```
Browser
├── Globe View (react-globe.gl)
│   ├── OpenSky air traffic arcs
│   ├── AIS ship position dots
│   └── City markers (glow = aggregate activity pulse)
│
├── City Drill-down View (MapLibre + deck.gl)
│   ├── H3 hex grid overlay (activity pressure by percentile)
│   ├── Data layer toggles (traffic / foot traffic / weather)
│   └── City pulse indicator (aggregate %)
│
└── Left Sidebar
    └── Scrollable city list (from cities_list.csv)

Server (Vercel Route Handlers)
├── /api/waze       → scrape + cache Waze live map reports
├── /api/foot-traffic → BestTime API proxy
├── /api/weather    → WeatherAPI proxy
├── /api/opensky    → OpenSky API proxy
└── /api/ais        → aisstream.io WebSocket relay
```

---

## Hackathon Time Budget (24h solo)

| Phase | Est. Hours | Deliverable |
|-------|-----------|-------------|
| Project setup (Next.js, deps, routing, layout) | 1-2h | Running app with sidebar + view shells |
| 3D Globe + OpenSky air traffic | 2-3h | Rotating globe with live flight arcs |
| AIS ship integration | 1-2h | Ship dots on globe via WebSocket |
| City markers + sidebar + zoom transition | 1-2h | Clickable cities, animated zoom to 2D |
| 2D MapLibre view + H3 hex grid | 2-3h | Base map with hex overlay rendering |
| Waze data integration + hex binning | 1-2h | Live traffic incidents → hex coloring |
| BestTime foot traffic integration | 1-2h | Venue busyness → hex coloring |
| Weather layer | 0.5-1h | Weather conditions overlay |
| Activity index computation + pulse UI | 1h | Percentile ranking, city pulse display |
| Polish, deployment, demo prep | 2h | Deployed on Vercel, demo-ready |
| **Total** | **~14-18h** | |

**Critical path:** Setup → 2D hex map → Waze → foot traffic. Globe can be built in parallel.

---

## Requirements

- WeatherAPI key
- BestTime API key (or Google Maps scraper fallback)
- aisstream.io API key
- OpenSky (no key needed for basic queries)
- Waze scraper (no key, scrape public endpoints)
- `.env` file for all keys

---

## Stretch Goals (if time allows)

1. MTA GTFS real-time transit integration for NYC
2. Gemini AI interpretation layer ("What's happening in this city right now")
3. Time-series playback (replay the last 24h of activity)
4. Additional cities beyond NYC with full data layers
5. Extend `cities_list.csv` with lat/lng/timezone/data_tier columns
