import { chromium, type Browser, type BrowserContext, type Page, type Frame, type CDPSession } from "playwright";
import { DVE_AGENT_SOURCE } from "../agent/source";
import { NotConnectedError, DVEError } from "../core/errors";
import type { ChangeDelta, DVEConfig, EngineCost, FrameInfo, ScreencastFrame } from "../core/types";

type Listener = {
  change: (d: ChangeDelta) => void;
  screencast: (f: ScreencastFrame) => void;
  navigated: (url: string) => void;
  log: (level: "info" | "warn" | "error", message: string) => void;
};

const AGENT_BOOT = DVE_AGENT_SOURCE;

/**
 * BrowserRuntime owns the browser process, the isolated context, agent
 * injection, frame bookkeeping and the screencast. It is the only module that
 * talks to Playwright/CDP directly.
 */
export class BrowserRuntime {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pageRef: Page | null = null;
  private cdp: CDPSession | null = null;
  private frameIds = new WeakMap<Frame, string>();
  private frameSeq = 0;
  private initialized = new WeakSet<Frame>();
  private listeners: Partial<Listener> = {};
  private screencasting = false;
  cost: EngineCost = { evaluations: 0, bytesOut: 0, scans: 0 };

  constructor(private config: DVEConfig) {}

  on<K extends keyof Listener>(event: K, fn: Listener[K]) {
    this.listeners[event] = fn;
  }

  get page(): Page {
    if (!this.pageRef) throw new NotConnectedError();
    return this.pageRef;
  }

  get connected() {
    return !!this.pageRef && !this.pageRef.isClosed();
  }

  applyConfig(config: DVEConfig) {
    this.config = { ...this.config, ...config };
  }

  getConfig() {
    return this.config;
  }

  async launch() {
    if (this.browser) return;
    const viewport = this.config.browser?.viewport ?? { width: 1440, height: 900 };
    this.browser = await chromium.launch({
      headless: this.config.browser?.headless ?? true,
      args: this.config.browser?.args ?? [],
    });
    // Every controlled page lives in its own context: cookies, storage and the
    // injected agent never leak into another browser profile or application.
    this.context = await this.browser.newContext({
      viewport,
      userAgent: this.config.browser?.userAgent,
      bypassCSP: false,
      serviceWorkers: "block",
    });
    await this.context.addInitScript({ content: AGENT_BOOT });
    await this.context.exposeBinding("__dveEmit", (_source, payload: ChangeDelta) => {
      this.listeners.change?.(payload);
    });
    this.pageRef = await this.context.newPage();
    this.pageRef.on("framenavigated", (frame) => {
      this.initialized.delete(frame);
      if (frame === this.pageRef?.mainFrame()) this.listeners.navigated?.(frame.url());
    });
    this.pageRef.on("console", (msg) => {
      if (msg.type() === "error") this.listeners.log?.("warn", `page console: ${msg.text().slice(0, 300)}`);
    });
    this.cdp = await this.context.newCDPSession(this.pageRef);
    if (this.config.screencast?.enabled !== false) await this.startScreencast();
  }

