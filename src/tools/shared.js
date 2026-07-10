import { randomUUID } from "node:crypto";
import { hasWriteScope } from "../auth.js";
import { authError, unknownError, toMcpResult } from "../errors.js";
import { normalizeMac, normalizeIpAddress } from "../ipUtils.js";

export const createRequestId = () => {
  return randomUUID();
};

export const getIdentity = ({ extra }) => {
  return {
    name: extra?.authInfo?.clientId ?? "unknown",
    role: extra?.authInfo?.scopes?.includes("write") ? "readwrite" : "read",
    scopes: extra?.authInfo?.scopes ?? []
  };
};

export const requireWriteAccess = ({ identity }) => {
  if (!hasWriteScope({ identity })) {
    return authError({
      message: "Bearer token is not allowed to call mutating tools."
    });
  }

  return null;
};

const READ_RESULT_ARRAY_KEYS = [
  "arp",
  "devices",
  "history",
  "hosts",
  "observations",
  "pairings",
  "leases",
  "options",
  "poll_runs",
  "ranges"
];

const redactForHistory = ({ context, value }) => {
  if (typeof context.logger?.redact !== "function") {
    return value;
  }

  return context.logger.redact({ value });
};

const readResultSummary = ({ payload }) => {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  if (Array.isArray(payload)) {
    return {
      result_count: payload.length
    };
  }

  for (const key of READ_RESULT_ARRAY_KEYS) {
    if (Array.isArray(payload[key])) {
      return {
        result_field: key,
        result_count: payload[key].length
      };
    }
  }

  if (payload.error?.code) {
    return {
      error_code: payload.error.code
    };
  }

  return {};
};

const appendReadHistory = ({ context, toolName, identity, requestId, args, payload }) => {
  if (!context.config.historyRecordReads) {
    return;
  }

  const argsTarget = args && typeof args === "object" && Object.keys(args).length > 0
    ? { args: redactForHistory({ context, value: args }) }
    : {};

  try {
    context.history.append({
      toolName,
      identityName: identity.name,
      action: "read",
      applied: false,
      ok: payload?.ok !== false,
      requestId,
      target: {
        ...argsTarget,
        ...readResultSummary({ payload })
      }
    });
  } catch (err) {
    context.logger.generateLog({
      level: "warn",
      caller: "tools::" + toolName,
      loggerKey: "MCP_HISTORY_APPEND_FAILED",
      message: "Failed to append read tool history.",
      correlationId: requestId,
      error: err
    });
  }
};

export const makeToolHandler = ({ context, toolName, mutating = false, handler }) => {
  return async (args, extra) => {
    const requestId = createRequestId();
    const identity = getIdentity({ extra });

    context.logger.generateLog({
      level: "info",
      caller: `tools::${toolName}`,
      loggerKey: "MCP_TOOL_CALL",
      message: "MCP tool called.",
      correlationId: requestId,
      context: {
        request_id: requestId,
        tool_name: toolName,
        identity_name: identity.name,
        role: identity.role
      }
    });

    try {
      if (mutating) {
        const writeError = requireWriteAccess({
          identity
        });

        if (writeError) {
          context.history.append({
            toolName,
            identityName: identity.name,
            action: "blocked",
            applied: false,
            ok: false,
            requestId
          });
          return toMcpResult({ payload: writeError });
        }
      }

      const payload = await handler({
        args,
        extra,
        context,
        identity,
        requestId
      });

      if (!mutating) {
        appendReadHistory({ context, toolName, identity, requestId, args, payload });
      }

      return toMcpResult({ payload });
    } catch (err) {
      context.logger.generateError({
        caller: `tools::${toolName}`,
        reason: "Tool execution failed.",
        errorKey: "MCP_TOOL_FAILED",
        err,
        includeStackTrace: false,
        correlationId: requestId,
        context: {
          request_id: requestId,
          tool_name: toolName,
          identity_name: identity.name
        }
      });

      const payload = unknownError({
        message: "Tool execution failed.",
        details: {
          tool_name: toolName
        }
      });

      if (!mutating) {
        appendReadHistory({ context, toolName, identity, requestId, args, payload });
      }

      return toMcpResult({ payload });
    }
  };
};

export const textIncludes = ({ value, query }) => {
  if (!query) {
    return true;
  }

  return String(value ?? "").toLowerCase().includes(String(query).toLowerCase());
};

export const matchesCommonFilters = ({ row, args }) => {
  const query = String(args.query ?? "").trim().toLowerCase();
  const ipAddress = args.ip_address ? normalizeIpAddress({ value: args.ip_address }) : "";
  const macAddress = args.mac_address ? normalizeMac({ value: args.mac_address }) : "";

  if (ipAddress && row.ip_address !== ipAddress) {
    return false;
  }

  if (macAddress && row.mac_address !== macAddress && row.hw_address !== macAddress) {
    return false;
  }

  if (args.hostname && String(row.hostname ?? "").toLowerCase() !== String(args.hostname).toLowerCase()) {
    return false;
  }

  if (args.interface && String(row.interface ?? "").toLowerCase() !== String(args.interface).toLowerCase()) {
    return false;
  }

  if (!query) {
    return true;
  }

  return JSON.stringify(row).toLowerCase().includes(query);
};

export const getIncludeRaw = ({ args, config }) => {
  return args.include_raw ?? config.includeRawDefault;
};


export const diffRecords = ({ before, after }) => {
  return Object.fromEntries(
    Object.keys(after)
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => [key, {
        before: before[key],
        after: after[key]
      }])
  );
};

export const reconfigureDnsmasqIfRequested = async ({ context, reconfigure, requestId }) => {
  if (!reconfigure) {
    return false;
  }

  await context.opnsense.reconfigureDnsmasq({ requestId });
  return true;
};

export const appendHistory = ({ context, toolName, identity, requestId, action, applied, ok, target }) => {
  return context.history.append({
    toolName,
    identityName: identity.name,
    requestId,
    action,
    applied,
    ok,
    target
  });
};
