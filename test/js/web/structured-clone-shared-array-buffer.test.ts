import { deserialize as jscDeserialize, serialize as jscSerialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { deserialize as v8Deserialize, serialize as v8Serialize } from "node:v8";

// structuredClone stays inside the agent cluster, so SharedArrayBuffers share
// their backing store like node and the HTML spec's StructuredSerialize.
describe("structuredClone(SharedArrayBuffer)", () => {
  test("clone is a SharedArrayBuffer sharing memory", () => {
    const sab = new SharedArrayBuffer(8);
    const clone = structuredClone(sab);
    expect(clone).toBeInstanceOf(SharedArrayBuffer);
    expect(clone.byteLength).toBe(8);
    new Uint8Array(sab)[0] = 42;
    expect(new Uint8Array(clone)[0]).toBe(42);
    new Uint8Array(clone)[1] = 7;
    expect(new Uint8Array(sab)[1]).toBe(7);
  });

  test("SAB nested in an object shares through the clone", () => {
    const sab = new SharedArrayBuffer(4);
    const out = structuredClone({ deep: [sab] });
    expect(out.deep[0]).toBeInstanceOf(SharedArrayBuffer);
    new Uint8Array(sab)[0] = 9;
    expect(new Uint8Array(out.deep[0])[0]).toBe(9);
  });

  test("worker postMessage shares the SAB", async () => {
    const sab = new SharedArrayBuffer(4);
    const worker = new Worker(
      URL.createObjectURL(
        new Blob(
          [
            `self.onmessage = ({ data }) => {
               new Uint8Array(data)[0] = 42;
               postMessage("done");
             };`,
          ],
          { type: "application/javascript" },
        ),
      ),
    );
    try {
      const { promise, resolve, reject } = Promise.withResolvers();
      worker.onmessage = resolve;
      worker.onerror = reject;
      worker.postMessage(sab);
      await promise;
      expect(new Uint8Array(sab)[0]).toBe(42);
    } finally {
      worker.terminate();
    }
  });
});

describe("Error.cause SharedArrayBuffer graph", () => {
  test("an ArrayBuffer cause transfers once and retains view aliases", () => {
    const buffer = new ArrayBuffer(4);
    const view = new Uint8Array(buffer);
    view[0] = 42;
    const result = structuredClone(new Error("transfer", { cause: { buffer, view } }), { transfer: [buffer] });
    expect(buffer.byteLength).toBe(0);
    expect(result.cause.buffer).toBeInstanceOf(ArrayBuffer);
    expect(result.cause.view.buffer).toBe(result.cause.buffer);
    expect([...result.cause.view]).toEqual([42, 0, 0, 0]);
  });

  test("a failing cause leaves transferred buffers attached", () => {
    const buffer = new ArrayBuffer(4);
    new Uint8Array(buffer)[0] = 42;
    const source = new Error("invalid", { cause: { buffer, invalid: () => {} } });
    expect(() => structuredClone(source, { transfer: [buffer] })).toThrow(
      expect.objectContaining({ name: "DataCloneError" }),
    );
    expect(buffer.byteLength).toBe(4);
    expect([...new Uint8Array(buffer)]).toEqual([42, 0, 0, 0]);
  });

  for (const [name, serialize, deserialize] of [
    ["bun:jsc", jscSerialize, jscDeserialize],
    ["node:v8", v8Serialize, v8Deserialize],
  ] as const) {
    test("storage serialization copies shared causes into private buffers: " + name, () => {
      const buffer = new SharedArrayBuffer(4);
      const view = new Uint8Array(buffer);
      view[0] = 42;
      const result = deserialize(serialize(new Error("storage", { cause: { buffer, view } })));
      expect(result.cause.buffer).toBeInstanceOf(ArrayBuffer);
      expect(result.cause.buffer).not.toBeInstanceOf(SharedArrayBuffer);
      expect(result.cause.view.buffer).toBe(result.cause.buffer);
      expect([...result.cause.view]).toEqual([42, 0, 0, 0]);
      view[0] = 7;
      expect(result.cause.view[0]).toBe(42);
      result.cause.view[1] = 9;
      expect(view[1]).toBe(0);
    });
  }

  test("nested views retain aliases and shared backing memory", () => {
    const buffer = new SharedArrayBuffer(4);
    const view = new Uint8Array(buffer);
    const error = new Error("outer", { cause: new Map([["view", view]]) });
    const result = structuredClone({ error, view, buffer });
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toBe("outer");
    const cause = result.error.cause;
    expect(cause).toBeInstanceOf(Map);
    if (!(cause instanceof Map)) throw new Error("Expected cloned Map cause");
    expect(cause.get("view")).toBe(result.view);
    expect(result.view.buffer).toBe(result.buffer);
    view[0] = 42;
    expect(result.view[0]).toBe(42);
    result.view[1] = 7;
    expect(view[1]).toBe(7);
  });

  test("worker postMessage preserves cause aliases and shared memory", async () => {
    const buffer = new SharedArrayBuffer(4);
    const view = new Uint8Array(buffer);
    const url = URL.createObjectURL(
      new Blob(
        [
          "self.onmessage = ({data}) => { data.error.cause[0] = 42; postMessage({error: data.error, same: data.error.cause === data.view}); };",
        ],
        { type: "application/javascript" },
      ),
    );
    const worker = new Worker(url);
    try {
      const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();
      worker.onmessage = resolve;
      worker.onerror = reject;
      worker.postMessage({ error: new Error("worker", { cause: view }), view });
      const { data } = await promise;
      expect(data.same).toBe(true);
      expect(data.error).toBeInstanceOf(Error);
      expect(data.error.message).toBe("worker");
      expect(data.error.cause).toBeInstanceOf(Uint8Array);
      expect(data.error.cause[0]).toBe(42);
      expect(view[0]).toBe(42);
      data.error.cause[1] = 7;
      expect(view[1]).toBe(7);
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  });
});
