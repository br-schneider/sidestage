import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

import { sidestageConfigSchema, type SidestageConfig } from "./schema.js";

// Filenames searched, in priority order. `.ts` wins so authors get types; it is
// loaded via dynamic import (works under tsx today; a bundled build embeds it).
const CONFIG_FILENAMES = [
  "sidestage.config.ts",
  "sidestage.config.mjs",
  "sidestage.config.js",
  "sidestage.config.json",
];

export interface LoadConfigResult {
  config: SidestageConfig;
  path: string;
}

export class ConfigError extends Error {}

export function findConfigPath(repoDir: string): string | undefined {
  for (const name of CONFIG_FILENAMES) {
    const candidate = join(repoDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

// Load and validate a Sidestage config. `target` may be a directory (searched)
// or a direct path to a config file.
export async function loadConfig(target: string): Promise<LoadConfigResult> {
  const path = resolveConfigPath(target);
  if (!path) {
    throw new ConfigError(
      `No sidestage config found. Expected one of ${CONFIG_FILENAMES.join(", ")} in ${target}.`,
    );
  }

  const raw = path.endsWith(".json") ? readJsonConfig(path) : await importConfig(path);

  try {
    const config = sidestageConfigSchema.parse(raw);
    return { config, path };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
        .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n");
      throw new ConfigError(`Invalid sidestage config at ${path}:\n${issues}`);
    }
    throw error;
  }
}

function resolveConfigPath(target: string): string | undefined {
  const isConfigFile = CONFIG_FILENAMES.some((name) => target.endsWith(name));
  if (isConfigFile) {
    const abs = isAbsolute(target) ? target : join(process.cwd(), target);
    return existsSync(abs) ? abs : undefined;
  }
  return findConfigPath(target);
}

function readJsonConfig(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ConfigError(
      `Could not parse ${path} as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function importConfig(path: string): Promise<unknown> {
  const mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
  if (mod.default === undefined) {
    throw new ConfigError(`${path} must \`export default defineConfig({ ... })\`.`);
  }
  return mod.default;
}
