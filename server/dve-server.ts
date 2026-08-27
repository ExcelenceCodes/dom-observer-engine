/**
 * DVE local engine host.
 *
 *   bun run dve:server
 *
 * Starts a real Chromium instance and exposes the DVE engine over a loopback
 * WebSocket, which the Control Console (or any other controller) connects to.
 */
import { serveDVE } from "../src/dve/transport/serve";
import { webSocketTransport } from "../src/dve/transport/websocket-server";
import { modalsAndToasts } from "../src/dve/plugins/builtin/modals-and-toasts";

const port = Number(process.env["DVE_PORT"] ?? 7331);
const headless = process.env["DVE_HEADED"] !== "1";

const host = serveDVE(webSocketTransport({ port }), {
  browser: { headless, viewport: { width: 1440, height: 900 } },
  screencast: { enabled: process.env["DVE_SCREENCAST"] !== "0", quality: 62 },
  visualMouse: { enabled: true, speed: "medium-fast" },
  typing: { delayMs: 35 },
});

host.dve.use(modalsAndToasts());

await host.start();
await host.dve.connect();
// eslint-disable-next-line no-console
console.log(`[dve] engine ready (headless=${headless}) — connect the console at /console`);

const shutdown = async () => {
  await host.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
