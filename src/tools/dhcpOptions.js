import { dhcpOptionGetSchema, dhcpOptionsSearchSchema } from "../validators.js";
import { extractRows, normalizeDhcpOption } from "../normalizers.js";
import { makeToolHandler, getIncludeRaw, matchesCommonFilters } from "./shared.js";

const optionMatchesFilters = ({ option, args }) => {
  if (!matchesCommonFilters({ row: option, args })) {
    return false;
  }

  if (args.type && option.type !== args.type) {
    return false;
  }

  if (args.tag && !option.tag.includes(args.tag)) {
    return false;
  }

  if (args.set_tag && option.set_tag !== args.set_tag) {
    return false;
  }

  if (args.option && option.option !== args.option && option.option6 !== args.option) {
    return false;
  }

  if (args.value && !String(option.value ?? "").toLowerCase().includes(String(args.value).toLowerCase())) {
    return false;
  }

  if (
    args.description &&
    !String(option.description ?? "").toLowerCase().includes(String(args.description).toLowerCase())
  ) {
    return false;
  }

  return true;
};

export const getDhcpOptions = async ({ context, args = {}, requestId }) => {
  const tags = [args.tag, args.set_tag].filter(Boolean);
  const raw = await context.opnsense.searchOptions({
    body: {
      searchPhrase: args.query ?? "",
      rowCount: args.limit ?? 500,
      ...(tags.length > 0 ? { tags } : {})
    },
    requestId
  });
  const includeRaw = getIncludeRaw({ args, config: context.config });

  return extractRows({ value: raw })
    .map((row) => normalizeDhcpOption({ value: row, include_raw: includeRaw }))
    .filter((option) => optionMatchesFilters({ option, args }))
    .slice(0, args.limit ?? 500);
};

export const getDhcpOptionByUuid = async ({ context, uuid, includeRaw = false, requestId }) => {
  const raw = await context.opnsense.getOption({
    uuid,
    requestId
  });

  return normalizeDhcpOption({
    value: raw,
    include_raw: includeRaw
  });
};

export const registerDhcpOptionTools = ({ server, context }) => {
  server.registerTool(
    "dhcp_options_list",
    {
      description: "List Dnsmasq DHCP options.",
      inputSchema: dhcpOptionsSearchSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_options_list",
      handler: async ({ args, context: toolContext, requestId }) => {
        const options = await getDhcpOptions({
          context: toolContext,
          args,
          requestId
        });

        return {
          ok: true,
          options
        };
      }
    })
  );

  server.registerTool(
    "dhcp_options_search",
    {
      description: "Search Dnsmasq DHCP options by text, interface, tag, type, option code, or value.",
      inputSchema: dhcpOptionsSearchSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_options_search",
      handler: async ({ args, context: toolContext, requestId }) => {
        const options = await getDhcpOptions({
          context: toolContext,
          args,
          requestId
        });

        return {
          ok: true,
          options
        };
      }
    })
  );

  server.registerTool(
    "dhcp_options_get",
    {
      description: "Get one Dnsmasq DHCP option by UUID.",
      inputSchema: dhcpOptionGetSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_options_get",
      handler: async ({ args, context: toolContext, requestId }) => {
        const option = await getDhcpOptionByUuid({
          context: toolContext,
          uuid: args.uuid,
          includeRaw: getIncludeRaw({ args, config: toolContext.config }),
          requestId
        });

        return {
          ok: true,
          option
        };
      }
    })
  );
};
