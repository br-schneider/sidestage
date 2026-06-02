import pc from "picocolors";

// A small, tasteful wordmark. Deliberately not ASCII-art-heavy — it should feel
// calm and trustworthy to a non-engineer, not like a hacker tool.
export function printBanner(): void {
  const line = pc.dim("─".repeat(44));
  process.stdout.write(
    [
      "",
      `  ${pc.green("●")}  ${pc.bold(pc.green("sidestage"))}`,
      `  ${pc.dim("a safe place to change the real thing")}`,
      `  ${line}`,
      "",
    ].join("\n") + "\n",
  );
}
