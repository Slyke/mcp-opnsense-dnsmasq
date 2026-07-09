import { leasesSearchSchema } from "../validators.js";
import { extractRows, normalizeLease } from "../normalizers.js";
import { makeToolHandler, matchesCommonFilters, getIncludeRaw } from "./shared.js";

export const getLeases = async ({ context, args = {}, requestId }) => {
  const raw = await context.opnsense.searchLeases({
    body: {
      searchPhrase: args.query ?? "",
      rowCount: args.limit ?? 100
    },
    requestId
  });
  const includeRaw = getIncludeRaw({ args, config: context.config });

  return extractRows({ value: raw })
    .map((row) => normalizeLease({ value: row, include_raw: includeRaw }))
    .filter((row) => matchesCommonFilters({ row, args }))
    .filter((row) => (args.only_static ? row.is_static : true))
    .filter((row) => (args.only_dynamic ? !row.is_static : true))
    .slice(0, args.limit ?? 100);
};

export const registerDhcpLeaseTools = ({ server, context }) => {
  server.registerTool(
    "dhcp_leases_search",
    {
      description: "Search active and recent Dnsmasq DHCP leases.",
      inputSchema: leasesSearchSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_leases_search",
      handler: async ({ args, context: toolContext, requestId }) => {
        const rows = await getLeases({
          context: toolContext,
          args,
          requestId
        });

        return {
          ok: true,
          leases: rows
        };
      }
    })
  );
};
