import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { DevServer, SidestageConfig } from "@sidestage/config";
import {
  type Action,
  branchPolicy,
  canWriteToBranch,
  continueWork,
  createDevServer,
  type DevServerHandle,
  fetchAll,
  friendlyName,
  getGitHostAdapter,
  type GitHostAdapter,
  launchAgent,
  listChangedPaths,
  listDesignBranches,
  mergeBaseBranch,
  previewCheckPattern,
  runAction,
  save,
  type SelectOption,
  startWork,
  storedBase,
  currentBranch,
  syncBranch,
  system,
  type UI,
} from "@sidestage/core";

type MenuCommand =
  | "edit"
  | "save"
  | "preview"
  | "restart"
  | "update"
  | "log"
  | "status"
  | "quit"
  | `action:${string}`;

interface SessionContext {
  config: SidestageConfig;
  repoDir: string;
  ui: UI;
  dev: DevServerHandle;
  host: GitHostAdapter;
  friendly: string;
  diagPath: string;
}

export async function runSession(
  config: SidestageConfig,
  repoDir: string,
  ui: UI,
  diagPath: string,
): Promise<void> {
  const host = getGitHostAdapter(config.repo.host, repoDir);

  const server = await pickDevServer(config, ui);
  if (!server) return;

  const friendly = await pickWork(config, repoDir, ui, host);
  if (friendly === null) return;

  const dev = createDevServer(server, repoDir, join(system.logsDir(), `dev-${server.id}.log`));

  const spinner = ui.spinner();
  spinner.start(`Starting the ${server.label} preview…`);
  const started = await dev.start();
  spinner.stop(started.ok ? "Preview is running." : "Preview didn't start.");
  if (started.ok) {
    await system.openUrl(dev.url);
  } else {
    ui.error(started.error);
    ui.info("You can still work — use 'Restart the preview' once things settle.");
  }

  ui.note(
    `Working on “${friendly}”.\nLive preview: ${dev.url}\nYour changes stay on a separate branch until an engineer ships them.`,
    "Ready",
  );

  const ctx: SessionContext = { config, repoDir, ui, dev, host, friendly, diagPath };

  try {
    let quit = false;
    while (!quit) {
      // Recover a dead or cache-corrupted preview before each prompt.
      if (!dev.isRunning() || dev.hasCorruptionSignal()) {
        ui.warn("The preview needs a restart — doing that now.");
        await dev.restart();
      }

      const choice = await ui.select<MenuCommand>({
        message: "What would you like to do?",
        options: buildMenu(config),
      });
      if (choice === null || choice === "quit") {
        quit = true;
        continue;
      }
      await handleCommand(choice, ctx);
    }
  } finally {
    await finish(ctx);
  }
}

function buildMenu(config: SidestageConfig): SelectOption<MenuCommand>[] {
  const options: SelectOption<MenuCommand>[] = [];
  if (config.agent.enabled) {
    options.push({
      value: "edit",
      label: "Edit with AI",
      hint: "describe a change in plain words",
    });
  }
  options.push({ value: "save", label: "Save my changes" });
  if (config.preview.provider !== "none") {
    options.push({ value: "preview", label: "Get a shareable preview link" });
  }
  for (const action of config.actions) {
    options.push({ value: `action:${action.id}`, label: action.label, hint: action.description });
  }
  options.push({ value: "restart", label: "Restart the preview" });
  options.push({ value: "update", label: "Update with the latest changes" });
  options.push({ value: "log", label: "Share a problem report" });
  options.push({ value: "status", label: "Show status" });
  options.push({ value: "quit", label: "Quit (saves first)" });
  return options;
}

async function handleCommand(choice: MenuCommand, ctx: SessionContext): Promise<void> {
  const { config, repoDir, ui } = ctx;

  if (choice.startsWith("action:")) {
    const action = config.actions.find(
      (candidate) => candidate.id === choice.slice("action:".length),
    );
    if (action) await doAction(action, ctx);
    return;
  }

  switch (choice) {
    case "edit": {
      ui.info("Handing you to the AI editor. Describe your change; press Ctrl-C when you're done.");
      const launched = await launchAgent(repoDir, config);
      if (!launched.ok) {
        ui.error(launched.error);
        return;
      }
      await doSave(ctx, { quiet: true });
      return;
    }
    case "save":
      await doSave(ctx, { quiet: false });
      return;
    case "preview":
      await doPreview(ctx);
      return;
    case "restart": {
      const spinner = ui.spinner();
      spinner.start("Restarting the preview…");
      const restarted = await ctx.dev.restart();
      spinner.stop(restarted.ok ? "Preview restarted." : "Couldn't restart the preview.");
      return;
    }
    case "update":
      await doUpdate(ctx);
      return;
    case "log":
      await doShareLog(ctx);
      return;
    case "status":
      await doStatus(ctx);
      return;
    case "quit":
      return;
  }
}

