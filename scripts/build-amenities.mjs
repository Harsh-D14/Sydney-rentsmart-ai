#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Rebuilds src/data/suburb_amenities.json (+ .meta.json) from OpenStreetMap.
//
//   node scripts/build-amenities.mjs            # uses scripts/.cache if present
//   node scripts/build-amenities.mjs --refresh  # re-download everything
//
// Approach: ONE Overpass request per category (6 in total) covering a single
// bounding box around every postcode centroid, then items are assigned to
// postcodes locally by haversine distance. That is ~6 requests instead of
// ~237 per-postcode radius queries, which is far kinder to the public API.
//
// Each category's raw response is cached in scripts/.cache/ so an interrupted
// run resumes without re-downloading. The cache directory is not meant to be
// committed.
//
// Plain Node 22+, no dependencies.
// ---------------------------------------------------------------------------

import dns from "node:dns";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUBURBS_FILE = join(ROOT, "src/data/sydney_suburbs.json");
const OUT_FILE = join(ROOT, "src/data/suburb_amenities.json");
const META_FILE = join(ROOT, "src/data/suburb_amenities.meta.json");
const CACHE_DIR = join(ROOT, "scripts/.cache");

const RADIUS_KM = 5;
const MAX_PER_CATEGORY = 15;
const PAUSE_MS = 5_000; // between Overpass requests
const QL_TIMEOUT_S = 180;
const MAX_ATTEMPTS = 5;
const USER_AGENT =
  "SydneyRentSmartAI-amenity-build/1.0 (one-off static dataset build; 6 requests per run)";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/** Output category -> OSM `amenity` values. */
const CATEGORIES = {
  hospitals: ["hospital"],
  schools: ["school"],
  universities: ["university"],
  fire_stations: ["fire_station"],
  police: ["police"],
  childcare: ["childcare", "kindergarten"],
};

const REFRESH = process.argv.includes("--refresh");

// Node gives each connection attempt only 250 ms before trying the next
// address family, which is too short for a server on another continent (or a
// network with a dead IPv6 route) and surfaces as ETIMEDOUT. Prefer IPv4 and
// allow a realistic connect time.
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamilyAttemptTimeout(5_000);

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Same formula as src/lib/geo.ts. */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Postcode centroid = mean lat/lng of ALL rows in sydney_suburbs.json with
 * that postcode and non-null coords. Postcodes whose rows all lack coords
 * cannot be placed and are returned separately.
 */
async function loadCentroids() {
  const suburbs = JSON.parse(await readFile(SUBURBS_FILE, "utf8"));
  const sums = new Map();
  const all = new Set();
  for (const row of Object.values(suburbs)) {
    const pc = String(row.postcode);
    all.add(pc);
    if (typeof row.lat !== "number" || typeof row.lng !== "number") continue;
    const s = sums.get(pc) ?? { lat: 0, lng: 0, n: 0 };
    s.lat += row.lat;
    s.lng += row.lng;
    s.n += 1;
    sums.set(pc, s);
  }
  const centroids = new Map();
  for (const [pc, s] of sums) centroids.set(pc, { lat: s.lat / s.n, lng: s.lng / s.n });
  const unplaced = [...all].filter((pc) => !centroids.has(pc)).sort();
  return { centroids, unplaced, total: all.size };
}

/** Box containing every centroid's search radius (with a little slack). */
function boundingBox(centroids) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const c of centroids.values()) {
    minLat = Math.min(minLat, c.lat);
    maxLat = Math.max(maxLat, c.lat);
    minLng = Math.min(minLng, c.lng);
    maxLng = Math.max(maxLng, c.lng);
  }
  const padKm = RADIUS_KM + 0.5;
  const padLat = padKm / 111;
  const padLng = padKm / (111 * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
  return {
    south: round(minLat - padLat, 4),
    west: round(minLng - padLng, 4),
    north: round(maxLat + padLat, 4),
    east: round(maxLng + padLng, 4),
  };
}

// ---------------------------------------------------------------------------
// Overpass
// ---------------------------------------------------------------------------

let requestCount = 0;

function buildQuery(amenityValues, box) {
  const filter =
    amenityValues.length === 1
      ? `["amenity"="${amenityValues[0]}"]`
      : `["amenity"~"^(${amenityValues.join("|")})$"]`;
  return [
    `[out:json][timeout:${QL_TIMEOUT_S}][bbox:${box.south},${box.west},${box.north},${box.east}];`,
    `nwr${filter}["name"];`,
    "out tags center;",
  ].join("\n");
}

/** POST a query, rotating mirrors and backing off on 429/504/network errors. */
async function overpass(query) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    if (attempt > 0) {
      const wait = Math.min(120_000, 15_000 * 2 ** (attempt - 1));
      console.log(`    retrying in ${wait / 1000}s via ${new URL(endpoint).host}`);
      await sleep(wait);
    }
    requestCount += 1;
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout((QL_TIMEOUT_S + 30) * 1000),
      });
      if (!resp.ok) {
        lastError = new Error(`${new URL(endpoint).host} responded ${resp.status}`);
        console.log(`    ${lastError.message}`);
        continue;
      }
      const json = await resp.json();
      // Overpass reports server-side timeouts/out-of-memory as a 200 + remark.
      if (typeof json.remark === "string" && /error/i.test(json.remark)) {
        lastError = new Error(`${new URL(endpoint).host}: ${json.remark}`);
        console.log(`    ${lastError.message}`);
        continue;
      }
      if (!Array.isArray(json.elements)) {
        lastError = new Error(`${new URL(endpoint).host}: response has no elements array`);
        continue;
      }
      return { endpoint, json };
    } catch (err) {
      lastError = err;
      const detail = err.cause?.code ? `${err.message} (${err.cause.code})` : err.message;
      console.log(`    ${new URL(endpoint).host} failed: ${detail}`);
    }
  }
  throw new Error(`Overpass failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`);
}

