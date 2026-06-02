import { createServer } from "node:net";

import { delay, run } from "./process.js";

// True if nothing is listening on the port (we can bind it ourselves).
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  // Bail early if the thing we are waiting on has died.
  isAlive?: () => boolean;
}

// Poll a URL until it responds (any non-5xx) or we time out / the server dies.
export async function waitForHttp(url: string, opts: WaitOptions = {}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const intervalMs = opts.intervalMs ?? 1000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (opts.isAlive && !opts.isAlive()) return false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.status >= 200 && res.status < 500) return true;
    } catch {
      // not ready yet
    }
    await delay(intervalMs);
  }
  return false;
}

// PIDs listening on a port. lsof on mac/linux, netstat on Windows.
export async function pidsOnPort(port: number): Promise<number[]> {
  if (process.platform === "win32") {
    const res = await run("netstat", ["-ano"]);
    if (!res.ok) return [];
    const pids = new Set<number>();
    for (const line of res.stdout.split(/\r?\n/)) {
      if (line.includes(`:${port} `) && /LISTENING/i.test(line)) {
        const pid = Number(line.trim().split(/\s+/).pop());
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
    }
    return [...pids];
  }
  const res = await run("lsof", ["-ti", `:${port}`, "-sTCP:LISTEN"]);
  if (!res.ok) return [];
  return res.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

// Best-effort: kill whatever is listening on a port (orphan cleanup).
export async function freePort(port: number, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
  for (const pid of await pidsOnPort(port)) {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}
