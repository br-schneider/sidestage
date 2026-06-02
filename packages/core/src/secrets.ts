import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { SidestageConfig } from "@sidestage/config";

// Sidestage never transmits or stores secret values anywhere but the local
// target file. These helpers only parse key names and merge a pasted blob.

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Required key names from a manifest (e.g. .env.example). Values are ignored.
export function parseEnvKeys(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    const key = (eq >= 0 ? trimmed.slice(0, eq) : trimmed).replace(/^export\s+/, "").trim();
    if (KEY_RE.test(key)) keys.push(key);
  }
  return keys;
}

export function parseDotenv(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed
      .slice(0, eq)
      .replace(/^export\s+/, "")
      .trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (KEY_RE.test(key)) map.set(key, value);
  }
  return map;
}

export interface SecretsStatus {
  manifestExists: boolean;
  required: string[];
  present: string[];
  missing: string[];
}

export function readSecretsStatus(repoDir: string, config: SidestageConfig): SecretsStatus {
  const manifestPath = join(repoDir, config.secrets.manifest);
  const targetPath = join(repoDir, config.secrets.target);
  const manifestExists = existsSync(manifestPath);
  const required = manifestExists ? parseEnvKeys(readFileSync(manifestPath, "utf8")) : [];
  const present = existsSync(targetPath)
    ? [...parseDotenv(readFileSync(targetPath, "utf8")).keys()]
    : [];
  const presentSet = new Set(present);
  return { manifestExists, required, present, missing: required.filter((k) => !presentSet.has(k)) };
}

function serializeValue(value: string): string {
  return /^[A-Za-z0-9_./:@%+-]*$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

// Merge a pasted .env blob into the target. If the target is new it is written
// verbatim (preserving the engineer's formatting); otherwise only keys not
// already present are appended. Returns keys still missing afterward.
export function applyPastedEnv(repoDir: string, config: SidestageConfig, pasted: string): string[] {
  const targetPath = join(repoDir, config.secrets.target);

  if (!existsSync(targetPath)) {
    writeFileSync(targetPath, pasted.endsWith("\n") ? pasted : `${pasted}\n`, { mode: 0o600 });
    return readSecretsStatus(repoDir, config).missing;
  }

  const existingKeys = new Set(parseDotenv(readFileSync(targetPath, "utf8")).keys());
  const additions: string[] = [];
  for (const [key, value] of parseDotenv(pasted)) {
    if (!existingKeys.has(key)) additions.push(`${key}=${serializeValue(value)}`);
  }
  if (additions.length > 0) {
    appendFileSync(targetPath, `\n# Added by Sidestage\n${additions.join("\n")}\n`);
  }
  return readSecretsStatus(repoDir, config).missing;
}
