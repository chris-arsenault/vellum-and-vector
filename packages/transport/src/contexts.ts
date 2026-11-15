import type { ContextManagement, ContextInventory, DeleteContext } from "@atlas/context";
import type { ReadOptions } from "@atlas/map";
import { Decoder, Encoder } from "cbor-x";
import { cborOptions } from "./cbor";

export type ContextCall = { method: "list" } | { method: "delete"; request: DeleteContext };
type Transport = (call: ContextCall, options?: ReadOptions) => Promise<unknown>;
export class RpcContextManagement implements ContextManagement {
  constructor(private send: Transport) {}
  async list(options?: ReadOptions) {
    return (await this.send({ method: "list" }, options)) as ContextInventory;
  }
  async delete(request: DeleteContext, options?: ReadOptions) {
    return (await this.send({ method: "delete", request }, options)) as ContextInventory;
  }
}
export function httpContextManagement(baseUrl: string): ContextManagement {
  const endpoint = new URL("api/contexts", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const encoder = new Encoder({ useRecords: false });
  const decoder = new Decoder(cborOptions);
  return new RpcContextManagement(async (call, options) => {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: options?.signal,
      headers: { "Content-Type": "application/cbor", Accept: "application/cbor" },
      body: new Uint8Array(encoder.encode(call)),
    });
    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      throw new Error(error.message ?? `Context request failed (${response.status}).`);
    }
    return decoder.decode(new Uint8Array(await response.arrayBuffer()));
  });
}
