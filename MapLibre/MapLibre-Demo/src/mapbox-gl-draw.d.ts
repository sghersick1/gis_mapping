/*
# File: mapbox-gl-draw.d.ts
# Date: October 19, 2026
# Purpose: Describes the Mapbox Draw control so it can be used with the MapLibre map.
*/

declare module "@mapbox/mapbox-gl-draw" {
  import type { ControlPosition, IControl, Map } from "maplibre-gl";

  interface MapboxDrawOptions {
    displayControlsDefault?: boolean;
    controls?: {
      point?: boolean;
      line_string?: boolean;
      polygon?: boolean;
      trash?: boolean;
      combine_features?: boolean;
      uncombine_features?: boolean;
    };
    defaultMode?: string;
    keybindings?: boolean;
  }

  interface DrawFeature {
    id?: string | number;
    type: "Feature";
    properties: Record<string, unknown> | null;
    geometry: {
      type: string;
      coordinates: number[][][];
    };
  }

  interface DrawFeatureCollection {
    type: "FeatureCollection";
    features: DrawFeature[];
  }

  export default class MapboxDraw implements IControl {
    constructor(options?: MapboxDrawOptions);
    onAdd(map: Map): HTMLElement;
    onRemove(map: Map): void;
    getDefaultPosition(): ControlPosition;
    add(featureCollection: DrawFeatureCollection): string[];
    getAll(): DrawFeatureCollection;
    getMode(): string;
    getSelected(): DrawFeatureCollection;
  }
}
