import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DevServer } from "@sidestage/config";
import { afterAll, describe, expect, it } from "vitest";

import { createDevServer } from "./dev-server.js";
import { isPortFree } from "./system/net.js";

const PORT = 4599;
const dir = mkdtempSync(join(tmpdir(), "gr-dev-"));

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // harmless
  }
});

describe("dev server lifecycle", () => {
  it("starts, serves, then stops and frees the port", async () => {
    if (!(await isPortFree(PORT))) return; // skip if something else holds the port

    const server: DevServer = {
      id: "test",
      label: "Test",
      command: `node -e "require('http').createServer((_req,res)=>res.end('ok')).listen(${PORT})"`,
      port: PORT,
      readyPath: "/",
    };
    const dev = createDevServer(server, dir, join(dir, "dev.log"));

    const started = await dev.start();
    expect(started.ok).toBe(true);
    expect(dev.isRunning()).toBe(true);

    const response = await fetch(`http://localhost:${PORT}/`);
    expect(response.status).toBe(200);

    await dev.stop();
    expect(dev.isRunning()).toBe(false);
    expect(await isPortFree(PORT)).toBe(true);
  }, 30_000);
});
