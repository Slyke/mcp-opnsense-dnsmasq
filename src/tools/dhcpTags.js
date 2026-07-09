import {
  dhcpTagDeleteSchema,
  dhcpTagGetSchema,
  dhcpTagSearchSchema,
  dhcpTagUpdateSchema
} from "../validators.js";
import { extractRows, normalizeDhcpTag } from "../normalizers.js";
import {
  appendHistory,
  diffRecords,
  getIncludeRaw,
  makeToolHandler,
  reconfigureDnsmasqIfRequested
} from "./shared.js";
import { validationError } from "../errors.js";

const tagMatchesFilters = ({ tag, args }) => {
  const query = String(args.query ?? "").trim().toLowerCase();
  if (args.uuid && tag.uuid !== args.uuid) return false;
  if (args.tag && String(tag.tag ?? "").toLowerCase() !== String(args.tag).toLowerCase()) return false;
  return query ? JSON.stringify(tag).toLowerCase().includes(query) : true;
};

export const getDhcpTags = async ({ context, args = {}, requestId }) => {
  const raw = await context.opnsense.searchTags({
    body: { searchPhrase: args.query ?? "", rowCount: args.limit ?? 500 },
    requestId
  });
  const includeRaw = getIncludeRaw({ args, config: context.config });
  return extractRows({ value: raw })
    .map((row) => normalizeDhcpTag({ value: row, include_raw: includeRaw }))
    .filter((tag) => tagMatchesFilters({ tag, args }))
    .slice(0, args.limit ?? 500);
};

export const getDhcpTagByUuid = async ({ context, uuid, includeRaw = false, requestId }) => {
  const raw = await context.opnsense.getTag({ uuid, requestId });
  return normalizeDhcpTag({ value: raw, include_raw: includeRaw });
};

export const registerDhcpTagTools = ({ server, context }) => {
  for (const [name, description] of [
    ["dhcp_tags_list", "List Dnsmasq DHCP tags."],
    ["dhcp_tags_search", "Search Dnsmasq DHCP tags by text, UUID, or tag name."]
  ]) {
    server.registerTool(
      name,
      { description, inputSchema: dhcpTagSearchSchema, annotations: { readOnlyHint: true } },
      makeToolHandler({
        context,
        toolName: name,
        handler: async ({ args, context: toolContext, requestId }) => ({
          ok: true,
          tags: await getDhcpTags({ context: toolContext, args, requestId })
        })
      })
    );
  }

  server.registerTool(
    "dhcp_tags_get",
    {
      description: "Get one Dnsmasq DHCP tag by UUID.",
      inputSchema: dhcpTagGetSchema,
      annotations: { readOnlyHint: true }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_tags_get",
      handler: async ({ args, context: toolContext, requestId }) => ({
        ok: true,
        tag: await getDhcpTagByUuid({
          context: toolContext,
          uuid: args.uuid,
          includeRaw: getIncludeRaw({ args, config: toolContext.config }),
          requestId
        })
      })
    })
  );

  server.registerTool(
    "dhcp_tags_update",
    {
      description: "Update a Dnsmasq DHCP tag name.",
      inputSchema: dhcpTagUpdateSchema,
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_tags_update",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        const includeRaw = getIncludeRaw({ args, config: toolContext.config });
        const before = await getDhcpTagByUuid({ context: toolContext, uuid: args.uuid, includeRaw, requestId });
        const payload = { tag: args.tag };
        const after = normalizeDhcpTag({ value: { tag: { uuid: args.uuid, ...payload } }, include_raw: includeRaw });
        const diff = diffRecords({ before, after });
        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;
        if (!args.apply) {
          appendHistory({ context: toolContext, toolName: "dhcp_tags_update", identity, requestId, action: "plan_update", applied: false, ok: true, target: { uuid: args.uuid } });
          return { ok: true, applied: false, before, after, diff, planned_payload: payload };
        }
        await toolContext.opnsense.setTag({ uuid: args.uuid, tag: payload, requestId });
        const reconfigured = await reconfigureDnsmasqIfRequested({ context: toolContext, reconfigure, requestId });
        appendHistory({ context: toolContext, toolName: "dhcp_tags_update", identity, requestId, action: "update", applied: true, ok: true, target: { uuid: args.uuid } });
        return { ok: true, applied: true, reconfigured, before, after, diff };
      }
    })
  );

  server.registerTool(
    "dhcp_tags_delete",
    {
      description: "Delete a Dnsmasq DHCP tag.",
      inputSchema: dhcpTagDeleteSchema,
      annotations: { readOnlyHint: false, destructiveHint: true }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_tags_delete",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        if (args.confirm !== true) return validationError({ message: "confirm must be true to delete a Dnsmasq DHCP tag." });
        const deleted = await getDhcpTagByUuid({ context: toolContext, uuid: args.uuid, requestId });
        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;
        if (!args.apply) {
          appendHistory({ context: toolContext, toolName: "dhcp_tags_delete", identity, requestId, action: "plan_delete", applied: false, ok: true, target: { uuid: args.uuid } });
          return { ok: true, applied: false, planned_delete: deleted };
        }
        await toolContext.opnsense.deleteTag({ uuid: args.uuid, requestId });
        const reconfigured = await reconfigureDnsmasqIfRequested({ context: toolContext, reconfigure, requestId });
        appendHistory({ context: toolContext, toolName: "dhcp_tags_delete", identity, requestId, action: "delete", applied: true, ok: true, target: { uuid: args.uuid } });
        return { ok: true, applied: true, reconfigured, deleted };
      }
    })
  );
};
