import open from "open";

// Open a URL in the default browser. Non-fatal if there is no browser (e.g. a
// headless CI run) — Sidestage keeps working, the user just opens it manually.
export async function openUrl(url: string): Promise<void> {
  try {
    await open(url);
  } catch {
    // no browser available
  }
}

// Open a file or folder with the OS default handler.
export async function openPath(path: string): Promise<void> {
  try {
    await open(path);
  } catch {
    // non-fatal
  }
}
