import type { SidestageConfig } from "@sidestage/config";

import {
  branchPolicy,
  canWriteToBranch,
  isDesignBranch,
  pathPolicy,
  selectStageablePaths,
} from "./rails.js";
import { err, ok, type Result } from "./result.js";
import { run } from "./system/process.js";
import { isDryRun } from "./system/runtime.js";

// Never let git open an interactive credential prompt — non-engineers can't
// answer it and it hangs the tool. Auth is set up explicitly via the host CLI.
const NO_PROMPT = { GIT_TERMINAL_PROMPT: "0" };

function gitRun(repoDir: string, args: string[], inherit = false) {
  return run("git", args, { cwd: repoDir, env: NO_PROMPT, inherit });
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const res = run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir });
  return (await res).stdout.trim() === "true";
}

export async function currentBranch(repoDir: string): Promise<string | undefined> {
  const res = await gitRun(repoDir, ["branch", "--show-current"]);
  const name = res.stdout.trim();
  return res.ok && name ? name : undefined;
}

export async function fetchAll(repoDir: string): Promise<Result<void>> {
  const res = await gitRun(repoDir, ["fetch", "origin", "--prune"]);
  return res.ok ? ok(undefined) : err(res.stderr || "Could not reach the remote.");
}

// Convert an SSH clone URL to HTTPS so the host CLI's HTTPS auth works.
export function httpsRemote(url: string): string {
  const match = url.match(/^git@([^:]+):(.+)$/);
  return match ? `https://${match[1]}/${match[2]}` : url;
}

export async function clone(url: string, dir: string): Promise<Result<void>> {
  const res = await run("git", ["clone", httpsRemote(url), dir], { inherit: true, env: NO_PROMPT });
  return res.ok ? ok(undefined) : err(`Clone failed (exit ${res.exitCode}).`);
}

export async function ensureHttpsRemote(repoDir: string): Promise<void> {
  const res = await gitRun(repoDir, ["remote", "get-url", "origin"]);
  if (!res.ok) return;
  const url = res.stdout.trim();
  const https = httpsRemote(url);
  if (https !== url) await gitRun(repoDir, ["remote", "set-url", "origin", https]);
}

// --- Branch discovery ------------------------------------------------------

export interface DesignBranch {
  name: string;
  friendly: string;
  lastCommitUnix: number;
}

export interface ListBranchesOptions {
  maxAgeDays?: number;
  // Branch names to hide (e.g. those whose PRs are merged/closed).
  hide?: ReadonlySet<string>;
}

export function friendlyName(branch: string, config: SidestageConfig): string {
  return branch.startsWith(config.branchPrefix) ? branch.slice(config.branchPrefix.length) : branch;
}

export async function listDesignBranches(
  repoDir: string,
  config: SidestageConfig,
  opts: ListBranchesOptions = {},
): Promise<DesignBranch[]> {
  const policy = branchPolicy(config);
  const maxAgeDays = opts.maxAgeDays ?? 60;
  const cutoffUnix = Date.now() / 1000 - maxAgeDays * 86_400;

  const res = await gitRun(repoDir, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(committerdate:unix)%09%(refname)",
    `refs/heads/${config.branchPrefix}*`,
    `refs/remotes/origin/${config.branchPrefix}*`,
  ]);
  if (!res.ok) return [];

  const seen = new Set<string>();
  const branches: DesignBranch[] = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line) continue;
    const [epochStr, refname] = line.split("\t");
    if (!refname) continue;
    const short = refname.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/origin\//, "");
    if (seen.has(short)) continue;
    seen.add(short);
    if (opts.hide?.has(short)) continue;
    if (!isDesignBranch(short, policy)) continue;
    const epoch = Number(epochStr);
    if (Number.isFinite(epoch) && epoch < cutoffUnix) continue;
    branches.push({ name: short, friendly: friendlyName(short, config), lastCommitUnix: epoch });
  }
  return branches;
}

// What the base of a design branch was, recorded when it was created.
export async function storedBase(repoDir: string, branch: string): Promise<string | undefined> {
  const res = await gitRun(repoDir, ["config", "--get", `branch.${branch}.sidestageBase`]);
  const value = res.stdout.trim();
  return res.ok && value ? value : undefined;
}

// --- Working with branches -------------------------------------------------

