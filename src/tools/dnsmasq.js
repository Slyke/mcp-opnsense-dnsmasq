import { dnsmasqSettingsGetSchema, dnsmasqSettingsUpdateSchema, dnsmasqStatusSchema, reconfigureSchema } from "../validators.js";
import { normalizeDnsmasqSettings, normalizeDnsmasqStatus, unwrapValue } from "../normalizers.js";
import { publicConfigSummary } from "../config.js";
import { appendHistory, diffRecords, getIncludeRaw, makeToolHandler, reconfigureDnsmasqIfRequested } from "./shared.js";

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
    "dnsmasq_settings_get",
    {
      description: "Read Dnsmasq settings, including DHCP settings, from OPNsense.",
      inputSchema: dnsmasqSettingsGetSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dnsmasq_settings_get",
      handler: async ({ args, context: toolContext, requestId }) => {
        const raw = await toolContext.opnsense.getDnsmasqSettings({ requestId });
        const settings = normalizeDnsmasqSettings({
          value: raw,
          include_raw: getIncludeRaw({ args, config: toolContext.config })
        });

        return {
          ok: true,
          settings
        };
      }
    })
  );

  server.registerTool(
    "dnsmasq_settings_update",
    {
      description: "Update DHCP max leases, DHCP reply delay, or default DHCP domain in Dnsmasq settings.",
      inputSchema: dnsmasqSettingsUpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false
      }
    },
    makeToolHandler({
      context,
      toolName: "dnsmasq_settings_update",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        const includeRaw = getIncludeRaw({ args, config: toolContext.config });
        const rawBefore = await toolContext.opnsense.getDnsmasqSettings({ requestId });
        const before = normalizeDnsmasqSettings({ value: rawBefore, include_raw: includeRaw });
        const payload = structuredClone(unwrapValue({ value: rawBefore, keys: ["dnsmasq"] }) ?? {});
        payload.dhcp = payload.dhcp ?? {};
        if (args.domain !== undefined) {
          payload.dhcp.domain = args.domain;
        }
        if (args.lease_max !== undefined) {
          payload.dhcp.lease_max = String(args.lease_max);
        }
        if (args.reply_delay !== undefined) {
          payload.dhcp.reply_delay = String(args.reply_delay);
        }
        const after = normalizeDnsmasqSettings({ value: { dnsmasq: payload }, include_raw: includeRaw });
        const diff = diffRecords({ before, after });
        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;

        if (!args.apply) {
          appendHistory({
            context: toolContext,
            toolName: "dnsmasq_settings_update",
            identity,
            requestId,
            action: "plan_update",
            applied: false,
            ok: true,
            target: { settings: ["domain", "lease_max", "reply_delay"] }
          });
          return { ok: true, applied: false, before, after, diff, planned_payload: payload };
        }

        await toolContext.opnsense.setDnsmasqSettings({ dnsmasq: payload, requestId });
        const reconfigured = await reconfigureDnsmasqIfRequested({ context: toolContext, reconfigure, requestId });
        appendHistory({
          context: toolContext,
          toolName: "dnsmasq_settings_update",
          identity,
          requestId,
          action: "update",
          applied: true,
          ok: true,
          target: { settings: ["domain", "lease_max", "reply_delay"] }
        });
        return { ok: true, applied: true, reconfigured, before, after, diff };
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
