import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sidestageConfigSchema } from "@sidestage/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveClonedConfig } from "./onboarding.js";

// The bootstrap config is what a launcher embeds: enough to clone + install.
const bootstrap = sidestageConfigSchema.parse({
  repo: { url: "https://github.com/acme/app.git", host: "github" },
  baseBranch: "main",
  packageManager: "pnpm",
  devServers: [{ id: "app", label: "App", command: "true", port: 3000 }],
  tracked: { include: ["app/"] },
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ss-onboard-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveClonedConfig", () => {
  it("prefers the repo's committed config over the bootstrap snapshot", async () => {
    // Simulate a freshly-cloned repo whose committed config differs from the
    // launcher snapshot (extra dev server, more tracked dirs, different base).
    writeFileSync(
      join(dir, "sidestage.config.json"),
      JSON.stringify({
        repo: { url: "https://github.com/acme/app.git", host: "github" },
        baseBranch: "stage",
        packageManager: "pnpm",
        devServers: [
          { id: "app", label: "App", command: "pnpm dev", port: 3000 },
          { id: "email", label: "Emails", command: "pnpm email:dev", port: 3001 },
        ],
        tracked: { include: ["app/", "lib/email/", "proxy.ts"] },
        actions: [{ id: "public", label: "Make public", run: "scripts/x.ts" }],
      }),
    );

    const resolved = await resolveClonedConfig(dir, bootstrap);

    expect(resolved).not.toBe(bootstrap);
    expect(resolved.baseBranch).toBe("stage");
    expect(resolved.devServers).toHaveLength(2);
    expect(resolved.tracked.include).toContain("lib/email/");
    expect(resolved.actions.map((a) => a.id)).toContain("public");
  });

  it("falls back to the bootstrap config when the clone has no committed config", async () => {
    const resolved = await resolveClonedConfig(dir, bootstrap);
    expect(resolved).toBe(bootstrap);
    expect(resolved.baseBranch).toBe("main");
  });
});
