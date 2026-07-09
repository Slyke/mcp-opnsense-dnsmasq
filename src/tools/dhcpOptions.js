import { emptyIncludeRawSchema } from "../validators.js";
import { extractRows, normalizeDhcpOption } from "../normalizers.js";
import { makeToolHandler, getIncludeRaw } from "./shared.js";

export const registerDhcpOptionTools = ({ server, context }) => {
  server.registerTool(
    "dhcp_options_list",
    {
      description: "List Dnsmasq DHCP options.",
      inputSchema: emptyIncludeRawSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_options_list",
      handler: async ({ args, context: toolContext, requestId }) => {
        const raw = await toolContext.opnsense.searchOptions({
          body: {},
          requestId
        });
        const options = extractRows({ value: raw }).map((row) => normalizeDhcpOption({
          value: row,
          include_raw: getIncludeRaw({ args, config: toolContext.config })
        }));

        return {
          ok: true,
          options
        };
      }
    })
  );
};
