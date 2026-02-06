/**
 * Geographic utilities for suburb distance calculations.
 * Uses Haversine formula for accurate straight-line distances.
 */
import fs from "fs";
import path from "path";
import { CONFIG } from "./config.js";

export interface Suburb {
  id: number;
  name: string;
  state: string;
  postcode: string;
  lat: number;
  lng: number;
  area: string;
  region: string;
}

let suburbsCache: Suburb[] | null = null;

/**
 * Load suburbs from CSV file (cached after first load)
 */
export function loadSuburbs(): Suburb[] {
  if (suburbsCache) return suburbsCache;

  const csvPath = path.resolve(CONFIG.tradeAgentDir, "../resources/suburbs.csv");
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.trim().split("\n");

  // Skip header
  suburbsCache = lines.slice(1).map((line) => {
    // Handle commas in quoted fields (e.g., "Hunter, Central & Northern NSW")
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim());

    return {
      id: parseInt(fields[0]),
      name: fields[1],
      state: fields[2],
      postcode: fields[3],
      lat: parseFloat(fields[4]),
      lng: parseFloat(fields[5]),
      area: fields[6],
      region: fields[7],
    };
  });

  return suburbsCache;
}

/**
 * Haversine formula - calculate distance between two lat/lng points
 * Returns distance in kilometers
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Find a suburb by name (case-insensitive, partial match)
 */
export function findSuburb(query: string, state?: string): Suburb | null {
  const suburbs = loadSuburbs();
  const q = query.toLowerCase().trim();

  // Try exact match first
  let match = suburbs.find(
    (s) => s.name.toLowerCase() === q && (!state || s.state === state)
  );
  if (match) return match;

  // Try starts-with match
  match = suburbs.find(
    (s) => s.name.toLowerCase().startsWith(q) && (!state || s.state === state)
  );
  if (match) return match;

  // Try contains match
  match = suburbs.find(
    (s) => s.name.toLowerCase().includes(q) && (!state || s.state === state)
  );
  return match || null;
}

/**
 * Find suburb by postcode
 */
export function findSuburbByPostcode(postcode: string): Suburb | null {
  const suburbs = loadSuburbs();
  return suburbs.find((s) => s.postcode === postcode) || null;
}

/**
 * Get all suburbs within a radius of a base suburb
 */
export function getSuburbsInRadius(
  baseSuburb: Suburb,
  radiusKm: number,
  options?: {
    state?: string;
    region?: string;
    limit?: number;
  }
): Array<Suburb & { distance_km: number }> {
  const suburbs = loadSuburbs();
  const results: Array<Suburb & { distance_km: number }> = [];

  for (const suburb of suburbs) {
    // Filter by state/region if specified
    if (options?.state && suburb.state !== options.state) continue;
    if (options?.region && suburb.region !== options.region) continue;

    const distance = haversineDistance(
      baseSuburb.lat,
      baseSuburb.lng,
      suburb.lat,
      suburb.lng
    );

    if (distance <= radiusKm) {
      results.push({ ...suburb, distance_km: Math.round(distance * 10) / 10 });
    }
  }

  // Sort by distance
  results.sort((a, b) => a.distance_km - b.distance_km);

  // Apply limit
  if (options?.limit) {
    return results.slice(0, options.limit);
  }

  return results;
}

/**
 * Calculate distance between two suburbs
 */
export function getDistanceBetweenSuburbs(
  suburb1: Suburb,
  suburb2: Suburb
): number {
  return Math.round(
    haversineDistance(suburb1.lat, suburb1.lng, suburb2.lat, suburb2.lng) * 10
  ) / 10;
}

/**
 * Get all unique areas for a region (e.g., all Sydney areas)
 */
export function getAreasInRegion(region: string): Array<{
  area: string;
  suburb_count: number;
  sample_suburbs: string[];
  center: { lat: number; lng: number };
}> {
  const suburbs = loadSuburbs();
  const areaMap = new Map<string, Suburb[]>();

  for (const suburb of suburbs) {
    if (suburb.region.toLowerCase() !== region.toLowerCase()) continue;

    const existing = areaMap.get(suburb.area) || [];
    existing.push(suburb);
    areaMap.set(suburb.area, existing);
  }

  const results: Array<{
    area: string;
    suburb_count: number;
    sample_suburbs: string[];
    center: { lat: number; lng: number };
  }> = [];

  for (const [area, areaSuburbs] of areaMap) {
    // Calculate center point (average of all suburb coordinates)
    const avgLat = areaSuburbs.reduce((sum, s) => sum + s.lat, 0) / areaSuburbs.length;
    const avgLng = areaSuburbs.reduce((sum, s) => sum + s.lng, 0) / areaSuburbs.length;

    results.push({
      area,
      suburb_count: areaSuburbs.length,
      sample_suburbs: areaSuburbs.slice(0, 5).map((s) => s.name),
      center: {
        lat: Math.round(avgLat * 1000) / 1000,
        lng: Math.round(avgLng * 1000) / 1000,
      },
    });
  }

  // Sort by suburb count (largest areas first)
  results.sort((a, b) => b.suburb_count - a.suburb_count);

  return results;
}

/**
 * Group suburbs by area within a radius
 */
export function getAreaBreakdownInRadius(
  baseSuburb: Suburb,
  radiusKm: number
): Array<{
  area: string;
  suburb_count: number;
  avg_distance_km: number;
  suburbs: string[];
}> {
  const nearby = getSuburbsInRadius(baseSuburb, radiusKm);
  const areaMap = new Map<string, Array<Suburb & { distance_km: number }>>();

  for (const suburb of nearby) {
    const existing = areaMap.get(suburb.area) || [];
    existing.push(suburb);
    areaMap.set(suburb.area, existing);
  }

  const results: Array<{
    area: string;
    suburb_count: number;
    avg_distance_km: number;
    suburbs: string[];
  }> = [];

  for (const [area, areaSuburbs] of areaMap) {
    const avgDist = areaSuburbs.reduce((sum, s) => sum + s.distance_km, 0) / areaSuburbs.length;

    results.push({
      area,
      suburb_count: areaSuburbs.length,
      avg_distance_km: Math.round(avgDist * 10) / 10,
      suburbs: areaSuburbs.map((s) => `${s.name} (${s.distance_km}km)`),
    });
  }

  // Sort by average distance
  results.sort((a, b) => a.avg_distance_km - b.avg_distance_km);

  return results;
}
