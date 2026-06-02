import { chmodSync, writeFileSync } from "node:fs";

// Generates the per-OS launcher an engineer hands to a non-engineer. The
// launcher bootstraps Node if needed, drops the embedded config into the user's
// home, and runs Sidestage in onboarding mode — the "double-click, no terminal"
// experience, made portable.

export type LauncherPlatform = "mac" | "windows" | "linux";

export interface LauncherOptions {
  appName: string;
  // Serialized resolved config, embedded so a fresh laptop can onboard with no
  // prior checkout. Never contains secret values.
  configJson: string;
  packageSpec?: string;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "sidestage"
  );
}

export function macLauncherScript(opts: LauncherOptions): string {
  const pkg = opts.packageSpec ?? "sidestage@latest";
  const slug = slugify(opts.appName);
  const b64 = Buffer.from(opts.configJson).toString("base64");
  return `#!/bin/bash
# ${opts.appName} — double-click to start designing.
cd "$(dirname "$0")"
[[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
[[ -f /usr/local/bin/brew ]] && eval "$(/usr/local/bin/brew shellenv)"
if ! command -v node >/dev/null 2>&1; then
  if ! command -v brew >/dev/null 2>&1; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    [[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
  brew install node
fi
mkdir -p "$HOME/.sidestage"
CONFIG="$HOME/.sidestage/${slug}.config.json"
printf '%s' "${b64}" | base64 --decode > "$CONFIG"
exec npx -y ${pkg} --config "$CONFIG"
`;
}

export function windowsLauncherScript(opts: LauncherOptions): string {
  const pkg = opts.packageSpec ?? "sidestage@latest";
  const slug = slugify(opts.appName);
  const b64 = Buffer.from(opts.configJson).toString("base64");
  return `@echo off
REM ${opts.appName} — double-click to start designing.
if not exist "%USERPROFILE%\\.sidestage" mkdir "%USERPROFILE%\\.sidestage"
set "CONFIG=%USERPROFILE%\\.sidestage\\${slug}.config.json"
echo ${b64}> "%CONFIG%.b64"
certutil -decode "%CONFIG%.b64" "%CONFIG%" >nul
del "%CONFIG%.b64"
npx -y ${pkg} --config "%CONFIG%"
pause
`;
}

export function posixLauncherScript(opts: LauncherOptions): string {
  const pkg = opts.packageSpec ?? "sidestage@latest";
  const slug = slugify(opts.appName);
  const b64 = Buffer.from(opts.configJson).toString("base64");
  return `#!/usr/bin/env bash
# ${opts.appName} — run to start designing.
mkdir -p "$HOME/.sidestage"
CONFIG="$HOME/.sidestage/${slug}.config.json"
printf '%s' "${b64}" | base64 --decode > "$CONFIG"
exec npx -y ${pkg} --config "$CONFIG"
`;
}

export interface GeneratedLauncher {
  filename: string;
  script: string;
}

// The handed-out, blank-laptop launcher is named "…Setup" so it never collides
// with a lightweight `Sidestage.command` an engineer may commit into the repo
// for machines that already have the checkout.
export function launcherFor(platform: LauncherPlatform, opts: LauncherOptions): GeneratedLauncher {
  switch (platform) {
    case "mac":
      return { filename: "Sidestage Setup.command", script: macLauncherScript(opts) };
    case "windows":
      return { filename: "Sidestage Setup.bat", script: windowsLauncherScript(opts) };
    case "linux":
      return { filename: "sidestage-setup.sh", script: posixLauncherScript(opts) };
  }
}

export function writeLauncher(path: string, script: string): void {
  writeFileSync(path, script);
  try {
    chmodSync(path, 0o755);
  } catch {
    // Windows ignores the executable bit
  }
}
