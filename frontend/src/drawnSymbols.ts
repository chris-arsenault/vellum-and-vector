import Icon from "ol/style/Icon.js";
import type { CartographicMark } from "@atlas/domain";

export type DrawnIconKind =
  | Exclude<CartographicMark, "auto">
  | "grass"
  | "reeds"
  | "dune"
  | "rock"
  | "broadleaf"
  | "volcano"
  | "crater"
  | "falls"
  | "gorge"
  | "site"
  | "harbor"
  | "shrine";
const paths: Record<DrawnIconKind, string> = {
  grass:
    '<path d="m5 27 3-5 4 5m4 0 3-8 4 8m3-1 3-4 4 4M8 17l2-4 3 4m9-5 3-4 3 4" stroke="#77834e"/>',
  reeds:
    '<path d="M4 29h27M7 25h21M10 22V8m7 14V4m7 18V10m-14 8-4-4m11 0 4-5m3 10 5-4" stroke="#537c70"/><path d="M8 6h4v7H8Zm7-4h4v7h-4Zm7 6h4v7h-4Z" fill="#81946b"/>',
  dune: '<path d="M2 27q15-25 32 0M8 26q10-15 21-10M19 16q-3 8 1 11m-16 4h27" stroke="#a28a50"/>',
  rock: '<path d="m5 27 5-9 7 2 5-8 8 4 4 11ZM10 18l4 9m8-15 2 15m-7-7 7 7" stroke="#8d8170"/>',
  broadleaf:
    '<path d="M16 30V16m0 6-6-6m6 4 7-7"/><path d="M9 23C-2 20 3 11 8 11 5 1 17-2 21 6c9-5 16 9 8 12 2 8-10 10-13 5Z" fill="#91a770"/><path d="M16 28V16m0 6-6-5m6 3 7-6"/>',
  volcano:
    '<path d="m2 29 12-19h8l12 19Z" fill="#d1b89b"/><path d="m14 10 4 5 4-5m-4 5 2 13m-9-20 2-4m6 2-1-5m6 7 3-5"/>',
  crater:
    '<ellipse cx="18" cy="22" rx="15" ry="7" fill="#d6c9ad"/><ellipse cx="18" cy="20" rx="10" ry="4"/><path d="m5 19-2-4m10 2-2-5m12 5 2-5m6 8 3-4"/>',
  falls:
    '<path d="M3 7h11v18q8 8 19 0M5 12h5v13m8-18v18m4-17v18m5-14v12M1 5h33M3 30h29" stroke="#557e83"/>',
  gorge:
    '<path d="m2 3 9 8-4 9 7 12m20-29-10 9 4 9-8 11m-5-29 4 9-3 9 3 11"/><path d="m4 8 5 3m-1 8 4 1m15-9 5-3m-7 13 6 2"/>',
  site: '<path d="m13 29 1-23 4-4 5 4 1 23ZM10 29h17m-12-9h7m-6-7h5" fill="#d9c9a6"/>',
  harbor:
    '<circle cx="18" cy="6" r="3"/><path d="M18 9v21M10 13h16M4 19q1 11 14 11 13 0 14-11m-29 0 2 6 4-4m24-2-2 6-4-4" stroke="#557e83"/>',
  shrine: '<path d="M7 29V17l11-9 11 9v12ZM3 17h30M18 8V1m-4 4h8m-9 24v-8h10v8" fill="#ddd2b9"/>',
  mountain:
    '<path d="M2 29 17 3 33 29 25 24 20 25 15 18 10 27Z" fill="#e9dfc3"/><path d="m17 3 1 17 7 4m-8-21-6 17 4-2m3 2 2 5m-8-2-4 6m15-8 5 8"/>',
  tree: '<path d="M17 2 7 14h5L4 24h10v7h6v-7h10l-8-10h5Z" fill="#bdc39b"/><path d="M17 7v20m0-10-5-4m5 8 6-5"/>',
  town: '<path d="M5 16 13 9l8 7v13H5Zm13-5 6-6 7 6v18H19" fill="#eee2c5"/><path d="M3 17 13 7l10 10m-6-5 7-9 9 10M10 29v-8h5v8m10-12h3m-3 5h3"/>',
  castle:
    '<path d="M5 30V8h4V4h4v4h4V4h4v4h4V4h4v26Z" fill="#dfd1b2"/><path d="M13 30v-8a4 4 0 0 1 8 0v8M6 12h22M9 16h3m11 0h3M17 5V0h9l-4 3 4 2Z"/>',
  ruin: '<path d="M5 30V13l7-4v11l5-6v8l7-10v18Z" fill="#d6cfb9"/><path d="m3 30 7-2m10 2 10-2M6 14l5 1m12 4 4-2"/>',
};
const icons = new Map<string, Icon>();
export function drawnIcon(
  kind: DrawnIconKind,
  size = 24,
  monochrome = false,
  obstacle = false
): Icon {
  const key = `${kind}:${size}:${monochrome}:${obstacle}`;
  let icon = icons.get(key);
  if (!icon) {
    const drawing = monochrome
      ? paths[kind].replaceAll(/fill="#[0-9a-f]+"/g, 'fill="#eee4c9"')
      : paths[kind];
    const stroke = monochrome
      ? drawing.replaceAll(/stroke="#[0-9a-f]+"/g, 'stroke="#594b36"')
      : drawing;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="34" viewBox="0 -2 36 36"><g stroke="#594b36" stroke-width="1.1" stroke-linejoin="round" fill="none">${stroke}</g></svg>`;
    icon = new Icon({
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      width: size,
      anchor: [0.5, 0.85],
      declutterMode: obstacle ? "obstacle" : "none",
    });
    icons.set(key, icon);
  }
  return icon;
}

export const atlasColours = [
  "#c98b79",
  "#9caf84",
  "#d1b56c",
  "#a8b8c5",
  "#b69bb3",
  "#d4a57c",
  "#83b6ae",
  "#c4bf87",
];
export function atlasColour(identity: string) {
  let hash = 2166136261;
  for (const char of identity) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return atlasColours[(hash >>> 0) % atlasColours.length];
}
