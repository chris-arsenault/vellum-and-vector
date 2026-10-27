import { configureSpatial } from "@atlas/domain";
import { GeometryKernel, GeosSpatial } from "@atlas/storage-browser";

/** One native geometry engine per execution context, with bounded prepared handles. */
export async function openSpatialRuntime() {
  const kernel = await GeometryKernel.create();
  configureSpatial((precision) => new GeosSpatial(kernel, precision));
  return () => {
    configureSpatial();
    kernel.close();
  };
}
