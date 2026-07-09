import { randomUUID } from "node:crypto";
import { hasWriteScope } from "../auth.js";
import { readOnlyError, authError, unknownError, toMcpResult } from "../errors.js";
import { normalizeMac, normalizeIpv4 } from "../ipUtils.js";

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

export const requireWriteAccess = ({ config, identity }) => {
  if (config.readOnly) {
    return readOnlyError({
      message: "This MCP server is configured as read-only."
    });
  }

  if (!hasWriteScope({ identity })) {
    return authError({
      message: "Bearer token is not allowed to call mutating tools."
    });
  }

  return null;
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
          config: context.config,
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

      return toMcpResult({
        payload: unknownError({
          message: "Tool execution failed.",
          details: {
            tool_name: toolName
          }
        })
      });
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
  const ipAddress = args.ip_address ? normalizeIpv4({ value: args.ip_address }) : "";
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
