import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import stow from "bare-stow";
import type { Logger } from "@/logging/types";

// A bare-stow target: a built-in name or a target provider object (e.g.
// `bare-stow-target-react-native`).
type StowTarget = Parameters<typeof stow>[1];

interface RunStowOptions {
  entryPath: string;
  outPath: string;
  base: string;
  importsMapPath: string;
  hosts: string[];
  logger: Logger;
  target?: StowTarget;
  defer?: string[];
}

/**
 * Bundle `entryPath` for a bare-stow `target` (default `bare-sidecar`), writing
 * the harness, the bundle, and any offloaded addons next to `outPath`. Returns
 * the paths written. `imports` carries the node→bare module map from
 * `bare-imports.json`; `base` anchors the bundle's relative module keys.
 */
export async function runStow(options: RunStowOptions): Promise<string[]> {
  const {
    entryPath,
    outPath,
    base,
    importsMapPath,
    hosts,
    logger,
    target = "bare-sidecar",
    defer,
  } = options;

  const imports = JSON.parse(readFileSync(importsMapPath, "utf8")) as Record<
    string,
    unknown
  >;

  const written: string[] = [];
  for await (const artifact of stow(
    pathToFileURL(entryPath),
    target,
    pathToFileURL(outPath),
    {
      base: pathToFileURL(base + path.sep),
      imports,
      hosts,
      ...(defer ? { defer } : {}),
    },
  )) {
    const file = fileURLToPath(artifact.url);
    logger.debug(`   stow wrote ${file}`);
    written.push(file);
  }

  return written;
}
