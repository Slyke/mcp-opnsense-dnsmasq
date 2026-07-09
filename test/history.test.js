import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHistoryStore } from "../src/history.js";

const createStore = ({ historyCount = 50 } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-history-"));
  const historyFile = path.join(dir, "history.jsonl");
  const store = createHistoryStore({
    config: {
      historyFile,
      historyCount
    }
  });

  return { dir, historyFile, store };
};

test("history entries are written as jsonl", () => {
  const { dir, historyFile, store } = createStore();

  try {
    store.append({
      toolName: "dhcp_static_create",
      identityName: "admin1",
      action: "create",
      applied: true,
      target: { uuid: "first" },
      requestId: "req-1"
    });
    store.append({
      toolName: "dhcp_static_delete",
      identityName: "admin1",
      action: "delete",
      applied: true,
      target: { uuid: "second" },
      requestId: "req-2"
    });

    const lines = fs.readFileSync(historyFile, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(lines[0].startsWith("{"), true);
    assert.equal(lines[1].startsWith("{"), true);

    const entries = lines.map((line) => JSON.parse(line));
    assert.equal(entries[0].request_id, "req-2");
    assert.equal(entries[1].request_id, "req-1");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("history search reads jsonl entries", () => {
  const { dir, store } = createStore();

  try {
    store.append({
      toolName: "dhcp_static_create",
      identityName: "admin1",
      action: "create",
      applied: true,
      target: { uuid: "lease-1", hostname: "printer" },
      requestId: "req-1"
    });

    const results = store.search({ query: "printer" });
    assert.equal(results.length, 1);
    assert.equal(results[0].tool_name, "dhcp_static_create");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("history search reads existing json array entries", () => {
  const { dir, historyFile, store } = createStore();

  try {
    fs.writeFileSync(historyFile, `${JSON.stringify([
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        request_id: "req-old",
        tool_name: "dhcp_static_update",
        identity_name: "admin1",
        action: "update",
        applied: true,
        ok: true,
        target: { hostname: "legacy-printer" }
      }
    ], null, 2)}\n`, "utf8");

    const results = store.search({ query: "legacy-printer" });
    assert.equal(results.length, 1);
    assert.equal(results[0].request_id, "req-old");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
