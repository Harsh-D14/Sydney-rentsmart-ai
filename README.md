# Sydney RentSmart AI

A web app that helps renters find Sydney areas they can afford. It ranks
Greater Sydney postcodes by how much of a weekly income (or a weekly rent
budget) the local median rent takes up, using NSW rental bond lodgement data.

Built for the Western Sydney AI Summit at WSTI.

## What it does

- Takes a weekly income, or a maximum weekly rent, plus optional bedroom
  count, number of people sharing, and a workplace (suburb name, postcode or
  "CBD").
- Returns one result per postcode, sorted from lowest to highest rent stress,
  each with its median rent, bond count, rent by year, dwelling mix, nearest
  station and straight-line distance to the workplace.
- Shows the areas on a map (Leaflet with OpenStreetMap tiles) and has a detail
  page per suburb.
- For a chosen suburb and workplace, looks up a public transport time and a
  driving time, and falls back to a labelled estimate when no routing service
  answers.

## How it works

**Postcode-level data.** The rent, bond and income figures are measured per
postcode. `src/data/sydney_suburbs.json` holds 886 suburb rows covering 237
postcodes and 1,129,892 bond lodgements (about 1.1 million) from 2021 to 2025.
Every suburb sharing a postcode carries the same figures, so results are
grouped to one entry per postcode, named after a representative suburb and
placed at the mean of that postcode's suburb coordinates
(`src/lib/suburbs.ts`). Three unnamed postcodes have no coordinates and are
never returned by the search or the map.

**Two modes** (`GET /api/recommend`):

| Mode | The number you enter | What is returned |
| --- | --- | --- |
| `income` (default) | Weekly income | Areas where rent is at most 100% of income, each with a rent-stress percentage and band |
| `budget` | Maximum weekly rent, per person when sharing | Areas where the per-person rent is within the budget; no stress band |

When 2 to 4 people share, the rent of a dwelling with that many bedrooms is
split evenly (two people can instead share a 1-bedroom). If a postcode has no
figure for that size, a smaller dwelling stands in and the result is marked
`rent_estimated`.

**Rent-stress bands** (`src/lib/stress.ts`), rent as a share of weekly income:

| Share of income | Band |
| --- | --- |
| Under 25% | Comfortable |
| 25% to 30% | Manageable |
| Over 30%, up to 40% | Stressed |
| Over 40% | Severe |

**Commute times** (`GET /api/commute`). Public transport comes from the
Transport for NSW Trip Planner for an 08:00 departure on the next Sydney
weekday. Driving comes from OpenRouteService, with Google Routes as a
fallback. If neither driving service is configured or answers, the response
carries an estimate derived from straight-line distance, marked
`is_estimate: true`.

## Data sources

Bundled data, as listed on the app's About page:

