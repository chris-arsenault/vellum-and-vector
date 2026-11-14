import { Decoder, Encoder } from "cbor-x";
import { RpcMapReader } from "./mapReader";

/** Map products cross the wire; binary responses stay binary rather than JSON byte arrays. */
export function httpMapReader(baseUrl: string) {
  const encoder = new Encoder({ useRecords: false }),
    decoder = new Decoder({ useRecords: false });
  const endpoint = new URL("api/maps/read", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  return new RpcMapReader(async (call, options) => {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: options?.signal,
      headers: { "Content-Type": "application/cbor", Accept: "application/cbor" },
      body: new Uint8Array(encoder.encode(call)),
    });
    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      throw new Error(error.message ?? `Map request failed (${response.status}).`);
    }
    const value = decoder.decode(new Uint8Array(await response.arrayBuffer()));
    if (call.method === "source") value.url = new URL(value.url, endpoint).href;
    return value;
  });
}
