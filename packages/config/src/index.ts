export * from "./schema.js";
export { loadConfig, findConfigPath, ConfigError, type LoadConfigResult } from "./loader.js";

import type { SidestageUserConfig } from "./schema.js";

/**
 * Identity helper that gives config authors full type-checking and autocomplete
 * on `sidestage.config.ts`. Defaults are applied later, at load time, by the
 * schema — so this returns the author's input unchanged.
 */
export function defineConfig(config: SidestageUserConfig): SidestageUserConfig {
  return config;
}
