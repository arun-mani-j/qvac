import stow from "bare-stow";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const sdkRoot = path.resolve(import.meta.dirname, "..");
const entry = pathToFileURL(path.join(sdkRoot, "dist/server/worker.js"));
const out = pathToFileURL(path.join(sdkRoot, "dist/worker/harness.js"));
const base = pathToFileURL(sdkRoot + path.sep);
const imports = JSON.parse(
  readFileSync(path.join(sdkRoot, "bare-imports.json"), "utf8"),
);

// Release builds set QVAC_BUNDLE_HOSTS to the full desktop set (needs
// cross-platform prebuilds installed); local builds bundle for this host.
const hosts = process.env.QVAC_BUNDLE_HOSTS
  ? process.env.QVAC_BUNDLE_HOSTS.split(",")
  : [`${process.platform}-${process.arch}`];

for await (const artifact of stow(entry, "bare-sidecar", out, {
  base,
  imports,
  hosts,
})) {
  console.log("wrote", artifact.url.href);
}
