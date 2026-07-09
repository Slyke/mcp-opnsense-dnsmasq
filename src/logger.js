import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { debugAndErrors } = require("./logger.cjs");
const errorCodeMap = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "errors.json"), "utf8"));

const SECRET_KEY_PATTERN = /authorization|token|secret|api[_-]?key|password/i;

const redactString = ({ value, secrets }) => {
  let redacted = String(value);

  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }

  redacted = redacted.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]");
  redacted = redacted.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
  return redacted;
};

export const createRedactor = ({ config }) => {
  const tokenSecrets = [
    ...config.auth.readTokens.map((entry) => entry.token),
    ...config.auth.readWriteTokens.map((entry) => entry.token)
  ];
  const secrets = [
    config.opnsense.apiKey,
    config.opnsense.apiSecret,
    ...tokenSecrets
  ].filter(Boolean);

  const redact = ({ value }) => {
    if (value === undefined || value === null) {
      return value;
    }

    if (typeof value === "string") {
      return redactString({ value, secrets });
    }

    if (value instanceof Error) {
      const redactedError = new Error(redactString({ value: value.message, secrets }));
      redactedError.name = value.name;
      return redactedError;
    }

    if (Array.isArray(value)) {
      return value.map((item) => redact({ value: item }));
    }

    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [
          key,
          SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redact({ value: nested })
        ])
      );
    }

    return value;
  };

  return redact;
};

export const createLogger = ({ config }) => {
  const baseLogger = debugAndErrors({
    settings: {
      logging: config.logging
    },
    errorCodeMap
  });
  const redact = createRedactor({ config });

  return {
    generateLog: (entry = {}) => {
      return baseLogger.generateLog({
        ...entry,
        message: entry.message ? redact({ value: entry.message }) : entry.message,
        context: redact({ value: entry.context }),
        error: redact({ value: entry.error })
      });
    },
    generateError: (entry = {}) => {
      return baseLogger.generateError({
        ...entry,
        reason: entry.reason ? redact({ value: entry.reason }) : entry.reason,
        err: redact({ value: entry.err }),
        context: redact({ value: entry.context })
      });
    },
    wrapError: (entry = {}) => {
      return baseLogger.wrapError({
        ...entry,
        reason: entry.reason ? redact({ value: entry.reason }) : entry.reason,
        err: redact({ value: entry.err }),
        context: redact({ value: entry.context })
      });
    },
    redact
  };
};
