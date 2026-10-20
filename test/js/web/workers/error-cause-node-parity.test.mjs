import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { deserialize, serialize } from "node:v8";
import { MessageChannel, Worker } from "node:worker_threads";

function graph() {
  const shared = { answer: 42 };
  const first = new Error("outer", { cause: shared });
  const second = new TypeError("inner", { cause: first });
  shared.second = second;
  return [first, shared, first, new Error("absent"), new Error("undefined", { cause: undefined })];
}

function check(value) {
  assert(value[0] instanceof Error);
  assert.equal(value[0].cause, value[1]);
  assert.equal(value[1].second.cause, value[0]);
  assert.equal(value[0], value[2]);
  assert.equal(Object.hasOwn(value[3], "cause"), false);
  assert.deepEqual(Object.getOwnPropertyDescriptor(value[4], "cause"), {
    value: undefined,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

for (const [name, clone] of [
  ["structuredClone", structuredClone],
  ["node:v8", value => deserialize(serialize(value))],
]) {
  test(`${name} retains cause cycles, aliases and descriptors`, () => check(clone(graph())));
  test(`${name} omits accessor causes without invoking them`, () => {
    const error = new Error("accessor");
    Object.defineProperty(error, "cause", {
      get() {
        throw new Error("must not run");
      },
    });
    assert.equal(Object.hasOwn(clone(error), "cause"), false);
  });
}

test("structuredClone preserves the four cause value kinds", () => {
  const shared = new Uint8Array(new SharedArrayBuffer(4));
  shared[0] = 42;
  for (const cause of [new Error("inner"), 42, shared, { answer: 42 }]) {
    const result = structuredClone(new Error("outer", { cause }));
    assert(Object.hasOwn(result, "cause"));
    if (cause instanceof Error) assert.equal(result.cause.message, cause.message);
    else assert.deepEqual(result.cause, cause);
  }
});

test("Worker postMessage retains cause graphs", async () => {
  const worker = new Worker(
    'require("node:worker_threads").parentPort.once("message", value => require("node:worker_threads").parentPort.postMessage(value))',
    { eval: true },
  );
  try {
    const reply = once(worker, "message");
    worker.postMessage(graph());
    check((await reply)[0]);
  } finally {
    await worker.terminate();
  }
});

test("MessagePort retains cause graphs", async () => {
  const { port1, port2 } = new MessageChannel();
  try {
    const reply = once(port2, "message");
    port1.postMessage(graph());
    check((await reply)[0]);
  } finally {
    port1.close();
    port2.close();
  }
});

test("BroadcastChannel retains cause graphs", async () => {
  const name = `error-cause-${process.pid}`;
  const sender = new BroadcastChannel(name);
  const receiver = new BroadcastChannel(name);
  try {
    const reply = once(receiver, "message");
    sender.postMessage(graph());
    check((await reply)[0].data);
  } finally {
    sender.close();
    receiver.close();
  }
});
