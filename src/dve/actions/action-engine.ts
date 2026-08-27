import type { Frame } from "playwright";
import type { BrowserRuntime } from "../runtime/browser-runtime";
import type { QueryEngine } from "../query/query-engine";
import { MouseController, sleep } from "./mouse-controller";
import { actionSchema } from "../core/schema";
import { DVEError, NotActionableError, StaleReferenceError, TimeoutError } from "../core/errors";
import type { Action, ActionResult, ChangeDelta, ElementRef } from "../core/types";

interface Resolution {
  frame: Frame;
  frameId: string;
  ref: ElementRef;
  /** Viewport point of the element centre, in top-level page coordinates. */
  point: { x: number; y: number };
}

export class ActionEngine {
  private lastDelta: ChangeDelta | null = null;

  constructor(
    private runtime: BrowserRuntime,
    private query: QueryEngine,
    private mouse: MouseController,
  ) {}

  noteDelta(delta: ChangeDelta) {
    this.lastDelta = delta;
  }

  /** Validate a reference against live DOM state before touching anything. */
  private async resolve(id: string, opts: { requireActionable?: boolean; scroll?: boolean } = {}): Promise<Resolution> {
    for (const frame of this.runtime.page.frames()) {
      let res: { stale: boolean; reason?: string; ref?: ElementRef; actionable?: boolean } | null = null;
      try {
        res = await this.runtime.call(frame, "resolve", [id]);
      } catch {
        continue;
      }
      if (!res) continue;
      if (res.stale) {
        if (res.reason === "unknown-id") continue;
        throw new StaleReferenceError(id, res.reason ?? "stale");
      }
      let ref = res.ref!;
      if (opts.requireActionable && !res.actionable) {
        if (!ref.visible) {
          // Try to bring it into view before declaring it unusable.
          await this.runtime.call(frame, "scrollIntoView", [id, "center"]);
          const retry = await this.runtime.call<{ stale: boolean; ref?: ElementRef; actionable?: boolean }>(frame, "resolve", [id]);
          if (!retry || retry.stale || !retry.actionable) throw new NotActionableError(id, "not visible");
          ref = retry.ref!;
        } else {
          throw new NotActionableError(id, "disabled");
        }
      }
      if (opts.scroll && !ref.inViewport) {
        await this.runtime.call(frame, "scrollIntoView", [id, "center"]);
        const after = await this.runtime.call<{ ref?: ElementRef }>(frame, "resolve", [id]);
        if (after?.ref) ref = after.ref;
      }
      const offset = await this.runtime.frameOffset(frame);
      const scroll = await this.scrollOf(frame);
      const point = {
        x: offset.x + ref.bounds.x - scroll.x + ref.bounds.width / 2,
        y: offset.y + ref.bounds.y - scroll.y + ref.bounds.height / 2,
      };
      ref.bounds = { ...ref.bounds, x: ref.bounds.x + offset.x, y: ref.bounds.y + offset.y };
      ref.frameId = this.runtime.frameIdOf(frame);
      return { frame, frameId: ref.frameId, ref, point };
    }
    throw new StaleReferenceError(id, "unknown-id");
  }

  private async scrollOf(frame: Frame) {
    this.runtime.cost.evaluations++;
    return frame.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  }

