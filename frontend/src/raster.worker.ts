import { tileProcessor } from "./tileProcessor";
import type { TileMessage } from "./tileProtocol";

const process = tileProcessor();
const queue: Extract<TileMessage, { kind: "tile" }>[] = [];
let scheduled = false;
function next() {
  const message = queue.shift();
  if (message) {
    const reply = process(message)!;
    self.postMessage(reply, { transfer: "values" in reply ? [reply.values.buffer] : [] });
  }
  scheduled = queue.length > 0;
  if (scheduled) setTimeout(next, 0);
}
self.addEventListener("message", (event: MessageEvent<TileMessage>) => {
  const message = event.data;
  if (message.kind === "tile") {
    queue.push(message);
    if (!scheduled) {
      scheduled = true;
      setTimeout(next, 0);
    }
  } else if (message.kind === "cancel") {
    const index = queue.findIndex((item) => item.request === message.request);
    if (index >= 0) queue.splice(index, 1);
  } else {
    if (message.kind === "release") {
      for (let index = queue.length - 1; index >= 0; index--)
        if (queue[index].id === message.id) queue.splice(index, 1);
    }
    process(message);
  }
});
