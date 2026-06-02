import { describe, expect, it } from "vitest";

import {
  type BranchPolicy,
  canWriteToBranch,
  isDesignBranch,
  isProtectedBranch,
  isSecretPath,
  isStageable,
  matchPath,
  type PathPolicy,
  selectStageablePaths,
} from "./rails.js";

const BRANCH: BranchPolicy = {
  baseBranch: "stage",
  protectedBranches: ["main", "master", "stage", "production", "develop"],
  branchPrefix: "design/",
};

const PATHS: PathPolicy = {
  include: ["app/", "components/", "lib/email/", "public/", "proxy.ts", ".claude/"],
  exclude: [],
  secretTarget: ".env",
};

describe("branch rails", () => {
  it("treats listed branches as protected", () => {
    for (const b of BRANCH.protectedBranches) {
      expect(isProtectedBranch(b, BRANCH)).toBe(true);
    }
  });

  it("treats the base branch as protected even if not listed", () => {
    const policy: BranchPolicy = { ...BRANCH, protectedBranches: [] };
    expect(isProtectedBranch("stage", policy)).toBe(true);
  });

  it("recognizes design branches only with a non-empty name", () => {
    expect(isDesignBranch("design/homepage", BRANCH)).toBe(true);
    expect(isDesignBranch("design/", BRANCH)).toBe(false);
    expect(isDesignBranch("stage", BRANCH)).toBe(false);
    expect(isDesignBranch("feature/x", BRANCH)).toBe(false);
  });

  it("allows writes only to non-protected design branches", () => {
    expect(canWriteToBranch("design/homepage", BRANCH).allowed).toBe(true);
  });

  it.each([
    ["stage", "protected"],
    ["main", "protected"],
    ["production", "protected"],
    ["feature/x", "non-design"],
    ["", "detached"],
    [undefined, "detached"],
    [null, "detached"],
  ])("refuses to write to %s", (branch, _reason) => {
    const verdict = canWriteToBranch(branch, BRANCH);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBeTruthy();
  });
});

describe("secret rails", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production",
    "app/.env",
    "config/secret.pem",
    "certs/server.key",
    ".ssh/id_rsa",
  ])("denies secret file %s", (p) => {
    expect(isSecretPath(p, ".env")).toBe(true);
  });

  it.each([".env.example", ".env.sample", "lib/.env.template", "app/page.tsx", "proxy.ts"])(
    "allows non-secret file %s",
    (p) => {
      expect(isSecretPath(p, ".env")).toBe(false);
    },
  );

  it("denies a custom secrets target", () => {
    expect(isSecretPath("config/.env.vault", "config/.env.vault")).toBe(true);
  });
});

describe("path matching", () => {
  it("matches directory prefixes", () => {
    expect(matchPath("app/page.tsx", "app/")).toBe(true);
    expect(matchPath("app/page.tsx", "app")).toBe(true);
    expect(matchPath("components/x/y.tsx", "components/")).toBe(true);
    expect(matchPath("lib/db/index.ts", "app/")).toBe(false);
  });

  it("matches exact files", () => {
    expect(matchPath("proxy.ts", "proxy.ts")).toBe(true);
    expect(matchPath("proxy.ts.bak", "proxy.ts")).toBe(false);
  });

  it("supports globs", () => {
    expect(matchPath("app/page.tsx", "app/**/*.tsx")).toBe(true);
    expect(matchPath("app/deeply/nested/page.tsx", "app/**/*.tsx")).toBe(true);
    expect(matchPath("app/page.ts", "app/**/*.tsx")).toBe(false);
    expect(matchPath("app/page.css", "app/*.tsx")).toBe(false);
  });
});

describe("stageable selection", () => {
  it("keeps tracked design files", () => {
    expect(isStageable("app/page.tsx", PATHS)).toBe(true);
    expect(isStageable("components/button.tsx", PATHS)).toBe(true);
    expect(isStageable("proxy.ts", PATHS)).toBe(true);
  });

  it("drops files outside the whitelist", () => {
    expect(isStageable("db/schema.ts", PATHS)).toBe(false);
    expect(isStageable("package.json", PATHS)).toBe(false);
  });

  it("never stages secrets even inside a tracked dir", () => {
    expect(isStageable("app/.env", PATHS)).toBe(false);
    expect(isStageable(".env", PATHS)).toBe(false);
  });

  it("never stages .git or node_modules", () => {
    expect(isStageable(".git/config", PATHS)).toBe(false);
    expect(isStageable("app/node_modules/x/index.js", PATHS)).toBe(false);
  });

  it("honors excludes", () => {
    const policy: PathPolicy = { ...PATHS, exclude: ["app/secret-stuff/"] };
    expect(isStageable("app/secret-stuff/x.tsx", policy)).toBe(false);
    expect(isStageable("app/page.tsx", policy)).toBe(true);
  });

  it("filters a mixed changeset down to the safe subset", () => {
    const changed = [
      "app/page.tsx",
      ".env",
      "db/migrations/0001.sql",
      "components/nav.tsx",
      "package.json",
      "proxy.ts",
    ];
    expect(selectStageablePaths(changed, PATHS)).toEqual([
      "app/page.tsx",
      "components/nav.tsx",
      "proxy.ts",
    ]);
  });
});
