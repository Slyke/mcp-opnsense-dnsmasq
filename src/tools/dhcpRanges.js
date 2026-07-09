import { emptyIncludeRawSchema } from "../validators.js";
import { extractRows, normalizeDhcpRange } from "../normalizers.js";
import { makeToolHandler, getIncludeRaw } from "./shared.js";

export const getRanges = async ({ context, args = {}, requestId }) => {
  const raw = await context.opnsense.searchRanges({
    body: {},
    requestId
  });
  const includeRaw = getIncludeRaw({ args, config: context.config });

  return extractRows({ value: raw }).map((row) => normalizeDhcpRange({
    value: row,
    include_raw: includeRaw
  }));
};

export const registerDhcpRangeTools = ({ server, context }) => {
  server.registerTool(
    "dhcp_ranges_list",
    {
      description: "List Dnsmasq DHCP ranges.",
      inputSchema: emptyIncludeRawSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_ranges_list",
      handler: async ({ args, context: toolContext, requestId }) => {
        const ranges = await getRanges({
          context: toolContext,
          args,
          requestId
        });

        return {
          ok: true,
          ranges
        };
      }
    })
  );
};
