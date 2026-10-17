import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

if (!isMainThread) {
  const mode = workerData;
  let error;
  let calls = 0;
  Error.prepareStackTrace = error => {
    parentPort.postMessage({ formatter: ++calls });
    if (mode === "throwing-formatter") throw new Error("formatter failure");
    return `formatted:${error.message}`;
  };
  if (mode === "vm" || mode === "vm-throwing-formatter") {
    error = runInNewContext(
      `
      Error.prepareStackTrace = error => {
        notify();
        ${mode === "vm-throwing-formatter" ? 'throw new Error("formatter failure")' : 'return "formatted:" + error.message'};
      };
      new Error("original")
    `,
      { notify: () => parentPort.postMessage({ formatter: ++calls }) },
    );
  } else {
    error = new Error("original");
    if (mode === "captured") Error.captureStackTrace(error);
    if (mode === "materialized") assert.equal(error.stack, "formatted:original");
    if (mode === "throwing-getter" || mode === "captured-throwing-getter") {
      if (mode === "captured-throwing-getter") Error.captureStackTrace(error);
      Object.defineProperty(error, "stack", {
        configurable: true,
        get() {
          parentPort.postMessage({ getter: true });
          throw new Error("getter failure");
        },
      });
    }
  }
  error.code = "E_ORIGINAL";
  // Exercise rethrowing as well as first delivery; neither changes the original identity.
  try {
    throw error;
  } catch (caught) {
    throw caught;
  }
} else {
  const result = {};
  let calls = 0;
  Error.prepareStackTrace = error => {
    calls++;
    return `formatted:${error.message}`;
  };
  for (const captured of [false, true]) {
    calls = 0;
    const error = new Error("local");
    if (captured) Error.captureStackTrace(error);
    const before = calls;
    const first = error.stack;
    const second = error.stack;
    try {
      throw error;
    } catch (caught) {
      assert.equal(caught.stack, second);
    }
    result[captured ? "captured" : "constructed"] = { before, first, second, calls };
  }
  delete Error.prepareStackTrace;
  result.vm = runInNewContext(`
    let calls = 0;
    Error.prepareStackTrace = error => { calls++; return "formatted:" + error.message; };
    const error = new Error("vm-local");
    const before = calls;
    const first = error.stack;
    const second = error.stack;
    ({ before, first, second, calls });
  `);
  for (const mode of [
    "ordinary",
    "captured",
    "materialized",
    "throwing-formatter",
    "throwing-getter",
    "captured-throwing-getter",
    "vm",
    "vm-throwing-formatter",
  ]) {
    result["worker:" + mode] = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: mode });
      const events = [];
      let forwarded;
      worker.on("message", message => events.push(message));
      worker.on("error", error => {
        forwarded = { name: error.name, message: error.message, stack: error.stack ?? null, code: error.code };
      });
      worker.on("exit", code => {
        if (!forwarded) return reject(new Error(`No forwarded error for ${mode}, exit ${code}`));
        resolve({ events, forwarded, exit: code });
      });
    });
  }
  console.log(JSON.stringify(result));
}
