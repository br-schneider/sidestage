// Public library surface of the `sidestage` package. Config authors write:
//   import { defineConfig } from "sidestage";
export { defineConfig } from "@sidestage/config";
export type {
  SidestageConfig,
  SidestageUserConfig,
  DevServer,
  Action,
  GitHost,
  PackageManager,
  SecretsConfig,
  SecretsSource,
} from "@sidestage/config";
