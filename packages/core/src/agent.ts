import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { SidestageConfig } from "@sidestage/config";

import { err, ok, type Result } from "./result.js";
import { run, which } from "./system/process.js";

// Belt-and-suspenders guardrails handed to the editing agent. Sidestage's own
// save rails are the real guarantee (only tracked, non-secret paths reach a
// design branch); these just stop the agent from racing Sidestage on git/state.
const GUARDRAILS = {
  permissions: {
    deny: ["Bash(git push:*)", "Bash(git reset:*)", "Bash(git rebase:*)", "Bash(rm -rf:*)"],
  },
};

// Write a local, non-destructive guardrail file. Only writes if absent so a
// team's own .claude/settings.local.json is never clobbered.
export function prepareAgentWorkspace(repoDir: string): void {
  try {
    const dir = join(repoDir, ".claude");
    mkdirSync(dir, { recursive: true });
    const settingsPath = join(dir, "settings.local.json");
    if (!existsSync(settingsPath)) {
      writeFileSync(settingsPath, `${JSON.stringify(GUARDRAILS, null, 2)}\n`);
    }
  } catch {
    // non-fatal — the save rails remain authoritative
  }
}

export async function isAgentAvailable(config: SidestageConfig): Promise<boolean> {
  if (!config.agent.enabled) return false;
  return (await which(config.agent.command)) !== undefined;
}

// Hand the terminal fully to the editing agent and return when the designer
// exits it. A non-zero exit (Ctrl-C is how you leave Claude Code) is a normal
// way to finish — only a failure to launch is an error.
export async function launchAgent(repoDir: string, config: SidestageConfig): Promise<Result<void>> {
  if (!config.agent.enabled) {
    return err("The editing assistant is turned off for this project.");
  }
  if (!(await which(config.agent.command))) {
    return err(`"${config.agent.command}" isn't installed on this computer.`);
  }
  prepareAgentWorkspace(repoDir);
  const res = await run(config.agent.command, config.agent.args, { cwd: repoDir, inherit: true });
  if (res.exitCode === 127) return err(`Could not launch "${config.agent.command}".`);
  return ok(undefined);
}
