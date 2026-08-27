import type { ChangeDelta, PageSummary } from "../core/types";

/**
 * Plugins are pure, synchronous decorators over engine output. They cannot
 * drive the browser, which keeps the engine's action surface explicit.
 */
export interface DVEPlugin {
  name: string;
  onSummary?(summary: PageSummary): PageSummary;
  onChange?(delta: ChangeDelta): ChangeDelta;
}

export class PluginHost {
  private plugins: DVEPlugin[] = [];

  register(plugin: DVEPlugin) {
    if (this.plugins.some((p) => p.name === plugin.name)) return;
    this.plugins.push(plugin);
  }

  onSummary(summary: PageSummary): PageSummary {
    return this.plugins.reduce((acc, p) => (p.onSummary ? p.onSummary(acc) : acc), summary);
  }

  onChange(delta: ChangeDelta): ChangeDelta {
    return this.plugins.reduce((acc, p) => (p.onChange ? p.onChange(acc) : acc), delta);
  }
}
