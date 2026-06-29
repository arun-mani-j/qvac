import test from "brittle";
import { Duplex } from "node:stream";
import { createStowHost } from "@/client/rpc/stow-host";
import { WorkerCrashedError, WorkerShutdownError } from "@/utils/errors-client";
import type { RuntimeContext } from "@/schemas";

// Stand-in for the bare-stow/host IPC: a duplex bare-rpc can bind to, plus the
// lifecycle surface stow-host consumes — `exit`/`error`/`close` events and a
// `terminate()`. The real subprocess is bare-stow's concern; here we only drive
// the host adapter's reaction to that surface.
function makeFakeIpc() {
  const ipc = new Duplex({
    write(_chunk, _enc, cb) {
      cb();
    },
    read() {},
  }) as Duplex & { terminate(): Promise<number> };
  ipc.terminate = async function terminate() {
    ipc.emit("exit", 0);
    ipc.emit("close");
    return 0;
  };
  return ipc;
}

// resolveConfig + getRuntimeContext both empty so initializeConfig short-circuits
// before any RPC round-trip; getRPC() then resolves without a worker responder.
function makeHost(ipcs: Duplex[]) {
  let i = 0;
  return createStowHost({
    boot: async () => ({ ipc: (ipcs[i++] ?? makeFakeIpc()) as never }),
    resolveConfig: async () => undefined,
    getRuntimeContext: () => undefined as unknown as RuntimeContext,
  });
}

test("getRPC resolves and exposes a live worker life-signal", async function (t) {
  const host = makeHost([makeFakeIpc()]);
  t.teardown(() => host.close());

  const rpc = await host.getRPC();
  t.ok(rpc, "getRPC resolved an instance");

  const signal = host.getWorkerLifeSignal();
  t.ok(signal && !signal.aborted, "life-signal is live before any teardown");
});

test("worker death aborts the life-signal with WorkerCrashedError", async function (t) {
  const ipc = makeFakeIpc();
  const host = makeHost([ipc]);

  await host.getRPC();
  const signal = host.getWorkerLifeSignal();
  t.ok(signal, "captured the life-signal");

  ipc.emit("exit", 1);
  ipc.emit("close");

  t.ok(signal!.aborted, "life-signal aborted on worker death");
  t.ok(
    signal!.reason instanceof WorkerCrashedError,
    `expected WorkerCrashedError, got ${String(signal!.reason)}`,
  );
});

test("transport error aborts the life-signal", async function (t) {
  const ipc = makeFakeIpc();
  const host = makeHost([ipc]);

  await host.getRPC();
  const signal = host.getWorkerLifeSignal();

  ipc.emit("error", new Error("transport gone"));

  t.ok(signal!.aborted, "life-signal aborted on transport error");
  t.ok(signal!.reason instanceof WorkerCrashedError, "surfaced as a crash");
});

test("close() aborts with WorkerShutdownError and is idempotent", async function (t) {
  const host = makeHost([makeFakeIpc()]);

  await host.getRPC();
  const signal = host.getWorkerLifeSignal();

  await host.close();
  t.ok(signal!.aborted, "life-signal aborted by close()");
  t.ok(
    signal!.reason instanceof WorkerShutdownError,
    "planned close surfaces as shutdown, not a crash",
  );

  await host.close();
  t.pass("second close() is a no-op");
});

test("getRPC after a crash boots a fresh worker", async function (t) {
  const ipc1 = makeFakeIpc();
  const ipc2 = makeFakeIpc();
  const host = makeHost([ipc1, ipc2]);
  t.teardown(() => host.close());

  const first = await host.getRPC();
  ipc1.emit("close");
  t.absent(host.getWorkerLifeSignal(), "life-signal cleared after crash");

  const second = await host.getRPC();
  t.not(first, second, "next call booted a new RPC instance");
});

test("createDuplexSession tears down its streams when the worker dies", async function (t) {
  const ipc = makeFakeIpc();
  const host = makeHost([ipc]);
  t.teardown(() => host.close());

  const { requestStream, responseStream } = await host.createDuplexSession(
    "payload",
    7,
  );
  // The consumer owns these streams; on a crash they are destroyed with the
  // life-signal reason, which surfaces as an `error` event the consumer handles.
  requestStream.on("error", () => {});
  responseStream.on("error", () => {});

  ipc.emit("close");
  await new Promise((r) => setTimeout(r, 0));

  // The consumer reads the response stream; its teardown is the visible
  // guarantee that the session does not hang on a dead worker.
  t.ok(responseStream.destroyed, "response stream torn down on worker death");
});