async function doSave(ctx: SessionContext, opts: { quiet: boolean }): Promise<void> {
  const result = await save(ctx.repoDir, ctx.config, commitMessage());
  if (!result.ok) {
    ctx.ui.error(result.error);
    return;
  }
  if (result.value.committed) {
    ctx.ui.success(result.value.message);
  } else if (!opts.quiet) {
    ctx.ui.info("Nothing new to save.");
  }
}

async function doPreview(ctx: SessionContext): Promise<void> {
  const { config, repoDir, ui, host, friendly } = ctx;

  await doSave(ctx, { quiet: true });
  const synced = await syncBranch(repoDir, config);
  if (!synced.ok) {
    ui.error("Couldn't sync to the cloud, so a preview link can't be made yet.");
    ui.info("Try 'Share a problem report' to send the details to your engineer.");
    return;
  }

  const branch = await currentBranch(repoDir);
  if (!branch) return;
  const base = (await storedBase(repoDir, branch)) ?? config.baseBranch;

  const spinner = ui.spinner();
  spinner.start("Creating a pull request…");
  const pr = await host.createPullRequest({
    base,
    head: branch,
    title: `Design: ${friendly}`,
    body: `Design changes for **${friendly}**.\n\n_Created with Sidestage._`,
  });
  spinner.stop(pr.ok ? "Pull request ready." : "Couldn't create the pull request.");
  if (!pr.ok) {
    ui.error(pr.error);
    return;
  }

  const preview = await host.findPreviewUrl(branch, previewCheckPattern(config.preview.provider));
  if (preview) {
    ui.note(preview, "Preview link — share this");
    await system.openUrl(preview);
  } else {
    ui.info(
      "The preview link isn't ready yet (it takes a couple of minutes). Opening the pull request.",
    );
    await system.openUrl(pr.value.url);
  }
}

async function doUpdate(ctx: SessionContext): Promise<void> {
  const { config, repoDir, ui, dev } = ctx;
  await doSave(ctx, { quiet: true });

  const spinner = ui.spinner();
  spinner.start(`Pulling the latest from ${config.baseBranch}…`);
  const merged = await mergeBaseBranch(repoDir, config);
  spinner.stop(merged.ok ? "Up to date." : "Couldn't update cleanly.");
  if (!merged.ok) {
    ui.error(`${merged.error} Ask an engineer to help merge.`);
    return;
  }
  await syncBranch(repoDir, config);
  await dev.restart();
}

async function doAction(action: Action, ctx: SessionContext): Promise<void> {
  const { repoDir, ui } = ctx;
  let input: string | undefined;
  if (action.prompt) {
    const answer = await ui.text({ message: action.prompt });
    if (answer === null) return;
    input = answer.trim();
  }

  const spinner = ui.spinner();
  spinner.start(`${action.label}…`);
  const result = await runAction(action, repoDir, input);
  spinner.stop(result.ok ? result.value || "Done." : "That didn't work.");
  if (!result.ok) {
    ui.error(result.error);
    return;
  }
  if (action.saveAfter) await doSave(ctx, { quiet: true });
}

async function doShareLog(ctx: SessionContext): Promise<void> {
  const { dev, host, ui, diagPath } = ctx;
  const reportPath = join(system.logsDir(), "sidestage-report.log");
  writeFileSync(
    reportPath,
    [
      "=== Sidestage diagnostics ===",
      readFileSafe(diagPath),
      "",
      "=== Preview log ===",
      readFileSafe(dev.logPath),
      "",
    ].join("\n"),
  );

  const spinner = ui.spinner();
  spinner.start("Uploading a problem report…");
  const url = await host.shareLog(reportPath, `Sidestage report (${new Date().toISOString()})`);
  spinner.stop(url ? "Report uploaded." : "Couldn't upload — opening the file instead.");
  if (url) {
    ui.note(url, "Paste this link to your engineer");
  } else {
    await system.openPath(reportPath);
    ui.info(`Send this file to your engineer: ${reportPath}`);
  }
}

async function doStatus(ctx: SessionContext): Promise<void> {
  const { repoDir, ui, dev, friendly } = ctx;
  const branch = (await currentBranch(repoDir)) ?? "(unknown)";
  const running = dev.isRunning() ? "running" : "stopped";
  ui.note(
    [
      `Working on: ${friendly}`,
      `Branch:     ${branch}`,
      `Preview:    ${running} (${dev.url})`,
    ].join("\n"),
    "Status",
  );
}

