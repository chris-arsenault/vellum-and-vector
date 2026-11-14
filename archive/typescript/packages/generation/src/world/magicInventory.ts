/** Reservoir operations. Mobile stores own a band; solid stores own charge inside Ground parcels. */
export interface MagicInventory {
  readonly length: number;
  get(cell: number): number;
  set(cell: number, amount: number): void;
  add(cell: number, amount: number): void;
}
