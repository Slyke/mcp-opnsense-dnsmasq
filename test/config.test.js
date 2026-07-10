import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const requiredEnv = {
  MCP_READ_BEARER_TOKENS: "[{name:\"reader1\",token:\"read-token\"}]",
  OPNSENSE_BASE_URL: "https://opnsense.lan",
  OPNSENSE_API_KEY: "key",
  OPNSENSE_API_SECRET: "secret"
};

test("read history recording defaults off", () => {
  const config = loadConfig({
    env: requiredEnv,
    cwd: "/tmp",
    requireRequired: true
  });

  assert.equal(config.historyRecordReads, false);
  assert.equal(Object.hasOwn(config, "readOnly"), false);
  assert.equal(config.inventory.enabled, false);
  assert.equal(config.inventory.dbPath, "/tmp/data/inventory.sqlite");
  assert.equal(config.inventory.pollIntervalMs, 120000);
});

test("read history recording can be enabled by environment", () => {
  const config = loadConfig({
    env: {
      ...requiredEnv,
      HISTORY_RECORD_READS: "true"
    },
    cwd: "/tmp",
    requireRequired: true
  });

  assert.equal(config.historyRecordReads, true);
});

test("inventory can be configured by environment", () => {
  const config = loadConfig({
    env: {
      ...requiredEnv,
      INVENTORY_ENABLED: "true",
      INVENTORY_DB_PATH: "./custom/inventory.db",
      INVENTORY_POLL_ENABLED: "false",
      INVENTORY_POLL_INTERVAL_MS: "60000",
      INVENTORY_INCLUDE_RAW: "true",
      INVENTORY_COLLECT_NDP: "false",
      INVENTORY_RETENTION_DAYS: "30"
    },
    cwd: "/tmp",
    requireRequired: true
  });

  assert.equal(config.inventory.enabled, true);
  assert.equal(config.inventory.dbPath, "/tmp/custom/inventory.db");
  assert.equal(config.inventory.pollEnabled, false);
  assert.equal(config.inventory.pollIntervalMs, 60000);
  assert.equal(config.inventory.includeRaw, true);
  assert.equal(config.inventory.collectNdp, false);
  assert.equal(config.inventory.retentionDays, 30);
});
