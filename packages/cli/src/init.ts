import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  findConfigPath,
  httpsRemote,
  launcherFor,
  type PackageManager,
  repoNameFromUrl,
  system,
  type UI,
  writeLauncher,
} from "@sidestage/core";

interface DetectedDefaults {
  repoUrl: string;
  repoName: string;
  baseBranch: string;
  packageManager: PackageManager;
  configObject: Record<string, unknown>;
}

// Scaffold a config in the current repo and (optionally) a double-click
// launcher to hand to designers.
export async function runInit(ui: UI): Promise<void> {
  const cwd = process.cwd();
  if (!existsSync(join(cwd, ".git"))) {
    ui.warn("Run `sidestage init` from the root of your project's git repository.");
    return;
  }

  const detected = await detectDefaults(cwd);

  const existing = findConfigPath(cwd);
  if (existing) {
    ui.info(`Using the existing config at ${existing}.`);
  } else {
    const configPath = join(cwd, "sidestage.config.ts");
    writeFileSync(configPath, configTemplate(detected));
    ui.success(`Created ${configPath}`);
    ui.note(
      "Edit it to list the folders designers may touch and your dev command(s), then commit it.",
      "Next step",
    );
  }

  const makeLauncher = await ui.confirm({
    message: "Create a double-click launcher to hand to designers?",
    initialValue: true,
  });
  if (!makeLauncher) return;

  const platform = system.platform();
  const target = platform === "unknown" ? "linux" : platform;
  const { filename, script } = launcherFor(target, {
    appName: `Sidestage — ${detected.repoName}`,
    configJson: JSON.stringify(detected.configObject, null, 2),
  });
  const launcherPath = join(cwd, filename);
  writeLauncher(launcherPath, script);
  ui.success(`Created ${launcherPath}`);
  ui.note(
    "Hand this file to a designer. Double-clicking installs everything, clones the project, and opens Sidestage — no terminal needed.",
    "Launcher",
  );
}

async function detectDefaults(cwd: string): Promise<DetectedDefaults> {
  const remote = (await system.run("git", ["remote", "get-url", "origin"], { cwd })).stdout.trim();
  const repoUrl = remote ? httpsRemote(remote) : "https://github.com/ORG/REPO.git";
  const baseBranch =
    (await system.run("git", ["branch", "--show-current"], { cwd })).stdout.trim() || "main";
  const packageManager = detectPackageManager(cwd);
  const repoName = repoNameFromUrl(repoUrl);

  const configObject: Record<string, unknown> = {
    repo: { url: repoUrl, host: "github" },
    baseBranch,
    branchPrefix: "design/",
    packageManager,
    install: `${packageManager} install`,
    devServers: [{ id: "app", label: "App", command: `${packageManager} run dev`, port: 3000 }],
    tracked: { include: ["app/", "components/", "public/"] },
    secrets: { source: "dotenv-paste", manifest: ".env.example", target: ".env" },
    preview: { provider: "vercel" },
  };

  return { repoUrl, repoName, baseBranch, packageManager, configObject };
}

function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}

function configTemplate(d: DetectedDefaults): string {
  return `import { defineConfig } from "sidestage";

export default defineConfig({
  repo: { url: "${d.repoUrl}", host: "github" },

  baseBranch: "${d.baseBranch}",
  branchPrefix: "design/",

  packageManager: "${d.packageManager}",
  install: "${d.packageManager} install",

  devServers: [
    { id: "app", label: "App", command: "${d.packageManager} run dev", port: 3000 },
  ],

  // The only folders/files a designer is allowed to commit. Tighten or widen
  // to match where your design/copy work actually lives.
  tracked: {
    include: ["app/", "components/", "public/"],
  },

  secrets: {
    source: "dotenv-paste",
    manifest: ".env.example",
    target: ".env",
  },

  preview: { provider: "vercel" },

  // Optional org-specific buttons backed by a repo-local script:
  // actions: [
  //   { id: "public", label: "Make a page public", prompt: "Page URL",
  //     run: "scripts/sidestage/make-path-public.mjs" },
  // ],
});
`;
}
