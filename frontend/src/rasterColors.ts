/** Presentation math and palettes have no generation or workspace dependency. */
export const palettes = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  magma: ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"],
  blueRed: ["#2166ac", "#92c5de", "#f7f7f7", "#f4a582", "#b2182b"],
  terrain: ["#dae3bd", "#becda5", "#c3c3a8", "#b9ad98", "#a89f93"],
};
/** Signed log retains zero and negative map values. */
export function scaledValue(value: number, scale: "linear" | "log") {
  return scale === "log" ? Math.sign(value) * Math.log(1 + Math.abs(value)) : value;
}
