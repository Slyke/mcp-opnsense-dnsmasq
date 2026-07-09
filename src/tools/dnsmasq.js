import { dnsmasqStatusSchema, reconfigureSchema } from "../validators.js";
import { normalizeDnsmasqStatus } from "../normalizers.js";
import { publicConfigSummary } from "../config.js";
import { makeToolHandler, getIncludeRaw, appendHistory } from "./shared.js";

export const registerDnsmasqTools = ({ server, context }) => {
  server.registerTool(
    "dnsmasq_status",
    {
      description: "Return Dnsmasq service status and MCP safety guardrails.",
      inputSchema: dnsmasqStatusSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dnsmasq_status",
      handler: async ({ args, context: toolContext, requestId }) => {
        const raw = await toolContext.opnsense.getDnsmasqStatus({ requestId });
        const status = normalizeDnsmasqStatus({
          value: raw,
          include_raw: getIncludeRaw({ args, config: toolContext.config })
        });

        return {
          ...status,
          ...publicConfigSummary({ config: toolContext.config })
        };
      }
    })
  );

  server.registerTool(
    "dnsmasq_reconfigure",
    {
      description: "Reload Dnsmasq configuration after validated settings changes.",
      inputSchema: reconfigureSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false
      }
    },
    makeToolHandler({
      context,
      toolName: "dnsmasq_reconfigure",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        if (!args.apply) {
          appendHistory({
            context: toolContext,
            toolName: "dnsmasq_reconfigure",
            identity,
            requestId,
            action: "plan_reconfigure",
            applied: false,
            ok: true,
            target: {
              endpoint: "/api/dnsmasq/service/reconfigure"
            }
          });

          return {
            ok: true,
            applied: false,
            planned_action: {
              method: "POST",
              path: "/api/dnsmasq/service/reconfigure"
            }
          };
        }

        await toolContext.opnsense.reconfigureDnsmasq({ requestId });
        const rawStatus = await toolContext.opnsense.getDnsmasqStatus({ requestId });
        const status = normalizeDnsmasqStatus({ value: rawStatus });

        appendHistory({
          context: toolContext,
          toolName: "dnsmasq_reconfigure",
          identity,
          requestId,
          action: "reconfigure",
          applied: true,
          ok: true,
          target: {
            service: "dnsmasq"
          }
        });

        return {
          ok: true,
          applied: true,
          status
        };
      }
    })
  );
};
