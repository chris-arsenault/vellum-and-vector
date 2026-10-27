import { requireThat, type NumericalResource } from "@atlas/domain";
import type { BinaryStore } from "./opfsStore";
import { ByteCache } from "./byteCache";
import { resourcePrefix } from "./resourcePaths";

export const resourceDescriptorCacheBytes = 4 * 1024 * 1024;
/** Working metadata belongs to its writer; ready descriptors are immutable shared inputs. */
export class ResourceDescriptors {
  private ready = new ByteCache<string, NumericalResource>(resourceDescriptorCacheBytes);
  private working = new Map<string, NumericalResource>();
  constructor(private store: BinaryStore) {}
  async get(id: string) {
    const cached = this.ready.get(id) ?? this.working.get(id);
    if (cached) return cached;
    const bytes = await this.store.get(`${resourcePrefix(id)}/resource.json`);
    const resource = bytes
      ? (JSON.parse(new TextDecoder().decode(bytes)) as NumericalResource)
      : null;
    requireThat(
      resource && resource.id === id && resource.schemaVersion === 1,
      "missing_resource",
      "Resource is unavailable or has an unsupported format."
    );
    if (resource.state === "ready") this.ready.set(id, resource, bytes!.byteLength * 2);
    return resource;
  }
  async set(resource: NumericalResource) {
    const owned = structuredClone(resource),
      bytes = new TextEncoder().encode(JSON.stringify(owned));
    await this.store.set(`${resourcePrefix(resource.id)}/resource.json`, bytes);
    this.ready.delete(resource.id);
    this.working.delete(resource.id);
    if (owned.state === "ready") this.ready.set(owned.id, owned, bytes.byteLength * 2);
    else this.working.set(owned.id, owned);
  }
  remove(id: string) {
    this.ready.delete(id);
    this.working.delete(id);
  }
}
