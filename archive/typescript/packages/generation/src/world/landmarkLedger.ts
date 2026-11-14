/** What generation knows about one authored landmark after emplacement and maintenance. */
export interface LandmarkRecord {
  id: string;
  kind: string;
  /** The signature is held at this mesh; latent landmarks only measure and report. */
  realized: boolean;
  emplacedAtEpoch: number;
  /** Target measures in the catalogue's units. */
  target: Record<string, number>;
  /** Measured at the end of the last maintained epoch, same units. */
  measured: Record<string, number>;
  /** Metres of correction applied over all epochs to hold the signature. */
  maintenance: number;
  /** A magic landmark's injected source strength (0–1000), raised as maintenance. */
  strength?: number;
  /** Mesh-frame cell of the captured river, when a canyon or falls claimed one. */
  capture: { x: number; y: number; accumulation: number } | null;
  /** Cells cut to bring a captured river to a canyon head; they belong to its floor. */
  corridor: number[];
  notes: string[];
}
export type LandmarkLedger = Map<string, LandmarkRecord>;

export function note(record: LandmarkRecord, text: string) {
  if (record.notes.at(-1) !== text) record.notes.push(text);
}