  async act(rawAction: Action): Promise<ActionResult> {
    const action = actionSchema.parse(rawAction) as Action;
    const started = Date.now();
    this.runtime.resetCost();
    this.lastDelta = null;
    let target: ElementRef | undefined;

    try {
      switch (action.kind) {
        case "click":
        case "doubleClick":
        case "rightClick":
        case "hover": {
          const r = await this.resolve(action.target, { requireActionable: true, scroll: true });
          target = r.ref;
          await this.mouse.moveTo(r.point.x, r.point.y);
          if (action.kind === "hover") break;
          const button = action.kind === "rightClick" ? "right" : (action as { button?: "left" | "right" | "middle" }).button ?? "left";
          await this.mouse.click(button, action.kind === "doubleClick" ? 2 : 1);
          break;
        }
        case "move": {
          if (action.target) {
            const r = await this.resolve(action.target, { scroll: true });
            target = r.ref;
            await this.mouse.moveTo(r.point.x, r.point.y);
          } else if (action.to) {
            await this.mouse.moveTo(action.to.x, action.to.y);
          } else {
            throw new DVEError("BAD_ACTION", "move requires target or to");
          }
          break;
        }
        case "focus": {
          const r = await this.resolve(action.target, { scroll: true });
          target = r.ref;
          const ok = await this.runtime.call<boolean>(r.frame, "focus", [action.target]);
          if (!ok) throw new NotActionableError(action.target, "element refused focus");
          break;
        }
        case "type": {
          if (action.target) {
            const r = await this.resolve(action.target, { requireActionable: true, scroll: true });
            target = r.ref;
            // Real click focus, then verify focus actually landed on the target.
            await this.mouse.moveTo(r.point.x, r.point.y);
            await this.mouse.click();
            const focusedOk = await this.runtime.call<boolean>(r.frame, "focus", [action.target]);
            if (!focusedOk) throw new NotActionableError(action.target, "element never received focus");
            if (action.clear) await this.clearField(r.frame, action.target);
          }
          const delay = action.delayMs ?? this.runtime.getConfig().typing?.delayMs ?? 35;
          await this.runtime.page.keyboard.type(action.text, { delay });
          break;
        }
        case "clear": {
          const r = await this.resolve(action.target, { requireActionable: true, scroll: true });
          target = r.ref;
          await this.runtime.call(r.frame, "focus", [action.target]);
          await this.clearField(r.frame, action.target);
          break;
        }
        case "select": {
          const r = await this.resolve(action.target, { requireActionable: true, scroll: true });
          target = r.ref;
          const ok = await this.runtime.call<boolean>(r.frame, "selectOptions", [action.target, action.values]);
          if (!ok) throw new NotActionableError(action.target, "not a select element");
          break;
        }
        case "check":
        case "uncheck": {
          const r = await this.resolve(action.target, { requireActionable: true, scroll: true });
          target = r.ref;
          const want = action.kind === "check";
          if (r.ref.checked === want) break;
          await this.mouse.moveTo(r.point.x, r.point.y);
          await this.mouse.click();
          break;
        }
        case "press": {
          if (action.target) {
            const r = await this.resolve(action.target, { scroll: true });
            target = r.ref;
            await this.runtime.call(r.frame, "focus", [action.target]);
          }
          await this.runtime.page.keyboard.press(action.keys);
          break;
        }
        case "scroll": {
          await this.runtime.call(this.runtime.page.mainFrame(), "scrollBy", [action.dx ?? 0, action.dy ?? 0]);
          break;
        }
        case "scrollTo": {
          const r = await this.resolve(action.target);
          await this.runtime.call(r.frame, "scrollIntoView", [action.target, action.block ?? "center"]);
          target = (await this.resolve(action.target)).ref;
          break;
        }
        case "goto": {
          await this.runtime.page.goto(action.url, { waitUntil: action.waitUntil ?? "load", timeout: 45000 });
          break;
        }
        case "back":
          await this.runtime.page.goBack({ waitUntil: "load" });
          break;
        case "forward":
          await this.runtime.page.goForward({ waitUntil: "load" });
          break;
        case "reload":
          await this.runtime.page.reload({ waitUntil: "load" });
          break;
        case "setViewport":
          await this.runtime.page.setViewportSize({ width: action.width, height: action.height });
          break;
        case "waitFor": {
          const timeout = action.timeoutMs ?? 5000;
          const wantPresent = (action.state ?? "present") === "present";
          const deadline = Date.now() + timeout;
          for (;;) {
            const found = await this.query.query({ ...action.query, limit: 1 });
            if (wantPresent && found.length) {
              target = found[0];
              break;
            }
            if (!wantPresent && !found.length) break;
            if (Date.now() > deadline) throw new TimeoutError(JSON.stringify(action.query), timeout);
            await sleep(80);
          }
          break;
        }
        case "highlight": {
          const perFrame = new Map<Frame, string[]>();
          for (const id of action.targets) {
            const r = await this.resolve(id);
            const list = perFrame.get(r.frame) ?? [];
            list.push(id);
            perFrame.set(r.frame, list);
          }
          for (const [frame, ids] of perFrame) {
            await this.runtime.call(frame, "highlight", [
              ids,
              action.label,
              action.durationMs ?? this.runtime.getConfig().highlight?.durationMs ?? 0,
            ]);
          }
          break;
        }
        case "clearHighlights":
          await this.runtime.callAll("clearHighlights");
          break;
      }

      // Let the page settle so the delta reflects the action's real effect.
      await this.settle();

      return {
        ok: true,
        action: action.kind,
        target,
        delta: this.lastDelta,
        durationMs: Date.now() - started,
        cost: this.runtime.snapshotCost(),
      };
    } catch (error) {
      const err = error instanceof DVEError ? error : new DVEError("ACTION_FAILED", String((error as Error)?.message ?? error));
      return {
        ok: false,
        action: action.kind,
        target,
        durationMs: Date.now() - started,
        cost: this.runtime.snapshotCost(),
        error: { code: err.code, message: err.message },
      };
    }
  }

  private async clearField(frame: Frame, id: string) {
    await this.runtime.call(frame, "setValue", [id, ""]);
  }

  /** Wait only as long as the page keeps producing change deltas. */
  private async settle(quietMs = 90, maxMs = 900) {
    const start = Date.now();
    let lastSeen = this.lastDelta;
    let quietSince = Date.now();
    while (Date.now() - start < maxMs) {
      await sleep(30);
      if (this.lastDelta !== lastSeen) {
        lastSeen = this.lastDelta;
        quietSince = Date.now();
      } else if (Date.now() - quietSince >= quietMs) {
        return;
      }
    }
  }
}
