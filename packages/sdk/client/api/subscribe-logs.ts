import { getClientLogger, SDK_ALL_LOG_ID } from "@/logging";
import { loggingStream } from "./logging-stream";
import type { LoggingStreamResponse } from "@/schemas/logging-stream";

const logger = getClientLogger();

export type ServerLogHandler = (log: LoggingStreamResponse) => void;

/**
 * Subscribes to all server-side SDK logs (SDK, models, RAG, …) through a single
 * stream and returns a function that stops the subscription.
 *
 * @example
 * ```typescript
 * const unsubscribe = subscribeServerLogs((log) => {
 *   console.log(`[${log.level}] ${log.namespace}: ${log.message}`);
 * });
 * // later
 * unsubscribe();
 * ```
 */
export function subscribeServerLogs(handler: ServerLogHandler) {
  const streamIterator = loggingStream({ id: SDK_ALL_LOG_ID });

  void (async () => {
    try {
      for await (const log of streamIterator) {
        handler(log);
      }
    } catch (error) {
      logger.error("Server log stream error:", error);
    }
  })();

  return () => {
    void streamIterator.return(undefined);
  };
}
