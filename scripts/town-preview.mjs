import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Draw observations of a single generation in metres. The town, frame and scale stay
// fixed across panels, including when an older holding disappears or a street changes.
function parts(geometry) {
  switch (geometry.type) {
    case "Polygon":
      return geometry.coordinates;
    case "MultiPolygon":
      return geometry.coordinates.flat();
    case "LineString":
      return [geometry.coordinates];
    case "MultiLineString":
      return geometry.coordinates;
    case "GeometryCollection":
      return geometry.geometries.flatMap(parts);
    default:
      return [];
  }
}

function extent(series) {
  let west = Infinity,
    east = -Infinity,
    north = -Infinity,
    south = Infinity;
  function include([x, y]) {
    west = Math.min(west, x);
    east = Math.max(east, x);
    south = Math.min(south, y);
    north = Math.max(north, y);
  }
  for (const { town } of series) {
    include(town.centre);
    for (const plot of town.plots) for (const ring of parts(plot)) ring.forEach(include);
    for (const [points, , through] of town.streets) if (!through) points.forEach(include);
    for (const [points] of town.footpaths ?? []) points.forEach(include);
  }
  const width = Math.max(40, east - west, ((north - south) * 4) / 3) * 1.16;
  const height = (width * 3) / 4;
  return [(west + east - width) / 2, -(north + south + height) / 2, width, height];
}

const point = ([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`;
function shape(geometry, closed = true) {
  const paths = parts(geometry).map((line) => `M${line.map(point).join("L")}${closed ? "Z" : ""}`);
  return `<path d="${paths.join("")}"/>`;
}
const escape = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const roof = { residential: "#ab6e58", civic: "#587689", economic: "#bc883a" };
function svg({ town, fields, stage }, frame, buildingsOnly = false) {
  const crossing = (town.crossings ?? []).map(([name, ends]) =>
    `<path d="M${ends.map(point).join("L")}"><title>${escape(name)}</title></path>`
  );
  const walls = (town.walls ?? []).map((points) => shape({type: "LineString", coordinates: points}, false));
  const works = (town.works ?? []).map(([name, components]) =>
    `<g><title>${escape(name)}</title>${components.map((g) => shape(g)).join("")}</g>`
  );
  const walks = (town.footpaths ?? []).map(([[start,end],width]) =>
    `<path d="M${point(start)}L${point(end)}" stroke-width="${width}"/>`
  );
  const roads = town.streets.flatMap(([points, widths]) =>
    points
      .slice(1)
      .map(
        (end, i) =>
          `<path d="M${point(points[i])}L${point(end)}" stroke-width="${(widths[i] + widths[i + 1]) / 2}"/>`
      )
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="${frame.join(" ")}">
<title>${escape(town.name)} — ${stage.phase} (round ${stage.round})</title>
<rect x="${frame[0]}" y="${frame[1]}" width="${frame[2]}" height="${frame[3]}" fill="#d9ddc7"/>
${buildingsOnly ? "" : `<g fill="#d4c9a5" stroke="#b3a682" stroke-width=".6" fill-rule="evenodd">${fields.map((f) => shape(f)).join("")}</g>
<g fill="#e7ddbf" stroke="#ae9f81" stroke-width=".6" fill-rule="evenodd">${town.plots.map((p) => shape(p)).join("")}</g>
<g fill="none" stroke="#82796b" stroke-linecap="round">${roads.join("")}</g>
<g fill="none" stroke="#866e53" stroke-linecap="round">${walks.join("")}</g>
<g fill="none" stroke="#9e9182" stroke-width="1.5">${town.passages.map((p) => shape(p, false)).join("")}</g>
<g fill="none" stroke="#594d38" stroke-width="2.5">${walls.join("")}</g>
<g fill="none" stroke="#426a75" stroke-dasharray="3 2" stroke-width="1.5">${crossing.join("")}</g>
<g fill="none" stroke="#81672b" stroke-width="1.8">${works.join("")}</g>`}
<g stroke="#65584f" stroke-width=".6" fill-rule="evenodd">${town.buildings.map(([g, f,address]) => `<g fill="${roof[f]}">${address ? `<title>${escape(address)}</title>` : ""}${shape(g)}</g>`).join("")}</g>
</svg>`;
}

function comparison(series, frame) {
  const panels = series.map((observation, index) => {
    const x = index * 360;
    const picture = (onlyRoofs, y) =>
      svg(observation, frame, onlyRoofs).replace('width="1200" height="900"', `x="${x}" y="${y}" width="356" height="267"`);
    return `<text x="${x}" y="43">Round ${observation.stage.round}</text>${picture(true, 50)}${picture(false, 349)}`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${series.length * 360}" height="620" font-family="sans-serif" font-size="16">
<rect width="100%" height="100%" fill="white"/>
<text x="0" y="19">${escape(series[0].town.name)} · Buildings only</text>
<text x="0" y="341">Streets, plots and buildings</text>${panels.join("")}</svg>`;
}

export function townPictures(stages) {
  const towns = new Map();
  for (const { settlements, fields, stage } of stages) {
    for (const town of settlements) {
      if (!towns.has(town.key)) towns.set(town.key, []);
      towns.get(town.key).push({ town, fields, stage });
    }
  }
  const pictures = [];
  for (const series of towns.values()) {
    const frame = extent(series);
    const name = series[0].town.name.replace(/[^\w.-]+/g, "-");
    const id = towns.size === 1 ? "" : `-${pictures.length + 1}`;
    for (const observation of series) {
      const { phase, round } = observation.stage;
      const file = `town-${name}${id}-${String(round).padStart(2, "0")}-${phase}.svg`;
      pictures.push({
        file,
        svg: svg(observation, frame),
        label: `${name} ${phase} (round ${round})`,
      });
    }
    pictures.push({
      file: `town-${name}${id}-development.svg`,
      svg: comparison(series, frame),
      label: `${name} development`,
    });
  }
  return pictures;
}

export async function retainTownStage(directory, fabric) {
  const path = join(directory, `fabric-${fabric.stage.round}.json`);
  await writeFile(path + ".tmp", JSON.stringify(fabric));
  await rename(path + ".tmp", path);
}

export async function retainedTownPictures(directory) {
  const files = (await readdir(directory)).filter((file) => /^fabric-\d+\.json$/.test(file));
  const stages = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(join(directory, file), "utf8")))
  );
  return townPictures(stages.sort((a, b) => a.stage.round - b.stage.round));
}
