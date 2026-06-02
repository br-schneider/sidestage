#!/usr/bin/env node
// Example Sidestage action: opt a page into a public allowlist (here, a
// `PUBLIC_PATHS` array in `proxy.ts`) so it is reachable without logging in.
//
// In the target repo this lives at scripts/sidestage/make-path-public.mjs and is
// referenced from sidestage.config.ts. Sidestage passes the page URL as argv[2].
// Adapt FILE and the marker below to wherever your app defines public routes.
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "proxy.ts";

const raw = process.argv[2];
if (!raw) {
  console.error("Usage: make-path-public <url-path>");
  process.exit(1);
}

let path = raw.trim();
if (!path.startsWith("/")) path = `/${path}`;
path = path.replace(/\/+$/, "") || "/";

let source;
try {
  source = readFileSync(FILE, "utf8");
} catch {
  console.error(`Could not read ${FILE} — run this from the repo root.`);
  process.exit(2);
}

const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
if (new RegExp(`^\\s*"${escaped}",?\\s*$`, "m").test(source)) {
  console.log(`${path} is already public.`);
  process.exit(0);
}

const start = /const PUBLIC_PATHS\s*=\s*\[/.exec(source);
if (!start) {
  console.error("Could not find PUBLIC_PATHS in proxy.ts.");
  process.exit(2);
}
const closeIndex = source.indexOf("\n];", start.index);
if (closeIndex < 0) {
  console.error("Could not find the end of PUBLIC_PATHS.");
  process.exit(2);
}

const updated = `${source.slice(0, closeIndex)}\n  "${path}",${source.slice(closeIndex)}`;
writeFileSync(FILE, updated);
console.log(`Added ${path} to PUBLIC_PATHS.`);
