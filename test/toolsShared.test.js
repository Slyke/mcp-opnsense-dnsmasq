import assert from "node:assert/strict";
import test from "node:test";
import { makeToolHandler } from "../src/tools/shared.js";

const createContext = ({ historyRecordReads }) => {
  const entries = [];
  const logs = [];
  const errors = [];

  return {
    config: {
      historyRecordReads
    },
    history: {
      entries,
      append: (entry) => {
        entries.push(entry);
        return entry;
      }
    },
    logger: {
      logs,
      errors,
      redact: ({ value }) => value,
      generateLog: (entry) => {
        logs.push(entry);
      },
      generateError: (entry) => {
        errors.push(entry);
      }
    }
  };
};

const authInfo = {
  authInfo: {
    clientId: "reader1",
    scopes: ["read"]
  }
};

test("read tool calls are not recorded in history by default", async () => {
  const context = createContext({ historyRecordReads: false });
  const handler = makeToolHandler({
    context,
    toolName: "arp_list",
    handler: async () => ({
      ok: true,
      arp: [{ ip_address: "10.7.2.10" }]
    })
  });

  await handler({ include_raw: false }, authInfo);

  assert.equal(context.history.entries.length, 0);
});

test("read tool calls are summarized in history when enabled", async () => {
  const context = createContext({ historyRecordReads: true });
  const args = {
    query: "raspberry",
    include_raw: true
  };
  const handler = makeToolHandler({
    context,
    toolName: "arp_search",
    handler: async () => ({
      ok: true,
      arp: [{ ip_address: "10.7.2.10" }, { ip_address: "10.7.2.11" }]
    })
  });

  const result = await handler(args, authInfo);

  assert.equal(result.structuredContent.ok, true);
  assert.equal(context.history.entries.length, 1);
  assert.equal(context.history.entries[0].toolName, "arp_search");
  assert.equal(context.history.entries[0].identityName, "reader1");
  assert.equal(context.history.entries[0].action, "read");
  assert.equal(context.history.entries[0].applied, false);
  assert.equal(context.history.entries[0].ok, true);
  assert.deepEqual(context.history.entries[0].target, {
    args,
    result_field: "arp",
    result_count: 2
  });
});

test("read tool failures are summarized in history when enabled", async () => {
  const context = createContext({ historyRecordReads: true });
  const handler = makeToolHandler({
    context,
    toolName: "client_summary",
    handler: async () => {
      throw new Error("boom");
    }
  });

  const result = await handler({ identifier: "router" }, authInfo);

  assert.equal(result.structuredContent.ok, false);
  assert.equal(context.history.entries.length, 1);
  assert.equal(context.history.entries[0].ok, false);
  assert.equal(context.history.entries[0].target.error_code, "unknown");
});

test("mutating tools require a write-scoped token", async () => {
  const context = createContext({ historyRecordReads: true });
  let called = false;
  const handler = makeToolHandler({
    context,
    toolName: "dhcp_static_create",
    mutating: true,
    handler: async () => {
      called = true;
      return { ok: true };
    }
  });

  const result = await handler({ hostname: "device" }, authInfo);

  assert.equal(called, false);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.error.code, "auth_error");
  assert.equal(context.history.entries.length, 1);
  assert.equal(context.history.entries[0].action, "blocked");
});
