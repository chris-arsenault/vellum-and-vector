import { z } from "zod";
import { DomainError, requireThat } from "@atlas/domain";
import type { HttpConfig, HttpRequest, RequestContext } from "./types";

const claimsSchema = z.object({
  sub: z.string().trim().min(1),
  client_id: z.string().min(1),
  token_use: z.literal("access"),
});
// ALB jwt-validation verifies signatures and issuer. The shared pool accepts
// other applications too, so this boundary additionally checks token purpose
// and this application's client before assigning data ownership.
export function identity(request: HttpRequest, config: HttpConfig): RequestContext {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
    request.headers.authorization ?? ""
  );
  requireThat(match, "unauthorized", "A Cognito access token is required.");
  let claims: z.infer<typeof claimsSchema>;
  try {
    claims = claimsSchema.parse(
      JSON.parse(Buffer.from(match[1].split(".")[1], "base64url").toString("utf8"))
    );
  } catch {
    throw new DomainError(
      "unauthorized",
      "The bearer payload must identify an access-token owner."
    );
  }
  requireThat(
    config.clientId.length > 0,
    "auth_configuration",
    "The application Cognito client is not configured."
  );
  requireThat(
    claims.client_id === config.clientId,
    "forbidden",
    "The access token was issued to another application."
  );
  return {
    principal: { owner: claims.sub, clientId: claims.client_id },
    actor: `${request.headers["x-atlas-actor"] === "agent" ? "agent" : "user"}:${claims.sub}`,
    requestId: request.requestId,
  };
}
