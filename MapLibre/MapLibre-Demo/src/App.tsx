/*
# File: App.tsx
# Date: October 14, 2026
# Purpose: Shows the satellite map, saved polygon drawings, and the USDA soil overlay for the drawn area.
*/

import { useEffect, useRef, useState } from "react";

import MapboxDraw from "@mapbox/mapbox-gl-draw";
import { GeoJSONSource, Map as MapLibreMap, Marker, Popup } from "maplibre-gl";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  EMPTY_SOIL,
  fetchSoilInPolygon,
  soilPopupElement,
  type SoilFeatureCollection,
  type SoilProperties,
} from "./soil/fetchSoil";
import type { Position } from "./soil/wkt";
import { loadDrawnPolygons, saveDrawnPolygons } from "./draw/storedPolygons";

type SoilStatus =
  | { state: "idle" }
  | { state: "choose" }
  | { state: "loading" }
  | { state: "empty" }
  | { state: "error"; message: string }
  | { state: "ready"; regions: number; units: SoilLegendUnit[] };

type SoilLegendUnit = {
  mukey: string;
  musym: string;
  muname: string;
  color: string;
};

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const reloadSoil = useRef<() => void>(() => {});
  const [status, setStatus] = useState<SoilStatus>({ state: "idle" });

  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new MapLibreMap({
      container: mapContainer.current,
      zoom: 15,
      center: [-80.1416500067115, 40.781152685942075],
      attributionControl: false,
      scrollZoom: false,
      style: {
        version: 8,
        sources: {
          satellite: {
            type: "raster",
            tiles: [
              "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
          },
        },
        layers: [
          {
            id: "satellite",
            type: "raster",
            source: "satellite",
          },
        ],
      },
    });

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true,
      },
    });

    const popup = new Popup({ closeButton: true, closeOnClick: false, maxWidth: "320px" });
    let request: AbortController | undefined;
    let requestKey = "";
    let timer: number | undefined;
    let removed = false;

    const setSoil = (data: SoilFeatureCollection) => {
      const source = map.getSource("soil");
      if (source instanceof GeoJSONSource) source.setData(data);
    };

    const loadSoil = () => {
      const rings = selectedPolygon(draw);
      if (!rings) {
        request?.abort();
        requestKey = "";
        setSoil(EMPTY_SOIL);
        popup.remove();
        const hasPolygons = draw
          .getAll()
          .features.some((feature) => feature.geometry.type === "Polygon");
        setStatus(hasPolygons ? { state: "choose" } : { state: "idle" });
        return;
      }

      const key = JSON.stringify(rings);
      if (key === requestKey) return;
      requestKey = key;
      request?.abort();
      const nextRequest = new AbortController();
      request = nextRequest;
      setSoil(EMPTY_SOIL);
      popup.remove();
      setStatus({ state: "loading" });

      fetchSoilInPolygon(rings, nextRequest.signal)
        .then((data) => {
          if (removed || nextRequest.signal.aborted || requestKey !== key) return;
          setSoil(data);
          setStatus(statusForSoil(data));
        })
        .catch((error: unknown) => {
          if (removed || nextRequest.signal.aborted || requestKey !== key) return;
          requestKey = "";
          setSoil(EMPTY_SOIL);
          setStatus({
            state: "error",
            message:
              error instanceof Error
                ? error.message
                : "Couldn't load soil data for this polygon.",
          });
        });
    };

    reloadSoil.current = () => {
      requestKey = "";
      loadSoil();
    };

    const acreageMarkers = new Map<string, Marker>();

    const syncAcreage = () => {
      const seen = new Set<string>();
      for (const feature of draw.getAll().features) {
        if (feature.geometry.type !== "Polygon" || feature.id == null) continue;
        const id = String(feature.id);
        const label = `${formatAcres(polygonAcres(feature.geometry.coordinates))} acres`;
        const center = ringCenter(feature.geometry.coordinates[0]);
        seen.add(id);

        const existing = acreageMarkers.get(id);
        if (existing) {
          existing.setLngLat(center);
          existing.getElement().textContent = label;
          continue;
        }

        const element = document.createElement("div");
        element.textContent = label;
        element.style.cssText =
          "pointer-events:none;background:rgba(255,255,255,0.92);padding:2px 6px;border-radius:4px;font:600 13px/1.2 Helvetica,Arial,sans-serif;color:#111;white-space:nowrap;";
        acreageMarkers.set(id, new Marker({ element, anchor: "center" }).setLngLat(center).addTo(map));
      }

      for (const [id, marker] of acreageMarkers) {
        if (seen.has(id)) continue;
        marker.remove();
        acreageMarkers.delete(id);
      }
    };

    const scheduleSoilLoad = () => {
      syncAcreage();
      window.clearTimeout(timer);
      timer = window.setTimeout(loadSoil, 200);
    };

    map.once("load", () => {
      map.addControl(draw);
      const stored = loadDrawnPolygons();
      if (stored.features.length > 0) draw.add(stored);
      scheduleSoilLoad();

      // Draw's stylesheet targets Mapbox class names. MapLibre uses maplibregl-*.
      const container = map.getContainer();
      container.classList.add("mapboxgl-map");
      map
        .getCanvasContainer()
        .classList.add("mapboxgl-canvas-container", "mapboxgl-interactive");
      container.querySelectorAll(".mapboxgl-ctrl-group").forEach((element) => {
        element.classList.add("maplibregl-ctrl", "maplibregl-ctrl-group");
      });

      map.addSource("soil", { type: "geojson", data: EMPTY_SOIL });
      const beforeDraw = map
        .getStyle()
        .layers?.find((layer) => layer.id.startsWith("gl-draw"))?.id;
      map.addLayer(
        {
          id: "soil-fill",
          type: "fill",
          source: "soil",
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": 0.45,
          },
        },
        beforeDraw,
      );
      map.addLayer(
        {
          id: "soil-outline",
          type: "line",
          source: "soil",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 1.5,
          },
        },
        beforeDraw,
      );

      map.on("click", "soil-fill", (event) => {
        if (draw.getMode() === "draw_polygon") return;
        const properties = event.features?.[0]?.properties as Partial<SoilProperties> | null;
        if (!properties) return;
        popup
          .setLngLat(event.lngLat)
          .setDOMContent(soilPopupElement(properties))
          .addTo(map);
      });
      map.on("mouseenter", "soil-fill", () => {
        if (draw.getMode() !== "draw_polygon") map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "soil-fill", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    for (const eventName of ["draw.create", "draw.update", "draw.delete"]) {
      map.on(eventName as "load", () => {
        saveDrawnPolygons(draw.getAll().features);
        scheduleSoilLoad();
      });
    }
    map.on("draw.selectionchange" as "load", scheduleSoilLoad);

    // navigate map by scrolling
    map.on("wheel", (event) => {
      event.originalEvent.preventDefault();

      // zoom - diagonal finger movement
      if (event.originalEvent.ctrlKey) {
        map.zoomTo(map.getZoom() - event.originalEvent.deltaY * 0.01, {
          duration: 0,
        });
        return;
      }

      // navigation - follow mouse
      map.panBy([event.originalEvent.deltaX, event.originalEvent.deltaY], {
        animate: false,
      });
    });

    return () => {
      removed = true;
      window.clearTimeout(timer);
      request?.abort();
      map.remove();
    };
  }, []);

  return (
    <main className="relative h-screen w-screen">
      <div className="h-full w-full" ref={mapContainer} />
      <SoilStatusPanel status={status} onRetry={() => reloadSoil.current()} />
    </main>
  );
}

