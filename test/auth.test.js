import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticateBearerToken,
  authenticateHttpRequest
} from "../src/auth.js";
import { createRedactor } from "../src/logger.js";

const config = {
  auth: {
    readTokens: [{ name: "reader1", token: "read-secret" }],
    readWriteTokens: [{ name: "writer1", token: "write-secret" }]
  },
  opnsense: {
    apiKey: "opn-key",
    apiSecret: "opn-secret"
  }
};

test("authenticates named read and readwrite bearer tokens", () => {
  assert.deepEqual(authenticateBearerToken({ token: "read-secret", config }).identity, {
    name: "reader1",
    role: "read",
    scopes: ["read"]
  });
  assert.deepEqual(authenticateBearerToken({ token: "write-secret", config }).identity, {
    name: "writer1",
    role: "readwrite",
    scopes: ["read", "write"]
  });
});

test("returns 401 for missing bearer token and 403 for invalid token", () => {
  assert.equal(authenticateHttpRequest({ req: { headers: {} }, config }).status, 401);
  assert.equal(
    authenticateHttpRequest({
      req: {
        headers: {
          authorization: "Bearer wrong"
        }
      },
      config
    }).status,
    403
  );
});

test("redacts configured tokens and OPNsense secrets before logging", () => {
  const redact = createRedactor({ config });
  const redacted = redact({
    value: {
      Authorization: "Bearer read-secret",
      nested: {
        value: "opn-secret"
      }
    }
  });

  assert.equal(redacted.Authorization, "[REDACTED]");
  assert.equal(redacted.nested.value, "[REDACTED]");
});
