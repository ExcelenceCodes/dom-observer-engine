import { createDVE, type DVE } from "../index";
import type { DVETransport } from "./transport";
import type { DVEConfig, DVEResponse, DVERequest } from "../core/types";
import { DVEError } from "../core/errors";

/** Binds a DVE instance to any transport. This is the whole integration seam. */
export function serveDVE(transport: DVETransport, config: DVEConfig = {}) {
  const dve: DVE = createDVE(config);
  dve.on("any", (event) => transport.broadcast(event));

  const handler = async (request: DVERequest): Promise<DVEResponse> => {
    try {
      let result: unknown;
      switch (request.op) {
        case "connect":
          if (request.config) dve.configure(request.config);
          await dve.connect();
          result = dve.status();
          break;
        case "goto":
          result = await dve.goto(request.url);
          break;
        case "observe":
          result = await dve.observe(request.spec);
          break;
        case "query":
          result = await dve.query(request.spec);
          break;
        case "details":
          result = await dve.details(request.elementId);
          break;
        case "act":
          result = await dve.act(request.action);
          break;
        case "config":
          dve.configure(request.config);
          result = dve.status();
          break;
        case "status":
          result = dve.status();
          break;
        case "dispose":
          await dve.dispose();
          result = { disposed: true };
          break;
      }
      return { id: request.id, ok: true, result };
    } catch (error) {
      const err = error instanceof DVEError ? error : new DVEError("ENGINE_ERROR", String((error as Error)?.message ?? error));
      return { id: request.id, ok: false, error: { code: err.code, message: err.message } };
    }
  };

  return {
    dve,
    async start() {
      await transport.start(handler);
    },
    async stop() {
      await transport.stop();
      await dve.dispose();
    },
  };
}