- [NSW Fair Trading Rental Bond Data](https://www.fairtrading.nsw.gov.au/about-fair-trading/rental-bond-data):
  weekly rent, postcode, dwelling type and bedroom count of bond lodgements.
- [ABS Census 2021, General Community Profile (G02)](https://www.abs.gov.au/census/find-census-data/datapacks):
  median weekly household income by postal area.
- [Transport for NSW Open Data](https://opendata.transport.nsw.gov.au/):
  train, metro and ferry station locations.
- [Australian Postcodes Dataset](https://www.matthewproctor.com/australian_postcodes):
  postcode-to-suburb mapping with coordinates.

Services called at run time or build time:

- [OpenStreetMap](https://www.openstreetmap.org/copyright): map tiles, and
  amenity data through the Overpass API (`src/lib/overpass.ts`,
  `scripts/build-amenities.mjs`).
- [OpenRouteService](https://openrouteservice.org/): driving and cycling
  routes (`src/lib/ors-directions.ts`).
- Transport for NSW Trip Planner API: public transport journeys
  (`src/app/api/commute/route.ts`).
- Google Routes API: driving-time fallback (`src/app/api/commute/route.ts`).

## Data provenance and limits

- **The rent dataset cannot be regenerated from this repository.** The script
  that produced `src/data/sydney_suburbs.json` from the raw NSW bond data is
  not in this repo. The file is used as it is.
- Rents are postcode-level medians of **new bond lodgements**. They do not
  cover renewals or existing tenancies and are not asking rents.
- Household income is from the **2021 Census** and may not reflect current
  incomes.
- Postcodes with **fewer than 100 bonds** (10 of the 237) are flagged
  `low_sample`: their medians are unreliable. They are left out of the
  Sydney-wide median.
- Suburb names come from a postcode dataset that also lists postal delivery
  points (for example "Parramatta Westfield"). Those are filtered out of the
  search with a hand-maintained list in `src/lib/suburbs.ts`.
- Commute times are estimates from straight-line distance unless a routing
  API responds. Routed times are for typical conditions, not live traffic.
- Amenities: `scripts/build-amenities.mjs` exists and rebuilds
  `src/data/suburb_amenities.json` from OpenStreetMap.
  The committed file was generated on 13 October 2026 and covers 234 of the
  237 postcodes (the other three have no coordinates). It lists up to 15 named
  places per category within 5 km of each postcode centroid, so it is only as
  complete as OpenStreetMap is for that area.
- The app is for information only and is not financial or housing advice.

## Getting started

Requires Node.js 22.

```bash
npm install
cp .env.example .env.local   # optional, see below
npm run dev                  # http://localhost:3000
```

Other commands:

```bash
npm test            # unit and route-handler tests (Vitest)
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run build       # production build
```

The tests run against the bundled data files and make no network calls.

## Environment variables

All are optional. With none set, the affordability search, map and suburb
pages work, and commute times are straight-line estimates. See
`.env.example`.

| Variable | Used for | When missing |
| --- | --- | --- |
| `OPENROUTE_API_KEY` | Driving times and map route lines (OpenRouteService) | `/api/directions` returns 503; `/api/commute` driving falls back to Google Routes, then to an estimate |
| `TFNSW_API_KEY` | Public transport times (TfNSW Trip Planner) | `/api/commute` returns `transit: null` with `transit_error: "not_configured"` |
| `GOOGLE_MAPS_API_KEY` | Driving-time fallback (Google Routes API) | No fallback; driving uses the estimate when OpenRouteService cannot answer |
| `CHAT_ENABLED` | Turns on `POST /api/chat` when set to exactly `true` | `/api/chat` returns 503 |
| `ANTHROPIC_API_KEY` | The chat endpoint's model calls | Only matters when chat is enabled; `/api/chat` returns 503 |

## API routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/recommend` | Affordable areas, one per postcode. Params: `income` (required), `mode`, `bedrooms`, `sharing`, `share_bedroom`, `workplace` |
| GET | `/api/suburbs` | Map points, one per postcode. With `?search=`, suburb-name autocomplete (at most 10) |
| GET | `/api/suburbs/[suburbKey]` | One suburb by key (`Parramatta_2150`) or bare postcode, with nearby stations and Sydney-wide medians |
| GET | `/api/commute` | Public transport and driving time between two points in Greater Sydney |
| GET | `/api/directions` | Driving or cycling route geometry between two points (needs `OPENROUTE_API_KEY`) |
| GET | `/api/amenities` | Stored amenity data for a postcode (`?postcode=`) |
| GET | `/api/overpass-poi` | Places around a point, fetched live from the Overpass API (`?lat=&lng=&radius=`) |
| POST | `/api/chat` | AI chat advisor; switched off unless `CHAT_ENABLED=true` |

The full request and response shapes are documented in the header comment of
each route file under `src/app/api/`.

## Deployment

The app is set up for Vercel. Set the environment variables above in the
Vercel project settings.

`/api/commute`, `/api/directions` and `/api/chat` have a per-IP rate limiter
(`src/lib/rate-limit.ts`). Its counters live in the memory of one server
instance, so on serverless hosting each instance counts separately and the
counters reset on a cold start. It slows down a single abusive client but is
not a hard quota. A hard limit needs Vercel firewall rules or a shared store.

## Status

The AI chat advisor is switched off. The endpoint is behind the
`CHAT_ENABLED` flag and the chat component is not rendered on any page.
