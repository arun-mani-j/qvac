import test from "brittle";
import { SDK_ALL_LOG_ID, SDK_LOG_ID } from "@/logging";
import {
  registerLoggingStream,
  unregisterLoggingStream,
  sendLogToStreams,
  startLogBuffering,
  clearAllLoggingStreams,
} from "@/server/bare/registry/logging-stream-registry";

test("global stream receives logs from every source id", (t) => {
  clearAllLoggingStreams();

  const received: string[] = [];
  const handler = (_level: string, _ns: string, message: string) =>
    received.push(message);
  registerLoggingStream(SDK_ALL_LOG_ID, handler);

  sendLogToStreams(SDK_LOG_ID, "info", "sdk:server", "from sdk");
  sendLogToStreams("model-123", "debug", "llamacpp-completion", "from model");

  t.alike(received, ["from sdk", "from model"], "captures logs across ids");

  unregisterLoggingStream(SDK_ALL_LOG_ID, handler);
  sendLogToStreams(SDK_LOG_ID, "info", "sdk:server", "after unsubscribe");
  t.alike(received, ["from sdk", "from model"], "stops after unsubscribe");

  clearAllLoggingStreams();
});

test("per-id stream still receives only its own logs", (t) => {
  clearAllLoggingStreams();

  const global: string[] = [];
  const model: string[] = [];
  const globalHandler = (_l: string, _n: string, m: string) => global.push(m);
  const modelHandler = (_l: string, _n: string, m: string) => model.push(m);

  registerLoggingStream(SDK_ALL_LOG_ID, globalHandler);
  registerLoggingStream("model-123", modelHandler);

  sendLogToStreams("model-123", "info", "llamacpp-completion", "a");
  sendLogToStreams("model-456", "info", "llamacpp-completion", "b");

  t.alike(model, ["a"], "model stream only sees its own id");
  t.alike(global, ["a", "b"], "global stream sees both");

  clearAllLoggingStreams();
});

test("global stream flushes startup logs buffered before subscribe", (t) => {
  clearAllLoggingStreams();
  startLogBuffering(SDK_ALL_LOG_ID);

  sendLogToStreams(SDK_LOG_ID, "info", "sdk:server", "early");

  const received: string[] = [];
  registerLoggingStream(SDK_ALL_LOG_ID, (_l, _n, m) => received.push(m));

  t.alike(received, ["early"], "buffered log delivered on subscribe");

  clearAllLoggingStreams();
});
