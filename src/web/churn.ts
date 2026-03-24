// src/web/churn.ts
// Computes git churn and TODO density for a file path

export async function computeGitChurn(filePath: string, repoDir: string): Promise<number> {
  try {
    const proc = Bun.spawn(
      ["git", "log", "--oneline", "--since=30 days ago", "--", filePath],
      { cwd: repoDir, stdout: "pipe", stderr: "pipe" }
    );
    const text = await new Response(proc.stdout as ReadableStream).text();
    await proc.exited;
    return text.split("\n").filter(Boolean).length;
  } catch { return 0; }
}

export async function computeTodoCount(filePath: string, repoDir: string): Promise<number> {
  try {
    const proc = Bun.spawn(
      ["grep", "-c", "-iE", "TODO|FIXME|HACK|XXX", filePath],
      { cwd: repoDir, stdout: "pipe", stderr: "pipe" }
    );
    const text = await new Response(proc.stdout as ReadableStream).text();
    await proc.exited;
    return parseInt(text.trim(), 10) || 0;
  } catch { return 0; }
}
