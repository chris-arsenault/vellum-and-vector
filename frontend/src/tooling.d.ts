declare module "eslint-plugin-react-perf" {
  const plugin: import("eslint").ESLint.Plugin;
  export default plugin;
}
declare module "ol-ext/control/LayerSwitcher.js" {
  import Control from "ol/control/Control.js";
  import BaseLayer from "ol/layer/Base.js";
  export default class LayerSwitcher extends Control {
    on: Control["on"] &
      ((
        type: string,
        listener: (
          event: import("ol/events/Event.js").default & {
            layer: BaseLayer;
            li: HTMLLIElement;
          }
        ) => void
      ) => import("ol/events.js").EventsKey);
    constructor(options: {
      target: HTMLElement;
      layerGroup: import("ol/layer/Group.js").default;
      reordering: boolean;
      show_progress: boolean;
      oninfo: (layer: BaseLayer) => void;
    });
  }
}
declare module "eslint-plugin-jsx-a11y" {
  const plugin: import("eslint").ESLint.Plugin & {
    configs: { recommended: { rules: import("eslint").Linter.RulesRecord } };
  };
  export default plugin;
}
declare module "@ahara/standards/eslint-rules" {
  export const noDirectFetch: import("eslint").Rule.RuleModule;
  export const noInlineStyles: import("eslint").Rule.RuleModule;
  export const noEscapeHatches: import("eslint").Rule.RuleModule;
  export const noNonVitestTesting: import("eslint").Rule.RuleModule;
  export const noJsFileExtension: import("eslint").Rule.RuleModule;
  export const maxJsxProps: import("eslint").Rule.RuleModule;
}
