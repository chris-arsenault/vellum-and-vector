/** Source-only compiler fixtures. They are parsed, never executed. */
export const callerContract = `
import { plateAdvection as movePlates } from "../../packages/generation/src/world/advection";
declare const args: Parameters<typeof movePlates>;
movePlates(...args);
`;
export const contract = `
import { bindOperation, defineCommand, defineQuery } from "./processOperation";
import { mapQuery, mapWork } from "./processTraits";
import type { GenerationState, MapProcess } from "./process";
import { fieldQuery } from "./processes/builder";
import type { FieldProcess, StageProcess } from "./processes/groundProcess";
function kernel(value: number) { void value; }
async function asyncKernel(value: number) { void value; }
function utility(value: number) { void value; }
const named = defineQuery("named", kernel, []);
const forwarded = defineQuery("forwarded", (value: number) => { kernel(value); }, []);
const asynchronous = defineCommand("async", "event", asyncKernel, []);
const composite = defineQuery("other", (value: number) => {
  kernel(value);
  utility(value);
}, []);
const otherAsync = defineCommand("other-async", "event", async (value: number) => {
  await asyncKernel(value);
  utility(value);
}, []);
function namedComposite(value: number) {
  kernel(value);
  utility(value);
}
const otherNamed = defineQuery("other-named", namedComposite, []);
function nativeKernel() {}
const method = fieldQuery({ id: "native", statement: "contract", execute() {
  nativeKernel();
}}, []);
function returningNumber(state: GenerationState) { void state; return 1; }
function numericExposure(state: GenerationState) { void state; return 1; }
const valueCallback = mapQuery("value", returningNumber, []);
const valueForwarder = mapQuery("forwarded-value", (state) => returningNumber(state), []);
const exposure = mapWork("exposure", numericExposure, () => undefined, []);
const badValueOwner = mapQuery("bad-value", (state) => {
  returningNumber(state);
  utility(1);
}, []);
const badAsync = defineQuery("bad-async", asyncKernel, []);
const badMapAsync = mapQuery("bad-map-async", async () => {}, []);
const badFieldAsync = fieldQuery({id: "bad-field-async", statement: "contract", execute: async () => {}}, []);
bindOperation({}, named, asyncKernel);
const hiddenAsync: (value: number) => void = async (value) => { void value; };
const badTypedAsync = defineQuery("bad-typed-async", hiddenAsync, []);
declare const map: MapProcess, field: FieldProcess, stage: StageProcess;
const invalidMap: MapProcess = { ...map, operation: () => {} };
const invalidField: FieldProcess = { ...field, operation: () => {} };
const invalidStage: StageProcess = { ...stage, prepare: () => () => {} };
`;
