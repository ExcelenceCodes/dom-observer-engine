/**
 * Browser-side DVE client. Speaks the same wire protocol as any other
 * transport consumer and imports ONLY the dependency-free core types, so no
 * Playwright/Node code ever enters the app bundle.
 */
import type {
  Action,
  ChangeDelta,
  DVEEvent,
  ElementDetails,
  ElementRef,
  ObserveSpec,
  PageSummary,
  QuerySpec,
  ScreencastFrame,
} from "@/dve/core/types";

export type ConnectionState = "idle" | "connecting" | "open" | "closed" | "error";

export interface DVEClientHandlers {
  onChange?: (delta: ChangeDelta) => void;
  onScreencast?: (frame: ScreencastFrame) => void;
  onNavigated?: (url: string) => void;
  onState?: (state: ConnectionState) => void;
  onLog?: (level: string, message: string) => void;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class DVEClient {
  private socket: WebSocket | null = null;
  private seq = 1;
  private pending = new Map<number, Pending>();
  private state: ConnectionState = "idle";

  constructor(
    private url: string,
    private handlers: DVEClientHandlers = {},
  ) {}

  get connectionState() {
    return this.state;
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.handlers.onState?.(state);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState("connecting");
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url);
      } catch (error) {
        this.setState("error");
        reject(error as Error);
        return;
      }
      this.socket = socket;
      socket.onopen = () => {
        this.setState("open");
        resolve();
      };
      socket.onerror = () => {
        if (this.state !== "open") {
          this.setState("error");
          reject(new Error(`Cannot reach the DVE engine at ${this.url}. Run: bun run dve:server`));
        }
      };
      socket.onclose = () => {
        this.setState("closed");
        for (const [, p] of this.pending) p.reject(new Error("engine connection closed"));
        this.pending.clear();
      };
      socket.onmessage = (event) => this.receive(String(event.data));
    });
  }

  private receive(raw: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg["id"] === "number") {
      const p = this.pending.get(msg["id"] as number);
      if (!p) return;
      this.pending.delete(msg["id"] as number);
      if (msg["ok"]) p.resolve(msg["result"]);
      else p.reject(new Error(`${(msg["error"] as { code: string }).code}: ${(msg["error"] as { message: string }).message}`));
      return;
    }
    const event = msg as unknown as DVEEvent;
    if (event.type === "change") this.handlers.onChange?.(event.delta);
    else if (event.type === "screencast") this.handlers.onScreencast?.(event.frame);
    else if (event.type === "navigated") this.handlers.onNavigated?.(event.url);
    else if (event.type === "log") this.handlers.onLog?.(event.level, event.message);
  }

  private send<T>(payload: Record<string, unknown>): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("DVE engine is not connected"));
    }
    const id = this.seq++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      socket.send(JSON.stringify({ id, ...payload }));
    });
  }

  status() {
    return this.send<{ connected: boolean; url: string | null }>({ op: "status" });
  }
  goto(url: string) {
    return this.send<PageSummary>({ op: "goto", url });
  }
  observe(spec: ObserveSpec) {
    return this.send<PageSummary | ElementRef[] | null>({ op: "observe", spec });
  }
  query(spec: QuerySpec) {
    return this.send<ElementRef[]>({ op: "query", spec });
  }
  details(elementId: string) {
    return this.send<ElementDetails | null>({ op: "details", elementId });
  }
  act(action: Action) {
    return this.send<unknown>({ op: "act", action });
  }
  close() {
    this.socket?.close();
    this.socket = null;
  }
}

/** Parses the console command language into public API calls. */
export function parseCommand(input: string): { op: "observe" | "query" | "details" | "act"; payload: unknown } | { error: string } {
  const line = input.trim();
  if (!line) return { error: "empty command" };
  const [head, ...rest] = line.split(/\s+/);
  const arg = rest.join(" ");
  const cmd = (head ?? "").toLowerCase();

  const observeMap: Record<string, ObserveSpec> = {
    summary: { kind: "summary" },
    interactive: { kind: "interactive" },
    modals: { kind: "overlays" },
    overlays: { kind: "overlays" },
    toasts: { kind: "overlays" },
    focus: { kind: "focus" },
    frames: { kind: "frames" },
  };

  if (cmd === "observe") {
    const key = (rest[0] ?? "summary").toLowerCase();
    if (observeMap[key]) return { op: "observe", payload: observeMap[key] };
    // "observe buttons", "observe buttons in top 50%"
    const type = singular(key);
    const band = /in (top|bottom|left|right) (\d+)%?/i.exec(arg);
    const spec: QuerySpec = { visible: true };
    if (type) spec.type = type as QuerySpec["type"];
    if (band) spec.viewport = { band: String(band[1]).toLowerCase() as "top", pct: Number(band[2]) };
    return { op: "query", payload: spec };
  }

  if (cmd === "get" || cmd === "details") return { op: "details", payload: arg };
  if (cmd === "query") {
    try {
      return { op: "query", payload: JSON.parse(arg) };
    } catch {
      return { error: "query expects JSON, e.g. query {\"type\":\"button\"}" };
    }
  }
  if (cmd === "highlight") return { op: "act", payload: { kind: "highlight", targets: rest, durationMs: 3000 } };
  if (cmd === "clearhighlights") return { op: "act", payload: { kind: "clearHighlights" } };
  if (cmd === "click") return { op: "act", payload: { kind: "click", target: arg } };
  if (cmd === "doubleclick") return { op: "act", payload: { kind: "doubleClick", target: arg } };
  if (cmd === "rightclick") return { op: "act", payload: { kind: "rightClick", target: arg } };
  if (cmd === "hover" || cmd === "moveto" || cmd === "move") return { op: "act", payload: { kind: cmd === "hover" ? "hover" : "move", target: rest[0] } };
  if (cmd === "focus") return { op: "act", payload: { kind: "focus", target: arg } };
  if (cmd === "check") return { op: "act", payload: { kind: "check", target: arg } };
  if (cmd === "uncheck") return { op: "act", payload: { kind: "uncheck", target: arg } };
  if (cmd === "clear") return { op: "act", payload: { kind: "clear", target: arg } };
  if (cmd === "press") return { op: "act", payload: { kind: "press", keys: rest[0], target: rest[1] } };
  if (cmd === "type") {
    const m = /^(\S+)\s+"([\s\S]*)"$/.exec(arg);
    if (!m) return { error: 'type expects: type <id> "text"' };
    return { op: "act", payload: { kind: "type", target: m[1], text: m[2], clear: true } };
  }
  if (cmd === "select") return { op: "act", payload: { kind: "select", target: rest[0], values: rest.slice(1) } };
  if (cmd === "scroll") return { op: "act", payload: { kind: "scroll", dy: Number(rest[0] ?? 400) } };
  if (cmd === "scrollto") return { op: "act", payload: { kind: "scrollTo", target: arg } };
  return { error: `unknown command: ${head}` };
}

function singular(word: string) {
  const map: Record<string, string> = {
    buttons: "button",
    inputs: "input",
    links: "link",
    forms: "form",
    tables: "table",
    dialogs: "dialog",
    selects: "select",
    checkboxes: "checkbox",
    headings: "heading",
    menus: "menu",
    tabs: "tab",
    images: "image",
    lists: "list",
  };
  return map[word] ?? word.replace(/s$/, "");
}
