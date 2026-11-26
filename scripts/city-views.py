# /// script
# requires-python = ">=3.11"
# dependencies = ["cbor2>=5,<7", "matplotlib>=3.8,<4", "numpy>=1.26", "shapely>=2.1,<3", "tifffile", "imagecodecs", "zarr>=3,<4"]
# ///
"""Draw City inspection maps from a native trial or an exported published map."""
import argparse
import csv
import json
import sqlite3
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

import cbor2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from matplotlib.colors import Normalize, PowerNorm
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
import numpy as np
from shapely import orient_polygons
from shapely.geometry import shape
from shapely.plotting import patch_from_polygon
import tifffile
import zarr


LAND = {"Trade frontage": "#c78a50", "Working ground": "#a19889",
        "Crowded housing": "#ac7560", "Garden housing": "#b9c89e",
        "Civic precinct": "#ab9bb5", "Housing": "#ddbea1"}
WATER = "#66a0bb"
PARK = "#729568"
WALL = "#65485c"
ROAD = "#664c35"
VIEWS = {
    "overview": "City overview",
    "districts-roads-pois": "Districts, principal roads and points of interest",
    "parks": "Parks and commons",
    "walls-gates": "Walls and gates",
    "roads-population": "Principal roads and population density",
    "roads-elevation": "Principal roads and elevation",
}


def read_json(path):
    return json.loads(path.read_bytes())


class City:
    def __init__(self, folder):
        self.folder = folder
        if (folder / "completed.json").is_file():
            self.document = read_json(folder / "completed.json")
            self.footprint = shape(self.document["snapshot"]["scope"]["footprint"])
            with sqlite3.connect((folder / "records.sqlite").resolve().as_uri() + "?mode=ro", uri=True) as db:
                records = [cbor2.loads(row[0]) for row in db.execute(
                    "SELECT data FROM working_features WHERE area_id=? ORDER BY kind, id",
                    (UUID(self.document["snapshot"]["scope"]["areaId"]).bytes,))]
            self.title = folder.parent.name.rsplit("-", 1)[0].replace("-", " ") + " · " + folder.name
        else:
            self.document = read_json(folder / "map.json")
            self.footprint = shape(self.document["footprint"])
            self.title = self.document["name"]
            records = read_json(folder / "city-view-features.json")
        self.groups = {}
        for record in records:
            self.groups.setdefault(record["kind"], []).append(
                (shape(record["geometry"]), record.get("attributes", {}), record.get("name") or ""))
        if not self.groups.get("district"):
            raise ValueError(f"{folder} has no completed City districts")

    def field(self, channel):
        if "resources" in self.document:
            resource = next(r for r in self.document["resources"]
                            if channel in r.get("field", {}).get("channels", {}))
            field = resource["field"]
            def array(resource_id, name):
                return zarr.open_array(str(self.folder / "resources" / quote(resource_id, safe="") / name),
                                       mode="r")[:]
            layout = field["layoutResourceId"]
            active = array(layout, "active").astype(bool)
            boxes = array(layout, "cellBounds").reshape(-1, 4)[active]
            values = array(resource["id"], field["channels"][channel])[active]
            # Elevation in generation resources uses 1024 native length units per metre.
            return values / (1024 if channel == "Elevation" else 1), boxes
        layer_id = "terrain" if channel == "Elevation" else "raster:Population"
        layer = next(l for l in self.document["layers"] if l["id"] == layer_id)
        data = layer["source"]["data"]
        indices = {b["id"]: i - 1 for b, i in zip(data["bands"], data["bandIndices"], strict=True)}
        display = next(b["display"] for b in data["bands"] if b["id"] == "value")
        with tifffile.TiffFile(self.folder / (layer_id.replace(":", "-") + ".tif")) as tif:
            page = tif.pages[0]
            if page.samplesperpixel > 1:
                bands = np.moveaxis(page.asarray(), page.axes.index("S"), 0)
                values, coverage = bands[indices["value"]], bands[indices["coverage"]]
            else:
                values = tif.pages[indices["value"]].asarray()
                coverage = tif.pages[indices["coverage"]].asarray()
        values = np.where(coverage > 0, values * display["factor"], np.nan)
        return values, layer["bounds"]

    def districts(self):
        return sorted(self.groups["district"], key=lambda r: r[1].get("districtNumber", 0))


def paint(ax, geometry, fill, edge, width, marker="o", size=13):
    if geometry.is_empty:
        return
    if geometry.geom_type in ("Polygon", "MultiPolygon"):
        ax.add_patch(patch_from_polygon(orient_polygons(geometry), facecolor=fill,
                                        edgecolor=edge, linewidth=width))
    elif geometry.geom_type == "LineString":
        ax.plot(*geometry.xy, color=edge, lw=width, solid_capstyle="round")
    elif geometry.geom_type == "Point":
        ax.scatter(geometry.x, geometry.y, c=edge, s=size, marker=marker, zorder=5)
    else:
        for part in geometry.geoms:
            paint(ax, part, fill, edge, width, marker, size)


def field_plot(ax, city, field, norm, cmap):
    values, boxes = field
    if values.ndim == 2:
        w, s, e, n = boxes
        artist = ax.imshow(values, zorder=1, extent=(w, e, s, n), origin="upper",
                           norm=norm, cmap=cmap, interpolation="nearest")
    else:
        w, s, e, n = boxes.T
        vertices = np.stack([np.column_stack(pair) for pair in ((w, s), (e, s), (e, n), (w, n))], axis=1)
        artist = PolyCollection(vertices, array=values, norm=norm, cmap=cmap, edgecolors="none")
        ax.add_collection(artist)
    clip = patch_from_polygon(orient_polygons(city.footprint), transform=ax.transData)
    artist.set_clip_path(clip)
    return artist