/** Raw elements for one category, from cache when the bounding box matches. */
async function fetchCategory(category, box) {
  const cacheFile = join(CACHE_DIR, `${category}.json`);
  const boxKey = JSON.stringify(box);
  if (!REFRESH) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf8"));
      if (JSON.stringify(cached.box) === boxKey && Array.isArray(cached.elements)) {
        console.log(`  ${category}: ${cached.elements.length} elements (cached ${cached.fetched_at})`);
        return { elements: cached.elements, osmBase: cached.osm_base };
      }
    } catch {
      // no usable cache
    }
  }
  if (requestCount > 0) await sleep(PAUSE_MS); // be polite between requests
  const { endpoint, json } = await overpass(buildQuery(CATEGORIES[category], box));
  const payload = {
    category,
    box,
    endpoint,
    fetched_at: new Date().toISOString(),
    osm_base: json.osm3s?.timestamp_osm_base ?? null,
    elements: json.elements,
  };
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(payload));
  console.log(`  ${category}: ${json.elements.length} elements (${new URL(endpoint).host})`);
  return { elements: json.elements, osmBase: payload.osm_base };
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

/** Named points, de-duplicated by name + coords rounded to ~100 m. */
function toPoints(elements) {
  const seen = new Set();
  const points = [];
  for (const el of elements) {
    const name = el.tags?.name?.trim().replace(/\s+/g, " ");
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const key = `${name.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ name, lat: round(lat, 5), lng: round(lng, 5) });
  }
  return points;
}

function nearest(points, centroid) {
  const latWindow = RADIUS_KM / 110; // cheap pre-filter before haversine
  const hits = [];
  for (const p of points) {
    if (Math.abs(p.lat - centroid.lat) > latWindow) continue;
    const d = haversineKm(centroid.lat, centroid.lng, p.lat, p.lng);
    if (d <= RADIUS_KM) hits.push({ name: p.name, distance_km: round(d, 2), lat: p.lat, lng: p.lng });
  }
  hits.sort((a, b) => a.distance_km - b.distance_km || a.name.localeCompare(b.name));
  return hits.slice(0, MAX_PER_CATEGORY);
}

/** One postcode per line: compact, but still diffable. */
function serialize(result) {
  const lines = Object.keys(result)
    .sort()
    .map((pc) => `${JSON.stringify(pc)}:${JSON.stringify(result[pc])}`);
  return `{\n${lines.join(",\n")}\n}\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { centroids, unplaced, total } = await loadCentroids();
  const box = boundingBox(centroids);
  console.log(`${total} postcodes, ${centroids.size} with a centroid`);
  if (unplaced.length) console.log(`No coordinates (skipped): ${unplaced.join(", ")}`);
  console.log(`Bounding box: ${box.south},${box.west},${box.north},${box.east}`);

  const points = {};
  const osmBases = [];
  for (const category of Object.keys(CATEGORIES)) {
    const fetched = await fetchCategory(category, box);
    points[category] = toPoints(fetched.elements);
    if (fetched.osmBase) osmBases.push(fetched.osmBase);
  }

  const result = {};
  const counts = {};
  const zeroCounts = {};
  for (const category of Object.keys(CATEGORIES)) {
    counts[category] = 0;
    zeroCounts[category] = 0;
  }
  for (const [pc, centroid] of centroids) {
    result[pc] = {};
    for (const category of Object.keys(CATEGORIES)) {
      const items = nearest(points[category], centroid);
      result[pc][category] = items;
      counts[category] += items.length;
      if (items.length === 0) zeroCounts[category] += 1;
    }
  }

  const meta = {
    generated_at: new Date().toISOString(),
    source: "OpenStreetMap via Overpass API",
    license: "© OpenStreetMap contributors, ODbL 1.0",
    osm_data_timestamp: osmBases.sort()[0] ?? null,
    radius_km: RADIUS_KM,
    max_per_category: MAX_PER_CATEGORY,
    postcodes: centroids.size,
    postcodes_without_coordinates: unplaced,
    counts,
    postcodes_with_zero: zeroCounts,
    unique_items_in_area: Object.fromEntries(
      Object.entries(points).map(([category, list]) => [category, list.length]),
    ),
  };

  await writeFile(OUT_FILE, serialize(result));
  await writeFile(META_FILE, `${JSON.stringify(meta, null, 2)}\n`);

  console.log(`\nWrote ${centroids.size} postcodes to ${OUT_FILE}`);
  console.log(`Overpass requests this run: ${requestCount}`);
  console.log("Items kept per category:", counts);
  console.log("Postcodes with zero items:", zeroCounts);
}

main().catch((err) => {
  console.error(`\nBuild failed: ${err.message}`);
  console.error("Nothing was written. Cached categories are kept; re-run to resume.");
  process.exit(1);
});
