import configPlugins from "@expo/config-plugins";
import type { ExpoConfig } from "expo/config";
import * as fs from "fs";
import * as path from "path";
import reactNativeTarget from "bare-stow-target-react-native";
import { resolveConfigForProject } from "@/client/config-loader/resolve-config.node";
import { resolvePluginSpecifiers } from "@/commands/bundle/plugins";
import { generateWorkerStartEntry } from "@/commands/bundle/entry-gen";
import { runStow } from "@/commands/bundle/stow";
import { getClientLogger } from "@/logging";
import { resolveSDKPackageDir } from "@/expo/plugins/resolve-sdk-package-dir";
import { getProjectRootFromMod } from "@/expo/plugins/get-project-root";
import { findInAncestorNodeModules } from "@/expo/plugins/find-in-ancestor-node-modules";

const { withDangerousMod } = configPlugins;

// Resolved by the app at runtime (the harness loads the Worklet), so they are
// kept out of the stowed worker graph.
const DEFERRED_MODULES = ["expo-file-system", "react-native-bare-kit"];

const MOBILE_HOSTS = [
  "android-arm64",
  "ios-arm64",
  "ios-arm64-simulator",
  "ios-x64-simulator",
];

/**
 * Expo plugin: at prebuild, stow the worker for the `react-native` target into
 * the SDK's `worker.mobile.harness`, which the Expo RPC client loads to boot the
 * worker in a react-native-bare-kit Worklet. Native addons are linked into the
 * app by the patched bare-kit linker (all installed addons, unless a future
 * manifest narrows them). Uses `qvac.config.*` for the plugin set if present.
 */
function withMobileBundle(config: ExpoConfig): ExpoConfig {
  async function buildMobileHarness(
    config: configPlugins.ExportedConfigWithProps<unknown>,
  ) {
    const projectRoot = getProjectRootFromMod(config);
    const sdkPackage = resolveSDKPackageDir(projectRoot);
    const logger = getClientLogger();

    const outputDir = path.join(projectRoot, "qvac");
    const entryPath = path.join(outputDir, "worker.mobile.entry.mjs");
    const outPath = path.join(
      sdkPackage.dir,
      "dist",
      "worker.mobile.harness.js",
    );
    const importsMapPath = path.join(sdkPackage.dir, "bare-imports.json");

    const { configPath, config: qvacConfig } =
      await resolveConfigForProject(projectRoot);
    console.log(
      configPath
        ? `🕚 QVAC: Found ${path.basename(configPath)}, stowing worker harness...`
        : "🕚 QVAC: No config found, stowing worker harness (all plugins)...",
    );

    const plugins = resolvePluginSpecifiers(qvacConfig, sdkPackage.name, logger);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      entryPath,
      generateWorkerStartEntry(plugins, sdkPackage.name),
      "utf8",
    );

    patchBareKitLinkers(projectRoot, sdkPackage.dir);

    await runStow({
      entryPath,
      outPath,
      base: projectRoot,
      importsMapPath,
      hosts: MOBILE_HOSTS,
      target: reactNativeTarget,
      defer: [...DEFERRED_MODULES],
      logger,
    });

    console.log("🫡 QVAC: Mobile worker harness generated");
    return config;
  }

  config = withDangerousMod(config, ["android", buildMobileHarness]);
  config = withDangerousMod(config, ["ios", buildMobileHarness]);
  return config;
}

/**
 * Patches react-native-bare-kit linkers to be manifest-aware. With no
 * `qvac/addons.manifest.json` present the patched linker links all installed
 * addons, which is the correct default for a stowed worker.
 */
function patchBareKitLinkers(projectRoot: string, qvacSdkPath: string) {
  const bareKitPath = findInAncestorNodeModules(
    projectRoot,
    "react-native-bare-kit",
  );
  if (bareKitPath === null) {
    console.warn(
      "⚠️ QVAC: react-native-bare-kit not found in any ancestor node_modules, " +
        "skipping linker patch.",
    );
    return;
  }

  const patchesDir = path.join(qvacSdkPath, "expo", "plugins", "patches");
  if (!fs.existsSync(patchesDir)) {
    console.log(
      `⚠️ QVAC: patches directory not found (${patchesDir}), skipping linker patch`,
    );
    return;
  }

  const androidPatch = path.join(patchesDir, "android-link.mjs");
  const androidTarget = path.join(bareKitPath, "android", "link.mjs");
  if (fs.existsSync(androidPatch)) {
    fs.copyFileSync(androidPatch, androidTarget);
    console.log("✅ QVAC: Patched android/link.mjs for manifest-aware linking");
  } else {
    console.log(`⚠️ QVAC: Android linker patch not found (${androidPatch})`);
  }

  const iosPatch = path.join(patchesDir, "ios-link.mjs");
  const iosTarget = path.join(bareKitPath, "ios", "link.mjs");
  if (fs.existsSync(iosPatch)) {
    fs.copyFileSync(iosPatch, iosTarget);
    console.log("✅ QVAC: Patched ios/link.mjs for manifest-aware linking");
  } else {
    console.log(`⚠️ QVAC: iOS linker patch not found (${iosPatch})`);
  }
}

export { MOBILE_HOSTS };

export default withMobileBundle;
