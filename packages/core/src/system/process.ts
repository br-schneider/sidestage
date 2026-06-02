import { execa } from "execa";

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  // Stream stdio straight to the parent terminal — for long-running or
  // interactive children (dev servers, the editing agent).
  inherit?: boolean;
  timeout?: number;
  input?: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  ok: boolean;
}

// Run a command without throwing on non-zero exit. Callers inspect `ok`.
export async function run(
  command: string,
  args: string[] = [],
  opts: RunOptions = {},
): Promise<RunResult> {
  try {
    const result = await execa(command, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: opts.inherit ? "inherit" : "pipe",
      timeout: opts.timeout,
      input: opts.inherit ? undefined : opts.input,
      reject: false,
      stripFinalNewline: true,
    });
    const exitCode = typeof result.exitCode === "number" ? result.exitCode : 1;
    return {
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
      exitCode,
      ok: exitCode === 0 && !result.failed,
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 127,
      ok: false,
    };
  }
}

// Resolve a command to its path, or undefined if not on PATH. Cross-platform.
export async function which(command: string): Promise<string | undefined> {
  const finder = process.platform === "win32" ? "where" : "which";
  const result = await run(finder, [command]);
  if (!result.ok) return undefined;
  const first = result.stdout.split(/\r?\n/)[0]?.trim();
  return first ? first : undefined;
}

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
