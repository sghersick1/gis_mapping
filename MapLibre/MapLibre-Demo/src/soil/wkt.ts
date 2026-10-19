/*
# File: wkt.ts
# Date: October 19, 2026
# Purpose: Converts USDA well-known text boundaries into coordinates the map can draw.
*/

export type Position = [number, number];
export type LinearRing = Position[];
export type PolygonCoordinates = LinearRing[];
export type MultiPolygonCoordinates = PolygonCoordinates[];

// Soil Data Access returns SQL Server WKT: POLYGON, MULTIPOLYGON, or a
// GEOMETRYCOLLECTION of those, in longitude/latitude order.
export function wktToMultiPolygon(wkt: string): MultiPolygonCoordinates {
  const source = wkt.trim();
  if (!source || /EMPTY/i.test(source)) return [];

  const reader = new WktReader(source);
  const polygons = reader.readGeometry();
  if (!reader.done()) {
    throw new Error("Could not read the soil boundary returned by USDA.");
  }
  return polygons;
}

class WktReader {
  private index = 0;
  private source: string;

  constructor(source: string) {
    this.source = source;
  }

  done(): boolean {
    this.skipWhitespace();
    return this.index >= this.source.length;
  }

  readGeometry(): MultiPolygonCoordinates {
    const type = this.readType();
    if (type === "POLYGON") return [this.readPolygon()];
    if (type === "MULTIPOLYGON") return this.readMultiPolygon();
    if (type === "GEOMETRYCOLLECTION") return this.readCollection();
    this.skipGeometryBody();
    return [];
  }

  private readCollection(): MultiPolygonCoordinates {
    this.expect("(");
    const polygons: MultiPolygonCoordinates = [];
    if (this.peek() !== ")") {
      polygons.push(...this.readGeometry());
      while (this.peek() === ",") {
        this.expect(",");
        polygons.push(...this.readGeometry());
      }
    }
    this.expect(")");
    return polygons;
  }

  private readMultiPolygon(): MultiPolygonCoordinates {
    this.expect("(");
    const polygons: MultiPolygonCoordinates = [];
    if (this.peek() !== ")") {
      polygons.push(this.readPolygon());
      while (this.peek() === ",") {
        this.expect(",");
        polygons.push(this.readPolygon());
      }
    }
    this.expect(")");
    return polygons;
  }

  private readPolygon(): PolygonCoordinates {
    this.expect("(");
    const rings = [this.readRing()];
    while (this.peek() === ",") {
      this.expect(",");
      rings.push(this.readRing());
    }
    this.expect(")");
    return rings;
  }

  private readRing(): LinearRing {
    this.expect("(");
    const ring = [this.readPosition()];
    while (this.peek() === ",") {
      this.expect(",");
      ring.push(this.readPosition());
    }
    this.expect(")");
    return ring;
  }

  private readPosition(): Position {
    const longitude = this.readNumber();
    const latitude = this.readNumber();
    if (this.peek() !== "," && this.peek() !== ")") this.readNumber();
    return [longitude, latitude];
  }

  private readType(): string {
    this.skipWhitespace();
    const start = this.index;
    while (this.index < this.source.length && /[A-Za-z]/.test(this.source[this.index])) {
      this.index += 1;
    }
    const type = this.source.slice(start, this.index).toUpperCase();
    if (!type) throw new Error("Could not read the soil boundary returned by USDA.");
    if (this.peek() === "E") {
      this.readWord();
      return "EMPTY";
    }
    return type;
  }

  private readWord(): string {
    this.skipWhitespace();
    const start = this.index;
    while (this.index < this.source.length && /[A-Za-z]/.test(this.source[this.index])) {
      this.index += 1;
    }
    return this.source.slice(start, this.index).toUpperCase();
  }

  private readNumber(): number {
    this.skipWhitespace();
    const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      this.source.slice(this.index),
    );
    if (!match) throw new Error("Could not read the soil boundary returned by USDA.");
    this.index += match[0].length;
    return Number(match[0]);
  }

  private skipGeometryBody(): void {
    this.skipWhitespace();
    if (this.peek() !== "(") return;
    let depth = 0;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      this.index += 1;
      if (character === "(") depth += 1;
      if (character === ")") {
        depth -= 1;
        if (depth === 0) return;
      }
    }
  }

  private expect(character: string): void {
    if (this.peek() !== character) {
      throw new Error("Could not read the soil boundary returned by USDA.");
    }
    this.index += 1;
  }

  private peek(): string {
    this.skipWhitespace();
    return this.source[this.index] ?? "";
  }

  private skipWhitespace(): void {
    while (this.source[this.index] === " " || this.source[this.index] === "\n") {
      this.index += 1;
    }
  }
}
