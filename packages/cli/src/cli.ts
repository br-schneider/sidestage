#!/usr/bin/env node
import { join } from "node:path";

import {
  findConfigPath,
  type SidestageConfig,
  isGitRepo,
  loadConfig,
  runOnboarding,
  system,
} from "@sidestage/core";

import { printBanner } from "./banner.js";
import { runInit } from "./init.js";
import { runSession } from "./session.js";
import { createClackUI } from "./ui-clack.js";

interface CliArgs {
  configPath?: string;
  dirHint?: string;
}

interface ResolvedContext {
  config: SidestageConfig;
  repoDir: string;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  printBanner();

  const ui = createClackUI();
  const diag = system.createDiagnostics(join(system.logsDir(), "sidestage.log"));

  if (argv[0] === "init") {
    await runInit(ui);
    return;
  }

  const args = parseArgs(argv);
  const ctx = await resolveContext(args, ui, diag);
  if (!ctx) return;

  await runSession(ctx.config, ctx.repoDir, ui, diag.path);
}

function parseArgs(argv: string[]): CliArgs {
  const configIdx = argv.indexOf("--config");
  const dirIdx = argv.indexOf("--dir");
  return {
    configPath: configIdx >= 0 ? argv[configIdx + 1] : undefined,
    dirHint: dirIdx >= 0 ? argv[dirIdx + 1] : undefined,
  };
}

async function resolveContext(
  args: CliArgs,
  ui: ReturnType<typeof createClackUI>,
  diag: ReturnType<typeof system.createDiagnostics>,
): Promise<ResolvedContext | null> {
  try {
    // Explicit config (the launcher / onboarding path) → always onboard.
    if (args.configPath) {
      const { config } = await loadConfig(args.configPath);
      const result = await runOnboarding(config, ui, diag, { repoDirHint: args.dirHint });
      if (!result.ok) {
        ui.error(result.error);
        return null;
      }
      return { config, repoDir: result.value.repoDir };
    }

    const found = findConfigPath(process.cwd());
    if (!found) {
      ui.error("No Sidestage project found here.");
      ui.note(
        "Ask your engineer for the Sidestage launcher, or run `sidestage init` inside your project.",
        "Nothing to do yet",
      );
      return null;
    }

    const { config } = await loadConfig(found);
    // Config sits in a real checkout → this is the daily-driver path.
    if (await isGitRepo(process.cwd())) {
      return { config, repoDir: process.cwd() };
    }
    // Config present but not a checkout → onboard (clone elsewhere).
    const result = await runOnboarding(config, ui, diag, { repoDirHint: args.dirHint });
    if (!result.ok) {
      ui.error(result.error);
      return null;
    }
    return { config, repoDir: result.value.repoDir };
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error));
    return null;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
