import { answerKeys, respondersTo, type AnswerKey } from "./answers";
import "./responders";
import { groundProcesses } from "../processes/processCatalogue";
import type { Pool } from "./flows";

/**
 * Who affects whom, generated from what processes and responders declare. This is what replaces
 * remembering: nothing is hooked up unless it says so here, and tests hold it to being connected.
 */
export interface ProcessRow {
  id: string;
  reads: readonly string[];
  asks: readonly AnswerKey[];
  moves: readonly (readonly [Pool, Pool])[];
}
export interface AnswerRow {
  key: AnswerKey;
  answeredBy: string[];
  askedBy: string[];
}
export const processRows = (): ProcessRow[] =>
  groundProcesses.map(({ id, reads, asks, moves }) => ({ id, reads, asks, moves }));
export const answerRows = (): AnswerRow[] =>
  answerKeys.map((key) => ({
    key,
    answeredBy: respondersTo(key).map((one) => one.by),
    askedBy: groundProcesses.filter((one) => one.asks.includes(key)).map((one) => one.id),
  }));
