import type { GitHost } from "@sidestage/config";

import type { Result } from "../result.js";

// Contract every git-host implementation satisfies. Only GitHub is implemented
// in v1; the interface exists so GitLab/Bitbucket are drop-in later.
export interface GitHostAdapter {
  readonly host: GitHost;
  isAuthenticated(): Promise<boolean>;
  // Interactive, browser-based sign-in for a non-engineer.
  login(): Promise<Result<void>>;
  // Wire the host CLI in as git's credential helper.
  setupGitCredentials(): Promise<void>;
  listOpenPullRequests(limit?: number): Promise<PullRequestSummary[]>;
  // Branch names whose PRs are merged/closed, so they can be hidden from the
  // "what would you like to work on?" picker.
  listClosedDesignBranches(branchPrefix: string): Promise<string[]>;
  findPullRequestUrl(branch: string): Promise<string | undefined>;
  createPullRequest(opts: CreatePrOptions): Promise<Result<CreatePrResult>>;
  // The deploy-preview URL for a branch, discovered from its PR's checks.
  findPreviewUrl(branch: string, providerPattern: RegExp): Promise<string | undefined>;
  // Upload a diagnostics file and return a shareable URL (gist, snippet, ...).
  shareLog(filePath: string, description: string): Promise<string | undefined>;
}

export interface PullRequestSummary {
  number: number;
  headRef: string;
  title: string;
}

export interface CreatePrOptions {
  base: string;
  head: string;
  title: string;
  body: string;
}

export interface CreatePrResult {
  url: string;
  alreadyExisted: boolean;
}
