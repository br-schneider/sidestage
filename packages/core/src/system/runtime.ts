// Dry-run mode: destructive remote operations (push, PR create) become no-ops
// that report success. Used to dogfood the loop against a real repo without
// spraying branches and pull requests onto the remote.
export const isDryRun = (): boolean => process.env.SIDESTAGE_DRY_RUN === "1";
