declare module "bare-stow" {
  interface StowArtifact {
    url: URL;
  }

  interface StowOptions {
    base?: URL | string;
    imports?: Record<string, unknown>;
    hosts?: string[];
    defer?: string[];
    [key: string]: unknown;
  }

  // A target is a built-in name or a target provider object (e.g.
  // `bare-stow-target-react-native`). `entry`/`out` accept URL-coercible strings.
  type StowTarget = string | { generate: unknown; hosts: string[] };

  export default function stow(
    entry: URL | string,
    target: StowTarget,
    out: URL | string,
    opts?: StowOptions,
  ): AsyncGenerator<StowArtifact>;
}
