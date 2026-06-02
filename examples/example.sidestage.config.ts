import { defineConfig } from "sidestage";

// An example Sidestage config. A company commits a file like this to the root of
// its repo; everything a non-engineer needs is expressed here as data. Copy it,
// rename it to `sidestage.config.ts`, and adjust the values for your repo.
export default defineConfig({
  repo: { url: "https://github.com/acme/app.git", host: "github" },

  baseBranch: "main",
  protectedBranches: ["main", "master", "production", "develop"],
  branchPrefix: "design/",

  packageManager: "pnpm",
  install: "pnpm install",

  devServers: [
    {
      id: "app",
      label: "App (pages, components, layouts)",
      command: "pnpm dev",
      port: 3000,
      clearCacheGlob: ".next",
    },
    {
      id: "email",
      label: "Emails (templates)",
      command: "pnpm email:dev",
      port: 3001,
    },
  ],

  // The only directories a designer can commit to.
  tracked: {
    include: ["app/", "components/", "public/"],
  },

  secrets: {
    source: "dotenv-paste",
    manifest: ".env.example",
    target: ".env",
    instructions:
      "Paste the .env your engineer sent you. Sidestage never stores or " +
      "transmits these values — they only land in your local .env file.",
  },

  preview: { provider: "vercel" },

  // The escape hatch — an org-specific button backed by a repo-local script.
  // Here: opting a page into a public allowlist so it is reachable without
  // logging in. The script lives in the repo, never in Sidestage's core.
  actions: [
    {
      id: "public",
      label: "Make a page viewable without login",
      description: "Adds a page's URL to the app's public allowlist.",
      prompt: "Page URL (e.g. /pricing)",
      run: "scripts/sidestage/make-path-public.mjs",
    },
  ],
});
