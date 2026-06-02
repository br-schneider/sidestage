import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { DevServer } from "@sidestage/config";

import { err, ok, type Result } from "./result.js";
import { freePort, isPortFree, waitForHttp } from "./system/net.js";
import { delay } from "./system/process.js";

// Log lines that signal a corrupt build cache — restarting (with the cache
// cleared) reliably fixes these. Two or more hits triggers an auto-restart; a
// single transient ENOENT can be benign.
const CORRUPTION_PATTERN =
  /Persisting failed|ENOENT.*build-manifest|No such file or directory.*\.next|Cannot find module.*\.next/g;

export interface DevServerHandle {
  readonly server: DevServer;
  readonly logPath: string;
  readonly url: string;
  start(): Promise<Result<void>>;
  stop(): Promise<void>;
  restart(): Promise<Result<void>>;
  isRunning(): boolean;
  // True if the log has accumulated corruption signals since the last check.
  hasCorruptionSignal(): boolean;
}

export function createDevServer(
  server: DevServer,
  repoDir: string,
  logPath: string,
): DevServerHandle {
  let child: ChildProcess | undefined;
  let running = false;
  let logScanPos = 0;
  const url = `http://localhost:${server.port}${server.readyPath}`;

  function clearCache(): void {
    if (!server.clearCacheGlob) return;
    try {
      rmSync(join(repoDir, server.clearCacheGlob), { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  function isRunning(): boolean {
    return running;
  }

  async function stop(): Promise<void> {
    if (child?.pid) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          // Negative pid kills the whole process group (the detached child and
          // its dev-server grandchildren).
          process.kill(-child.pid, "SIGTERM");
        }
      } catch {
        // already gone
      }
    }
    child = undefined;
    running = false;

    await freePort(server.port);
    for (let i = 0; i < 10; i++) {
      if (await isPortFree(server.port)) break;
      if (i === 8) await freePort(server.port, "SIGKILL");
      await delay(500);
    }
  }

  async function start(): Promise<Result<void>> {
    await stop();
    clearCache();

    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, "");
    logScanPos = 0;

    const logFd = openSync(logPath, "a");
    child = spawn(server.command, {
      cwd: repoDir,
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    });
    running = true;
    child.on("exit", () => {
      running = false;
      try {
        closeSync(logFd);
      } catch {
        // already closed
      }
    });

    const ready = await waitForHttp(url, { timeoutMs: 120_000, isAlive: isRunning });
    if (ready) return ok(undefined);
    return err(running ? "The preview took too long to start." : "The preview failed to start.");
  }

  async function restart(): Promise<Result<void>> {
    return start();
  }

  function hasCorruptionSignal(): boolean {
    try {
      const size = statSync(logPath).size;
      if (size <= logScanPos) return false;
      const length = size - logScanPos;
      const buffer = Buffer.alloc(length);
      const fd = openSync(logPath, "r");
      readSync(fd, buffer, 0, length, logScanPos);
      closeSync(fd);
      logScanPos = size;
      const matches = buffer.toString("utf8").match(CORRUPTION_PATTERN);
      return (matches?.length ?? 0) >= 2;
    } catch {
      return false;
    }
  }

  return {
    server,
    logPath,
    url,
    start,
    stop,
    restart,
    isRunning,
    hasCorruptionSignal,
  };
}
