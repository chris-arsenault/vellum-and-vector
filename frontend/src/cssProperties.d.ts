import "react";

/** CSS custom properties in a style object: the one inline style the lint rules allow. */
declare module "react" {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