def draw(ax, city, view):
    def layer(kind, fill, edge, width, **style):
        for g, _, _ in city.groups.get(kind, []):
            paint(ax, g, fill, edge, width, **style)
    if view == "overview":
        for g, a, _ in city.groups.get("urbanGround", []):
            paint(ax, g, LAND.get(a.get("groundUse"), LAND["Housing"]), "none", 0)
    if view == "districts-roads-pois":
        for i, (g, _, _) in enumerate(city.districts()):
            paint(ax, g, plt.get_cmap("Pastel1")(i % 9), "none", 0)
    if view in ("overview", "parks"):
        layer("park", PARK, "#4f7151", .55)
        layer("square", "#e7daba", "#a7936f", .4)
    for kind in ("river", "lake", "reservoir"):
        for g, a, _ in city.groups.get(kind, []):
            widths = a.get("widths") or []
            # Matplotlib strokes are in points. Convert a river's recorded metres at this panel scale.
            metres = np.median(widths) if widths else 0
            points = ax.get_position().width * ax.figure.get_figwidth() * 72
            width = max(.65, metres * points / np.diff(ax.get_xlim())[0])
            paint(ax, g, WATER, WATER, width)
    if view in ("overview", "districts-roads-pois", "parks", "walls-gates"):
        for g, _, _ in city.districts():
            paint(ax, g, "none", "#66686b", .6)
    for kind in ("road", "thoroughfare"):
        layer(kind, "none", ROAD, .65 if view != "parks" else .35)
    if view in ("overview", "walls-gates", "districts-roads-pois"):
        layer("cityWall", "none", WALL, 1.8)
        layer("cityGate", "none", "#9c315e", 0, marker="s", size=9)
    if view in ("overview", "districts-roads-pois"):
        layer("cityPlace", "none", "#814357", 0, size=10)
        layer("majorWork", "none", "#242431", 0, marker="*", size=55)
    if view == "districts-roads-pois":
        for g, a, _ in city.districts():
            point = g.representative_point()
            ax.annotate(str(a["districtNumber"]), point.coords[0][:2], ha="center", va="center",
                        fontsize=8, bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=.85))


def render(cities, view, out):
    fig, axes = plt.subplots(1, len(cities), figsize=(8 * len(cities), 7), squeeze=False,
                             layout="constrained")
    channel = {"roads-elevation": "Elevation", "roads-population": "Population"}.get(view)
    if channel:
        fields = [c.field(channel) for c in cities]
        values = np.concatenate([a[np.isfinite(a)] for a, _ in fields])
        norm = (PowerNorm(.4, 0, max(1, np.percentile(values, 99)), clip=True)
                if channel == "Population" else Normalize(values.min(), values.max()))
    for i, (city, ax) in enumerate(zip(cities, axes[0])):
        w, s, e, n = city.footprint.bounds
        pad = max(e-w, n-s) * .025
        ax.set(xlim=(w-pad, e+pad), ylim=(s-pad, n+pad), aspect="equal", title=city.title)
        ax.set_axis_off()
        paint(ax, city.footprint, "#f4f1e9", "#c9c4b7", .7)
        if channel:
            artist = field_plot(ax, city, fields[i], norm, "YlOrBr" if channel == "Population" else "terrain")
        draw(ax, city, view)
    if channel:
        fig.colorbar(artist, ax=axes.ravel().tolist(), location="bottom", shrink=.6,
                     label="Residents per km² (upper 1% saturated)" if channel == "Population" else "Elevation (m)")
    else:
        legend = [Line2D([], [], color=ROAD, label="Principal roads"), Patch(color=WATER, label="Water")]
        if view == "overview":
            legend.extend(Patch(color=c, label=n) for n, c in LAND.items())
        if view in ("overview", "parks"):
            legend.append(Patch(color=PARK, label="Park / common"))
        if view != "parks":
            legend.extend([Line2D([], [], color=WALL, label="Wall"),
                           Line2D([], [], marker="s", ls="", color="#9c315e", label="Gate")])
        if view in ("overview", "districts-roads-pois"):
            legend.extend([Line2D([], [], marker="o", ls="", color="#814357", label="Place"),
                           Line2D([], [], marker="*", ls="", color="#242431", label="Major work")])
        axes[0, 0].legend(handles=legend, loc="upper center", bbox_to_anchor=(.5, -.01),
                          ncol=min(5, len(legend)), fontsize=8, frameon=False)
    fig.suptitle(VIEWS[view])
    fig.savefig(out / (view + ".png"), dpi=155)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--compare", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    cities = [City(folder) for folder in [args.input, args.compare] if folder]
    out = args.out or args.input / ("comparison" if args.compare else "views")
    out.mkdir(parents=True, exist_ok=True)
    for view in VIEWS:
        render(cities, view, out)
    with (out / "districts.csv").open("w", newline="") as output:
        table = csv.writer(output)
        table.writerow(["map", "district", "name", "population", "economic", "social", "traits", "x", "y"])
        for city in cities:
            for g, a, name in city.districts():
                point = g.representative_point()
                program = a.get("districtProgram") or {}
                table.writerow([city.title, a["districtNumber"], name, a.get("population"),
                                program.get("economic"), program.get("social"), " ".join(program.get("traits", [])),
                                point.x, point.y])
    print(out.resolve())


if __name__ == "__main__":
    main()
