# Sidestage

**A safe cockpit that lets a non-engineer make real changes to a real
production codebase — locally, with a live preview — and hand them to
engineering, without ever knowing git, terminals, or the stack exists.**

Sidestage is the wings — just off the main stage, where a performer waits,
ready, before stepping into the light. That's the idea: a protected space where
designers, marketers, and founders can change the real app
and hand the work to engineers cleanly — never touching a protected branch,
never committing a secret.

> Status: early. The engine and CLI are working and dogfooded; GitLab/Netlify,
> secret-manager sources, and the desktop GUI are defined seams, not yet built.

---

## What it does

**Onboarding (fresh laptop → working app), driven entirely by Sidestage:**
installs the toolchain, signs in to the git host, clones the repo, installs
dependencies, guides you through dropping in the secrets your engineer sent, and
boots the dev server.

**The session loop (the daily driver):** pick what to work on, edit (with an AI
assistant or by hand), see it live, save, and open a pull request with a deploy
preview — all from a friendly menu.

Everything that was hardcoded in a one-off script is now **config**. Any company
adds a `sidestage.config.ts` and adopts it.

## For designers

Your engineer hands you a **Sidestage** launcher (a file you double-click). It
sets everything up the first time and opens a simple menu after that:

- **Edit with AI** — describe a change in plain words.
- **Save my changes** — keeps your work safe on its own branch.
- **Get a shareable preview link** — a URL you can send to anyone.
- **Restart / Update / Share a problem report** — when something's off.

You can't break anything: Sidestage only ever writes to a separate `design/`
branch, and it never commits passwords or secrets.

## Install

Sidestage is a per-repo tool, not a global one. Add it to the repo your
designers will work in, so everyone gets the same pinned version from a normal
`npm install` — no global setup, no version drift:

```bash
# In your repo (one-time):
npm i -D sidestage      # pin it in your repo's devDependencies
npx sidestage init      # scaffold sidestage.config.ts + a launcher to hand out
```

`init` writes a `sidestage.config.ts` (pre-filled from your git remote and
current branch) and, optionally, a launcher the designer double-clicks — the
launcher bootstraps everything and runs Sidestage for them, no terminal needed.
From then on the whole team gets the tool from a normal install and runs it with
`npx sidestage`. Prefer it on your PATH instead? `npm i -g sidestage` works too —
optional convenience, not the recommended path.

## For engineers — adopting it

After `init`, edit `sidestage.config.ts`:

```ts
import { defineConfig } from "sidestage";

export default defineConfig({
  repo: { url: "https://github.com/acme/app.git", host: "github" },

  baseBranch: "main",
  branchPrefix: "design/",

  packageManager: "pnpm",
  devServers: [
    { id: "app", label: "App", command: "pnpm dev", port: 3000, clearCacheGlob: ".next" },
  ],

  // The only folders a designer may commit. Secrets/migrations are always denied.
  tracked: { include: ["app/", "components/", "public/"] },

  secrets: { source: "dotenv-paste", manifest: ".env.example", target: ".env" },
  preview: { provider: "vercel" },
});
```

Commit it. Hand the generated launcher to a designer. Done.

### Config reference

| Field               | What it is                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `repo`              | `{ url, host }` — HTTPS clone URL and git host (`github` today).                                         |
| `baseBranch`        | The branch design work branches off (and is **always** protected).                                       |
| `protectedBranches` | Branches Sidestage refuses to write to.                                                                  |
| `branchPrefix`      | The only writable namespace, e.g. `design/`.                                                             |
| `packageManager`    | `pnpm` \| `npm` \| `yarn` \| `bun`.                                                                      |
| `install`           | Install command (defaults to `<packageManager> install`).                                                |
| `devServers[]`      | `{ id, label, command, port, clearCacheGlob?, readyPath? }`.                                             |
| `tracked.include`   | Whitelist of paths a designer may commit.                                                                |
| `tracked.exclude`   | Paths to carve back out of the whitelist.                                                                |
| `secrets`           | `{ source, manifest, target, instructions?, url? }`. Values are never shipped — the human provides them. |
| `preview`           | `{ provider }` — `vercel` \| `netlify` \| `none`.                                                        |
| `actions[]`         | Org-specific buttons backed by a repo-local script (see below).                                          |
| `agent`             | `{ enabled, command, args }` — the editing agent (Claude Code by default).                               |

## The safety model

Safety is **structural**, not advisory:

- **Branch rails** — commits and pushes are refused unless the current branch is
  under `branchPrefix` and not protected. The base branch is always protected.
- **Secret rails** — `.env*` (and the configured `secrets.target`, `*.pem`,
  `*.key`, …) are never staged, even inside a tracked folder or a brand-new
  untracked subdirectory.
- **Tracked whitelist** — only paths in `tracked.include` are ever committed.

These are pure functions with exhaustive unit tests and an integration test that
drives real git. They're the part that absolutely cannot be wrong.

## The escape hatch: actions

Every company has one weird thing — say, opting a page into a public allowlist
so it's viewable without login. That lives in config as an **action** backed by
a repo-local script, never in Sidestage's core:

```ts
actions: [
  {
    id: "public",
    label: "Make a page viewable without login",
    prompt: "Page URL (e.g. /pricing)",
    run: "scripts/sidestage/make-path-public.mjs",
  },
],
```

See [`examples/`](./examples) for a complete example config and that script.

## Architecture

```
packages/
  config/   Zod schema + defineConfig + loader
  core/     the engine — rails, git, dev-server, secrets, adapters, agent,
            onboarding, actions, launcher. UI-agnostic and testable.
  cli/      the `sidestage` binary — a Clack UI implementing core's UI port
apps/
  desktop/  (future) a GUI over the same core
```

`core` drives every flow against a small **UI port**; the CLI backs it with a
terminal UI, and a desktop GUI would back it differently — same logic, no
rewrite. Git hosts and preview providers are **adapters** behind interfaces, so
GitLab/Netlify slot in later.

## Development

```bash
pnpm install
pnpm check     # typecheck
pnpm test      # unit + real-git integration tests
pnpm build     # bundle the publishable `sidestage` package
pnpm sidestage # run the CLI from source (tsx)
```

To dogfood the loop against a real repo without touching its remote, set
`SIDESTAGE_DRY_RUN=1` — pushes and PR creation become no-ops.

## License

MIT
