/**
 * DVE — DOM Visual Engine
 * Core type contracts. This module is dependency-free and safe to import from
 * ANY environment (browser, edge worker, node). The Control Console imports
 * only from here, never from the Node-side engine.
 */

export type ElementType =
  | "button"
  | "link"
  | "input"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "form"
  | "table"
  | "list"
  | "listitem"
  | "menu"
  | "menuitem"
  | "dialog"
  | "toast"
  | "alert"
  | "banner"
  | "tab"
  | "heading"
  | "image"
  | "region"
  | "text"
  | "other";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Stable, validated handle to a live element. */
export interface ElementRef {
  id: string;
  type: ElementType;
  role: string;
  name: string;
  text?: string;
  value?: string;
  visible: boolean;
  inViewport: boolean;
  occluded: boolean;
  enabled: boolean;
  focused: boolean;
  checked?: boolean;
  /** Page-relative bounds (frame offset already applied). */
  bounds: Bounds;
  frameId: string;
  /** Geometry epoch; a ref from a dead epoch is re-validated before actions. */
  epoch: number;
}

export interface ElementDetails extends ElementRef {
  tag: string;
  attributes: Record<string, string>;
  parent: string | null;
  children: string[];
  /** Frame-local bounds, before frame offset. */
  localBounds: Bounds;
  scrollable: boolean;
  path: string;
  state: Record<string, string | number | boolean | null>;
}

export type ViewportBand = "top" | "bottom" | "left" | "right";

export type SpatialRelation = "near" | "above" | "below" | "leftOf" | "rightOf" | "inside";

export interface QuerySpec {
  /** Element type filter. */
  type?: ElementType | ElementType[];
  role?: string | string[];
  /** Case-insensitive substring match on accessible name. */
  name?: string;
  /** Case-insensitive substring match on text content. */
  text?: string;
  /** Match against tag name. */
  tag?: string;
  /** CSS selector escape hatch, evaluated in-page (never generated JS). */
  css?: string;
  attributes?: Record<string, string>;
  visible?: boolean;
  inViewport?: boolean;
  enabled?: boolean;
  focused?: boolean;
  interactive?: boolean;
  /** Geometry band of the viewport, e.g. { band: 'top', pct: 50 }. */
  viewport?: { band: ViewportBand; pct: number };
  /** Spatial relation to another element. */
  relativeTo?: { id: string; relation: SpatialRelation; withinPx?: number };
  /** Structural filters. */
  childrenOf?: string;
  descendantsOf?: string;
  frameId?: string;
  /** Response shaping. */
  limit?: number;
  fields?: Array<keyof ElementRef>;
}

export type ObserveKind = "summary" | "interactive" | "overlays" | "focus" | "frames";

export interface ObserveSpec {
  kind: ObserveKind;
  /** Only report what changed since this epoch, when supported. */
  sinceEpoch?: number;
}

export interface PageSummary {
  url: string;
  title: string;
  epoch: number;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  documentSize: { width: number; height: number };
  counts: Record<string, number>;
  frames: FrameInfo[];
  overlays: ElementRef[];
  focused: ElementRef | null;
}

export interface FrameInfo {
  frameId: string;
  url: string;
  name: string;
  parentFrameId: string | null;
  /** False for cross-origin frames the browser will not let us inspect. */
  accessible: boolean;
  /** Reason a frame is inaccessible; always reported, never bypassed. */
  boundary?: string;
  offset: { x: number; y: number };
}

export interface ChangeDelta {
  epoch: number;
  frameId: string;
  reason: "mutation" | "resize" | "scroll" | "navigation" | "focus";
  added: ElementRef[];
  removed: string[];
  changed: ElementRef[];
  focused?: ElementRef | null;
  at: number;
}

export type MouseSpeed = "instant" | "slow" | "medium" | "medium-fast" | "fast";

export type Action =
  | { kind: "click"; target: string; button?: "left" | "right" | "middle" }
  | { kind: "doubleClick"; target: string }
  | { kind: "rightClick"; target: string }
  | { kind: "hover"; target: string }
  | { kind: "move"; target?: string; to?: { x: number; y: number } }
  | { kind: "focus"; target: string }
  | { kind: "type"; target?: string; text: string; delayMs?: number; clear?: boolean }
  | { kind: "clear"; target: string }
  | { kind: "select"; target: string; values: string[] }
  | { kind: "check"; target: string }
  | { kind: "uncheck"; target: string }
  | { kind: "press"; keys: string; target?: string }
  | { kind: "scroll"; dx?: number; dy?: number }
  | { kind: "scrollTo"; target: string; block?: "start" | "center" | "end" }
  | { kind: "goto"; url: string; waitUntil?: "load" | "domcontentloaded" | "networkidle" }
  | { kind: "back" }
  | { kind: "forward" }
  | { kind: "reload" }
  | { kind: "setViewport"; width: number; height: number }
  | { kind: "waitFor"; query: QuerySpec; timeoutMs?: number; state?: "present" | "absent" }
  | { kind: "highlight"; targets: string[]; label?: string; durationMs?: number }
  | { kind: "clearHighlights" };

export interface ActionResult {
  ok: boolean;
  action: Action["kind"];
  target?: ElementRef;
  /** Change observed as a direct consequence of the action. */
  delta?: ChangeDelta | null;
  durationMs: number;
  /** Engine cost accounting: how expensive this call actually was. */
  cost: EngineCost;
  error?: { code: string; message: string };
}

export interface EngineCost {
  evaluations: number;
  bytesOut: number;
  scans: number;
}

export interface DVEConfig {
  browser?: {
    headless?: boolean;
    viewport?: { width: number; height: number };
    userAgent?: string;
    /** Extra Chromium args; no security-bypass flags are added by DVE. */
    args?: string[];
  };
  screencast?: { enabled?: boolean; quality?: number; maxWidth?: number; maxHeight?: number };
  visualMouse?: { enabled?: boolean; speed?: MouseSpeed };
  typing?: { delayMs?: number };
  highlight?: { color?: string; durationMs?: number };
}

export interface ScreencastFrame {
  data: string;
  width: number;
  height: number;
  at: number;
}

/** Wire protocol shared by every transport. */
export type DVERequest =
  | { id: number; op: "connect"; config?: DVEConfig }
  | { id: number; op: "goto"; url: string }
  | { id: number; op: "observe"; spec: ObserveSpec }
  | { id: number; op: "query"; spec: QuerySpec }
  | { id: number; op: "details"; elementId: string }
  | { id: number; op: "act"; action: Action }
  | { id: number; op: "config"; config: DVEConfig }
  | { id: number; op: "status" }
  | { id: number; op: "dispose" };

export type DVEEvent =
  | { type: "change"; delta: ChangeDelta }
  | { type: "screencast"; frame: ScreencastFrame }
  | { type: "navigated"; url: string }
  | { type: "status"; connected: boolean; url: string | null }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

export type DVEResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { code: string; message: string } };

export type DVEMessage = DVEResponse | ({ id?: undefined } & DVEEvent);
