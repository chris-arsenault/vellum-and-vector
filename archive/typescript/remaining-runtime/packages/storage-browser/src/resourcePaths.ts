import { requireThat } from "@atlas/domain";
export function resourcePrefix(id: string): `/${string}` {
  requireThat(
    !!id && id !== "." && id !== ".." && !id.includes("/"),
    "resource_identity",
    "Resource needs a path-safe identity."
  );
  return `/resources/${encodeURIComponent(id)}`;
}
