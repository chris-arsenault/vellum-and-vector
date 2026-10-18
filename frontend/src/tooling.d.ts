declare module "eslint-plugin-react-perf" {
  const plugin: import("eslint").ESLint.Plugin;
  export default plugin;
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
