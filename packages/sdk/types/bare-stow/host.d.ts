declare module "bare-stow/host" {
  import type { Duplex, DuplexEvents } from "bare-stream";

  export interface IPC extends Duplex<DuplexEvents> {
    readonly ready: Promise<void>;
    terminate(): Promise<number | undefined>;
    on(event: "exit", listener: (code: number | undefined) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
  }

  export function wrap(stream: Duplex<DuplexEvents>): IPC;
}
