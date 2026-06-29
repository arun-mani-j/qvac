import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { IPC } from "bare-stow/host";
import { resolveConfig } from "@/client/config-loader/resolve-config.node";
import { createStowHost } from "@/client/rpc/stow-host";
import { getClientLogger } from "@/logging";

const logger = getClientLogger();

interface SidecarHarness {
  start(opts?: Record<string, unknown>): Promise<{ ipc: IPC }>;
}

function findProjectRootSync(): string | undefined {
  let dir = process.cwd();
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  return undefined;
}

function resolvePackagedHarnessPath(): string | undefined {
  const { resourcesPath } = process as { resourcesPath?: string };
  if (typeof resourcesPath !== "string") return undefined;

  const candidates = [
    path.join(resourcesPath, "app.asar.unpacked", "qvac", "worker.harness.js"),
    path.join(resourcesPath, "app", "qvac", "worker.harness.js"),
    path.join(resourcesPath, "qvac", "worker.harness.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}

/**
 * Resolve the SDK's default worker harness via bundler-visible asset references.
 * `import.meta.asset(<literal>)` lets Bare's bundler see the asset so packaged
 * consumers ship with it; elsewhere it resolves relative to this module.
 */
function getDefaultHarnessPath(): string {
  type ImportMetaAsset = { asset?: (spec: string) => string };
  const hasAsset = typeof (import.meta as ImportMetaAsset).asset === "function";

  const url = hasAsset
    ? new URL((import.meta as ImportMetaAsset).asset!("../../worker/harness.js"))
    : new URL("../../worker/harness.js", import.meta.url);
  return fileURLToPath(url);
}

/**
 * Resolve the worker harness with priority:
 * 1. QVAC_WORKER_PATH environment variable
 * 2. Packaged Electron app worker harness
 * 3. qvac/worker.harness.js in project root (from `bundleWorkerDesktop`)
 * 4. Default SDK worker harness
 */
function resolveHarnessPath(): string {
  const envWorkerPath = process.env["QVAC_WORKER_PATH"] as string | undefined;
  if (envWorkerPath) {
    const normalized = path.resolve(envWorkerPath);
    if (fs.existsSync(normalized)) {
      logger.info(`🔧 Using worker harness from QVAC_WORKER_PATH: ${normalized}`);
      return normalized;
    }
    logger.warn(
      `⚠️ QVAC_WORKER_PATH was set but file was not found: ${normalized}. Falling back.`,
    );
  }

  const packaged = resolvePackagedHarnessPath();
  if (packaged) {
    logger.info(`🔧 Using packaged worker harness: ${packaged}`);
    return packaged;
  }

  const projectRoot = findProjectRootSync();
  if (projectRoot) {
    const customHarness = path.join(projectRoot, "qvac", "worker.harness.js");
    if (fs.existsSync(customHarness)) {
      logger.info(`🔧 Using custom worker harness: ${customHarness}`);
      return customHarness;
    }
  }

  const defaultPath = getDefaultHarnessPath();
  logger.debug(`🔧 Using default SDK worker harness: ${defaultPath}`);
  return defaultPath;
}

const host = createStowHost({
  boot: async () => {
    const harnessPath = resolveHarnessPath();
    const harness = (await import(
      pathToFileURL(harnessPath).href
    )) as SidecarHarness;
    return harness.start();
  },
  resolveConfig,
  getRuntimeContext: () => ({
    runtime: "node",
    platform: process.platform as "darwin" | "linux" | "win32",
  }),
});

export const getRPC = host.getRPC;
export const close = host.close;
export const createDuplexSession = host.createDuplexSession;
export const getWorkerLifeSignal = host.getWorkerLifeSignal;

function handleTerminationSignal(signal: NodeJS.Signals) {
  logger.info(`Received ${signal}, closing RPC resources...`);
  host.destroy();
  process.kill(process.pid, signal);
}

process.once("SIGINT", () => handleTerminationSignal("SIGINT"));
process.once("SIGTERM", () => handleTerminationSignal("SIGTERM"));
process.once("SIGHUP", () => handleTerminationSignal("SIGHUP"));
process.once("exit", () => host.destroy());
