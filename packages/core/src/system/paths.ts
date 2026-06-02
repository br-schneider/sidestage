import { homedir } from "node:os";
import { join } from "node:path";

// Sidestage's own state lives here, separate from any repo it edits.
export function stateDir(): string {
  return process.env.SIDESTAGE_HOME ?? join(homedir(), ".sidestage");
}

export function logsDir(): string {
  return join(stateDir(), "logs");
}

// Where cloned repos land by default during onboarding.
export function workspacesDir(): string {
  return join(homedir(), "sidestage");
}

export function defaultCloneDir(repoName: string): string {
  return join(workspacesDir(), repoName);
}
