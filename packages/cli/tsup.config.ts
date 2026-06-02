import { defineConfig } from "tsup";

// Bundle the CLI and the library entry into a single publishable package. The
// workspace packages (@sidestage/core, @sidestage/config) are inlined so npm
// users get everything from one `sidestage` install.
export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  noExternal: [/^@sidestage\//],
  clean: true,
  dts: { entry: ["src/index.ts"] },
  shims: false,
  // Some bundled CJS deps (cross-spawn) call require() at runtime; polyfill it
  // so the ESM output works under Node.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
