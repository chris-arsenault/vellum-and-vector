import { afterAll, beforeEach } from "vitest";
import { configureSpatial } from "@atlas/domain";
import { GeometryKernel, GeosSpatial } from "@atlas/storage-browser";

const kernel = await GeometryKernel.create();
const configure = () => configureSpatial((precision) => new GeosSpatial(kernel, precision));
configure();
beforeEach(configure);
afterAll(() => {
  configureSpatial();
  kernel.close();
});
