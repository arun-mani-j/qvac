import type { IPC } from "bare-stow/host";
import os from "bare-os";
import { createStowHost } from "@/client/rpc/stow-host";
import { resolveConfig } from "@/client/config-loader/resolve-config.bare";
import { RPCConnectionFailedError } from "@/utils/errors-client";

// Pear exposes its runtime as a global; the pear-runtime stow harness boots the
// worker with `pear.run(bundle)`.
declare const Pear: {
  run: (bundle: string) => unknown;
  config: { applink: string };
};

interface PearHarness {
  start(pear: { run: (bundle: string) => unknown }): Promise<{ ipc: IPC }>;
}

async function loadHarness(): Promise<PearHarness> {
  // The Pear pre-hook stows the pear-runtime harness into the app's qvac/ dir.
  const appRoot = new URL(Pear.config.applink).pathname;
  const url = `file://${appRoot}/qvac/worker.harness.js`;

  let mod: unknown;
  try {
    mod = await import(url);
  } catch (error) {
    throw new RPCConnectionFailedError(
      "Failed to load Pear worker harness (qvac/worker.harness.js). Ensure the QVAC Pear pre-hook ran.",
      error instanceof Error ? error : undefined,
    );
  }

  const ns = mod as { default?: PearHarness; start?: PearHarness["start"] };
  if (ns.default?.start) return ns.default;
  if (ns.start) return ns as PearHarness;
  throw new RPCConnectionFailedError("Pear worker harness has no start()");
}

const host = createStowHost({
  boot: async () => {
    const harness = await loadHarness();
    return harness.start(Pear);
  },
  resolveConfig,
  getRuntimeContext: () => ({ runtime: "bare", platform: os.platform() }),
});

export const getRPC = host.getRPC;
export const close = host.close;
export const createDuplexSession = host.createDuplexSession;
export const getWorkerLifeSignal = host.getWorkerLifeSignal;
