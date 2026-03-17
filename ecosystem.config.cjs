// ecosystem.config.cjs — PM2 configuration for Theorex background processes.
// REL-03: scan runs every 6 hours to re-score all nodes and decay edges.

module.exports = {
  apps: [
    {
      name: "theorex-scan",
      script: "/Users/eoh/.bun/bin/bun",
      args: "run src/cli/index.ts scan",
      cron_restart: "0 */6 * * *",
      autorestart: false,
    },
    {
      name: "theorex-idle-flush",
      script: "/Users/eoh/.bun/bin/bun",
      args: "run src/cli/index.ts promote --agent claude-code-agent",
      cron_restart: "*/10 * * * *",
      autorestart: false,
    },
    {
      name: "theorex-nightly",
      script: "bash",
      args: "-c '/Users/eoh/.bun/bin/bun run src/cli/index.ts scan && /Users/eoh/.bun/bin/bun run src/cli/index.ts evolve-review --agent claude-code-agent && /Users/eoh/.bun/bin/bun run src/cli/index.ts promote --agent claude-code-agent && /Users/eoh/.bun/bin/bun run src/cli/index.ts boot-inject'",
      cron_restart: "0 3 * * *",
      autorestart: false,
    },
  ],
};
