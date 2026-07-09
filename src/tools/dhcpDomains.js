import {
  dhcpDomainDeleteSchema,
  dhcpDomainGetSchema,
  dhcpDomainSearchSchema,
  dhcpDomainUpdateSchema
} from "../validators.js";
import { extractRows, normalizeDhcpDomain, unwrapValue } from "../normalizers.js";
import {
  appendHistory,
  diffRecords,
  getIncludeRaw,
  makeToolHandler,
  reconfigureDnsmasqIfRequested
} from "./shared.js";
import { validationError } from "../errors.js";

const clean = (value) => {
  const copy = { ...(value ?? {}) };
  delete copy.uuid;
  delete copy._uuid;
  delete copy.id;
  return copy;
};

const matches = ({ domain, args }) => {
  const query = String(args.query ?? "").trim().toLowerCase();
  if (args.uuid && domain.uuid !== args.uuid) return false;
  if (args.domain && String(domain.domain ?? "").toLowerCase() !== String(args.domain).toLowerCase()) return false;
  if (args.ip && String(domain.ip ?? "").toLowerCase() !== String(args.ip).toLowerCase()) return false;
  if (args.srcip && String(domain.srcip ?? "").toLowerCase() !== String(args.srcip).toLowerCase()) return false;
  if (args.description && !String(domain.description ?? "").toLowerCase().includes(String(args.description).toLowerCase())) return false;
  return query ? JSON.stringify(domain).toLowerCase().includes(query) : true;
};

export const getDhcpDomains = async ({ context, args = {}, requestId }) => {
  const raw = await context.opnsense.searchDomains({
    body: { searchPhrase: args.query ?? "", rowCount: args.limit ?? 500 },
    requestId
  });
  const includeRaw = getIncludeRaw({ args, config: context.config });
  return extractRows({ value: raw })
    .map((row) => normalizeDhcpDomain({ value: row, include_raw: includeRaw }))
    .filter((domain) => matches({ domain, args }))
    .slice(0, args.limit ?? 500);
};

export const getDhcpDomainByUuid = async ({ context, uuid, includeRaw = false, requestId }) => {
  const raw = await context.opnsense.getDomain({ uuid, requestId });
  return normalizeDhcpDomain({ value: raw, include_raw: includeRaw });
};

const buildPayload = ({ current, args }) => {
  const payload = clean(unwrapValue({ value: current, keys: ["domainoverride"] }) ?? {});
  const assign = (key, value) => {
    if (value !== undefined) payload[key] = value;
  };
  assign("sequence", args.sequence);
  assign("domain", args.domain);
  assign("ipset", args.ipset);
  assign("srcip", args.srcip);
  assign("port", args.port);
  assign("ip", args.ip);
  assign("descr", args.description);
  return payload;
};

export const registerDhcpDomainTools = ({ server, context }) => {
  for (const [name, description] of [
    ["dhcp_domains_list", "List Dnsmasq domain overrides."],
    ["dhcp_domains_search", "Search Dnsmasq domain overrides by text, UUID, domain, target IP, source IP, or description."]
  ]) {
    server.registerTool(
      name,
      { description, inputSchema: dhcpDomainSearchSchema, annotations: { readOnlyHint: true } },
      makeToolHandler({
        context,
        toolName: name,
        handler: async ({ args, context: toolContext, requestId }) => ({
          ok: true,
          domains: await getDhcpDomains({ context: toolContext, args, requestId })
        })
      })
    );
  }

  server.registerTool(
    "dhcp_domains_get",
    {
      description: "Get one Dnsmasq domain override by UUID.",
      inputSchema: dhcpDomainGetSchema,
      annotations: { readOnlyHint: true }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_domains_get",
      handler: async ({ args, context: toolContext, requestId }) => ({
        ok: true,
        domain: await getDhcpDomainByUuid({
          context: toolContext,
          uuid: args.uuid,
          includeRaw: getIncludeRaw({ args, config: toolContext.config }),
          requestId
        })
      })
    })
  );

  server.registerTool(
    "dhcp_domains_update",
    {
      description: "Update a Dnsmasq domain override.",
      inputSchema: dhcpDomainUpdateSchema,
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_domains_update",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        const includeRaw = getIncludeRaw({ args, config: toolContext.config });
        const rawBefore = await toolContext.opnsense.getDomain({ uuid: args.uuid, requestId });
        const before = normalizeDhcpDomain({ value: rawBefore, include_raw: includeRaw });
        const payload = buildPayload({ current: rawBefore, args });
        const after = normalizeDhcpDomain({ value: { domainoverride: { uuid: args.uuid, ...payload } }, include_raw: includeRaw });
        const diff = diffRecords({ before, after });
        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;
        if (!args.apply) {
          appendHistory({ context: toolContext, toolName: "dhcp_domains_update", identity, requestId, action: "plan_update", applied: false, ok: true, target: { uuid: args.uuid } });
          return { ok: true, applied: false, before, after, diff, planned_payload: payload };
        }
        await toolContext.opnsense.setDomain({ uuid: args.uuid, domain: payload, requestId });
        const reconfigured = await reconfigureDnsmasqIfRequested({ context: toolContext, reconfigure, requestId });
        appendHistory({ context: toolContext, toolName: "dhcp_domains_update", identity, requestId, action: "update", applied: true, ok: true, target: { uuid: args.uuid } });
        return { ok: true, applied: true, reconfigured, before, after, diff };
      }
    })
  );

  server.registerTool(
    "dhcp_domains_delete",
    {
      description: "Delete a Dnsmasq domain override.",
      inputSchema: dhcpDomainDeleteSchema,
      annotations: { readOnlyHint: false, destructiveHint: true }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_domains_delete",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        if (args.confirm !== true) return validationError({ message: "confirm must be true to delete a Dnsmasq domain override." });
        const deleted = await getDhcpDomainByUuid({ context: toolContext, uuid: args.uuid, requestId });
        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;
        if (!args.apply) {
          appendHistory({ context: toolContext, toolName: "dhcp_domains_delete", identity, requestId, action: "plan_delete", applied: false, ok: true, target: { uuid: args.uuid } });
          return { ok: true, applied: false, planned_delete: deleted };
        }
        await toolContext.opnsense.deleteDomain({ uuid: args.uuid, requestId });
        const reconfigured = await reconfigureDnsmasqIfRequested({ context: toolContext, reconfigure, requestId });
        appendHistory({ context: toolContext, toolName: "dhcp_domains_delete", identity, requestId, action: "delete", applied: true, ok: true, target: { uuid: args.uuid } });
        return { ok: true, applied: true, reconfigured, deleted };
      }
    })
  );
};
