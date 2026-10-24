// The encyclopedia renders the markdown under docs/lore as it is written there,
// so the documentation and the in-app pages cannot drift apart.
import magic from "../../docs/lore/magic.md?raw";
import fire from "../../docs/lore/magic/fire.md?raw";
import aurora from "../../docs/lore/magic/aurora.md?raw";
import pressure from "../../docs/lore/magic/pressure.md?raw";
import greenwood from "../../docs/lore/magic/greenwood.md?raw";
import salt from "../../docs/lore/magic/salt.md?raw";
import veil from "../../docs/lore/magic/veil.md?raw";
import hallowed from "../../docs/lore/magic/hallowed.md?raw";
import banner from "../../docs/lore/images/banner.webp";
import hero from "../../docs/lore/images/hero.webp";
import fireImage from "../../docs/lore/images/fire.webp";
import auroraImage from "../../docs/lore/images/aurora.webp";
import pressureImage from "../../docs/lore/images/pressure.webp";
import greenwoodImage from "../../docs/lore/images/greenwood.webp";
import saltImage from "../../docs/lore/images/salt.webp";
import veilImage from "../../docs/lore/images/veil.webp";
import hallowedImage from "../../docs/lore/images/hallowed.webp";

export interface LorePage {
  id: string;
  title: string;
  /** Path of the page under docs/lore. */
  path: string;
  markdown: string;
}

export const lorePages: readonly LorePage[] = [
  { id: "magic", title: "Magic lore bible", path: "magic.md", markdown: magic },
  { id: "fire", title: "Fire", path: "magic/fire.md", markdown: fire },
  { id: "aurora", title: "Aurora", path: "magic/aurora.md", markdown: aurora },
  { id: "pressure", title: "Pressure", path: "magic/pressure.md", markdown: pressure },
  { id: "greenwood", title: "Greenwood", path: "magic/greenwood.md", markdown: greenwood },
  { id: "salt", title: "Salt", path: "magic/salt.md", markdown: salt },
  { id: "veil", title: "Veil", path: "magic/veil.md", markdown: veil },
  { id: "hallowed", title: "Hallowed", path: "magic/hallowed.md", markdown: hallowed },
];

const images: Record<string, string> = {
  "banner.webp": banner,
  "hero.webp": hero,
  "fire.webp": fireImage,
  "aurora.webp": auroraImage,
  "pressure.webp": pressureImage,
  "greenwood.webp": greenwoodImage,
  "salt.webp": saltImage,
  "veil.webp": veilImage,
  "hallowed.webp": hallowedImage,
};

const repositoryDocs = "https://github.com/chris-arsenault/vellum-and-vector/blob/main/docs/";

function basename(path: string) {
  return path.split("/").pop() ?? path;
}

/** A markdown image path resolves to the bundled asset of the same file name. */
export function loreImage(src: string | undefined) {
  return src ? (images[basename(src)] ?? src) : undefined;
}

/** A relative link to another lore page, matched by file name regardless of directory. */
export function lorePageForHref(href: string): LorePage | undefined {
  const [path] = href.split("#");
  if (!path.endsWith(".md")) return undefined;
  const name = basename(path);
  return lorePages.find((page) => basename(page.path) === name);
}

/** Any other relative link opens the documentation file in the repository. */
export function externalHref(href: string, from: LorePage) {
  if (/^[a-z]+:/i.test(href)) return href;
  const segments = ["lore", ...from.path.split("/").slice(0, -1)];
  for (const part of href.split("/")) {
    if (part === "..") segments.pop();
    else if (part && part !== ".") segments.push(part);
  }
  return repositoryDocs + segments.join("/");
}