  async startScreencast() {
    if (!this.cdp || this.screencasting) return;
    this.screencasting = true;
    this.cdp.on("Page.screencastFrame", async (evt: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } }) => {
      this.listeners.screencast?.({
        data: evt.data,
        width: evt.metadata.deviceWidth,
        height: evt.metadata.deviceHeight,
        at: Date.now(),
      });
      try {
        await this.cdp?.send("Page.screencastFrameAck", { sessionId: evt.sessionId });
      } catch {
        /* page gone */
      }
    });
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: this.config.screencast?.quality ?? 60,
      maxWidth: this.config.screencast?.maxWidth ?? 1600,
      maxHeight: this.config.screencast?.maxHeight ?? 1000,
      everyNthFrame: 1,
    });
  }

  async stopScreencast() {
    if (!this.cdp || !this.screencasting) return;
    this.screencasting = false;
    await this.cdp.send("Page.stopScreencast").catch(() => undefined);
  }

  frameIdOf(frame: Frame): string {
    let id = this.frameIds.get(frame);
    if (!id) {
      id = frame === this.pageRef?.mainFrame() ? "main" : `frame_${++this.frameSeq}`;
      this.frameIds.set(frame, id);
    }
    return id;
  }

  frameById(frameId: string): Frame | null {
    for (const frame of this.page.frames()) {
      if (this.frameIdOf(frame) === frameId) return frame;
    }
    return null;
  }

  /** Frames Playwright can reach, with same-origin DOM access reported honestly. */
  async frames(): Promise<FrameInfo[]> {
    const out: FrameInfo[] = [];
    for (const frame of this.page.frames()) {
      const id = this.frameIdOf(frame);
      let accessible = true;
      let boundary: string | undefined;
      let offset = { x: 0, y: 0 };
      try {
        if (frame !== this.page.mainFrame()) {
          const el = await frame.frameElement();
          const box = await el.boundingBox();
          if (box) offset = { x: box.x, y: box.y };
          await el.dispose();
        }
        await this.ensureAgent(frame);
      } catch (err) {
        accessible = false;
        boundary = err instanceof Error ? err.message.slice(0, 200) : "inaccessible frame";
      }
      out.push({
        frameId: id,
        url: frame.url(),
        name: frame.name(),
        parentFrameId: frame.parentFrame() ? this.frameIdOf(frame.parentFrame()!) : null,
        accessible,
        boundary,
        offset,
      });
    }
    return out;
  }

  /** Frame offset in page coordinates of the main document. */
  async frameOffset(frame: Frame): Promise<{ x: number; y: number }> {
    if (frame === this.page.mainFrame()) return { x: 0, y: 0 };
    try {
      const el = await frame.frameElement();
      const box = await el.boundingBox();
      await el.dispose();
      return box ? { x: box.x, y: box.y } : { x: 0, y: 0 };
    } catch {
      return { x: 0, y: 0 };
    }
  }

  private async ensureAgent(frame: Frame) {
    if (this.initialized.has(frame)) return;
    const id = this.frameIdOf(frame);
    this.cost.evaluations++;
    const ready = await frame.evaluate((fid) => {
      const w = window as unknown as { __dve?: { init: (f: string) => unknown } };
      if (!w.__dve) return false;
      w.__dve.init(fid);
      return true;
    }, id);
    if (!ready) throw new DVEError("AGENT_MISSING", `DVE agent unavailable in frame ${id}`);
    this.initialized.add(frame);
  }

  /** Invoke an agent command inside one frame. */
  async call<T>(frame: Frame, command: string, args: unknown[] = []): Promise<T> {
    await this.ensureAgent(frame);
    this.cost.evaluations++;
    const result = (await frame.evaluate(
      ([cmd, list]) => {
        const api = (window as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)["__dve"];
        if (!api || typeof api[cmd as string] !== "function") return null;
        return api[cmd as string](...(list as unknown[]));
      },
      [command, args] as [string, unknown[]],
    )) as T;
    this.cost.bytesOut += result ? JSON.stringify(result).length : 0;
    if (command === "scan" || command === "query" || command === "summary") this.cost.scans++;
    return result;
  }

  /** Invoke an agent command in every reachable frame. */
  async callAll<T>(command: string, args: unknown[] = []): Promise<Array<{ frame: Frame; frameId: string; value: T }>> {
    const results: Array<{ frame: Frame; frameId: string; value: T }> = [];
    for (const frame of this.page.frames()) {
      try {
        const value = await this.call<T>(frame, command, args);
        if (value !== null && value !== undefined) {
          results.push({ frame, frameId: this.frameIdOf(frame), value });
        }
      } catch {
        // Cross-origin / detached frames are reported by frames(), never bypassed.
      }
    }
    return results;
  }

  resetCost() {
    this.cost = { evaluations: 0, bytesOut: 0, scans: 0 };
  }

  snapshotCost(): EngineCost {
    return { ...this.cost };
  }

  async dispose() {
    if (this.pageRef && !this.pageRef.isClosed()) {
      await this.callAll("dispose").catch(() => undefined);
      await this.stopScreencast().catch(() => undefined);
    }
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
    this.context = null;
    this.pageRef = null;
    this.cdp = null;
  }
}
