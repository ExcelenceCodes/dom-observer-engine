export class DVEError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "DVEError";
  }
  toJSON() {
    return { code: this.code, message: this.message };
  }
}

export class StaleReferenceError extends DVEError {
  constructor(id: string, reason: string) {
    super("STALE_REFERENCE", `Element ${id} is no longer valid (${reason})`);
  }
}

export class NotConnectedError extends DVEError {
  constructor() {
    super("NOT_CONNECTED", "DVE is not connected to a browser. Call connect() first.");
  }
}

export class NotActionableError extends DVEError {
  constructor(id: string, reason: string) {
    super("NOT_ACTIONABLE", `Element ${id} cannot receive this action (${reason})`);
  }
}

export class FrameBoundaryError extends DVEError {
  constructor(frameId: string, boundary: string) {
    super("FRAME_BOUNDARY", `Frame ${frameId} is not inspectable: ${boundary}`);
  }
}

export class TimeoutError extends DVEError {
  constructor(what: string, ms: number) {
    super("TIMEOUT", `Timed out after ${ms}ms waiting for ${what}`);
  }
}
