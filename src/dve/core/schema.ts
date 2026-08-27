import { z } from "zod";

/** Runtime validation for everything crossing a transport boundary. */

export const elementTypeSchema = z.enum([
  "button",
  "link",
  "input",
  "textarea",
  "select",
  "checkbox",
  "radio",
  "form",
  "table",
  "list",
  "listitem",
  "menu",
  "menuitem",
  "dialog",
  "toast",
  "alert",
  "banner",
  "tab",
  "heading",
  "image",
  "region",
  "text",
  "other",
]);

export const querySpecSchema = z
  .object({
    type: z.union([elementTypeSchema, z.array(elementTypeSchema)]).optional(),
    role: z.union([z.string(), z.array(z.string())]).optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    tag: z.string().optional(),
    css: z.string().max(400).optional(),
    attributes: z.record(z.string()).optional(),
    visible: z.boolean().optional(),
    inViewport: z.boolean().optional(),
    enabled: z.boolean().optional(),
    focused: z.boolean().optional(),
    interactive: z.boolean().optional(),
    viewport: z
      .object({
        band: z.enum(["top", "bottom", "left", "right"]),
        pct: z.number().min(1).max(100),
      })
      .optional(),
    relativeTo: z
      .object({
        id: z.string(),
        relation: z.enum(["near", "above", "below", "leftOf", "rightOf", "inside"]),
        withinPx: z.number().positive().max(5000).optional(),
      })
      .optional(),
    childrenOf: z.string().optional(),
    descendantsOf: z.string().optional(),
    frameId: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional(),
    fields: z.array(z.string()).optional(),
  })
  .strict();

export const observeSpecSchema = z
  .object({
    kind: z.enum(["summary", "interactive", "overlays", "focus", "frames"]),
    sinceEpoch: z.number().optional(),
  })
  .strict();

const elementId = z.string().regex(/^dve_[a-z0-9#]+$/i, "invalid DVE element id");

export const actionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("click"),
    target: elementId,
    button: z.enum(["left", "right", "middle"]).optional(),
  }),
  z.object({ kind: z.literal("doubleClick"), target: elementId }),
  z.object({ kind: z.literal("rightClick"), target: elementId }),
  z.object({ kind: z.literal("hover"), target: elementId }),
  z.object({
    kind: z.literal("move"),
    target: elementId.optional(),
    to: z.object({ x: z.number(), y: z.number() }).optional(),
  }),
  z.object({ kind: z.literal("focus"), target: elementId }),
  z.object({
    kind: z.literal("type"),
    target: elementId.optional(),
    text: z.string().max(10000),
    delayMs: z.number().min(0).max(2000).optional(),
    clear: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("clear"), target: elementId }),
  z.object({ kind: z.literal("select"), target: elementId, values: z.array(z.string()) }),
  z.object({ kind: z.literal("check"), target: elementId }),
  z.object({ kind: z.literal("uncheck"), target: elementId }),
  z.object({ kind: z.literal("press"), keys: z.string().max(100), target: elementId.optional() }),
  z.object({ kind: z.literal("scroll"), dx: z.number().optional(), dy: z.number().optional() }),
  z.object({
    kind: z.literal("scrollTo"),
    target: elementId,
    block: z.enum(["start", "center", "end"]).optional(),
  }),
  z.object({
    kind: z.literal("goto"),
    url: z.string().url(),
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
  }),
  z.object({ kind: z.literal("back") }),
  z.object({ kind: z.literal("forward") }),
  z.object({ kind: z.literal("reload") }),
  z.object({
    kind: z.literal("setViewport"),
    width: z.number().int().min(200).max(4000),
    height: z.number().int().min(200).max(4000),
  }),
  z.object({
    kind: z.literal("waitFor"),
    query: querySpecSchema,
    timeoutMs: z.number().int().positive().max(60000).optional(),
    state: z.enum(["present", "absent"]).optional(),
  }),
  z.object({
    kind: z.literal("highlight"),
    targets: z.array(elementId).max(200),
    label: z.string().max(80).optional(),
    durationMs: z.number().min(0).max(60000).optional(),
  }),
  z.object({ kind: z.literal("clearHighlights") }),
]);

export const configSchema = z
  .object({
    browser: z
      .object({
        headless: z.boolean().optional(),
        viewport: z.object({ width: z.number(), height: z.number() }).optional(),
        userAgent: z.string().optional(),
        args: z.array(z.string()).optional(),
      })
      .optional(),
    screencast: z
      .object({
        enabled: z.boolean().optional(),
        quality: z.number().min(1).max(100).optional(),
        maxWidth: z.number().optional(),
        maxHeight: z.number().optional(),
      })
      .optional(),
    visualMouse: z
      .object({
        enabled: z.boolean().optional(),
        speed: z.enum(["instant", "slow", "medium", "medium-fast", "fast"]).optional(),
      })
      .optional(),
    typing: z.object({ delayMs: z.number().min(0).max(1000).optional() }).optional(),
    highlight: z.object({ color: z.string().optional(), durationMs: z.number().optional() }).optional(),
  })
  .strict();

export const requestSchema = z.union([
  z.object({ id: z.number(), op: z.literal("connect"), config: configSchema.optional() }),
  z.object({ id: z.number(), op: z.literal("goto"), url: z.string().url() }),
  z.object({ id: z.number(), op: z.literal("observe"), spec: observeSpecSchema }),
  z.object({ id: z.number(), op: z.literal("query"), spec: querySpecSchema }),
  z.object({ id: z.number(), op: z.literal("details"), elementId }),
  z.object({ id: z.number(), op: z.literal("act"), action: actionSchema }),
  z.object({ id: z.number(), op: z.literal("config"), config: configSchema }),
  z.object({ id: z.number(), op: z.literal("status") }),
  z.object({ id: z.number(), op: z.literal("dispose") }),
]);
