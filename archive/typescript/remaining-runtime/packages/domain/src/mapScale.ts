/** Display-unit conversion only. Rust MapScale owns procedural dimensions and resolution. */
export class MapScale {
  private static readonly units = { m: 1, km: 1000, mm: 0.001, ft: 0.3048, native: 1 / 1024 };
  static metres(value: number, unit: keyof typeof MapScale.units = "m") {
    return value * MapScale.units[unit];
  }
  static inUnits(metres: number, unit: keyof typeof MapScale.units) {
    return metres / MapScale.units[unit];
  }
  static areaUnits(value: number, from: "m2" | "km2", to: "m2" | "km2") {
    return (value * (from === "km2" ? 1e6 : 1)) / (to === "km2" ? 1e6 : 1);
  }
}
