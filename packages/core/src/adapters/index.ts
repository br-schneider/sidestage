import type { GitHost } from "@sidestage/config";

import { createGitHubAdapter } from "./github.js";
import type { GitHostAdapter } from "./git-host.js";

export * from "./git-host.js";

export function getGitHostAdapter(host: GitHost, repoDir: string): GitHostAdapter {
  switch (host) {
    case "github":
      return createGitHubAdapter(repoDir);
    case "gitlab":
    case "bitbucket":
      throw new Error(`Git host "${host}" is not supported yet — only GitHub is implemented.`);
  }
}

// The PR check name that carries a provider's deploy-preview URL.
export function previewCheckPattern(provider: string): RegExp {
  switch (provider) {
    case "vercel":
      return /vercel/i;
    case "netlify":
      return /netlify/i;
    default:
      return /preview|deploy/i;
  }
}
