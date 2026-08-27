import type { DVETransport, TransportHandler } from "./transport";
import type { DVEEvent, DVERequest, DVEResponse } from "../core/types";

/** In-process transport: another Node app embeds DVE and calls it directly. */
export function localTransport(onEvent?: (event: DVEEvent) => void): DVETransport & {
  send(request: DVERequest): Promise<DVEResponse>;
} {
  let handler: TransportHandler | null = null;
  return {
    name: "local",
    start(h) {
      handler = h;
    },
    broadcast(event) {
      onEvent?.(event);
    },
    async send(request) {
      if (!handler) throw new Error("local transport not started");
      return handler(request);
    },
    stop() {
      handler = null;
    },
  };
}
