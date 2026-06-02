import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sidestageConfigSchema } from "@sidestage/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { currentBranch, listChangedPaths, save, startWork } from "./git.js";
import { run } from "./system/process.js";

// End-to-end against real git in a throwaway repo with a real (bare) origin.
// No network, no real remote — the destructive paths are sandboxed and push is
// short-circuited by SIDESTAGE_DRY_RUN. This is the "it drove a real repo"
// check the rails exist to pass.

const config = sidestageConfigSchema.parse({
  repo: { url: "https://example.com/sandbox.git", host: "github" },
  baseBranch: "main",
  branchPrefix: "design/",
  packageManager: "pnpm",
  devServers: [{ id: "app", label: "App", command: "true", port: 4321 }],
  tracked: { include: ["app/"] },
});

let remoteDir: string;
let workDir: string;
const priorDryRun = process.env.SIDESTAGE_DRY_RUN;

async function git(cwd: string, ...args: string[]): Promise<void> {
  const res = await run("git", args, {
    cwd,
    env: {
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (!res.ok) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

beforeAll(async () => {
  process.env.SIDESTAGE_DRY_RUN = "1";
  remoteDir = mkdtempSync(join(tmpdir(), "gr-remote-"));
  workDir = mkdtempSync(join(tmpdir(), "gr-work-"));

  await git(remoteDir, "init", "--bare");
  await git(workDir, "init", "-b", "main");
  await git(workDir, "config", "user.email", "t@t");
  await git(workDir, "config", "user.name", "T");
  writeFileSync(join(workDir, "README.md"), "# sandbox\n");
  await git(workDir, "add", "-A");
  await git(workDir, "commit", "-m", "init");
  await git(workDir, "remote", "add", "origin", remoteDir);
  await git(workDir, "push", "-u", "origin", "main");
});

afterAll(() => {
  if (priorDryRun === undefined) delete process.env.SIDESTAGE_DRY_RUN;
  else process.env.SIDESTAGE_DRY_RUN = priorDryRun;
  for (const dir of [remoteDir, workDir]) {
    if (!dir) continue;
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // teardown of a temp dir racing git's background fs writes — harmless
    }
  }
});

describe("git module against a real repo", () => {
  it("creates a design branch off the base", async () => {
    const result = await startWork(workDir, config, "design/test", "main");
    expect(result.ok).toBe(true);
    expect(await currentBranch(workDir)).toBe("design/test");
  });

  it("commits tracked changes but never a secret", async () => {
    mkdirSync(join(workDir, "app"), { recursive: true });
    writeFileSync(join(workDir, "app", "page.txt"), "hello");
    writeFileSync(join(workDir, ".env"), "SECRET=should-never-be-committed");
    writeFileSync(join(workDir, "untracked-root.txt"), "ignored by whitelist");

    const result = await save(workDir, config, "design update");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.committed).toBe(true);
    expect(result.value.savedPaths).toContain("app/page.txt");
    expect(result.value.savedPaths).not.toContain(".env");

    const tracked = await run("git", ["ls-files"], { cwd: workDir });
    expect(tracked.stdout).toContain("app/page.txt");
    expect(tracked.stdout).not.toContain(".env");

    // The secret and the non-whitelisted file remain on disk, just uncommitted.
    expect(existsSync(join(workDir, ".env"))).toBe(true);
    const stillChanged = await listChangedPaths(workDir);
    expect(stillChanged).toContain(".env");
    expect(stillChanged).toContain("untracked-root.txt");
  });

  it("refuses to save on the protected base branch", async () => {
    await git(workDir, "checkout", "main");
    writeFileSync(join(workDir, "app-should-not-commit.txt"), "x");
    const result = await save(workDir, config, "should fail");
    expect(result.ok).toBe(false);
  });
});
