/*
# File: storedPolygons.ts
# Date: October 24, 2026
# Purpose: Saves drawn polygons in local storage and loads them back onto the map.
*/

const STORAGE_KEY = "gis-mapping.drawn-polygons";

export type StoredPolygon = {
  id: string;
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
};

export type StoredPolygonCollection = {
  type: "FeatureCollection";
  features: StoredPolygon[];
};

const EMPTY: StoredPolygonCollection = { type: "FeatureCollection", features: [] };

export function loadDrawnPolygons(): StoredPolygonCollection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!isCollection(parsed)) return EMPTY;
    return { type: "FeatureCollection", features: parsed.features.filter(isPolygon) };
  } catch {
    return EMPTY;
  }
}

export function saveDrawnPolygons(features: Array<{
  id?: string | number;
  type: "Feature";
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates: number[][][] };
}>): void {
  const stored: StoredPolygonCollection = {
    type: "FeatureCollection",
    features: features.flatMap((feature) => {
      if (feature.geometry.type !== "Polygon" || feature.id == null) return [];
      if (!isRingList(feature.geometry.coordinates)) return [];
      return [
        {
          id: String(feature.id),
          type: "Feature" as const,
          properties: feature.properties ?? {},
          geometry: { type: "Polygon" as const, coordinates: feature.geometry.coordinates },
        },
      ];
    }),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage can be unavailable in private browsing. The polygons stay on the map for this session.
  }
}

function isCollection(value: unknown): value is { features: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "features" in value &&
    Array.isArray(value.features)
  );
}

function isPolygon(value: unknown): value is StoredPolygon {
  if (typeof value !== "object" || value === null) return false;
  const feature = value as Partial<StoredPolygon>;
  return (
    typeof feature.id === "string" &&
    feature.type === "Feature" &&
    feature.geometry?.type === "Polygon" &&
    isRingList(feature.geometry.coordinates)
  );
}

function isRingList(value: unknown): value is number[][][] {
  return (
    Array.isArray(value) &&
    value.every(
      (ring) =>
        Array.isArray(ring) &&
        ring.length >= 4 &&
        ring.every(
          (point) =>
            Array.isArray(point) &&
            point.length >= 2 &&
            point.every((coordinate) => typeof coordinate === "number"),
        ),
    )
  );
}
