import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DVEClient, parseCommand, type ConnectionState } from "@/lib/dve-client";
import type { ChangeDelta, ElementDetails, ElementRef, PageSummary } from "@/dve/core/types";

export const Route = createFileRoute("/console")({
  head: () => ({
    meta: [
      { title: "DVE Control Console — Engine Inspector" },
      {
        name: "description",
        content:
          "Engineering console for the DOM Visual Engine: load any URL, inspect discovered elements, and issue real browser actions.",
      },
      { property: "og:title", content: "DVE Control Console" },
      { property: "og:description", content: "Inspect and drive the DOM Visual Engine against any web page." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConsolePage,
});

const ENGINE_URL = "ws://127.0.0.1:7331";

interface LogLine {
  at: number;
  kind: "in" | "out" | "err" | "evt";
  text: string;
}

function ConsolePage() {
  const clientRef = useRef<DVEClient | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<ConnectionState>("idle");
  const [url, setUrl] = useState("/fixtures/1-basic.html");
  const [summary, setSummary] = useState<PageSummary | null>(null);
  const [elements, setElements] = useState<ElementRef[]>([]);
  const [selected, setSelected] = useState<ElementDetails | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [command, setCommand] = useState("observe buttons");
  const [panelWide, setPanelWide] = useState(false);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"elements" | "commands" | "events">("elements");
  const [frameSize, setFrameSize] = useState({ width: 1440, height: 900 });

  const log = useCallback((kind: LogLine["kind"], text: string) => {
    setLogs((prev) => [{ at: Date.now(), kind, text }, ...prev].slice(0, 250));
  }, []);

  const drawFrame = useCallback((data: string, width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const image = new Image();
    image.onload = () => {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(image, 0, 0, width, height);
    };
    image.src = `data:image/jpeg;base64,${data}`;
  }, []);

  useEffect(() => {
    const client = new DVEClient(ENGINE_URL, {
      onState: setState,
      onScreencast: (frame) => {
        setFrameSize({ width: frame.width, height: frame.height });
        drawFrame(frame.data, frame.width, frame.height);
      },
      onChange: (delta: ChangeDelta) => {
        log(
          "evt",
          `delta ${delta.reason} +${delta.added.length} ~${delta.changed.length} -${delta.removed.length} (epoch ${delta.epoch})`,
        );
      },
      onNavigated: (next) => log("evt", `navigated ${next}`),
      onLog: (level, message) => log("evt", `${level}: ${message}`),
    });
    clientRef.current = client;
    client.connect().catch((error: Error) => log("err", error.message));
    return () => client.close();
  }, [drawFrame, log]);

  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client || client.connectionState !== "open") return;
    try {
      const next = (await client.observe({ kind: "summary" })) as PageSummary;
      setSummary(next);
      const interactive = await client.query({ interactive: true, visible: true, limit: 500 });
      setElements(interactive);
    } catch (error) {
      log("err", (error as Error).message);
    }
  }, [log]);

  const load = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const absolute = url.startsWith("http") ? url : `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
    log("out", `goto ${absolute}`);
    try {
      const next = await client.goto(absolute);
      setSummary(next);
      log("in", `${next.title} — ${Object.entries(next.counts).map(([k, v]) => `${k}:${v}`).join(" ")}`);
      await refresh();
    } catch (error) {
      log("err", (error as Error).message);
    }
  }, [url, log, refresh]);

  const runCommand = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const parsed = parseCommand(command);
    if ("error" in parsed) {
      log("err", parsed.error);
      return;
    }
    log("out", command);
    try {
      let result: unknown;
      if (parsed.op === "observe") result = await client.observe(parsed.payload as never);
      else if (parsed.op === "query") result = await client.query(parsed.payload as never);
      else if (parsed.op === "details") result = await client.details(parsed.payload as string);
      else result = await client.act(parsed.payload as never);

      if (Array.isArray(result)) {
        setElements(result as ElementRef[]);
        setTab("elements");
        log("in", `${result.length} result(s)`);
        const ids = (result as ElementRef[]).slice(0, 40).map((r) => r.id);
        if (ids.length) await client.act({ kind: "highlight", targets: ids, durationMs: 4000 });
      } else {
        log("in", JSON.stringify(result).slice(0, 600));
        await refresh();
      }
    } catch (error) {
      log("err", (error as Error).message);
    }
  }, [command, log, refresh]);

  const inspect = useCallback(
    async (ref: ElementRef) => {
      const client = clientRef.current;
      if (!client) return;
      try {
        const details = await client.details(ref.id);
        setSelected(details);
        if (details) await client.act({ kind: "highlight", targets: [ref.id], label: ref.id, durationMs: 5000 });
      } catch (error) {
        log("err", (error as Error).message);
      }
    },
    [log],
  );

  // Forward real input from the screencast canvas into the controlled browser.
  const canvasPoint = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = frameSize.width / rect.width;
    const scaleY = frameSize.height / rect.height;
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
  };

  const onCanvasClick = async (event: React.MouseEvent<HTMLCanvasElement>) => {
    const client = clientRef.current;
    if (!client) return;
    const point = canvasPoint(event);
    try {
      const hits = await client.query({ interactive: true, visible: true, limit: 500 });
      const hit = hits
        .filter(
          (r) =>
            point.x >= r.bounds.x && point.x <= r.bounds.x + r.bounds.width &&
            point.y >= r.bounds.y && point.y <= r.bounds.y + r.bounds.height,
        )
        .sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0];
      if (hit) {
        await inspect(hit);
        log("in", `picked ${hit.id} (${hit.type} "${hit.name}")`);
      } else {
        await client.act({ kind: "move", to: point });
      }
    } catch (error) {
      log("err", (error as Error).message);
    }
  };

  const filtered = useMemo(() => {
    if (!filter.trim()) return elements;
    const needle = filter.toLowerCase();
    return elements.filter(
      (e) => e.name.toLowerCase().includes(needle) || e.type.includes(needle) || e.id.includes(needle),
    );
  }, [elements, filter]);

  const statusTone =
    state === "open" ? "bg-emerald-500" : state === "connecting" ? "bg-amber-400" : "bg-rose-500";

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="font-mono text-sm font-bold tracking-tight">DVE</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={`inline-block h-2 w-2 rounded-full ${statusTone}`} />
          {state === "open" ? "engine connected" : `engine ${state}`}
        </span>
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com or /fixtures/1-basic.html"
            className="flex-1 rounded-md border border-input bg-card px-3 py-1.5 font-mono text-xs outline-none focus:border-ring"
            aria-label="URL to load in the controlled browser"
          />
          <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            Load
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-input px-3 py-1.5 text-xs font-medium"
          >
            Rescan
          </button>
        </form>
        <button
          type="button"
          onClick={() => setPanelWide((v) => !v)}
          className="rounded-md border border-input px-3 py-1.5 text-xs"
        >
          {panelWide ? "Panel 20%" : "Panel 40%"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto bg-muted p-3" style={{ flexBasis: panelWide ? "60%" : "80%" }}>
          {state !== "open" ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
                <h1 className="text-base font-semibold">Engine offline</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  The console drives a real Chromium instance from a local Node process.
                </p>
                <code className="mt-3 block rounded bg-muted px-3 py-2 font-mono text-xs">bun run dve:server</code>
              </div>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              onClick={(event) => void onCanvasClick(event)}
              className="mx-auto block max-w-full cursor-crosshair rounded-md border border-border bg-card shadow-sm"
            />
          )}
        </main>

        <aside
          className="flex min-w-0 flex-col border-l border-border"
          style={{ flexBasis: panelWide ? "40%" : "20%", maxWidth: panelWide ? "40%" : "22%" }}
        >
          <nav className="flex border-b border-border text-xs">
            {(["elements", "commands", "events"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex-1 px-2 py-2 capitalize ${tab === key ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
              >
                {key}
              </button>
            ))}
          </nav>

          {tab === "elements" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border p-2">
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="filter widgets"
                  className="w-full rounded border border-input bg-card px-2 py-1 font-mono text-xs outline-none"
                  aria-label="Filter discovered widgets"
                />
                {summary && (
                  <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                    epoch {summary.epoch} · {summary.viewport.width}×{summary.viewport.height} · frames{" "}
                    {summary.frames.length} · overlays {summary.overlays.length}
                  </p>
                )}
              </div>
              <ul className="min-h-0 flex-1 overflow-auto">
                {filtered.map((ref) => (
                  <li key={ref.id}>
                    <button
                      type="button"
                      onClick={() => void inspect(ref)}
                      className={`w-full border-b border-border px-2 py-1.5 text-left hover:bg-accent ${selected?.id === ref.id ? "bg-accent" : ""}`}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">{ref.id}</span>
                      <span className="ml-1.5 rounded bg-secondary px-1 font-mono text-[10px]">{ref.type}</span>
                      <span className="block truncate text-xs">{ref.name || ref.text || "—"}</span>
                    </button>
                  </li>
                ))}
                {!filtered.length && <li className="p-3 text-xs text-muted-foreground">No widgets discovered yet.</li>}
              </ul>
              {selected && (
                <div className="max-h-[45%] overflow-auto border-t border-border bg-card p-2 font-mono text-[11px]">
                  <Row k="id" v={selected.id} />
                  <Row k="type / role" v={`${selected.type} / ${selected.role}`} />
                  <Row k="name" v={selected.name || "—"} />
                  <Row k="text" v={(selected.text ?? "").slice(0, 120) || "—"} />
                  <Row
                    k="bounds"
                    v={`${Math.round(selected.bounds.x)},${Math.round(selected.bounds.y)} ${Math.round(selected.bounds.width)}×${Math.round(selected.bounds.height)}`}
                  />
                  <Row k="visible / enabled" v={`${selected.visible} / ${selected.enabled}`} />
                  <Row k="viewport / occluded" v={`${selected.inViewport} / ${selected.occluded}`} />
                  <Row k="focused" v={String(selected.focused)} />
                  <Row k="frame" v={selected.frameId} />
                  <Row k="parent" v={selected.parent ?? "—"} />
                  <Row k="children" v={selected.children.length ? selected.children.join(" ") : "—"} />
                  <Row k="state" v={JSON.stringify(selected.state)} />
                  <Row k="attributes" v={JSON.stringify(selected.attributes)} />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {["click", "hover", "focus", "scrollTo"].map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className="rounded border border-input px-2 py-0.5 text-[10px]"
                        onClick={async () => {
                          try {
                            const res = await clientRef.current?.act({ kind, target: selected.id } as never);
                            log("in", JSON.stringify(res).slice(0, 400));
                            await refresh();
                          } catch (error) {
                            log("err", (error as Error).message);
                          }
                        }}
                      >
                        {kind}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "commands" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <form
                className="border-b border-border p-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runCommand();
                }}
              >
                <input
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  className="w-full rounded border border-input bg-card px-2 py-1 font-mono text-xs outline-none"
                  aria-label="DVE command"
                />
                <button type="submit" className="mt-2 w-full rounded bg-primary px-2 py-1 text-xs text-primary-foreground">
                  Run
                </button>
              </form>
              <div className="overflow-auto p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {[
                  "observe summary",
                  "observe buttons",
                  "observe inputs",
                  "observe modals",
                  "observe toasts",
                  "observe frames",
                  "observe buttons in top 50%",
                  "query {\"type\":\"link\",\"text\":\"Student\"}",
                  "get dve_xxxx",
                  "click dve_xxxx",
                  "doubleClick dve_xxxx",
                  'type dve_xxxx "hello"',
                  "scroll 600",
                  "scrollTo dve_xxxx",
                  "highlight dve_xxxx",
                ].map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setCommand(example)}
                    className="block w-full truncate text-left hover:text-foreground"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "events" && (
            <ul className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[10px]">
              {logs.map((line, index) => (
                <li
                  key={`${line.at}-${index}`}
                  className={
                    line.kind === "err"
                      ? "text-destructive"
                      : line.kind === "evt"
                        ? "text-muted-foreground"
                        : line.kind === "out"
                          ? "text-primary"
                          : ""
                  }
                >
                  {line.kind === "out" ? "› " : line.kind === "in" ? "‹ " : "• "}
                  {line.text}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 border-b border-border py-0.5 last:border-0">
      <span className="w-28 shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 break-all">{v}</span>
    </div>
  );
}
