import { z } from "zod";

// The git host a repo lives on. Only `github` is implemented in v1; the others
// are declared so configs and adapter contracts can reference them today.
export const gitHostSchema = z.enum(["github", "gitlab", "bitbucket"]);
export type GitHost = z.infer<typeof gitHostSchema>;

export const repoSchema = z.object({
  // HTTPS clone URL. SSH URLs are converted to HTTPS at clone time so the
  // git-host CLI auth (which only speaks HTTPS) works for non-engineers.
  url: z.string(),
  host: gitHostSchema.default("github"),
});

export const packageManagerSchema = z.enum(["pnpm", "npm", "yarn", "bun"]);
export type PackageManager = z.infer<typeof packageManagerSchema>;

export const devServerSchema = z.object({
  id: z.string(),
  // Human label shown in the "what are you working on?" picker.
  label: z.string(),
  command: z.string(),
  port: z.number().int().positive(),
  // Optional cache dir wiped before each (re)start to dodge stale-cache crashes
  // (e.g. ".next" for Next.js / Turbopack).
  clearCacheGlob: z.string().optional(),
  // Path hit to decide the server is actually serving, not just listening.
  readyPath: z.string().default("/"),
});
export type DevServer = z.infer<typeof devServerSchema>;

// The whitelist of what a non-engineer is allowed to commit. Secrets and
// migration dirs are denied in core regardless of what lands here.
export const trackedSchema = z.object({
  include: z.array(z.string()).min(1),
  exclude: z.array(z.string()).default([]),
});

export const secretsSourceSchema = z.enum(["dotenv-paste", "manual-link", "none"]);
export type SecretsSource = z.infer<typeof secretsSourceSchema>;

export const secretsSchema = z.object({
  source: secretsSourceSchema.default("dotenv-paste"),
  // File whose keys define what's required (e.g. ".env.example"). The tool
  // never reads secret *values* from here — only the set of required keys.
  manifest: z.string().default(".env.example"),
  target: z.string().default(".env"),
  // Shown to the designer during the secrets step.
  instructions: z.string().optional(),
  // For `manual-link`: a company URL (1Password/Notion/Vault) to open.
  url: z.string().optional(),
});
export type SecretsConfig = z.infer<typeof secretsSchema>;

export const previewProviderSchema = z.enum(["vercel", "netlify", "none"]);
export const previewSchema = z.object({
  provider: previewProviderSchema.default("vercel"),
});

// The escape hatch: org-specific buttons backed by a repo-local script. This is
// where a company's one-off operation (e.g. a "make this page public" edit)
// lives — never in core.
export const actionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  // If set, the designer is asked this question and the answer is passed as the
  // script's first CLI argument.
  prompt: z.string().optional(),
  // Path (relative to repo root) to a Node script run via the repo's runtime.
  run: z.string(),
  // Commit the result with the next save. Defaults true.
  saveAfter: z.boolean().default(true),
});
export type Action = z.infer<typeof actionSchema>;

export const agentSchema = z.object({
  enabled: z.boolean().default(true),
  // The editing agent to hand the terminal to. Defaults to Claude Code.
  command: z.string().default("claude"),
  args: z.array(z.string()).default([]),
});

export const sidestageConfigSchema = z.object({
  repo: repoSchema,
  baseBranch: z.string().default("main"),
  // baseBranch is ALWAYS treated as protected by the rails, whether or not it
  // appears here.
  protectedBranches: z.array(z.string()).default(["main", "master", "production", "develop"]),
  branchPrefix: z.string().default("design/"),
  packageManager: packageManagerSchema.default("npm"),
  // Install command. If omitted, core derives `<packageManager> install`.
  install: z.string().optional(),
  devServers: z.array(devServerSchema).min(1),
  tracked: trackedSchema,
  secrets: secretsSchema.default({
    source: "dotenv-paste",
    manifest: ".env.example",
    target: ".env",
  }),
  preview: previewSchema.default({ provider: "vercel" }),
  actions: z.array(actionSchema).default([]),
  agent: agentSchema.default({ enabled: true, command: "claude", args: [] }),
});

// Resolved config (defaults applied) — what core and the CLI consume.
export type SidestageConfig = z.infer<typeof sidestageConfigSchema>;
// Author-facing config (defaults optional) — what `defineConfig` accepts.
export type SidestageUserConfig = z.input<typeof sidestageConfigSchema>;
