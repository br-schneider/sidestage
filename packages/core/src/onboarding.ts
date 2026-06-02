import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { SidestageConfig } from "@sidestage/config";

import { getGitHostAdapter } from "./adapters/index.js";
import { clone, ensureHttpsRemote, isGitRepo } from "./git.js";
import { err, ok, type Result } from "./result.js";
import { applyPastedEnv, readSecretsStatus } from "./secrets.js";
import type { Diagnostics } from "./system/diagnostics.js";
import { openUrl } from "./system/open.js";
import { defaultCloneDir } from "./system/paths.js";
import { run } from "./system/process.js";
import { installTool, isInstalled, TOOL_SPECS } from "./system/toolchain.js";
import type { UI } from "./ui.js";

export function repoNameFromUrl(url: string): string {
  const match = url.match(/([^/]+?)(?:\.git)?$/);
  return match?.[1] ?? "repo";
}

function expandHome(path: string): string {
  return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

export interface OnboardingResult {
  repoDir: string;
}

// The fresh-laptop flow. Every step is idempotent so a re-run resumes rather
// than redoing: installed tools are skipped, an existing clone is reused, and
// secrets already present are left alone.
export async function runOnboarding(
  config: SidestageConfig,
  ui: UI,
  diag: Diagnostics,
  opts: { repoDirHint?: string } = {},
): Promise<Result<OnboardingResult>> {
  // 1. Toolchain ------------------------------------------------------------
  const requiredTools = ["git", config.packageManager];
  if (config.repo.host === "github") requiredTools.push("gh");

  for (const id of requiredTools) {
    if (await isInstalled(id)) continue;
    const spec = TOOL_SPECS[id] ?? { id, label: id };
    const spinner = ui.spinner();
    spinner.start(`Installing ${spec.label}…`);
    const result = await installTool(spec);
    spinner.stop(result.message);
    diag.log(`install ${id}: ${result.ok ? "ok" : `FAILED — ${result.message}`}`);
    if (!result.ok) return err(result.message);
  }

  // 2. Git-host auth --------------------------------------------------------
  const host = getGitHostAdapter(config.repo.host, opts.repoDirHint ?? process.cwd());
  if (!(await host.isAuthenticated())) {
    ui.note("A browser window will open so you can sign in to GitHub.", "Sign in");
    const login = await host.login();
    diag.log(`auth login: ${login.ok ? "ok" : "FAILED"}`);
    if (!login.ok) return err(login.error);
  }

  // 3. Clone (or resume) ----------------------------------------------------
  const defaultDir = opts.repoDirHint ?? defaultCloneDir(repoNameFromUrl(config.repo.url));
  const chosen = await ui.text({
    message: "Where should the project live on your computer?",
    defaultValue: defaultDir,
    placeholder: defaultDir,
  });
  if (chosen === null) return err("Setup cancelled.");
  const repoDir = chosen.trim() || defaultDir;

  if (existsSync(repoDir) && (await isGitRepo(repoDir))) {
    ui.info("Project already downloaded — using the existing copy.");
  } else {
    const spinner = ui.spinner();
    spinner.start("Downloading the project… (this can take a few minutes)");
    const cloned = await clone(config.repo.url, repoDir);
    spinner.stop(cloned.ok ? "Project downloaded." : "Download failed.");
    diag.log(`clone: ${cloned.ok ? "ok" : "FAILED"}`);
    if (!cloned.ok) return err(cloned.error);
  }
  await ensureHttpsRemote(repoDir);

  // 4. Install dependencies -------------------------------------------------
  const installCommand = config.install ?? `${config.packageManager} install`;
  {
    const [bin, ...args] = installCommand.split(" ");
    const spinner = ui.spinner();
    spinner.start("Installing the project's building blocks…");
    const res = await run(bin ?? config.packageManager, args, { cwd: repoDir });
    spinner.stop(res.ok ? "Building blocks installed." : "Install hit a snag.");
    diag.log(`install deps: ${res.ok ? "ok" : "FAILED"}`);
    if (!res.ok) return err("Could not install the project's dependencies.");
  }

  // 5. Secrets (referenced, never distributed) ------------------------------
  const secrets = await ensureSecrets(config, ui, repoDir, diag);
  if (!secrets.ok) return secrets;

  return ok({ repoDir });
}

async function ensureSecrets(
  config: SidestageConfig,
  ui: UI,
  repoDir: string,
  diag: Diagnostics,
): Promise<Result<void>> {
  if (config.secrets.source === "none") return ok(undefined);

  const status = readSecretsStatus(repoDir, config);
  if (!status.manifestExists || status.required.length === 0 || status.missing.length === 0) {
    return ok(undefined);
  }

  if (config.secrets.source === "manual-link" && config.secrets.url) {
    ui.note(`Opening ${config.secrets.url}`, "Get your secrets");
    await openUrl(config.secrets.url);
  }
  ui.note(
    config.secrets.instructions ??
      `This project needs ${status.missing.length} secret value(s) to run. Ask your engineer for the "${config.secrets.target}" file.`,
    "Secrets",
  );

  let missing = status.missing;
  for (let attempt = 0; attempt < 3; attempt++) {
    const filePath = await ui.text({
      message: `Path to the "${config.secrets.target}" file your engineer sent you (drag it into the terminal):`,
      placeholder: "~/Downloads/.env",
    });
    if (filePath === null) return err("Setup cancelled.");

    const resolved = expandHome(filePath.trim().replace(/^['"]|['"]$/g, ""));
    if (!resolved || !existsSync(resolved)) {
      ui.warn("Couldn't find a file there. Try again.");
      continue;
    }

    const content = await readFile(resolved, "utf8");
    missing = applyPastedEnv(repoDir, config, content);
    diag.log(`secrets applied; ${missing.length} still missing`);
    if (missing.length === 0) {
      ui.success("All required secrets are in place.");
      return ok(undefined);
    }
    ui.warn(`Still missing: ${missing.join(", ")}.`);
    const proceed = await ui.confirm({ message: "Continue without those?", initialValue: false });
    if (proceed) return ok(undefined);
  }
  return err("Could not finish setting up secrets.");
}