function SoilStatusPanel({
  status,
  onRetry,
}: {
  status: SoilStatus;
  onRetry: () => void;
}) {
  return (
    <section className="pointer-events-none absolute top-3 left-3 z-10 w-80 max-w-[calc(100%-1.5rem)]">
      <div className="pointer-events-auto rounded-md bg-white/95 p-3 text-sm text-gray-800 shadow-md">
        {status.state === "idle" && <p>Draw a polygon to load USDA soil data for that area.</p>}
        {status.state === "choose" && <p>Select a polygon to load its soil data.</p>}
        {status.state === "loading" && <p>Loading USDA soil data…</p>}
        {status.state === "empty" && <p>No USDA soil map units intersect this polygon.</p>}
        {status.state === "error" && (
          <div className="space-y-2">
            <p className="text-red-700">{status.message}</p>
            <button
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-100"
              onClick={onRetry}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
        {status.state === "ready" && (
          <div className="space-y-2">
            <p>
              {status.regions} soil {status.regions === 1 ? "region" : "regions"} inside this
              polygon. Click one for details.
            </p>
            <ul className="max-h-52 space-y-1 overflow-y-auto">
              {status.units.map((unit) => (
                <li className="flex items-start gap-2" key={unit.mukey}>
                  <span
                    className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: unit.color }}
                  />
                  <span>
                    <span className="font-semibold">{unit.musym}</span> {unit.muname}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function selectedPolygon(draw: MapboxDraw): Position[][] | null {
  const selected = draw
    .getSelected()
    .features.map(polygonRings)
    .find((rings) => rings !== null);
  if (selected) return selected;

  const polygons = draw.getAll().features.map(polygonRings).filter((rings) => rings !== null);
  return polygons.length === 1 ? polygons[0] : null;
}

function polygonRings(feature: {
  geometry: { type: string; coordinates: number[][][] };
}): Position[][] | null {
  if (feature.geometry.type !== "Polygon") return null;
  const rings = feature.geometry.coordinates.filter((ring) => ring.length >= 3);
  if (rings.length === 0) return null;
  return rings.map((ring) => ring.map(([longitude, latitude]) => [longitude, latitude]));
}

const EARTH_RADIUS_M = 6378137;
const SQUARE_METERS_PER_ACRE = 4046.8564224;

function polygonAcres(rings: number[][][]): number {
  if (rings.length === 0) return 0;
  let squareMeters = Math.abs(ringArea(rings[0]));
  for (const hole of rings.slice(1)) squareMeters -= Math.abs(ringArea(hole));
  return Math.max(0, squareMeters) / SQUARE_METERS_PER_ACRE;
}

function ringArea(ring: number[][]): number {
  const count = ring.length;
  if (count < 3) return 0;
  let area = 0;
  for (let index = 0; index < count; index += 1) {
    const previous = ring[(index + count - 1) % count];
    const next = ring[(index + 1) % count];
    area += (toRadians(next[0]) - toRadians(previous[0])) * Math.sin(toRadians(ring[index][1]));
  }
  return (area * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

function ringCenter(ring: number[][]): [number, number] {
  const end = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1
    : ring.length;
  let twiceArea = 0;
  let longitude = 0;
  let latitude = 0;
  for (let index = 0; index < end; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % end];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    longitude += (x1 + x2) * cross;
    latitude += (y1 + y2) * cross;
  }
  if (twiceArea === 0) {
    const average = ring.reduce(
      (sum, point) => [sum[0] + point[0], sum[1] + point[1]] as [number, number],
      [0, 0] as [number, number],
    );
    return [average[0] / ring.length, average[1] / ring.length];
  }
  return [longitude / (3 * twiceArea), latitude / (3 * twiceArea)];
}

function formatAcres(acres: number): string {
  return acres >= 10 ? acres.toFixed(0) : acres.toFixed(1);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function statusForSoil(data: SoilFeatureCollection): SoilStatus {
  if (data.features.length === 0) return { state: "empty" };
  const units = new Map<string, SoilLegendUnit>();
  for (const feature of data.features) {
    const { mukey, musym, muname, color } = feature.properties;
    if (!units.has(mukey)) units.set(mukey, { mukey, musym, muname, color });
  }
  return { state: "ready", regions: data.features.length, units: [...units.values()] };
}

export default App;