async function pickDevServer(config: SidestageConfig, ui: UI): Promise<DevServer | null> {
  if (config.devServers.length === 1) return config.devServers[0] ?? null;
  return ui.select<DevServer>({
    message: "What are you working on today?",
    options: config.devServers.map((server) => ({ value: server, label: server.label })),
  });
}

interface WorkChoice {
  kind: "continue" | "new-on-base" | "new-on-pr";
  branch?: string;
  base?: string;
}

// Returns the friendly name of the chosen work, or null if cancelled.
async function pickWork(
  config: SidestageConfig,
  repoDir: string,
  ui: UI,
  host: GitHostAdapter,
): Promise<string | null> {
  const spinner = ui.spinner();
  spinner.start("Loading your work…");
  await fetchAll(repoDir);
  const closed = new Set(await host.listClosedDesignBranches(config.branchPrefix));
  const branches = await listDesignBranches(repoDir, config, { hide: closed });
  const openPrs = await host.listOpenPullRequests();
  spinner.stop("");

  const options: SelectOption<WorkChoice>[] = [];
  for (const branch of branches) {
    options.push({ value: { kind: "continue", branch: branch.name }, label: branch.friendly });
  }
  options.push({ value: { kind: "new-on-base" }, label: "✦ Start something new" });
  for (const pr of openPrs) {
    if (pr.headRef.startsWith(config.branchPrefix)) continue;
    options.push({
      value: { kind: "new-on-pr", base: pr.headRef },
      label: `Build on PR #${pr.number}: ${truncate(pr.title)}`,
    });
  }

  const choice = await ui.select<WorkChoice>({
    message: "What would you like to work on?",
    options,
  });
  if (choice === null) return null;

  if (choice.kind === "continue" && choice.branch) {
    const mode = await ui.select<"continue" | "fresh">({
      message: friendlyName(choice.branch, config),
      options: [
        { value: "continue", label: "Continue where you left off" },
        { value: "fresh", label: "Start fresh (discard previous changes)" },
      ],
    });
    if (mode === null) return null;
    if (mode === "continue") {
      const result = await continueWork(repoDir, config, choice.branch);
      if (!result.ok) {
        ui.error(result.error);
        return null;
      }
      return friendlyName(choice.branch, config);
    }
    // "Start fresh" resets the branch — preserve any uncommitted work first.
    if (!(await preserveBeforeReset(repoDir, config, ui))) return null;
    const base = (await storedBase(repoDir, choice.branch)) ?? config.baseBranch;
    const fresh = await startWork(repoDir, config, choice.branch, base);
    if (!fresh.ok) {
      ui.error(fresh.error);
      return null;
    }
    return friendlyName(choice.branch, config);
  }

  const name = await ui.text({ message: "Give it a short name (e.g. homepage, pricing):" });
  if (name === null) return null;
  const branch = config.branchPrefix + slugify(name);
  const base = choice.kind === "new-on-pr" && choice.base ? choice.base : config.baseBranch;
  // Starting new also resets the working tree — don't lose unsaved work.
  if (!(await preserveBeforeReset(repoDir, config, ui))) return null;
  const result = await startWork(repoDir, config, branch, base);
  if (!result.ok) {
    ui.error(result.error);
    return null;
  }
  return friendlyName(branch, config);
}

// Before a reset-based "start fresh"/"start new", don't silently discard a
// designer's uncommitted work: save it if we're on a writable design branch,
// otherwise ask before throwing it away.
async function preserveBeforeReset(
  repoDir: string,
  config: SidestageConfig,
  ui: UI,
): Promise<boolean> {
  const changed = await listChangedPaths(repoDir);
  if (changed.length === 0) return true;

  const branch = await currentBranch(repoDir);
  if (branch && canWriteToBranch(branch, branchPolicy(config)).allowed) {
    await save(repoDir, config, commitMessage());
    return true;
  }
  return ui.confirm({
    message: "You have unsaved changes that will be lost. Continue?",
    initialValue: false,
  });
}

async function finish(ctx: SessionContext): Promise<void> {
  ctx.ui.spinner().start("Saving and shutting down…");
  await doSave(ctx, { quiet: true });
  await ctx.dev.stop();
  ctx.ui.outro(`All set. Your “${ctx.friendly}” work is saved.`);
}

function commitMessage(): string {
  return `Design update ${new Date().toLocaleString()}`;
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "work"
  );
}

function truncate(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "(none)";
  }
}