// Start fresh work: clean the tree, reset to the latest base, create a new
// design branch off it. Local only — the remote branch is created on first
// save (`syncBranch`), so this never force-pushes or deletes remote refs.
export async function startWork(
  repoDir: string,
  config: SidestageConfig,
  branch: string,
  base: string,
): Promise<Result<void>> {
  const verdict = canWriteToBranch(branch, branchPolicy(config));
  if (!verdict.allowed) return err(verdict.reason);

  await gitRun(repoDir, ["checkout", "--", "."]);
  await gitRun(repoDir, ["clean", "-fd"]);
  await gitRun(repoDir, ["fetch", "origin", base]);
  await gitRun(repoDir, ["checkout", base]);
  await gitRun(repoDir, ["reset", "--hard", `origin/${base}`]);
  await gitRun(repoDir, ["branch", "-D", branch]); // ok if it doesn't exist

  const created = await gitRun(repoDir, ["checkout", "-b", branch]);
  if (!created.ok) return err(created.stderr || `Could not create branch ${branch}.`);

  await gitRun(repoDir, ["config", `branch.${branch}.sidestageBase`, base]);
  return ok(undefined);
}

// Resume an existing design branch and gently fold in the latest base.
export async function continueWork(
  repoDir: string,
  config: SidestageConfig,
  branch: string,
): Promise<Result<void>> {
  const verdict = canWriteToBranch(branch, branchPolicy(config));
  if (!verdict.allowed) return err(verdict.reason);

  const checkout = await gitRun(repoDir, ["checkout", branch]);
  if (!checkout.ok) return err(checkout.stderr || `Could not switch to ${branch}.`);

  await gitRun(repoDir, ["pull", "origin", branch, "--rebase"]);
  await mergeBaseBranch(repoDir, config);
  return ok(undefined);
}

// Fold the latest base branch into the current branch, keeping the designer's
// edits on conflict (-X ours). Real conflicts are an engineer's job at PR time.
export async function mergeBaseBranch(
  repoDir: string,
  config: SidestageConfig,
): Promise<Result<void>> {
  const base = config.baseBranch;
  await gitRun(repoDir, ["fetch", "origin", base]);
  const merge = await gitRun(repoDir, ["merge", `origin/${base}`, "--no-edit", "-X", "ours"]);
  if (!merge.ok) {
    await gitRun(repoDir, ["merge", "--abort"]);
    return err(`Could not auto-merge the latest ${base}.`);
  }
  return ok(undefined);
}

// --- Saving ----------------------------------------------------------------

export async function listChangedPaths(repoDir: string): Promise<string[]> {
  // --untracked-files=all lists files inside brand-new directories individually
  // instead of collapsing them to "dir/". Without it, a secret in a new
  // untracked subdir under a tracked path would be staged wholesale, slipping
  // past the per-file secret rail.
  const res = await gitRun(repoDir, ["status", "--porcelain", "--untracked-files=all"]);
  if (!res.ok) return [];
  const paths: string[] = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const raw = line.slice(3);
    const arrow = raw.indexOf(" -> ");
    const path = arrow >= 0 ? raw.slice(arrow + 4) : raw;
    paths.push(unquote(path.trim()));
  }
  return paths;
}

function unquote(path: string): string {
  if (path.startsWith('"') && path.endsWith('"')) {
    return path.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return path;
}

export interface SaveResult {
  committed: boolean;
  pushed: boolean;
  savedPaths: string[];
  message: string;
}

// Commit and push the tracked, non-secret subset of changes. Rails-guarded:
// refuses on a protected/non-design branch, never stages a secret.
export async function save(
  repoDir: string,
  config: SidestageConfig,
  commitMessage: string,
): Promise<Result<SaveResult>> {
  const branch = await currentBranch(repoDir);
  const verdict = canWriteToBranch(branch, branchPolicy(config));
  if (!verdict.allowed) return err(verdict.reason);

  const changed = await listChangedPaths(repoDir);
  const stageable = selectStageablePaths(changed, pathPolicy(config));
  if (stageable.length === 0) {
    return ok({ committed: false, pushed: false, savedPaths: [], message: "Nothing new to save." });
  }

  const added = await gitRun(repoDir, ["add", "--", ...stageable]);
  if (!added.ok) return err(added.stderr || "Could not stage changes.");

  const committed = await gitRun(repoDir, ["commit", "-m", commitMessage]);
  if (!committed.ok) return err(committed.stderr || "Could not commit changes.");

  const pushed = await syncBranch(repoDir, config);
  return ok({
    committed: true,
    pushed: pushed.ok,
    savedPaths: stageable,
    message: pushed.ok
      ? "Saved and synced to the cloud."
      : "Saved on this computer, but couldn't reach the cloud yet.",
  });
}

// Push the current branch, creating it on the remote if needed. Rails-guarded.
export async function syncBranch(repoDir: string, config: SidestageConfig): Promise<Result<void>> {
  const branch = await currentBranch(repoDir);
  const verdict = canWriteToBranch(branch, branchPolicy(config));
  if (!verdict.allowed) return err(verdict.reason);

  if (isDryRun()) return ok(undefined);

  const res = await gitRun(repoDir, ["push", "-u", "origin", branch as string]);
  return res.ok ? ok(undefined) : err(res.stderr || "Could not push to the remote.");
}
