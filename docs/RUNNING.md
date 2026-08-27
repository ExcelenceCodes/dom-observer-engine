# Running DVE

DVE runs as a local Node/Bun process (Playwright + bundled Chromium). The
TanStack app is only a client of it.

```bash
bun install
bunx playwright install chromium   # one-time Chromium download
bun run dve:server                 # engine + websocket transport on ws://127.0.0.1:7331
bun run dev                        # console at http://localhost:8080/console
```

Test fixtures are served by the dev server:
`/fixtures/1-basic.html`, `/fixtures/2-dashboard.html`, `/fixtures/3-dynamic.html`.

## Environment

- `DVE_PORT` — transport port (default `7331`, loopback only).
- `DVE_HEADED=1` — run Chromium headed instead of headless.

On minimal Linux images Chromium needs the usual system libraries
(`libglib-2.0`, `libnss3`, `libxkbcommon`, …). Install them with
`bunx playwright install --with-deps chromium`, or point `LD_LIBRARY_PATH`
at them if you cannot use the system package manager.

## Embedding the engine directly

```ts
import { createDVE } from "@/dve";

const dve = createDVE({ browser: { headless: true } });
await dve.connect();
await dve.goto("https://example.com");
const buttons = await dve.query({ type: "button", visible: true });
await dve.act({ kind: "click", target: buttons[0].id });
await dve.dispose();
```
