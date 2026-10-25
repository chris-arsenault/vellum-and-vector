import Icon from "ol/style/Icon.js";
import type { CartographicMark } from "@atlas/domain";

const paths: Record<Exclude<CartographicMark, "auto">, string> = {
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
  kind: Exclude<CartographicMark, "auto">,
  size = 24,
  monochrome = false
): Icon {
  const key = `${kind}:${size}:${monochrome}`;
  let icon = icons.get(key);
  if (!icon) {
    const drawing = monochrome
      ? paths[kind].replaceAll(/fill="#[0-9a-f]+"/g, 'fill="#eee4c9"')
      : paths[kind];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="34" viewBox="0 -2 36 36"><g stroke="#594b36" stroke-width="1.1" stroke-linejoin="round" fill="none">${drawing}</g></svg>`;
    icon = new Icon({
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      width: size,
      anchor: [0.5, 0.85],
      declutterMode: "none",
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
