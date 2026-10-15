import { useEffect, useRef } from "react";

// map imports
import { Map as MapLibreMap, Marker } from "maplibre-gl";
import createTreeMarker from "./components/TreeMarker";
import "maplibre-gl/dist/maplibre-gl.css";
import "./App.css";

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);

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

    const pins: Marker[] = [];
    const tol = 0.0005;

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

    // Placing/dragging pins
    map.on("click", (event) => {
      const customPin = createTreeMarker();
      const cur = event.lngLat;

      // Replace nearby pins
      pins
        .filter(
          (pin) =>
            Math.abs(cur.lat - pin._lngLat.lat) < tol ||
            Math.abs(cur.lng - pin._lngLat.lng) < tol,
        )
        .forEach((pin) => pin.remove());

      // Add current pin
      pins.push(
        new Marker({ element: customPin })
          .setLngLat(cur)
          .setDraggable(true)
          .addTo(map),
      );
    });

    return () => map.remove();
  }, []);

  return <div className="map" ref={mapContainer} />;
}

export default App;
