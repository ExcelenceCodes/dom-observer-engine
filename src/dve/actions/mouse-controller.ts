import type { Frame } from "playwright";
import type { BrowserRuntime } from "../runtime/browser-runtime";
import type { MouseSpeed } from "../core/types";

const SPEED_PX_PER_STEP: Record<MouseSpeed, number> = {
  instant: Infinity,
  slow: 12,
  medium: 28,
  "medium-fast": 46,
  fast: 90,
};

const SPEED_STEP_DELAY: Record<MouseSpeed, number> = {
  instant: 0,
  slow: 16,
  medium: 10,
  "medium-fast": 6,
  fast: 3,
};

/**
 * Keeps the real browser mouse and the rendered visual cursor on the exact
 * same coordinate system (CSS viewport pixels of the top-level page).
 */
export class MouseController {
  private pos = { x: 0, y: 0 };

  constructor(private runtime: BrowserRuntime) {}

  get position() {
    return { ...this.pos };
  }

  private get visual() {
    return this.runtime.getConfig().visualMouse?.enabled !== false;
  }

  private get speed(): MouseSpeed {
    return this.runtime.getConfig().visualMouse?.speed ?? "medium-fast";
  }

  private mainFrame(): Frame {
    return this.runtime.page.mainFrame();
  }

  async moveTo(x: number, y: number) {
    const speed = this.visual ? this.speed : "instant";
    const dx = x - this.pos.x;
    const dy = y - this.pos.y;
    const distance = Math.hypot(dx, dy);
    const perStep = SPEED_PX_PER_STEP[speed];
    const steps = distance === 0 || perStep === Infinity ? 1 : Math.max(1, Math.ceil(distance / perStep));

    for (let i = 1; i <= steps; i++) {
      // Ease-out so movement reads as human rather than linear-robotic.
      const t = i / steps;
      const eased = 1 - Math.pow(1 - t, 2);
      const nx = this.pos.x + dx * eased;
      const ny = this.pos.y + dy * eased;
      await this.runtime.page.mouse.move(nx, ny);
      if (this.visual) await this.runtime.call(this.mainFrame(), "cursor", [nx, ny]).catch(() => undefined);
      if (steps > 1 && SPEED_STEP_DELAY[speed]) await sleep(SPEED_STEP_DELAY[speed]);
    }
    this.pos = { x, y };
    if (this.visual) await this.runtime.call(this.mainFrame(), "cursor", [x, y]).catch(() => undefined);
  }

  async click(button: "left" | "right" | "middle" = "left", clickCount = 1) {
    if (this.visual) {
      await this.runtime.call(this.mainFrame(), "pulse", [this.pos.x, this.pos.y]).catch(() => undefined);
      if (clickCount > 1) {
        await sleep(60);
        await this.runtime.call(this.mainFrame(), "pulse", [this.pos.x, this.pos.y]).catch(() => undefined);
      }
    }
    await this.runtime.page.mouse.click(this.pos.x, this.pos.y, { button, clickCount, delay: clickCount > 1 ? 60 : 20 });
  }

  async hideVisual() {
    await this.runtime.call(this.mainFrame(), "cursorHide").catch(() => undefined);
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
