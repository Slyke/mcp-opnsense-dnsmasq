import {
  dhcpAccessBlockSchema,
  dhcpAccessBlocksListSchema,
  dhcpAccessPolicyGetSchema,
  dhcpAccessPolicySetSchema,
  dhcpAccessUnblockSchema
} from "../validators.js";
import {
  buildHostPayload,
  dhcpRangeRawModeFromPolicy,
  normalizeDhcpRange,
  normalizeStaticHost,
  unwrapValue
} from "../normalizers.js";
import { conflictError, notFoundError, validationError } from "../errors.js";
import { normalizeMac, stripControlChars } from "../ipUtils.js";
import { getRanges } from "./dhcpRanges.js";
import { getStaticHostByUuid, getStaticHosts } from "./dhcpStatic.js";
import {
  appendHistory,
  diffRecords,
  getIncludeRaw,
  makeToolHandler,
  matchesCommonFilters,
  reconfigureDnsmasqIfRequested
} from "./shared.js";

const normalizeClientId = ({ value }) => String(value ?? "").trim().toLowerCase();

const validateLookup = ({ args }) => {
  const lookup = {
    uuid: stripControlChars({ value: args.uuid }),
    macAddress: args.mac_address ? normalizeMac({ value: args.mac_address }) : "",
    clientId: normalizeClientId({ value: args.client_id })
  };
  if (!lookup.uuid && !lookup.macAddress && !lookup.clientId) {
    return { ok: false, error: validationError({ message: "One of uuid, mac_address, or client_id is required." }) };
  }
  if (args.mac_address && !lookup.macAddress) {
    return { ok: false, error: validationError({ message: "mac_address must be a valid MAC address." }) };
  }
  return { ok: true, lookup };
};

const findHost = async ({ context, args, includeRaw, requestId }) => {
  const validated = validateLookup({ args });
  if (!validated.ok) return validated;
  const { uuid, macAddress, clientId } = validated.lookup;
  if (uuid) {
    return { ok: true, host: await getStaticHostByUuid({ context, uuid, includeRaw, requestId }), lookup: validated.lookup };
  }
  const rows = await getStaticHosts({
    context,
    args: { include_disabled: true, limit: 5000, include_raw: includeRaw },
    requestId
  });
  const matches = rows.filter((row) => {
    return (macAddress && row.hw_address === macAddress) ||
      (clientId && normalizeClientId({ value: row.client_id }) === clientId);
  });
  if (matches.length > 1) {
    return { ok: false, error: conflictError({ message: "Multiple Dnsmasq host entries matched this DHCP client lookup.", details: { matches } }) };
  }
  return { ok: true, host: matches[0] ?? null, lookup: validated.lookup };
};

const blockRecord = ({ args, lookup }) => ({
  hostname: args.hostname ?? "",
  ip_address: "",
  hw_address: lookup.macAddress ?? "",
  client_id: lookup.clientId ?? "",
  domain: "",
  description: args.description ?? "Blocked by MCP DHCP access policy",
  aliases: [],
  cnames: [],
  lease_time: "",
  local: false,
  ignore: true,
  set_tag: ""
});

const blockMatches = ({ host, args }) => {
  if (!matchesCommonFilters({ row: host, args })) return false;
  if (args.uuid && host.uuid !== args.uuid) return false;
  if (args.client_id && normalizeClientId({ value: host.client_id }) !== normalizeClientId({ value: args.client_id })) return false;
  return true;
};

const summarizePolicy = ({ ranges }) => {
  const modes = [...new Set(ranges.map((range) => range.policy_mode))];
  return {
    mode: modes.length === 1 ? modes[0] : "mixed",
    ranges_total: ranges.length,
    whitelist_ranges: ranges.filter((range) => range.policy_mode === "whitelist").length,
    blacklist_ranges: ranges.filter((range) => range.policy_mode === "blacklist").length
  };
};

const targetRanges = async ({ context, args, requestId }) => {
  const ranges = await getRanges({ context, args: { uuid: args.uuid, interface: args.interface, limit: 5000, include_raw: args.include_raw }, requestId });
  return ranges.length === 0
    ? { ok: false, error: notFoundError({ message: "No matching Dnsmasq DHCP ranges were found." }) }
    : { ok: true, ranges };
};

