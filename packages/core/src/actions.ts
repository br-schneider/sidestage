import { existsSync } from "node:fs";
import { extname, join } from "node:path";

import type { Action } from "@sidestage/config";

import { err, ok, type Result } from "./result.js";
import { run } from "./system/process.js";

// Run an org-defined action — a repo-local script. The optional `input` (from
// the action's prompt) is passed as the script's first argument. This is the
// escape hatch for org-specific operations (e.g. opting a page into a public
// allowlist) that don't belong in Sidestage's core.
export async function runAction(
  action: Action,
  repoDir: string,
  input?: string,
): Promise<Result<string>> {
  const scriptPath = join(repoDir, action.run);
  if (!existsSync(scriptPath)) {
    return err(`This action's script is missing: ${action.run}`);
  }

  const isTypeScript = extname(action.run) === ".ts";
  const command = isTypeScript ? "npx" : "node";
  const base = isTypeScript ? ["tsx", scriptPath] : [scriptPath];
  const args = input ? [...base, input] : base;

  const res = await run(command, args, { cwd: repoDir });
  if (!res.ok) return err(res.stderr || res.stdout || "The action didn't complete.");
  return ok(res.stdout.trim());
}
