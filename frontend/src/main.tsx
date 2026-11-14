export {};

try {
  await import("./renderApp");
} catch (error) {
  const root = document.getElementById("root");
  if (root)
    root.textContent = `The map engine could not start. ${error instanceof Error ? error.message : String(error)}`;
}
