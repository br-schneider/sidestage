import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "./index.js";

describe("config loader", () => {
  it("loads JSON and applies nested defaults", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gr-cfg-"));
    writeFileSync(
      join(dir, "sidestage.config.json"),
      JSON.stringify({
        repo: { url: "https://github.com/x/y.git" },
        baseBranch: "stage",
        devServers: [{ id: "app", label: "App", command: "pnpm dev", port: 3000 }],
        tracked: { include: ["app/"] },
      }),
    );

    const { config } = await loadConfig(dir);
    expect(config.repo.host).toBe("github");
    expect(config.branchPrefix).toBe("design/");
    expect(config.secrets.target).toBe(".env");
    expect(config.preview.provider).toBe("vercel");
    expect(config.devServers[0]?.readyPath).toBe("/");
    expect(config.agent.command).toBe("claude");

    rmSync(dir, { recursive: true, force: true });
  });

  it("throws a helpful ConfigError on an invalid config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gr-cfg-"));
    writeFileSync(join(dir, "sidestage.config.json"), JSON.stringify({ repo: { url: "x" } }));
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigError);
    rmSync(dir, { recursive: true, force: true });
  });
});
