/**
 * Default worker entry point that registers ALL built-in plugins.
 *
 * Exported as the bare-stow harness entry: the generated shim imports this
 * default export and calls `start(ipc, ready)`, where `ipc` is the host IPC
 * stream and the returned value is the cleanup run on terminate.
 */

import type { Duplex, DuplexEvents } from "bare-stream";
import { initializeWorkerCore, startWorker } from "@/server/worker-core";
import { registerPlugins } from "@/server/plugins";
import { getServerLogger } from "@/logging";
import {
  llmPlugin,
  embeddingsPlugin,
  whisperPlugin,
  bciPlugin,
  parakeetPlugin,
  nmtPlugin,
  ttsPlugin,
  ocrPlugin,
  diffusionPlugin,
  vlaPlugin,
  classificationPlugin,
} from "@/server/bare/plugins";

export default function start(ipc: Duplex<DuplexEvents>, ready: () => void) {
  initializeWorkerCore();

  registerPlugins([
    llmPlugin,
    embeddingsPlugin,
    whisperPlugin,
    bciPlugin,
    parakeetPlugin,
    nmtPlugin,
    ttsPlugin,
    ocrPlugin,
    diffusionPlugin,
    vlaPlugin,
    classificationPlugin,
  ]);

  getServerLogger().info("🐻 Hello from Bare");

  return startWorker(ipc, ready);
}
