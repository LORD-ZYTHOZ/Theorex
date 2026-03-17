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
      // Hourly idle promote (was every 10 min — 144x/day was excessive, ECO-003)
      name: "theorex-idle-flush",
      script: BUN,
      args: `run ${CLI} promote --agent claude-code-agent`,
      cron_restart: "0 * * * *",
      autorestart: false,
      out_file: `${LOG_DIR}/theorex-idle-flush-out.log`,
      error_file: `${LOG_DIR}/theorex-idle-flush-err.log`,
    },
    {
      // Nightly: scan → evolve-review (all agents) → promote → boot-inject
      name: "theorex-nightly",
      script: "bash",
      args: `-c '${BUN} run ${CLI} scan && ${BUN} run ${CLI} evolve-review --agent all && ${BUN} run ${CLI} promote --agent claude-code-agent && ${BUN} run ${CLI} boot-inject'`,
      cron_restart: "0 3 * * *",
      autorestart: false,
      out_file: `${LOG_DIR}/theorex-nightly-out.log`,
      error_file: `${LOG_DIR}/theorex-nightly-err.log`,
    },
  ],
};
