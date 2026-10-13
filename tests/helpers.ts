import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A row of src/data/sydney_suburbs.json, read straight from disk. */
export interface RawRow {
  suburb_key: string;
  postcode: string;
  suburb_name: string | null;
  lat: number | null;
  lng: number | null;
  total_bonds: number;
  median_rent_overall: number | null;
  [field: string]: unknown;
}

/**
 * The raw data file, parsed without going through any app code, so tests can
 * recompute expected values independently of src/lib/suburbs.ts.
 */
export function loadRawRows(): RawRow[] {
  const path = fileURLToPath(new URL("../src/data/sydney_suburbs.json", import.meta.url));
  return Object.values(JSON.parse(readFileSync(path, "utf8")) as Record<string, RawRow>);
}

export function groupByPostcode(rows: RawRow[]): Map<string, RawRow[]> {
  const grouped = new Map<string, RawRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.postcode);
    if (list) list.push(row);
    else grouped.set(row.postcode, [row]);
  }
  return grouped;
}

// Coordinates of two rows in the data file, used as in-area test points.
export const SYDNEY_CBD = { lat: -33.870846, lng: 151.20733 };
export const PARRAMATTA = { lat: -33.813557, lng: 151.003407 };
