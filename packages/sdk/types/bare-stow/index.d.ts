declare module "bare-stow" {
  interface StowArtifact {
    url: URL;
  }

  interface StowOptions {
    base?: URL;
    imports?: Record<string, unknown>;
    hosts?: string[];
    defer?: string[];
    [key: string]: unknown;
  }

  export default function stow(
    entry: URL,
    target: string,
    out: URL,
    opts?: StowOptions,
  ): AsyncGenerator<StowArtifact>;
}
