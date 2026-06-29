import RPC from "bare-rpc";
import type { IPC } from "bare-stow/host";
import { initializeConfig } from "@/client/init-hooks";
import { getClientLogger } from "@/logging";
import {
  RPCInitTimeoutError,
  WorkerCrashedError,
  WorkerShutdownError,
} from "@/utils/errors-client";
import type { RuntimeContext } from "@/schemas";

const RPC_INIT_TIMEOUT_MS = 30_000;

const logger = getClientLogger();

export interface StowHostConfig {
  /**
   * Boot the runtime's stow harness and return its IPC. The generated harness
   * `start()` already awaits `ipc.ready`, so this resolves once the worker is
   * up. The same shape is returned by every target (sidecar, react-native,
   * pear-runtime), which is what makes this adapter runtime-agnostic.
   */
  boot(): Promise<{ ipc: IPC }>;
  resolveConfig: Parameters<typeof initializeConfig>[1];
  getRuntimeContext(): RuntimeContext | Promise<RuntimeContext>;
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new WorkerCrashedError(null, null),
      );
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}

async function withInitTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new RPCInitTimeoutError(RPC_INIT_TIMEOUT_MS)),
      RPC_INIT_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The shared host side of every stow target: wrap the harness IPC in bare-rpc,
 * derive the worker life-signal from the IPC `exit`/`error`/`close` events, and
 * run the config handshake. The per-runtime modules only differ in `boot()` and
 * the runtime context.
 */
export function createStowHost(config: StowHostConfig) {
  let rpcInstance: RPC | null = null;
  let rpcPromise: Promise<RPC> | null = null;
  let workerIpc: IPC | null = null;
  let lifeController: AbortController | null = null;
  let closePromise: Promise<void> | null = null;

  function reset() {
    rpcInstance = null;
    rpcPromise = null;
    workerIpc = null;
    lifeController = null;
  }

  function getWorkerLifeSignal(): AbortSignal | null {
    return lifeController?.signal ?? null;
  }

  // The IPC carries `exit` (clean shim exit, with code) plus `close`/`error`
  // (transport teardown, covering crashes). Any of them abort the life-signal so
  // in-flight bare-rpc calls reject instead of hanging on a dead worker.
  function wireLifeSignal(ipc: IPC, controller: AbortController) {
    let exitCode: number | undefined;
    ipc.on("exit", (code) => {
      exitCode = code;
    });
    const onDead = (cause?: Error) => {
      if (controller.signal.aborted) return;
      if (lifeController === controller) reset();
      controller.abort(
        cause instanceof WorkerShutdownError
          ? cause
          : new WorkerCrashedError(exitCode ?? null, null),
      );
    };
    ipc.on("error", () => onDead());
    ipc.on("close", () => onDead());
  }

  async function ensureRPC(): Promise<RPC> {
    if (rpcInstance) return rpcInstance;
    if (rpcPromise) return rpcPromise;
    if (closePromise) await closePromise;

    const controller = new AbortController();
    lifeController = controller;

    rpcPromise = (async () => {
      const { ipc } = await withInitTimeout(config.boot());
      workerIpc = ipc;
      wireLifeSignal(ipc, controller);
      rpcInstance = new RPC(ipc, () => {});
      return rpcInstance;
    })();

    let rpc: RPC;
    try {
      rpc = await rpcPromise;
    } catch (error) {
      reset();
      throw error instanceof Error ? error : new Error(String(error));
    }

    const runtimeContext = await config.getRuntimeContext();
    await Promise.race([
      initializeConfig(rpc, config.resolveConfig, runtimeContext),
      rejectOnAbort(controller.signal),
    ]);

    return rpc;
  }

  async function createDuplexSession(payload: string, commandId: number) {
    const rpc = await ensureRPC();
    const req = rpc.request(commandId);
    const requestStream = req.createRequestStream();
    const responseStream = req.createResponseStream({ encoding: "utf-8" });
    requestStream.write(payload, "utf-8");

    const lifeSignal = lifeController?.signal;
    if (lifeSignal && !lifeSignal.aborted) {
      const onAbort = () => {
        const err =
          lifeSignal.reason instanceof Error
            ? lifeSignal.reason
            : new WorkerCrashedError(null, null);
        try {
          (requestStream as { destroy?: (err?: Error) => void }).destroy?.(err);
        } catch {}
        try {
          (responseStream as { destroy?: (err?: Error) => void }).destroy?.(
            err,
          );
        } catch {}
      };
      lifeSignal.addEventListener("abort", onAbort, { once: true });
    }

    return { requestStream, responseStream };
  }

  async function close() {
    if (closePromise) {
      await closePromise;
      return;
    }
    if (!rpcInstance && !rpcPromise && !workerIpc) return;

    logger.info("🧹 Closing RPC client");
    lifeController?.abort(new WorkerShutdownError());

    const ipc = workerIpc;
    reset();

    closePromise = (async () => {
      if (ipc) {
        logger.info("🐻🔫 Terminating bare worker");
        try {
          await ipc.terminate();
        } catch (error) {
          logger.debug("Failed to terminate bare worker", { error });
        }
      }
    })();

    try {
      await closePromise;
    } finally {
      closePromise = null;
    }
  }

  // Synchronous best-effort teardown for process-exit handlers, where awaiting
  // close() is not possible.
  function destroy() {
    lifeController?.abort(new WorkerShutdownError());
    const ipc = workerIpc;
    reset();
    try {
      ipc?.destroy();
    } catch (error) {
      logger.debug("Failed to destroy bare worker during exit", { error });
    }
  }

  return {
    getRPC: ensureRPC,
    close,
    destroy,
    createDuplexSession,
    getWorkerLifeSignal,
  };
}
