import { Decoder, Encoder } from "cbor-x";
import { RpcGeneration } from "./generation";
import { cborOptions } from "./cbor";

// Arconis: docs/architecture/subsystems.arconis#item=j_be_http — client posting CBOR generation calls to api/generation.
export class HttpGeneration<Configuration> extends RpcGeneration<Configuration> {
  constructor(baseUrl: string) {
    const endpoint = new URL("api/generation", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const encoder = new Encoder({ useRecords: false });
    const decoder = new Decoder(cborOptions);
    super(async (call, options) => {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: options?.signal,
        headers: { "Content-Type": "application/cbor", Accept: "application/cbor" },
        body: new Uint8Array(encoder.encode(call)),
      });
      if (!response.ok) {
        const error = (await response.json()) as { message?: string };
        throw new Error(error.message ?? `Generation request failed (${response.status}).`);
      }
      return decoder.decode(new Uint8Array(await response.arrayBuffer()));
    });
  }
}
