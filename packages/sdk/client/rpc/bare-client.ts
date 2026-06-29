import os from "bare-os";
import type { IPC } from "bare-stow/host";
import { resolveConfig } from "@/client/config-loader/resolve-config.bare";
import { createStowHost } from "@/client/rpc/stow-host";

interface SidecarHarness {
  start(opts?: Record<string, unknown>): Promise<{ ipc: IPC }>;
}

// The Bare host spawns the worker through the bare-sidecar harness, the same way
// Node does — bare-stow has no dedicated Bare target yet, so sidecar is used for
// both. The default harness is the one stowed into dist/worker/harness.js at
// build time; it sits two directories up from dist/client/rpc/.
const host = createStowHost({
  boot: async () => {
    const url = new URL("../../worker/harness.js", import.meta.url).href;
    const harness = (await import(url)) as SidecarHarness;
    return harness.start();
  },
  resolveConfig,
  getRuntimeContext: () => ({ runtime: "bare", platform: os.platform() }),
});

export const getRPC = host.getRPC;
export const close = host.close;
export const createDuplexSession = host.createDuplexSession;
export const getWorkerLifeSignal = host.getWorkerLifeSignal;
