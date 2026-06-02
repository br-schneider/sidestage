import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// A diagnostics log — the spiritual successor to the bash `diag` helper and the
// `log` command. Everything tricky (auth, clone, install, dev-server output) is
// appended here so a non-engineer can share one file when something breaks.
export interface Diagnostics {
  readonly path: string;
  log(message: string): void;
  section(title: string): void;
}

export function createDiagnostics(path: string): Diagnostics {
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // best-effort
  }

  const write = (line: string): void => {
    try {
      appendFileSync(path, `${line}\n`);
    } catch {
      // never let logging crash the tool
    }
  };

  return {
    path,
    log(message) {
      write(`[${new Date().toISOString()}] ${message}`);
    },
    section(title) {
      write(`\n=== ${title} ===`);
    },
  };
}
