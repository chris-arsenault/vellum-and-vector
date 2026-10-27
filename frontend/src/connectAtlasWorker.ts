import { atlasWorkspace } from "./atlasWorkspace";

/** The UI transfers a peer port once; geographic results never return through it. */
export async function connectAtlasWorker(worker: Worker) {
  const channel = new MessageChannel();
  try {
    await (await atlasWorkspace()).connect(channel.port1);
    worker.postMessage({ kind: "connect", port: channel.port2 }, [channel.port2]);
  } catch (error) {
    channel.port1.close();
    channel.port2.close();
    throw error;
  }
}
