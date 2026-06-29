/**
 * QVAC Pear Pre-Hook
 *
 * Invoked by Pear before `pear run` / `pear stage`. It stows the worker for the
 * `pear-runtime` target into `<app>/qvac/worker.harness.js` (+ bundle +
 * offloaded addons). The Pear RPC client loads that harness and boots the worker
 * with `pear.run(bundle)`.
 *
 * @example package.json configuration
 * ```json
 * {
 *   "pear": {
 *     "pre": ["@qvac/sdk/pear-pre"]
 *   }
 * }
 * ```
 */

import * as cenc from "compact-encoding";
import pearPipe from "pear-pipe";
import fs from "bare-fs";
import path from "bare-path";
import os from "bare-os";
import stow from "bare-stow";
import pearRuntimeTarget from "bare-stow-target-pear-runtime";
import { generateWorkerStartEntry } from "@/commands/bundle/entry-gen";

declare const Pear: {
  pipe: { end: () => void };
  exit: () => void;
  config: { applink: string };
};

interface PearConfig {
  [key: string]: unknown;
}

interface QvacConfig {
  plugins?: string[];
  [key: string]: unknown;
}

const CONFIG_CANDIDATES = [
  "qvac.config.json",
  "qvac.config.js",
  "qvac.config.mjs",
  "qvac.config.ts",
];

const BUILTIN_PLUGINS = [
  "@qvac/sdk/llamacpp-completion/plugin",
  "@qvac/sdk/llamacpp-embedding/plugin",
  "@qvac/sdk/whispercpp-transcription/plugin",
  "@qvac/sdk/bci-whispercpp-transcription/plugin",
  "@qvac/sdk/nmtcpp-translation/plugin",
  "@qvac/sdk/tts-ggml/plugin",
  "@qvac/sdk/ggml-ocr/plugin",
  "@qvac/sdk/sdcpp-generation/plugin",
  "@qvac/sdk/ggml-vla/plugin",
  "@qvac/sdk/ggml-classification/plugin",
];

const SDK_NAME = "@qvac/sdk";
const LOG_PREFIX = "[qvac/pear-pre]";

function toPosixPath(p: string): string {
  return String(p).replaceAll("\\", "/");
}

function pathToFileUrl(absPath: string): string {
  let p = toPosixPath(absPath);
  if (/^[A-Za-z]:\//.test(p)) p = `/${p}`;
  if (!p.startsWith("/")) p = `/${p}`;

  const encoded = p
    .split("/")
    .map((seg, idx) => {
      if (idx === 0) return "";
      if (idx === 1 && /^[A-Za-z]:$/.test(seg)) return seg;
      return encodeURIComponent(seg);
    })
    .join("/");

  return `file://${encoded}`;
}

/** Extract app root directory from Pear's applink. */
function getAppRoot(): string {
  const applink = Pear.config?.applink;
  if (typeof applink !== "string" || applink.length === 0) {
    throw new Error("Pear.config.applink is not available");
  }

  let url: URL;
  try {
    url = new URL(applink);
  } catch {
    return path.normalize(applink);
  }
  if (url.protocol !== "file:") {
    throw new Error(
      `Expected Pear.config.applink to be a file:// URL (got: ${applink})`,
    );
  }

  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // keep raw pathname
  }
  if (pathname[0] === "/" && pathname[2] === ":") pathname = pathname.slice(1);

  return path.normalize(pathname);
}

/** Resolve the SDK's bare-imports.json, shipped two dirs up from dist/pear/. */
function resolveImportsMapPath(): string {
  const here = decodeURIComponent(new URL(import.meta.url).pathname);
  return path.join(path.dirname(here), "..", "..", "bare-imports.json");
}

function findConfigFile(appRoot: string): string | null {
  for (const candidate of CONFIG_CANDIDATES) {
    const configPath = path.join(appRoot, candidate);
    if (fs.existsSync(configPath)) return configPath;
  }
  return null;
}

async function loadConfig(configPath: string): Promise<QvacConfig> {
  const ext = path.extname(configPath).toLowerCase();

  if (ext === ".json") {
    return JSON.parse(fs.readFileSync(configPath, "utf8") as string) as QvacConfig;
  }
  if (ext === ".js" || ext === ".mjs") {
    const module = (await import(pathToFileUrl(configPath))) as {
      default?: QvacConfig;
    } & QvacConfig;
    return module.default ?? module;
  }
  throw new Error(
    `Unsupported config format: ${ext}. Use qvac.config.json or qvac.config.mjs.`,
  );
}

/** Plugin specifiers from config, or all built-ins when unset. */
function resolvePlugins(config: QvacConfig | null): string[] {
  const fromConfig = Array.isArray(config?.plugins)
    ? [...new Set(config.plugins.filter((p) => typeof p === "string"))]
    : [];
  return fromConfig.length ? fromConfig : [...BUILTIN_PLUGINS];
}

/** Stow the worker for the pear-runtime target into <app>/qvac/. */
async function stowPearHarness(appRoot: string): Promise<void> {
  const configPath = findConfigFile(appRoot);
  const qvacConfig = configPath ? await loadConfig(configPath) : null;
  const plugins = resolvePlugins(qvacConfig);

  const outputDir = path.join(appRoot, "qvac");
  const entryPath = path.join(outputDir, "worker.pear.entry.mjs");
  const outPath = path.join(outputDir, "worker.harness.js");

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    entryPath,
    generateWorkerStartEntry(plugins, SDK_NAME),
    "utf8",
  );

  const imports = JSON.parse(
    fs.readFileSync(resolveImportsMapPath(), "utf8") as string,
  ) as Record<string, unknown>;

  for await (const artifact of stow(pathToFileUrl(entryPath), pearRuntimeTarget, pathToFileUrl(outPath), {
    base: pathToFileUrl(appRoot + path.sep),
    imports,
    hosts: [`${os.platform()}-${os.arch()}`],
  })) {
    console.log(`${LOG_PREFIX} wrote`, artifact.url.href);
  }
}

async function configure(options: PearConfig): Promise<PearConfig> {
  await stowPearHarness(getAppRoot());
  return options;
}

// IPC Protocol
const pipe = pearPipe();

if (!pipe) {
  console.error(`${LOG_PREFIX} No IPC pipe available`);
  process.exit(1);
}

pipe.autoexit = true;

let exitCode = 0;

pipe.on("end", () => {
  try {
    Pear.pipe.end();
  } finally {
    if (exitCode !== 0) process.exit(exitCode);
  }
});

pipe.once("error", (err: Error) => {
  exitCode = exitCode || 1;
  console.error(LOG_PREFIX, err);
});

pipe.once("data", (data: unknown) => {
  void (async () => {
    let options: PearConfig | null = null;
    try {
      options = cenc.decode(cenc.any, data as Buffer) as PearConfig;
    } catch (err) {
      exitCode = 1;
      console.error(LOG_PREFIX, err);
      try {
        pipe.end(cenc.encode(cenc.any, { tag: "configure", data: {} }));
      } catch {
        pipe.destroy(err as Error);
      }
      return;
    }

    try {
      const config = await configure(options);
      pipe.end(cenc.encode(cenc.any, { tag: "configure", data: config }));
    } catch (err) {
      exitCode = 1;
      console.error(LOG_PREFIX, err);
      try {
        pipe.end(cenc.encode(cenc.any, { tag: "configure", data: options }));
      } catch {
        pipe.destroy(err as Error);
      }
    }
  })();
});
