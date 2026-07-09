import { interfaceGetSchema, interfacesListSchema } from "../validators.js";
import { extractRows, normalizeInterfaceDetail, normalizeInterfaceSummary } from "../normalizers.js";
import { notFoundError } from "../errors.js";
import { getIncludeRaw, makeToolHandler } from "./shared.js";

const matches = ({ row, args }) => {
  const query = String(args.query ?? "").trim().toLowerCase();
  if (args.identifier && String(row.identifier ?? "").toLowerCase() !== String(args.identifier).toLowerCase()) return false;
  if (args.device && String(row.device ?? "").toLowerCase() !== String(args.device).toLowerCase()) return false;
  if (args.status && String(row.status ?? "").toLowerCase() !== String(args.status).toLowerCase()) return false;
  return query ? JSON.stringify(row).toLowerCase().includes(query) : true;
};

export const getInterfaces = async ({ context, args = {}, requestId }) => {
  const raw = await context.opnsense.getInterfacesInfo({
    body: { searchPhrase: args.query ?? "", rowCount: args.limit ?? 500 },
    details: args.detailed ?? false,
    requestId
  });
  const includeRaw = getIncludeRaw({ args, config: context.config });
  return extractRows({ value: raw })
    .map((row) => normalizeInterfaceSummary({ value: row, include_raw: includeRaw }))
    .filter((row) => matches({ row, args }))
    .slice(0, args.limit ?? 500);
};

export const registerInterfaceTools = ({ server, context }) => {
  server.registerTool(
    "interfaces_list",
    {
      description: "List OPNsense interfaces and current read-only status/details.",
      inputSchema: interfacesListSchema,
      annotations: { readOnlyHint: true }
    },
    makeToolHandler({
      context,
      toolName: "interfaces_list",
      handler: async ({ args, context: toolContext, requestId }) => ({
        ok: true,
        interfaces: await getInterfaces({ context: toolContext, args, requestId })
      })
    })
  );

  server.registerTool(
    "interfaces_get",
    {
      description: "Get detailed read-only OPNsense interface information by identifier or device name.",
      inputSchema: interfaceGetSchema,
      annotations: { readOnlyHint: true }
    },
    makeToolHandler({
      context,
      toolName: "interfaces_get",
      handler: async ({ args, context: toolContext, requestId }) => {
        const interfaces = await getInterfaces({ context: toolContext, args: { limit: 5000 }, requestId });
        const requested = String(args.interface).toLowerCase();
        const match = interfaces.find((row) => {
          return String(row.identifier ?? "").toLowerCase() === requested ||
            String(row.device ?? "").toLowerCase() === requested;
        });
        if (!match) {
          return notFoundError({ message: "No matching OPNsense interface was found." });
        }
        const raw = await toolContext.opnsense.getInterface({ interfaceName: match.device, requestId });
        const detail = normalizeInterfaceDetail({ value: raw, include_raw: getIncludeRaw({ args, config: toolContext.config }) });
        return { ok: true, interface: { ...match, ...detail } };
      }
    })
  );
};
