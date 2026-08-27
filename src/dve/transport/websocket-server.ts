import { WebSocketServer, type WebSocket } from "ws";
import type { DVETransport, TransportHandler } from "./transport";
import type { DVEEvent } from "../core/types";
import { requestSchema } from "../core/schema";

/**
 * WebSocket transport. Binds to loopback by default: the engine controls a
 * real browser, so it must never be exposed on a public interface.
 */
export function webSocketTransport(opts: { port?: number; host?: string } = {}): DVETransport {
  const port = opts.port ?? 7331;
  const host = opts.host ?? "127.0.0.1";
  let wss: WebSocketServer | null = null;
  const clients = new Set<WebSocket>();

  return {
    name: "websocket",
    start(handler: TransportHandler) {
      wss = new WebSocketServer({ port, host });
      wss.on("connection", (socket) => {
        clients.add(socket);
        socket.on("close", () => clients.delete(socket));
        socket.on("message", async (raw) => {
          let parsedId = 0;
          try {
            const json = JSON.parse(String(raw));
            parsedId = typeof json?.id === "number" ? json.id : 0;
            const request = requestSchema.parse(json);
            const response = await handler(request);
            socket.send(JSON.stringify(response));
          } catch (error) {
            socket.send(
              JSON.stringify({
                id: parsedId,
                ok: false,
                error: { code: "BAD_REQUEST", message: String((error as Error)?.message ?? error) },
              }),
            );
          }
        });
      });
      // eslint-disable-next-line no-console
      console.log(`[dve] websocket transport listening on ws://${host}:${port}`);
    },
    broadcast(event: DVEEvent) {
      const payload = JSON.stringify(event);
      for (const socket of clients) {
        if (socket.readyState === socket.OPEN) socket.send(payload);
      }
    },
    async stop() {
      for (const socket of clients) socket.close();
      clients.clear();
      await new Promise<void>((resolve) => (wss ? wss.close(() => resolve()) : resolve()));
      wss = null;
    },
  };
}
