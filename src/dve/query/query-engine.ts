import type { BrowserRuntime } from "../runtime/browser-runtime";
import type { ElementDetails, ElementRef, PageSummary, QuerySpec } from "../core/types";
import { querySpecSchema } from "../core/schema";

/**
 * The query engine never traverses the DOM from Node. It ships one validated
 * spec into each frame's agent, which does a single filtered pass and returns
 * only the requested fields.
 */
export class QueryEngine {
  constructor(private runtime: BrowserRuntime) {}

  async query(rawSpec: QuerySpec): Promise<ElementRef[]> {
    const spec = querySpecSchema.parse(rawSpec) as QuerySpec;
    const targetFrame = spec.frameId ? this.runtime.frameById(spec.frameId) : null;
    const frames = targetFrame ? [targetFrame] : this.runtime.page.frames();
    const out: ElementRef[] = [];

    for (const frame of frames) {
      let refs: ElementRef[] = [];
      try {
        refs = (await this.runtime.call<ElementRef[]>(frame, "query", [spec])) ?? [];
      } catch {
        continue; // inaccessible frame; reported through observe({kind:'frames'})
      }
      if (!refs.length) continue;
      const offset = await this.runtime.frameOffset(frame);
      const frameId = this.runtime.frameIdOf(frame);
      for (const ref of refs) {
        if (ref.bounds) {
          ref.bounds = { ...ref.bounds, x: ref.bounds.x + offset.x, y: ref.bounds.y + offset.y };
        }
        ref.frameId = frameId;
        out.push(ref);
      }
      if (spec.limit && out.length >= spec.limit) break;
    }
    return spec.limit ? out.slice(0, spec.limit) : out;
  }

  async details(elementId: string): Promise<ElementDetails | null> {
    for (const frame of this.runtime.page.frames()) {
      let value: ElementDetails | null = null;
      try {
        value = await this.runtime.call<ElementDetails | null>(frame, "details", [elementId]);
      } catch {
        continue;
      }
      if (value) {
        const offset = await this.runtime.frameOffset(frame);
        value.bounds = { ...value.bounds, x: value.bounds.x + offset.x, y: value.bounds.y + offset.y };
        value.frameId = this.runtime.frameIdOf(frame);
        return value;
      }
    }
    return null;
  }

  /** Cheap page digest: counts + overlays + focus, no element dump. */
  async summary(): Promise<PageSummary> {
    const main = this.runtime.page.mainFrame();
    const base = await this.runtime.call<Omit<PageSummary, "frames">>(main, "summary");
    const frames = await this.runtime.frames();

    const merged: PageSummary = { ...base, frames };
    for (const frame of this.runtime.page.frames()) {
      if (frame === main) continue;
      try {
        const sub = await this.runtime.call<Omit<PageSummary, "frames">>(frame, "summary");
        if (!sub) continue;
        const offset = await this.runtime.frameOffset(frame);
        const frameId = this.runtime.frameIdOf(frame);
        for (const [key, count] of Object.entries(sub.counts)) {
          merged.counts[key] = (merged.counts[key] ?? 0) + count;
        }
        for (const overlay of sub.overlays) {
          overlay.frameId = frameId;
          overlay.bounds = { ...overlay.bounds, x: overlay.bounds.x + offset.x, y: overlay.bounds.y + offset.y };
          merged.overlays.push(overlay);
        }
      } catch {
        // boundary already described in frames[]
      }
    }
    return merged;
  }

  async overlays(): Promise<ElementRef[]> {
    const summary = await this.summary();
    return summary.overlays;
  }

  async focused(): Promise<ElementRef | null> {
    for (const frame of this.runtime.page.frames()) {
      try {
        const ref = await this.runtime.call<ElementRef | null>(frame, "activeElement");
        if (ref) {
          ref.frameId = this.runtime.frameIdOf(frame);
          return ref;
        }
      } catch {
        continue;
      }
    }
    return null;
  }
}
