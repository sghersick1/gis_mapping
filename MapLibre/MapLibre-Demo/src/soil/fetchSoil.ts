/*
# File: fetchSoil.ts
# Date: October 19, 2026
# Purpose: Loads soil map units clipped to a drawn polygon from USDA Soil Data Access, and builds the details shown when a region is clicked.
*/

import { wktToMultiPolygon, type Position } from "./wkt";

const SOIL_QUERY_URL = "https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest";

const SOIL_COLORS = [
  "#d95f02",
  "#1b9e77",
  "#7570b3",
  "#e7298a",
  "#66a61e",
  "#e6ab02",
  "#a6761d",
  "#666666",
  "#1f78b4",
  "#e31a1c",
  "#33a02c",
  "#6a3d9a",
];

export type SoilProperties = {
  mukey: string;
  musym: string;
  muname: string;
  compname: string;
  comppct: string;
  taxclname: string;
  drainagecl: string;
  hydgrp: string;
  color: string;
};

export type SoilFeature = {
  type: "Feature";
  id: string;
  properties: SoilProperties;
  geometry: {
    type: "MultiPolygon";
    coordinates: Position[][][];
  };
};

export type SoilFeatureCollection = {
  type: "FeatureCollection";
  features: SoilFeature[];
};

export const EMPTY_SOIL: SoilFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export function polygonWkt(rings: Position[][]): string {
  const parts = rings.map((ring) => {
    if (ring.length < 3) {
      throw new Error("Draw a polygon with at least three corners.");
    }
    const closed = samePosition(ring[0], ring[ring.length - 1])
      ? ring
      : [...ring, ring[0]];
    if (closed.length < 4) {
      throw new Error("Draw a polygon with at least three corners.");
    }
    const coordinates = closed.map(([longitude, latitude]) => {
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        throw new Error("The drawn polygon has an invalid coordinate.");
      }
      return `${longitude} ${latitude}`;
    });
    return `(${coordinates.join(", ")})`;
  });
  return `POLYGON(${parts.join(", ")})`;
}

export async function fetchSoilInPolygon(
  rings: Position[][],
  signal: AbortSignal,
): Promise<SoilFeatureCollection> {
  const wkt = polygonWkt(rings);
  const response = await fetch(SOIL_QUERY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      FORMAT: "JSON+COLUMNNAME",
      QUERY: soilQuery(wkt),
    }),
    signal,
  });

  const body = await response.text();
  if (!response.ok || body.includes("<ServiceException")) {
    throw new Error(soilErrorMessage(body, response.status));
  }

  let table: unknown;
  try {
    table = (JSON.parse(body) as { Table?: unknown }).Table;
  } catch {
    throw new Error("USDA returned soil data that could not be read.");
  }
  console.log(table);
  if (!Array.isArray(table) || table.length === 0) {
    throw new Error("USDA returned soil data that could not be read.");
  }

  const [header, ...rows] = table as unknown[][];
  if (!Array.isArray(header)) {
    throw new Error("USDA returned soil data that could not be read.");
  }
  const columns = new Map(header.map((name, index) => [String(name), index]));

  const features: SoilFeature[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const feature = soilFeature(row, columns);
    if (feature) features.push(feature);
  }
  return { type: "FeatureCollection", features };
}

function soilQuery(wkt: string): string {
  // ~DeclareGeometry lets SDA use its spatial index. STIntersection clips each
  // map-unit polygon to the drawn area. The component join adds attributes.
  return `
~DeclareGeometry(@aoi)~
SELECT @aoi = geometry::STGeomFromText('${wkt}', 4326);
SELECT
  mu.mukey,
  mu.musym,
  mu.muname,
  c.compname,
  c.comppct_r,
  c.taxclname,
  c.drainagecl,
  c.hydgrp,
  poly.mupolygonkey,
  poly.mupolygongeo.STIntersection(@aoi).STAsText() AS wkt
FROM mupolygon AS poly
INNER JOIN mapunit AS mu ON mu.mukey = poly.mukey
OUTER APPLY (
  SELECT TOP 1 compname, comppct_r, taxclname, drainagecl, hydgrp
  FROM component
  WHERE mukey = mu.mukey
  ORDER BY comppct_r DESC
) AS c
WHERE poly.mupolygongeo.STIntersects(@aoi) = 1
`.trim();
}

function soilFeature(
  row: unknown[],
  columns: Map<string, number>,
): SoilFeature | null {
  const wkt = textAt(row, columns, "wkt");
  if (!wkt) return null;

  const coordinates = wktToMultiPolygon(wkt);
  if (coordinates.length === 0) return null;

  const mukey = textAt(row, columns, "mukey");
  return {
    type: "Feature",
    id: textAt(row, columns, "mupolygonkey") || mukey,
    properties: {
      mukey,
      musym: textAt(row, columns, "musym"),
      muname: textAt(row, columns, "muname"),
      compname: textAt(row, columns, "compname"),
      comppct: textAt(row, columns, "comppct_r"),
      taxclname: textAt(row, columns, "taxclname"),
      drainagecl: textAt(row, columns, "drainagecl"),
      hydgrp: textAt(row, columns, "hydgrp"),
      color: colorForMukey(mukey),
    },
    geometry: { type: "MultiPolygon", coordinates },
  };
}

function textAt(row: unknown[], columns: Map<string, number>, name: string): string {
  const index = columns.get(name);
  if (index === undefined) return "";
  const value = row[index];
  return value == null ? "" : String(value);
}

function colorForMukey(mukey: string): string {
  let hash = 0;
  for (const character of mukey) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return SOIL_COLORS[hash % SOIL_COLORS.length];
}

function soilErrorMessage(body: string, status: number): string {
  const exception = body.match(/<ServiceException>([\s\S]*?)<\/ServiceException>/)?.[1];
  const message = decodeXml(exception ?? "").replace(/\s+/g, " ").trim();
  if (message) return message.replace(/^Invalid query:\s*/i, "");
  if (status >= 500) return "The USDA soil service is unavailable right now.";
  return "The USDA soil service rejected the polygon query.";
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function soilPopupElement(properties: Partial<SoilProperties>): HTMLElement {
  const root = document.createElement("div");
  root.style.font = "13px/1.4 Helvetica, Arial, sans-serif";
  root.style.color = "#1f2937";

  const symbol = document.createElement("div");
  symbol.textContent = properties.musym || "Soil map unit";
  symbol.style.fontWeight = "700";
  root.append(symbol);

  if (properties.muname) {
    const name = document.createElement("div");
    name.textContent = properties.muname;
    name.style.marginBottom = "8px";
    root.append(name);
  }

  const rows: Array<[string, string | undefined]> = [
    ["Dominant component", properties.compname],
    ["Component percent", properties.comppct ? `${properties.comppct}%` : ""],
    ["Taxonomic class", properties.taxclname],
    ["Drainage", properties.drainagecl],
    ["Hydrologic group", properties.hydgrp],
  ];

  for (const [label, value] of rows) {
    if (!value) continue;
    const row = document.createElement("div");
    const title = document.createElement("span");
    title.textContent = `${label}: `;
    title.style.color = "#4b5563";
    row.append(title, document.createTextNode(value));
    root.append(row);
  }

  return root;
}
