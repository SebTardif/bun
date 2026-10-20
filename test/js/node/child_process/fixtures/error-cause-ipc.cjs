const { fork } = require("node:child_process");
const { once } = require("node:events");
const assert = require("node:assert/strict");

function payload(kind) {
  if (kind === "object") return { answer: 42 };
  const error = new Error("outer");
  error.stack = "stable";
  if (kind === "cause") error.cause = new Error("inner");
  return error;
}

function summarize(value) {
  return { answer: value.answer, error: value instanceof Error, message: value.message, cause: value.cause?.message };
}

if (process.argv[2] === "child") {
  process.on("message", ({ kind, direction }) => {
    if (direction === "child") process.send(payload(kind));
    else process.send(summarize(kind));
  });
  process.send("ready");
} else {
  (async () => {
    const [childExecutable, kind, direction, expectedCause] = process.argv.slice(2);
    const child = fork(__filename, ["child"], {
      execPath: childExecutable,
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    try {
      assert.equal((await once(child, "message"))[0], "ready");
      const reply = once(child, "message");
      child.send(direction === "child" ? { kind, direction } : { kind: payload(kind), direction });
      const value = (await reply)[0];
      const result = direction === "child" ? summarize(value) : value;
      assert.equal(result.error, kind !== "object");
      if (kind === "object") assert.equal(result.answer, 42);
      else assert.equal(result.message, "outer");
      assert.equal(result.cause, expectedCause === "true" && kind === "cause" ? "inner" : undefined);
      console.log(JSON.stringify(result));
    } finally {
      const exit = once(child, "exit");
      child.kill();
      await exit;
    }
  })().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
