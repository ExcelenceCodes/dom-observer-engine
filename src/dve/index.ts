/**
 * DVE — DOM Visual Engine. Public API.
 *
 * NODE ONLY. This module imports Playwright and must never be imported from
 * browser/edge code. Consumers that only need types import "src/dve/core/types".
 */
import { BrowserRuntime } from "./runtime/browser-runtime";
import { QueryEngine } from "./query/query-engine";
import { ActionEngine } from "./actions/action-engine";
import { MouseController } from "./actions/mouse-controller";
import { PluginHost, type DVEPlugin } from "./plugins/plugin-host";
import { configSchema, observeSpecSchema, querySpecSchema } from "./core/schema";
import { DVEError, NotConnectedError } from "./core/errors";
import type {
  Action,
  ActionResult,
  ChangeDelta,
  DVEConfig,
  DVEEvent,
  ElementDetails,
  ElementRef,
  FrameInfo,
  ObserveSpec,
  PageSummary,
  QuerySpec,
  ScreencastFrame,
} from "./core/types";

export type ObserveResult = PageSummary | ElementRef[] | FrameInfo[] | ElementRef | null;

export interface DVE {
  connect(): Promise<void>;
  goto(url: string, opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" }): Promise<PageSummary>;
  observe(spec: ObserveSpec): Promise<ObserveResult>;
  query(spec: QuerySpec): Promise<ElementRef[]>;
  details(elementId: string): Promise<ElementDetails | null>;
  act(action: Action): Promise<ActionResult>;
  configure(config: DVEConfig): void;
  status(): { connected: boolean; url: string | null; config: DVEConfig };
  on(event: "change", fn: (delta: ChangeDelta) => void): () => void;
  on(event: "screencast", fn: (frame: ScreencastFrame) => void): () => void;
  on(event: "any", fn: (event: DVEEvent) => void): () => void;
  use(plugin: DVEPlugin): void;
  dispose(): Promise<void>;
}

export function createDVE(config: DVEConfig = {}): DVE {
  const validated = configSchema.parse(config) as DVEConfig;
  const runtime = new BrowserRuntime(validated);
  const query = new QueryEngine(runtime);
  const mouse = new MouseController(runtime);
  const actions = new ActionEngine(runtime, query, mouse);
  const plugins = new PluginHost();
  const listeners = new Set<(e: DVEEvent) => void>();

  const emit = (event: DVEEvent) => {
    for (const fn of listeners) fn(event);
  };

  runtime.on("change", (delta) => {
    actions.noteDelta(delta);
    const enriched = plugins.onChange(delta);
    emit({ type: "change", delta: enriched });
  });
  runtime.on("screencast", (frame) => emit({ type: "screencast", frame }));
  runtime.on("navigated", (url) => emit({ type: "navigated", url }));
  runtime.on("log", (level, message) => emit({ type: "log", level, message }));

  return {
    async connect() {
      await runtime.launch();
      emit({ type: "status", connected: true, url: null });
    },

    async goto(url, opts) {
      if (!runtime.connected) throw new NotConnectedError();
      await runtime.page.goto(url, { waitUntil: opts?.waitUntil ?? "load", timeout: 45000 });
      const summary = await query.summary();
      emit({ type: "navigated", url: summary.url });
      return summary;
    },

    async observe(rawSpec) {
      const spec = observeSpecSchema.parse(rawSpec) as ObserveSpec;
      if (!runtime.connected) throw new NotConnectedError();
      runtime.resetCost();
      switch (spec.kind) {
        case "summary":
          return plugins.onSummary(await query.summary());
        case "interactive":
          return query.query({ interactive: true, visible: true });
        case "overlays":
          return query.overlays();
        case "focus":
          return query.focused();
        case "frames":
          return runtime.frames();
        default:
          throw new DVEError("BAD_OBSERVE", `unknown observe kind`);
      }
    },

    query(spec) {
      if (!runtime.connected) throw new NotConnectedError();
      return query.query(querySpecSchema.parse(spec) as QuerySpec);
    },

    details(elementId) {
      if (!runtime.connected) throw new NotConnectedError();
      return query.details(elementId);
    },

    act(action) {
      if (!runtime.connected) throw new NotConnectedError();
      return actions.act(action);
    },

    configure(next) {
      runtime.applyConfig(configSchema.parse(next) as DVEConfig);
    },

    status() {
      return {
        connected: runtime.connected,
        url: runtime.connected ? runtime.page.url() : null,
        config: runtime.getConfig(),
      };
    },

    on(event: string, fn: (arg: never) => void) {
      const wrapped = (e: DVEEvent) => {
        if (event === "any") (fn as unknown as (e: DVEEvent) => void)(e);
        else if (e.type === event) (fn as unknown as (v: unknown) => void)((e as unknown as Record<string, unknown>)[event === "change" ? "delta" : "frame"]);
      };
      listeners.add(wrapped);
      return () => listeners.delete(wrapped);
    },

    use(plugin) {
      plugins.register(plugin);
    },

    async dispose() {
      await runtime.dispose();
      listeners.clear();
      emit({ type: "status", connected: false, url: null });
    },
  };
}

export * from "./core/types";
export { DVEError, StaleReferenceError, NotActionableError, TimeoutError } from "./core/errors";
export type { DVEPlugin } from "./plugins/plugin-host";
export { modalsAndToasts } from "./plugins/builtin/modals-and-toasts";
