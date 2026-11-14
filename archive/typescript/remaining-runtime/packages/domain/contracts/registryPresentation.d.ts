/** Display an already resolved catalogue value; no feature composition or world reads. */
export declare function registryCell(
  row: {
    values: Record<string, unknown>;
    feature: {
      attributes: Record<string, unknown>;
    };
  },
  column: {
    key: string;
  }
): string;
