import { expect, test } from "bun:test";
import { tls as tlsCert } from "harness";

test("Bun.serve accepts a string ALPNProtocols", () => {
  const server = Bun.serve({
    port: 0,
    tls: {
      ...tlsCert,
      ALPNProtocols: "http/1.1",
    },
    fetch() {
      return new Response("ok");
    },
  });
  try {
    expect(server.port).toBeGreaterThan(0);
  } finally {
    server.stop(true);
  }
});
