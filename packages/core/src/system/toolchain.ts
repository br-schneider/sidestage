import { run, which } from "./process.js";

export type Platform = "mac" | "windows" | "linux" | "unknown";

export function platform(): Platform {
  switch (process.platform) {
    case "darwin":
      return "mac";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      return "unknown";
  }
}

export interface ToolSpec {
  id: string; // command name, e.g. "git"
  label: string; // "Git"
  brew?: string;
  winget?: string;
  apt?: string;
}

export const TOOL_SPECS: Record<string, ToolSpec> = {
  git: { id: "git", label: "Git", brew: "git", winget: "Git.Git", apt: "git" },
  gh: { id: "gh", label: "GitHub CLI", brew: "gh", winget: "GitHub.cli", apt: "gh" },
  node: { id: "node", label: "Node.js", brew: "node", winget: "OpenJS.NodeJS", apt: "nodejs" },
  pnpm: { id: "pnpm", label: "pnpm", brew: "pnpm", winget: "pnpm.pnpm" },
  yarn: { id: "yarn", label: "Yarn", brew: "yarn", winget: "Yarn.Yarn" },
  bun: { id: "bun", label: "Bun", brew: "oven-sh/bun/bun" },
};

export async function isInstalled(command: string): Promise<boolean> {
  return (await which(command)) !== undefined;
}

// Install Homebrew via the official script if it is missing (mac/linux).
async function ensureHomebrew(): Promise<boolean> {
  if (await isInstalled("brew")) return true;
  const script =
    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
  const res = await run("bash", ["-lc", script], { inherit: true });
  return res.ok && (await isInstalled("brew"));
}

export interface InstallResult {
  ok: boolean;
  message: string;
}

// Install one tool for the current platform, or return guidance if we can't.
export async function installTool(spec: ToolSpec): Promise<InstallResult> {
  switch (platform()) {
    case "mac": {
      if (!(await ensureHomebrew())) {
        return { ok: false, message: "Homebrew is required but could not be installed." };
      }
      const res = await run("brew", ["install", spec.brew ?? spec.id], { inherit: true });
      return res.ok
        ? { ok: true, message: `Installed ${spec.label}.` }
        : { ok: false, message: res.stderr || `Failed to install ${spec.label}.` };
    }
    case "windows": {
      if (!spec.winget) return manualHint(spec);
      const res = await run("winget", ["install", "-e", "--id", spec.winget], { inherit: true });
      return res.ok ? { ok: true, message: `Installed ${spec.label}.` } : manualHint(spec);
    }
    case "linux": {
      if (!spec.apt) return manualHint(spec);
      const res = await run("sudo", ["apt-get", "install", "-y", spec.apt], { inherit: true });
      return res.ok ? { ok: true, message: `Installed ${spec.label}.` } : manualHint(spec);
    }
    case "unknown":
      return manualHint(spec);
  }
}

function manualHint(spec: ToolSpec): InstallResult {
  return { ok: false, message: `Please install ${spec.label} manually, then run Sidestage again.` };
}
