// ecosystem.config.cjs — PM2 configuration for Theorex background processes.
// REL-03: scan runs every 6 hours to re-score all nodes and decay edges.

const BUN = "/Users/eoh/.bun/bin/bun";
const CLI = "src/cli/index.ts";
const LOG_DIR = "/Users/eoh/.pm2/logs";

module.exports = {
  apps: [
    {
      name: "theorex-scan",
      script: BUN,
      args: `run ${CLI} scan`,
      cron_restart: "0 */6 * * *",
      autorestart: false,
      out_file: `${LOG_DIR}/theorex-scan-out.log`,
      error_file: `${LOG_DIR}/theorex-scan-err.log`,
    },
    {
      // Hourly idle promote — promotes agents that went quiet in the last hour
      name: "theorex-idle-flush",
      script: "/Users/eoh/theorex/theorex-idle-flush.sh",
      cwd: "/Users/eoh/theorex",
      cron_restart: "15 * * * *",
      autorestart: false,
      out_file: `${LOG_DIR}/theorex-idle-flush-out.log`,
      error_file: `${LOG_DIR}/theorex-idle-flush-err.log`,
    },
    {
      // Nightly: scan → prune → promote → boot-inject for all agents
      name: "theorex-nightly",
      script: "/Users/eoh/theorex/theorex-nightly.sh",
      cwd: "/Users/eoh/theorex",
      cron_restart: "0 3 * * *",
      autorestart: false,
      out_file: `${LOG_DIR}/theorex-nightly-out.log`,
      error_file: `${LOG_DIR}/theorex-nightly-err.log`,
    },
    {
      // Every 5 min: check agent endpoint health + trace metrics
      name: "theorex-health",
      script: BUN,
      args: `run ${CLI} health-check`,
      cwd: "/Users/eoh/theorex",
      cron_restart: "*/5 * * * *",
      autorestart: false,
      out_file: `${LOG_DIR}/theorex-health-out.log`,
      error_file: `${LOG_DIR}/theorex-health-err.log`,
    },
  ],
};
