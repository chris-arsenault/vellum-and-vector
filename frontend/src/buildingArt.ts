import { useQuery } from "@tanstack/react-query";

/**
 * Building art is drawn during development and shipped with the app under
 * `public/building-art/`; `manifest.json` there maps a building use to its image file.
 * Nothing makes art at run time: a use with no entry, or whose file is not shipped yet,
 * shows a plain placeholder.
 */
export interface BuildingArtManifest {
  art: Record<string, string>;
}
const folder = `${import.meta.env.BASE_URL}building-art/`;

/** The image address for a use, or null when the manifest names none. */
// owner-direction(2026-11-17): there are no tools for art generation. we will ship assets that we genrate in development with open ai
export function artFor(manifest: BuildingArtManifest | undefined, use: string): string | null {
  const file = manifest?.art[use];
  return file && !file.includes("/") ? `${folder}${file}` : null;
}
async function loadManifest(): Promise<BuildingArtManifest> {
  const response = await fetch(`${folder}manifest.json`);
  if (!response.ok) return { art: {} };
  const value = (await response.json()) as Partial<BuildingArtManifest>;
  return { art: value.art ?? {} };
}
/** The shipped art for a building use; read once per session. */
export function useBuildingArt(use: string) {
  const manifest = useQuery({
    queryKey: ["building-art"],
    queryFn: loadManifest,
    staleTime: Infinity,
    retry: false,
  });
  return artFor(manifest.data, use);
}
