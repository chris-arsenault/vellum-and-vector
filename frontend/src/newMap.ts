import type { AuthoredProfile, NewMapRequest } from "@atlas/map";

export const levels: { id: AuthoredProfile; label: string; hint: string }[] = [
  { id: "world", label: "World", hint: "Continents and seas" },
  { id: "region", label: "Region", hint: "A coast, a range, a river basin" },
  { id: "city", label: "City", hint: "Districts and streets" },
];
/** A city frame is given in metres; world and region frames in kilometres. */
export const frameUnit = (profile: AuthoredProfile) => (profile === "city" ? "m" : "km");
const unitMetres = (profile: AuthoredProfile) => (profile === "city" ? 1 : 1000);

/** A frame side typed in the level's unit, in metres; empty means the level's default. */
export function sideMetres(profile: AuthoredProfile, text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value * unitMetres(profile) : "invalid";
}
/** The request for a new blank map, or the first thing wrong with the form. */
export function newMapRequest(form: {
  name: string;
  profile: AuthoredProfile;
  width: string;
  height: string;
}): NewMapRequest | string {
  const name = form.name.trim();
  if (!name) return "Give the map a name.";
  const width = sideMetres(form.profile, form.width);
  const height = sideMetres(form.profile, form.height);
  if (width === "invalid" || height === "invalid")
    return `Width and height are positive numbers in ${frameUnit(form.profile)}, or empty for the default.`;
  return { name, profile: form.profile, width, height };
}
