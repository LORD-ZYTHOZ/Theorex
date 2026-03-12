// ecosystem.config.cjs — PM2 configuration for Theorex background processes.
// REL-03: scan runs every 6 hours to re-score all nodes and decay edges.

module.exports = {
  apps: [
    {
      name: "theorex-scan",
      script: "bun",
      args: "run src/cli/index.ts scan",
      cron_restart: "0 */6 * * *",
      autorestart: false,
    },
  ],
};
