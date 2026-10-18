export function download(name: string, content: unknown) {
  const type = name.endsWith(".geojson") ? "application/geo+json" : "application/json";
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
