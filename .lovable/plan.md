# DVE — DOM Visual Engine: Technical Architecture

Decisions locked from your answers: engine runs as a **local Node process** (Playwright, **bundled Chromium**), console is a client over a transport; target page shown via **CDP screencast** with an optional headed mode; first delivery = **engine core + console + test pages 1–3**.

## 1. Repository inspection

Fresh Lovable TanStack Start template (React 19, Vite 8, Tailwind v4, zod 3, shadcn/ui present, deploys to an edge worker). No backend, no tests, no engine code. The edge target is why the engine cannot live in the deployed app — it becomes a separate Node-side package in the same repo.

## 2. Technology decision (reuse vs. build)

| Concern | Decision | Why |
| --- | --- | --- |
| Browser control, process lifecycle, frames, input, waiting | **Reuse Playwright** (bundled Chromium) | Mature, deterministic, cross-frame input, exposes raw CDP sessions |
| Screencast, accessibility tree, layout metrics, viewport override | **Reuse CDP** via `context.newCDPSession` (`Page.startScreencast`, `Accessibility.*`, `DOM.*`) | Cheaper and more precise than screenshots or DOM polling |
| Change detection, geometry, visibility | **Reuse in-page DOM APIs**: MutationObserver, ResizeObserver, IntersectionObserver, `getBoundingClientRect`, `elementFromPoint` | Event-driven, no polling, no full rescans |
| Validation | **Reuse Zod** (already a dep) | Runtime validation of every command at the transport edge |
| Page map, element registry, stable IDs, query language, spatial queries, action semantics, visual mouse, overlays, delta protocol, transports, plugins | **Custom-built** | This is the DVE abstraction; nothing off-the-shelf provides it |
| Anti-bot / CSP / SOP evasion | **Not built** | Boundaries are reported, never bypassed |

## 3. Module boundaries

```text
src/dve/
  core/        types.ts  schema.ts  errors.ts  events.ts  ids.ts
  runtime/     browser-runtime.ts   frame-manager.ts   cdp-session.ts
  agent/       (bundled, injected into every frame — no framework, no globals leak)
               scanner.ts  a11y.ts  geometry.ts  observers.ts
               registry.ts overlay.ts cursor.ts   query-local.ts
  map/         page-map.ts  element-registry.ts  change-detector.ts
  query/       query-engine.ts  spatial.ts  predicates.ts
  actions/     action-engine.ts  mouse-controller.ts  typing.ts  focus.ts  waits.ts
  overlays/    highlighter.ts  visual-mouse.ts
  plugins/     plugin-host.ts  builtin/ (modals-toasts, tables, forms)
  transport/   transport.ts (iface)  local.ts  websocket-server.ts  websocket-client.ts
  index.ts     createDVE(config)
server/dve-server.ts   # bun run dve:server — WS host on :7331
src/routes/console/    # Control Console (client of the WS transport)
public/fixtures/       # 5 raw HTML test pages
tests/                 # vitest + Playwright-driven engine tests
docs/                  # 19 markdown files from the brief
```

The **agent** is compiled to a single IIFE string and injected via `addInitScript`, so it lands in every frame/navigation before app code. All state lives on one non-enumerable symbol; overlays live in a closed shadow root on a dedicated host element that is excluded from scans. Nothing persists after `dispose()`.

## 4. Public contracts

```ts
const dve = createDVE({
  browser: { headless: true, viewport: {width:1440,height:900} },
  screencast: { enabled: true, quality: 60, maxFps: 12 },
  visualMouse: { enabled: true, speed: 'medium-fast' },
  typing: { delayMs: 35 },
  transport: localTransport(),      // or webSocketTransport(url)
  plugins: [modalsAndToasts(), tables()],
});

await dve.connect();
await dve.goto(url, { waitUntil: 'load' });

await dve.observe({ kind: 'summary' });                 // cheap page digest + deltas
await dve.query({ type: 'button', visible: true,
                  viewport: { band: 'top', pct: 50 } }); // ElementRef[]
await dve.details('dve_8f21');                          // full node incl. parent/children/attrs
await dve.act({ kind: 'click', target: 'dve_8f21' });   // ActionResult + change delta
dve.on('change', (delta) => …);                         // mutation/resize/overlay deltas
await dve.dispose();
```

Every element reference: `{ id, type, role, name, text?, visible, enabled, focused, bounds, frameId, epoch }`. IDs are stable content+path hashes held in the in-page registry; a ref carrying a dead epoch or detached node fails with `StaleReferenceError` before any action runs — never a silent mis-click.

Query shape (Zod-validated, one in-page pass, no round-trip per element): type/role/name/text predicates, state filters, geometry filters (`viewport band`, `near|below|above|beside <ref>`, `intersects rect`), structure filters (`childrenOf`, `withinFrame`), plus `limit`/`fields` so callers pull only what they need.

Action set: click, dblclick, rightclick, hover, move, focus, type, clear, select, check, uncheck, press, scroll, scrollTo, goto, back, waitFor. Each action resolves the ref → validates → optionally animates the visual cursor → performs the **real** Playwright/CDP input → waits for quiescence → returns the resulting delta.

## 5. Efficiency model (non-negotiable)

Full scan happens once per document. After that the in-page agent batches MutationObserver/ResizeObserver/IntersectionObserver records through a rAF+idle coalescer and emits **deltas only** (added/removed/changed IDs). Geometry is lazily computed and invalidated by resize/scroll/mutation epoch, never cached across an epoch. Screencast frames are ack-throttled and pause when the console tab is hidden. No screenshots, no polling loops, no re-serialization of unchanged nodes.

## 6. Control Console

Route `/console`: URL bar; screencast canvas (~80%, click/keyboard forwarded as real CDP input, so pointer position matches the visual mouse); right panel resizable 20%→40% with tabs — **Elements** (live discovered tree, click to inspect all fields from §20, hover to highlight), **Commands** (raw DVE command console over the public API only), **Events** (delta/change stream + per-command timing and cost counters). Engine-offline state is explicit with the `bun run dve:server` hint. Console renders on the edge app fine; it only needs the local WS to do work.

## 7. Test fixtures & testing strategy

`public/fixtures/1-basic.html` … `5-extreme.html`, raw HTML/CSS/JS, no framework — plus framework-independence checks driven against the console's own React/TanStack routes and a Vue/Svelte CDN fixture. Tests (vitest, real Chromium): recognition accuracy against a per-fixture expected-inventory snapshot, ID stability across re-scan and re-render, geometry vs. `getBoundingClientRect` ground truth, visibility/occlusion, query and spatial-query correctness, action effects, scroll/typing/focus, modal & toast lifecycle, dynamic insertion deltas, viewport-resize invalidation, stale-ref rejection, iframe same-origin access + cross-origin boundary reporting, and a resource budget assertion (evaluations and bytes per action must stay under a fixed ceiling).

## 8. Implementation phases

1. **Core runtime** — types/schema, browser runtime, frame manager, agent injection, dispose hygiene.
2. **Page map** — scanner, a11y, registry/IDs, observers, delta protocol.
3. **Query engine** — predicates, geometry, spatial ops.
4. **Actions** — action engine, focus, typing, waits, real mouse.
5. **Visuals** — overlay highlighter, visual cursor, screencast.
6. **Transport + console** — WS server/client, `/console` UI.
7. **Fixtures 1–3 + tests** for everything above.
8. *(Later)* fixtures 4–5, shadow-DOM/iframe depth, plugin SDK, full 19-file docs set.

Phases 1–7 are the first delivery; docs land incrementally per module with the final pass in phase 8.
