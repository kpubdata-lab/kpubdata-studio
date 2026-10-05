/**
 * A request no handler matches never reaches the network (#741).
 *
 * MSW's default lets it through after a warning, so a test that forgets a handler opens a
 * real connection to `localhost`. A later request to the same origin — one that has a
 * handler — was seen in CI failing with that connection without MSW ever seeing it.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("a request without a handler (#741)", () => {
  let server: Server;
  let reached: string[];
  let origin: string;

  beforeEach(async () => {
    reached = [];
    server = createServer((request, response) => {
      reached.push(request.url ?? "");
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise((resolve) => server.close(resolve));
  });

  it("fails as a network error, with the warning, and the server never hears of it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(fetch(`${origin}/no-handler`)).rejects.toThrow(TypeError);

    expect(reached).toEqual([]);
    expect(warn.mock.calls.flat().join("\n")).toContain(`GET ${origin}/no-handler`);
  });
});