export const registerDhcpAccessTools = ({ server, context }) => {
  server.registerTool(
    "dhcp_access_blocks_list",
    {
      description: "List Dnsmasq host entries that block DHCP clients with ignore=true.",
      inputSchema: dhcpAccessBlocksListSchema,
      annotations: { readOnlyHint: true }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_access_blocks_list",
      handler: async ({ args, context: toolContext, requestId }) => {
        const hosts = await getStaticHosts({ context: toolContext, args: { ...args, include_disabled: true, limit: args.limit ?? 500 }, requestId });
        return { ok: true, blocks: hosts.filter((host) => host.ignore).filter((host) => blockMatches({ host, args })) };
      }
    })
  );

  server.registerTool(
    "dhcp_access_block",
    {
      description: "Block one DHCP client by host UUID, MAC address, or DHCP client ID.",
      inputSchema: dhcpAccessBlockSchema,
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_access_block",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        const includeRaw = getIncludeRaw({ args, config: toolContext.config });
        const found = await findHost({ context: toolContext, args, includeRaw, requestId });
        if (!found.ok) return found.error;
        const before = found.host;
        const record = before ? { ...before, ignore: true, description: args.description ?? before.description } : blockRecord({ args, lookup: found.lookup });
        const payload = buildHostPayload({ record });
        const after = normalizeStaticHost({ value: { host: { uuid: before?.uuid ?? "", ...payload } }, include_raw: includeRaw });
        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;
        if (!args.apply) {
          appendHistory({ context: toolContext, toolName: "dhcp_access_block", identity, requestId, action: before ? "plan_update_block" : "plan_create_block", applied: false, ok: true, target: { uuid: before?.uuid, mac_address: args.mac_address, client_id: args.client_id } });
          return { ok: true, applied: false, action: before ? "update_existing_host" : "create_block_host", before, after, planned_payload: payload };
        }
        let uuid = before?.uuid ?? "";
        if (before) {
          await toolContext.opnsense.setHost({ uuid: before.uuid, host: payload, requestId });
        } else {
          const raw = await toolContext.opnsense.addHost({ host: payload, requestId });
          uuid = raw.uuid ?? raw.host?.uuid ?? raw.result?.uuid ?? "";
        }
        const reconfigured = await reconfigureDnsmasqIfRequested({ context: toolContext, reconfigure, requestId });
        appendHistory({ context: toolContext, toolName: "dhcp_access_block", identity, requestId, action: before ? "update_block" : "create_block", applied: true, ok: true, target: { uuid, mac_address: args.mac_address, client_id: args.client_id } });
        return { ok: true, applied: true, reconfigured, uuid, before, after };
      }
    })
  );

  server.registerTool(
    "dhcp_access_unblock",
    {
      description: "Unblock one DHCP client by host UUID, MAC address, or DHCP client ID.",
      inputSchema: dhcpAccessUnblockSchema,
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_access_unblock",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        const includeRaw = getIncludeRaw({ args, config: toolContext.config });
        const found = await findHost({ context: toolContext, args, includeRaw, requestId });
        if (!found.ok) return found.error;
        if (!found.host) return notFoundError({ message: "No matching Dnsmasq host entry was found for this DHCP client." });
        const before = found.host;
        const shouldDelete = args.delete_block_only !== false && before.is_block_only;
        const after = shouldDelete ? null : { ...before, ignore: false, is_blocked: false, is_block_only: false };
        const payload = after ? buildHostPayload({ record: after }) : null;
        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;
        if (!args.apply) {
          appendHistory({ context: toolContext, toolName: "dhcp_access_unblock", identity, requestId, action: shouldDelete ? "plan_delete_block" : "plan_update_unblock", applied: false, ok: true, target: { uuid: before.uuid, mac_address: args.mac_address, client_id: args.client_id } });
          return { ok: true, applied: false, action: shouldDelete ? "delete_block_only_host" : "update_existing_host", before, after, planned_payload: payload };
        }
        if (shouldDelete) await toolContext.opnsense.deleteHost({ uuid: before.uuid, requestId });
        else await toolContext.opnsense.setHost({ uuid: before.uuid, host: payload, requestId });
        const reconfigured = await reconfigureDnsmasqIfRequested({ context: toolContext, reconfigure, requestId });
        appendHistory({ context: toolContext, toolName: "dhcp_access_unblock", identity, requestId, action: shouldDelete ? "delete_block" : "update_unblock", applied: true, ok: true, target: { uuid: before.uuid, mac_address: args.mac_address, client_id: args.client_id } });
        return { ok: true, applied: true, reconfigured, action: shouldDelete ? "deleted_block_only_host" : "updated_existing_host", before, after };
      }
    })
  );

  server.registerTool(
    "dhcp_access_policy_get",
    {
      description: "Summarize DHCP range access mode as blacklist, whitelist, or mixed.",
      inputSchema: dhcpAccessPolicyGetSchema,
      annotations: { readOnlyHint: true }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_access_policy_get",
      handler: async ({ args, context: toolContext, requestId }) => {
        const targets = await targetRanges({ context: toolContext, args, requestId });
        return targets.ok ? { ok: true, policy: summarizePolicy({ ranges: targets.ranges }), ranges: targets.ranges } : targets.error;
      }
    })
  );

  server.registerTool(
    "dhcp_access_policy_set",
    {
      description: "Set DHCP ranges to blacklist mode (dynamic clients allowed except ignored hosts) or whitelist mode (static-only ranges).",
      inputSchema: dhcpAccessPolicySetSchema,
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_access_policy_set",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        if (!args.uuid && !args.interface && args.apply && args.confirm_all_ranges !== true) {
          return validationError({ message: "confirm_all_ranges must be true when applying a DHCP policy mode to all ranges." });
        }
        const targets = await targetRanges({ context: toolContext, args, requestId });
        if (!targets.ok) return targets.error;
        const includeRaw = getIncludeRaw({ args, config: toolContext.config });
        const rawMode = dhcpRangeRawModeFromPolicy({ policyMode: args.mode });
        const planned = [];
        for (const range of targets.ranges) {
          const rawBefore = await toolContext.opnsense.getRange({ uuid: range.uuid, requestId });
          const current = unwrapValue({ value: rawBefore, keys: ["range"] }) ?? {};
          const payload = { ...current, mode: rawMode };
          delete payload.uuid;
          delete payload._uuid;
          delete payload.id;
          const before = normalizeDhcpRange({ value: rawBefore, include_raw: includeRaw });
          const after = normalizeDhcpRange({ value: { range: { uuid: range.uuid, ...payload } }, include_raw: includeRaw });
          planned.push({ uuid: range.uuid, before, after, diff: diffRecords({ before, after }), payload });
        }
        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;
        if (!args.apply) {
          appendHistory({ context: toolContext, toolName: "dhcp_access_policy_set", identity, requestId, action: "plan_policy_set", applied: false, ok: true, target: { mode: args.mode, uuid: args.uuid, interface: args.interface, range_count: planned.length } });
          return { ok: true, applied: false, policy: { requested_mode: args.mode, before: summarizePolicy({ ranges: planned.map((entry) => entry.before) }), after: summarizePolicy({ ranges: planned.map((entry) => entry.after) }) }, ranges: planned };
        }
        for (const entry of planned) await toolContext.opnsense.setRange({ uuid: entry.uuid, range: entry.payload, requestId });
        const reconfigured = await reconfigureDnsmasqIfRequested({ context: toolContext, reconfigure, requestId });
        appendHistory({ context: toolContext, toolName: "dhcp_access_policy_set", identity, requestId, action: "policy_set", applied: true, ok: true, target: { mode: args.mode, uuid: args.uuid, interface: args.interface, range_count: planned.length } });
        return { ok: true, applied: true, reconfigured, policy: { requested_mode: args.mode, before: summarizePolicy({ ranges: planned.map((entry) => entry.before) }), after: summarizePolicy({ ranges: planned.map((entry) => entry.after) }) }, ranges: planned.map(({ payload, ...entry }) => entry) };
      }
    })
  );
};
