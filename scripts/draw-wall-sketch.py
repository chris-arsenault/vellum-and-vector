# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10"]
# ///
"""Draw a city and its walls from a sketch the city wall bench wrote.

    scripts/draw-wall-sketch.py <sketch.json> <picture.png>

Built ground is shaded by how built it is, water is blue and sheltered ground is tinted
green. Each wall has its own colour; a section that has fallen is drawn thin and pale.
"""
import json
import sys

from PIL import Image, ImageDraw

sketch = json.load(open(sys.argv[1]))
cells = sketch["cells"]
xs = [c[0] for c in cells]
ys = [c[1] for c in cells]
west, east, south, north = min(xs), max(xs), min(ys), max(ys)
scale = 1800 / max(east - west, north - south)
width = int((east - west) * scale) + 40
height = int((north - south) * scale) + 40


def at(x, y):
    return (20 + (x - west) * scale, 20 + (north - y) * scale)


image = Image.new("RGB", (width, height), (247, 244, 236))
draw = ImageDraw.Draw(image)
dot = max(2.0, sketch["spacing"] * scale * 0.62)
for x, y, built, water, sheltered in cells:
    if water:
        colour = (150, 190, 225)
    else:
        shade = int(238 - 110 * min(1.0, built))
        colour = (shade, shade - 6, shade - 22)
        if sheltered:
            colour = (colour[0] - 6, colour[1] + 4, colour[2] - 30)
    px, py = at(x, y)
    draw.rectangle([px - dot, py - dot, px + dot, py + dot], fill=colour)
palette = [(40, 40, 40), (150, 30, 30), (30, 70, 150), (20, 120, 60), (140, 80, 0)]
for (a, b), wall, stands, inherited in sketch["sections"]:
    colour = palette[wall % len(palette)]
    if not stands:
        colour = tuple(int(c + (255 - c) * 0.6) for c in colour)
    draw.line([at(*a), at(*b)], fill=colour, width=3 if stands else 1)
image.save(sys.argv[2])
print(sys.argv[2], image.size)
