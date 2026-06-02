import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type SidestageConfig, sidestageConfigSchema } from "@sidestage/config";
import { describe, expect, it } from "vitest";

import { launchAgent, prepareAgentWorkspace } from "./agent.js";

function makeConfig(agent: Record<string, unknown>): SidestageConfig {
  return sidestageConfigSchema.parse({
    repo: { url: "https://example.com/x.git" },
    devServers: [{ id: "a", label: "A", command: "true", port: 1 }],
    tracked: { include: ["app/"] },
    agent,
  });
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "gr-agent-"));
}

describe("agent orchestration", () => {
  it("launches the configured agent and returns ok", async () => {
    const dir = tempDir();
    const result = await launchAgent(dir, makeConfig({ command: "true" }));
    expect(result.ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("errors when the agent binary is missing", async () => {
    const dir = tempDir();
    const result = await launchAgent(dir, makeConfig({ command: "sidestage-no-such-binary-xyz" }));
    expect(result.ok).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("respects agent.enabled = false", async () => {
    const dir = tempDir();
    const result = await launchAgent(dir, makeConfig({ enabled: false, command: "true" }));
    expect(result.ok).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not clobber an existing settings.local.json", () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".claude"), { recursive: true });
    const settings = join(dir, ".claude", "settings.local.json");
    writeFileSync(settings, '{"mine":true}');
    prepareAgentWorkspace(dir);
    expect(readFileSync(settings, "utf8")).toContain('"mine"');
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes guardrails when none exist", () => {
    const dir = tempDir();
    prepareAgentWorkspace(dir);
    expect(existsSync(join(dir, ".claude", "settings.local.json"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
