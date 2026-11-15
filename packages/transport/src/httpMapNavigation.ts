import { Decoder, Encoder } from "cbor-x";
import { RpcMapNavigation } from "./mapNavigation";
import { cborOptions } from "./cbor";

export function httpMapNavigation(baseUrl: string) {
  const encoder = new Encoder({ useRecords: false }),
    decoder = new Decoder(cborOptions);
  const endpoint = new URL("api/maps/navigation", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  return new RpcMapNavigation(async (call, options) => {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: options?.signal,
      headers: { "Content-Type": "application/cbor", Accept: "application/cbor" },
      body: new Uint8Array(encoder.encode(call)),
    });
    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      throw new Error(error.message ?? `Map navigation failed (${response.status}).`);
    }
    return decoder.decode(new Uint8Array(await response.arrayBuffer()));
  });
}
