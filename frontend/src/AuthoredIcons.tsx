import type { ReactNode } from "react";

export type IconName =
  | "select"
  | "points"
  | "landmass"
  | "raise"
  | "lower"
  | "smooth"
  | "flatten"
  | "set"
  | "heightLine"
  | "heightArea"
  | "peak"
  | "river"
  | "street"
  | "building"
  | "plot"
  | "place"
  | "undo"
  | "redo"
  | "search"
  | "star"
  | "starFilled"
  | "Point"
  | "LineString"
  | "Polygon";

/** Line icons on a 20-unit grid, drawn with the current text colour. */
const paths: Record<IconName, ReactNode> = {
  select: <path d="M5 3l10 7-4.4 1.2L8.6 16 5 3z" />,
  points: (
    <>
      <path d="M3.5 14.5l4.5-7 4 3.5 4.5-6" />
      <rect x="2" y="13" width="3" height="3" />
      <rect x="6.5" y="6" width="3" height="3" />
      <rect x="14.5" y="3.5" width="3" height="3" />
    </>
  ),
  landmass: <path d="M3.5 11.5C2.5 7 6 3.5 10 4.5s6.5 0 6 4.5-3.5 7-7 6.5-4.5-1.2-5.5-4z" />,
  raise: <path d="M10 15.5V5M6 9l4-4 4 4M3.5 17.5h13" />,
  lower: <path d="M10 4.5V15M6 11l4 4 4-4M3.5 2.5h13" />,
  smooth: <path d="M2.5 11c2.2-5 4.6-5 7.5 0s5.3 5 7.5 0" />,
  flatten: <path d="M3 10h14M5.5 5.5v9M14.5 5.5v9" />,
  set: <path d="M6 3v14M6 5h4M6 9h7M6 13h4M13 13l2 2 2-2" />,
  heightLine: <path d="M2.5 14.5l4-6 3 3 4-7 3.5 10" strokeDasharray="0" />,
  heightArea: <path d="M4 6.5l7-2.5 5 4.5-2 7-8 1.5-3-5.5zM8 8l3 5M11 7l-1 7" />,
  peak: <path d="M2 16.5l5.5-10 3 5.2 2-3.2 5.5 8z" />,
  river: <path d="M5 2.5c5 1.2 0 5 4.2 7.2S6 14.8 14 17.5" />,
  street: <path d="M3 16L8 4M17 16L12 4M10 5v2M10 10v2M10 15v2" />,
  building: <path d="M4 17V8l6-4 6 4v9zM8 17v-5h4v5" />,
  plot: <path d="M4 5h12v10H4zM4 10h12M10 5v10" strokeDasharray="2 2" />,
  place: (
    <>
      <path d="M10 18s-5.5-5-5.5-9.2a5.5 5.5 0 0111 0C15.5 13 10 18 10 18z" />
      <circle cx="10" cy="8.8" r="2" />
    </>
  ),
  undo: <path d="M7.5 4L3.5 8l4 4M3.5 8h8a4.5 4.5 0 010 9H8" />,
  redo: <path d="M12.5 4l4 4-4 4M16.5 8h-8a4.5 4.5 0 000 9H12" />,
  search: (
    <>
      <circle cx="8.6" cy="8.6" r="5" />
      <path d="M12.4 12.4l4.6 4.6" />
    </>
  ),
  star: <path d="M10 2.5l2.3 4.9 5.2.7-3.8 3.7.9 5.3-4.6-2.5-4.6 2.5.9-5.3-3.8-3.7 5.2-.7z" />,
  starFilled: (
    <path
      d="M10 2.5l2.3 4.9 5.2.7-3.8 3.7.9 5.3-4.6-2.5-4.6 2.5.9-5.3-3.8-3.7 5.2-.7z"
      fill="currentColor"
    />
  ),
  Point: <circle cx="10" cy="10" r="3" />,
  LineString: <path d="M3.5 15.5l5-6 3 3 5-6.5" />,
  Polygon: <path d="M4 7l6-3.5 6 4-1.5 7.5-8 .5z" />,
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="authored-icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
