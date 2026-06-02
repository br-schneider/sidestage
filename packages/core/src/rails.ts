import type { SidestageConfig } from "@sidestage/config";

import { allow, deny, type RailVerdict } from "./result.js";

// ---------------------------------------------------------------------------
// Rails — the safety guarantee, expressed as pure functions over branch names
// and file paths. Nothing here does I/O. Every consumer (git, save, actions)
// must route through these. They are the one thing that absolutely cannot be
// wrong, so they are exhaustively unit-tested before anything depends on them.
// ---------------------------------------------------------------------------

export interface BranchPolicy {
  baseBranch: string;
  protectedBranches: readonly string[];
  branchPrefix: string;
}

export interface PathPolicy {
  include: readonly string[];
  exclude: readonly string[];
  // The configured secrets file (e.g. ".env"). Always denied from commits.
  secretTarget?: string;
}

export function branchPolicy(config: SidestageConfig): BranchPolicy {
  return {
    baseBranch: config.baseBranch,
    protectedBranches: config.protectedBranches,
    branchPrefix: config.branchPrefix,
  };
}

export function pathPolicy(config: SidestageConfig): PathPolicy {
  return {
    include: config.tracked.include,
    exclude: config.tracked.exclude,
    secretTarget: config.secrets.target,
  };
}

// --- Branch rails ----------------------------------------------------------

// The base branch is ALWAYS protected, whether or not it is listed explicitly.
export function isProtectedBranch(branch: string, policy: BranchPolicy): boolean {
  return branch === policy.baseBranch || policy.protectedBranches.includes(branch);
}

// A design branch is one the prefix owns, with a non-empty name after it.
export function isDesignBranch(branch: string, policy: BranchPolicy): boolean {
  return branch.startsWith(policy.branchPrefix) && branch.length > policy.branchPrefix.length;
}

// The single gate every commit and push passes through.
export function canWriteToBranch(
  branch: string | undefined | null,
  policy: BranchPolicy,
): RailVerdict {
  if (!branch) {
    return deny("Not on any branch (detached HEAD) — refusing to write.");
  }
  if (isProtectedBranch(branch, policy)) {
    return deny(`Refusing to write to protected branch "${branch}".`);
  }
  if (!isDesignBranch(branch, policy)) {
    return deny(
      `Refusing to write to "${branch}" — only branches starting with "${policy.branchPrefix}" are writable.`,
    );
  }
  return allow();
}

// --- Path rails ------------------------------------------------------------

// Strip leading "./", normalize separators to "/", drop a trailing slash.
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

// Manifests and templates are committed on purpose and carry no real secrets.
const SECRET_ALLOW_SUFFIXES = [
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.defaults",
  ".env.dist",
];

// Real secret material. Denied from commits regardless of the tracked list.
const SECRET_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(\.[^/]+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_rsa(\.[^/]+)?$/i,
];

// Never commit-able, full stop.
const ALWAYS_DENY: readonly RegExp[] = [/(^|\/)\.git(\/|$)/, /(^|\/)node_modules(\/|$)/];

export function isSecretPath(path: string, secretTarget?: string): boolean {
  const p = normalizePath(path);
  if (secretTarget && p === normalizePath(secretTarget)) return true;
  const lower = p.toLowerCase();
  if (SECRET_ALLOW_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return false;
  return SECRET_PATTERNS.some((rx) => rx.test(p));
}

// Match a path against an include/exclude pattern. Supports exact files,
// directory prefixes (with or without a trailing slash), and `*` / `**` globs.
export function matchPath(path: string, pattern: string): boolean {
  const p = normalizePath(path);

  if (pattern.includes("*")) {
    return globToRegExp(pattern).test(p);
  }

  const dir = normalizePath(pattern);
  return p === dir || p.startsWith(`${dir}/`);
}

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

// A path is stageable iff it is in the include set, not excluded, not a secret,
// and not on the always-deny list. The whitelist is the primary guard; secret
// denial is the non-negotiable override.
export function isStageable(path: string, policy: PathPolicy): boolean {
  const p = normalizePath(path);
  if (ALWAYS_DENY.some((rx) => rx.test(p))) return false;
  if (isSecretPath(p, policy.secretTarget)) return false;
  if (policy.exclude.some((pattern) => matchPath(p, pattern))) return false;
  return policy.include.some((pattern) => matchPath(p, pattern));
}

export function selectStageablePaths(paths: readonly string[], policy: PathPolicy): string[] {
  return paths.filter((p) => isStageable(p, policy));
}
