import type { DVEEvent, DVERequest, DVEResponse } from "../core/types";

/**
 * Transport abstraction: the engine never knows how it is reached.
 * A transport receives validated requests and pushes engine events back.
 */
export interface DVETransport {
  name: string;
  start(handler: TransportHandler): Promise<void> | void;
  broadcast(event: DVEEvent): void;
  stop(): Promise<void> | void;
}

export interface TransportHandler {
  (request: DVERequest): Promise<DVEResponse>;
}
