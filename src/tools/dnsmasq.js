import { dnsmasqSettingsGetSchema, dnsmasqSettingsUpdateSchema, dnsmasqStatusSchema, reconfigureSchema } from "../validators.js";
import { normalizeDnsmasqSettings, normalizeDnsmasqStatus, unwrapValue } from "../normalizers.js";
import { publicConfigSummary } from "../config.js";
import { normalizeStringList } from "../ipUtils.js";
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
      description: "Update Dnsmasq DNS and DHCP settings, including DHCP max leases, reply delay, and default domain.",
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
        const setBoolean = (target, key, value) => { if (value !== undefined) target[key] = value ? "1" : "0"; };
        const setNumber = (target, key, value) => { if (value !== undefined) target[key] = String(value); };
        const setStringList = (target, key, value) => { if (value !== undefined) target[key] = normalizeStringList({ value }).join(","); };
        const changedSettings = [
          "enabled",
          "interface",
          "strict_interface_binding",
          "dns_listen_port",
          "dnssec",
          "log_queries",
          "dns_forward_max",
          "cache_size",
          "no_ident",
          "strict_order",
          "domain_needed",
          "no_private_reverse",
          "no_resolv",
          "no_hosts",
          "dhcp_no_interface",
          "dhcp_fqdn",
          "domain",
          "dhcp_local_domain",
          "lease_max",
          "dhcp_authoritative",
          "register_firewall_rules",
          "reply_delay"
        ].filter((key) => args[key] !== undefined);

        setBoolean(payload, "enable", args.enabled);
        setStringList(payload, "interface", args.interface);
        setBoolean(payload, "strictbind", args.strict_interface_binding);
        setNumber(payload, "port", args.dns_listen_port);
        setBoolean(payload, "dnssec", args.dnssec);
        setBoolean(payload, "log_queries", args.log_queries);
        setNumber(payload, "dns_forward_max", args.dns_forward_max);
        setNumber(payload, "cache_size", args.cache_size);
        setBoolean(payload, "no_ident", args.no_ident);
        setBoolean(payload, "strict_order", args.strict_order);
        setBoolean(payload, "domain_needed", args.domain_needed);
        setBoolean(payload, "no_private_reverse", args.no_private_reverse);
        setBoolean(payload, "no_resolv", args.no_resolv);
        setBoolean(payload, "no_hosts", args.no_hosts);
        setStringList(payload.dhcp, "no_interface", args.dhcp_no_interface);
        setBoolean(payload.dhcp, "fqdn", args.dhcp_fqdn);
        if (args.domain !== undefined) payload.dhcp.domain = args.domain;
        setBoolean(payload.dhcp, "local", args.dhcp_local_domain);
        setNumber(payload.dhcp, "lease_max", args.lease_max);
        setBoolean(payload.dhcp, "authoritative", args.dhcp_authoritative);
        setBoolean(payload.dhcp, "default_fw_rules", args.register_firewall_rules);
        setNumber(payload.dhcp, "reply_delay", args.reply_delay);
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
            target: { settings: changedSettings }
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
          target: { settings: changedSettings }
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
