// ecosystem.config.cjs — PM2 configuration for Theorex background processes.
// REL-03: scan runs every 6 hours to re-score all nodes and decay edges.

const BUN = "/Users/eoh/.bun/bin/bun";
const CLI = "src/cli/index.ts";
const LOG_DIR = "/Users/eoh/.pm2/logs";
const QWEN3_MODEL = "/Users/eoh/.cache/huggingface/hub/models--mlx-community--Qwen3-32B-4bit/snapshots/bcaaf7f538adf166c1080a2befdb4f6019f66639";

module.exports = {
  apps: [
    {
      // turbo-kv patched MLX server — TurboQwen3Attention KV cache injection
      name: "qwen3-32b",
      script: "/Users/eoh/turbo-kv/server.py",
      interpreter: "/Users/eoh/turbo-kv/venv/bin/python3",
      args: [
        "--model", QWEN3_MODEL,
        "--host", "0.0.0.0",
        "--port", "8082",
        "--max-tokens", "2048",
        "--chat-template-args", '{"enable_thinking":false}',
      ],
      cwd: "/Users/eoh/turbo-kv",
      autorestart: true,
      out_file: `${LOG_DIR}/qwen3-32b-out.log`,
      error_file: `${LOG_DIR}/qwen3-32b-error.log`,
    },
    {
      name: "theorex-scan",
      script: BUN,
      args: `run ${CLI} scan`,
      autorestart: false,
      env: { THEOREX_STORAGE: "postgres" },
      out_file: `${LOG_DIR}/theorex-scan-out.log`,
      error_file: `${LOG_DIR}/theorex-scan-err.log`,
    },
    {
      name: "theorex-mcp",
      script: BUN,
      args: `run ${CLI} mcp-start --port 18800`,
      cwd: "/Users/eoh/theorex",
      env: { THEOREX_STORAGE: "postgres", THEOREX_PG_HOST: "10.10.0.2" },
      out_file: `${LOG_DIR}/theorex-mcp-out.log`,
      error_file: `${LOG_DIR}/theorex-mcp-err.log`,
    },
    {
      // Hourly idle promote — promotes agents that went quiet in the last hour
      name: "theorex-idle-flush",
      script: "/Users/eoh/theorex/theorex-idle-flush.sh",
      cwd: "/Users/eoh/theorex",
      cron_restart: "15 * * * *",
      autorestart: false,
      env: { THEOREX_STORAGE: "postgres" },
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
      env: { THEOREX_STORAGE: "postgres" },
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
      env: { THEOREX_STORAGE: "postgres" },
      out_file: `${LOG_DIR}/theorex-health-out.log`,
      error_file: `${LOG_DIR}/theorex-health-err.log`,
    },
  ],
};
