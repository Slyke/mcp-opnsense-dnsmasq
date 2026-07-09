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
