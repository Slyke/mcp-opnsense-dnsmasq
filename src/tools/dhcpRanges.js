import {
  dhcpRangeDeleteSchema,
  dhcpRangeGetSchema,
  dhcpRangeSearchSchema,
  dhcpRangeUpdateSchema
} from "../validators.js";
import {
  dhcpRangeRawModeFromPolicy,
  extractRows,
  normalizeDhcpRange,
  unwrapValue
} from "../normalizers.js";
import { normalizeStringList, stripControlChars } from "../ipUtils.js";
import {
  appendHistory,
  diffRecords,
  getIncludeRaw,
  makeToolHandler,
  reconfigureDnsmasqIfRequested
} from "./shared.js";
import { validationError } from "../errors.js";

const removeModelMetadata = ({ value }) => {
  const copy = { ...(value ?? {}) };
  delete copy.uuid;
  delete copy._uuid;
  delete copy.id;
  return copy;
};

const rangeMatchesFilters = ({ range, args }) => {
  const query = String(args.query ?? "").trim().toLowerCase();

  if (args.uuid && range.uuid !== args.uuid) {
    return false;
  }

  if (args.interface && String(range.interface ?? "").toLowerCase() !== String(args.interface).toLowerCase()) {
    return false;
  }

  if (args.mode) {
    const requested = ["whitelist", "static"].includes(args.mode) ? "whitelist" : "blacklist";
    if (range.policy_mode !== requested) {
      return false;
    }
  }

  if (args.domain && String(range.domain ?? "").toLowerCase() !== String(args.domain).toLowerCase()) {
    return false;
  }

  if (
    args.description &&
    !String(range.description ?? "").toLowerCase().includes(String(args.description).toLowerCase())
  ) {
    return false;
  }

  if (!query) {
    return true;
  }

  return JSON.stringify(range).toLowerCase().includes(query);
};

export const getRanges = async ({ context, args = {}, requestId }) => {
  const raw = await context.opnsense.searchRanges({
    body: {
      searchPhrase: args.query ?? "",
      rowCount: args.limit ?? 500
    },
    requestId
  });
  const includeRaw = getIncludeRaw({ args, config: context.config });

  return extractRows({ value: raw })
    .map((row) => normalizeDhcpRange({
      value: row,
      include_raw: includeRaw
    }))
    .filter((range) => rangeMatchesFilters({ range, args }))
    .slice(0, args.limit ?? 500);
};

export const getRangeByUuid = async ({ context, uuid, includeRaw = false, requestId }) => {
  const raw = await context.opnsense.getRange({
    uuid,
    requestId
  });

  return normalizeDhcpRange({
    value: raw,
    include_raw: includeRaw
  });
};

export const buildRangePayload = ({ current = {}, args = {} }) => {
  const range = unwrapValue({ value: current, keys: ["range"] }) ?? current ?? {};
  const payload = removeModelMetadata({ value: range });
  const assign = ({ key, value }) => {
    if (value !== undefined) {
      payload[key] = value;
    }
  };

  assign({ key: "interface", value: args.interface });
  assign({ key: "set_tag", value: args.set_tag });
  assign({ key: "start_addr", value: args.start_address });
  assign({ key: "end_addr", value: args.end_address });
  assign({ key: "subnet_mask", value: args.subnet_mask });
  assign({ key: "constructor", value: args.constructor });
  if (args.mode !== undefined) {
    payload.mode = dhcpRangeRawModeFromPolicy({ policyMode: args.mode });
  }
  assign({ key: "prefix_len", value: args.prefix_len });
  assign({ key: "lease_time", value: args.lease_time });
  assign({ key: "domain_type", value: args.domain_type });
  assign({ key: "domain", value: args.domain });
  if (args.nosync !== undefined) {
    payload.nosync = args.nosync ? "1" : "0";
  }
  if (args.ra_mode !== undefined) {
    payload.ra_mode = normalizeStringList({ value: args.ra_mode }).join(",");
  }
  assign({ key: "ra_priority", value: args.ra_priority });
  assign({ key: "ra_mtu", value: args.ra_mtu });
  assign({ key: "ra_interval", value: args.ra_interval });
  assign({ key: "ra_router_lifetime", value: args.ra_router_lifetime });
  if (args.description !== undefined) {
    payload.description = stripControlChars({ value: args.description });
  }

  return payload;
};

