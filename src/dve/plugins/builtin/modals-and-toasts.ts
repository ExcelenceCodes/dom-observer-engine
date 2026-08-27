import type { DVEPlugin } from "../plugin-host";
import type { ChangeDelta, ElementRef, PageSummary } from "../../core/types";

const OVERLAY_TYPES = new Set(["dialog", "toast", "alert", "banner"]);

function overlayOf(refs: ElementRef[]) {
  return refs.filter((r) => OVERLAY_TYPES.has(r.type) && r.visible);
}

/**
 * Surfaces overlay lifecycle explicitly so a controller can react to a modal
 * opening or a toast appearing without diffing the whole page itself.
 */
export function modalsAndToasts(): DVEPlugin {
  return {
    name: "modals-and-toasts",
    onSummary(summary: PageSummary) {
      const counts = { ...summary.counts };
      counts["overlay"] = summary.overlays.length;
      return { ...summary, counts };
    },
    onChange(delta: ChangeDelta) {
      const opened = overlayOf(delta.added);
      const shown = overlayOf(delta.changed);
      if (!opened.length && !shown.length && !delta.removed.length) return delta;
      return Object.assign({}, delta, {
        overlaysOpened: opened,
        overlaysUpdated: shown,
      }) as ChangeDelta;
    },
  };
}
