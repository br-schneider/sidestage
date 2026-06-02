// Public surface of @sidestage/core — the UI-agnostic engine. Front-ends (the
// CLI today, a GUI later) consume only what is exported here, including the
// re-exported config surface so there is a single import target.

export * from "@sidestage/config";
export * from "./result.js";
export * from "./rails.js";
export * from "./git.js";
export * from "./dev-server.js";
export * from "./secrets.js";
export * from "./adapters/index.js";
export * from "./ui.js";
export * from "./agent.js";
export * from "./actions.js";
export * from "./onboarding.js";
export * from "./launcher.js";

// System primitives are namespaced to keep generic names (run, which, open)
// out of the top-level surface.
export * as system from "./system/index.js";
