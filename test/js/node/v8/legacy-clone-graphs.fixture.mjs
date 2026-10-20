export function legacyGraphs() {
  const error = new TypeError("stable");
  error.stack = "stable";
  error.line = 0;
  error.column = 0;
  error.sourceURL = "";
  const a = Buffer.alloc(3, 1);
  const b = Buffer.alloc(2, 2);
  const shared = { n: 1 };
  const cycle = { shared, again: shared };
  cycle.self = cycle;
  const slots = Array.from({ length: 254 }, (_, n) => ({ n }));
  return {
    primitives: [undefined, null, false, true, 0, -1, 1.5, "hello", "é", 123n],
    object: { answer: 42, nested: ["x", { ok: true }] },
    holes: [1, , undefined, , 4],
    terminals: [new Date(42), /abc/gi, error, error],
    collections: [new Map([[shared, [1, 2]]]), new Set([shared]), cycle],
    views: [new Uint8Array([1, 2]), new Uint16Array([3, 4]), new ArrayBuffer(2)],
    buffers: { a, b, again: a },
    nestedBuffers: new Map([[a, { b, a }]]),
    getterBuffer: {
      get value() {
        return a;
      },
    },
    bufferPoolBoundary: { slots, a, again: a, first: slots[0], last: slots.at(-1) },
  };
}
