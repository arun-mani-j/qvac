import RPC from "bare-rpc";
import { handleRequest } from "./handle-request";
import type { Duplex, DuplexEvents } from "bare-stream";
import { getServerLogger } from "@/logging";

const logger = getServerLogger();

export function createBareKitRPCServer() {
  const { IPC } = (globalThis as { BareKit?: { IPC: Duplex<DuplexEvents> } })
    .BareKit!;
  return new RPC(IPC, handleRequest);
}

export interface IPCServerOptions {
  onDisconnect?: () => void;
}

export function createRPCServerOverStream(
  stream: Duplex<DuplexEvents>,
  options?: IPCServerOptions,
) {
  stream.on("close", () => {
    logger.warn("IPC stream closed — host process likely terminated");
    options?.onDisconnect?.();
  });

  return new RPC(stream, handleRequest);
}
