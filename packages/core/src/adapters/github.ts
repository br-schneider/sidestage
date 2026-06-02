import { z } from "zod";

import { err, ok, type Result } from "../result.js";
import { run } from "../system/process.js";
import { isDryRun } from "../system/runtime.js";
import type {
  CreatePrOptions,
  CreatePrResult,
  GitHostAdapter,
  PullRequestSummary,
} from "./git-host.js";

const prListSchema = z.array(
  z.object({ number: z.number(), headRefName: z.string(), title: z.string() }),
);
const prStateSchema = z.array(z.object({ headRefName: z.string(), state: z.string() }));
const checksSchema = z.array(z.object({ name: z.string(), link: z.string().optional() }));
const prViewSchema = z.object({ url: z.string() });

function parseJson<T>(schema: z.ZodType<T>, text: string): T | undefined {
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

// GitHub adapter backed by the `gh` CLI, run inside the repo so it picks up the
// right remote and auth.
export function createGitHubAdapter(repoDir: string): GitHostAdapter {
  const gh = (args: string[], inherit = false) => run("gh", args, { cwd: repoDir, inherit });

  return {
    host: "github",

    async isAuthenticated() {
      return (await gh(["auth", "status"])).ok;
    },

    async login() {
      const res = await gh(["auth", "login", "--web", "--git-protocol", "https"], true);
      if (!res.ok) return err("GitHub sign-in did not complete.");
      await gh(["auth", "setup-git"]);
      return ok(undefined);
    },

    async setupGitCredentials() {
      await gh(["auth", "setup-git"]);
    },

    async listOpenPullRequests(limit = 20) {
      const res = await gh([
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        String(limit),
        "--json",
        "number,headRefName,title",
      ]);
      if (!res.ok) return [];
      const parsed = parseJson(prListSchema, res.stdout) ?? [];
      return parsed.map(
        (pr): PullRequestSummary => ({
          number: pr.number,
          headRef: pr.headRefName,
          title: pr.title,
        }),
      );
    },

    async listClosedDesignBranches(branchPrefix) {
      const res = await gh([
        "pr",
        "list",
        "--state",
        "all",
        "--limit",
        "200",
        "--json",
        "headRefName,state",
      ]);
      if (!res.ok) return [];
      const parsed = parseJson(prStateSchema, res.stdout) ?? [];
      return parsed
        .filter((pr) => pr.state !== "OPEN" && pr.headRefName.startsWith(branchPrefix))
        .map((pr) => pr.headRefName);
    },

    async findPullRequestUrl(branch) {
      const res = await gh(["pr", "view", branch, "--json", "url"]);
      if (!res.ok) return undefined;
      return parseJson(prViewSchema, res.stdout)?.url;
    },

    async createPullRequest(opts: CreatePrOptions): Promise<Result<CreatePrResult>> {
      const existing = await this.findPullRequestUrl(opts.head);
      if (existing) return ok({ url: existing, alreadyExisted: true });

      if (isDryRun()) {
        return ok({
          url: `https://github.com/dry-run/pull/0 (${opts.head})`,
          alreadyExisted: false,
        });
      }

      const res = await gh([
        "pr",
        "create",
        "--base",
        opts.base,
        "--head",
        opts.head,
        "--title",
        opts.title,
        "--body",
        opts.body,
      ]);
      const url = res.stdout.trim();
      if (res.ok && url.startsWith("https://")) {
        return ok({ url, alreadyExisted: false });
      }
      return err(res.stderr || "Could not create the pull request.");
    },

    async findPreviewUrl(branch, providerPattern) {
      const res = await gh(["pr", "checks", branch, "--json", "name,link"]);
      if (!res.ok) return undefined;
      const checks = parseJson(checksSchema, res.stdout) ?? [];
      return checks.find((check) => providerPattern.test(check.name) && check.link)?.link;
    },

    async shareLog(filePath, description) {
      const res = await gh(["gist", "create", filePath, "--desc", description]);
      const url = res.stdout.trim();
      return res.ok && url.startsWith("https://") ? url : undefined;
    },
  };
}