export const registerDhcpRangeTools = ({ server, context }) => {
  server.registerTool(
    "dhcp_ranges_list",
    {
      description: "List Dnsmasq DHCP ranges.",
      inputSchema: dhcpRangeSearchSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_ranges_list",
      handler: async ({ args, context: toolContext, requestId }) => {
        const ranges = await getRanges({ context: toolContext, args, requestId });
        return { ok: true, ranges };
      }
    })
  );

  server.registerTool(
    "dhcp_ranges_search",
    {
      description: "Search Dnsmasq DHCP ranges by text, UUID, interface, domain, or blacklist/whitelist mode.",
      inputSchema: dhcpRangeSearchSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_ranges_search",
      handler: async ({ args, context: toolContext, requestId }) => {
        const ranges = await getRanges({ context: toolContext, args, requestId });
        return { ok: true, ranges };
      }
    })
  );

  server.registerTool(
    "dhcp_ranges_get",
    {
      description: "Get one Dnsmasq DHCP range by UUID.",
      inputSchema: dhcpRangeGetSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_ranges_get",
      handler: async ({ args, context: toolContext, requestId }) => {
        const range = await getRangeByUuid({
          context: toolContext,
          uuid: args.uuid,
          includeRaw: getIncludeRaw({ args, config: toolContext.config }),
          requestId
        });
        return { ok: true, range };
      }
    })
  );

  server.registerTool(
    "dhcp_ranges_update",
    {
      description: "Update a Dnsmasq DHCP range, including mode blacklist/dynamic or whitelist/static.",
      inputSchema: dhcpRangeUpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_ranges_update",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        const includeRaw = getIncludeRaw({ args, config: toolContext.config });
        const rawBefore = await toolContext.opnsense.getRange({ uuid: args.uuid, requestId });
        const before = normalizeDhcpRange({ value: rawBefore, include_raw: includeRaw });
        const payload = buildRangePayload({ current: rawBefore, args });
        const after = normalizeDhcpRange({ value: { range: { uuid: args.uuid, ...payload } }, include_raw: includeRaw });
        const diff = diffRecords({ before, after });
        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;

        if (!args.apply) {
          appendHistory({
            context: toolContext,
            toolName: "dhcp_ranges_update",
            identity,
            requestId,
            action: "plan_update",
            applied: false,
            ok: true,
            target: { uuid: args.uuid }
          });
          return { ok: true, applied: false, before, after, diff, planned_payload: payload };
        }

        await toolContext.opnsense.setRange({ uuid: args.uuid, range: payload, requestId });
        const reconfigured = await reconfigureDnsmasqIfRequested({ context: toolContext, reconfigure, requestId });
        appendHistory({
          context: toolContext,
          toolName: "dhcp_ranges_update",
          identity,
          requestId,
          action: "update",
          applied: true,
          ok: true,
          target: { uuid: args.uuid }
        });
        return { ok: true, applied: true, reconfigured, before, after, diff };
      }
    })
  );

  server.registerTool(
    "dhcp_ranges_delete",
    {
      description: "Delete a Dnsmasq DHCP range.",
      inputSchema: dhcpRangeDeleteSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_ranges_delete",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        if (args.confirm !== true) {
          return validationError({ message: "confirm must be true to delete a Dnsmasq DHCP range." });
        }

        const deleted = await getRangeByUuid({ context: toolContext, uuid: args.uuid, requestId });
        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;

        if (!args.apply) {
          appendHistory({
            context: toolContext,
            toolName: "dhcp_ranges_delete",
            identity,
            requestId,
            action: "plan_delete",
            applied: false,
            ok: true,
            target: { uuid: args.uuid }
          });
          return { ok: true, applied: false, planned_delete: deleted };
        }

        await toolContext.opnsense.deleteRange({ uuid: args.uuid, requestId });
        const reconfigured = await reconfigureDnsmasqIfRequested({ context: toolContext, reconfigure, requestId });
        appendHistory({
          context: toolContext,
          toolName: "dhcp_ranges_delete",
          identity,
          requestId,
          action: "delete",
          applied: true,
          ok: true,
          target: { uuid: args.uuid }
        });
        return { ok: true, applied: true, reconfigured, deleted };
      }
    })
  );
};
