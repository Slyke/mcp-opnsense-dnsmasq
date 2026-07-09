import { clientSummarySchema } from "../validators.js";
import { normalizeIpv4, normalizeMac } from "../ipUtils.js";
import { getStaticHosts } from "./dhcpStatic.js";
import { getLeases } from "./dhcpLeases.js";
import { getArpRows, routerPing } from "./diagnostics.js";
import { makeToolHandler } from "./shared.js";

const inferIdentifier = ({ identifier }) => {
  const ipAddress = normalizeIpv4({ value: identifier });
  if (ipAddress) {
    return {
      ip_address: ipAddress
    };
  }

  const macAddress = normalizeMac({ value: identifier });
  if (macAddress) {
    return {
      mac_address: macAddress
    };
  }

  return {
    hostname: identifier
  };
};

const chooseBest = ({ staticHosts, leases, arp }) => {
  const staticHost = staticHosts[0];
  const lease = leases[0];
  const arpRow = arp[0];
  const best = {
    ip_address: staticHost?.ip_address ?? lease?.ip_address ?? arpRow?.ip_address ?? "",
    mac_address: staticHost?.hw_address ?? lease?.mac_address ?? arpRow?.mac_address ?? "",
    hostname: staticHost?.hostname ?? lease?.hostname ?? arpRow?.hostname ?? "",
    manufacturer: arpRow?.manufacturer ?? "",
    is_static: Boolean(staticHost),
    is_online_guess: Boolean(arpRow)
  };

  return best;
};

const mergeSearchArgs = ({ identifier }) => {
  const inferred = inferIdentifier({ identifier });

  if (inferred.ip_address) {
    return {
      ip_address: inferred.ip_address
    };
  }

  if (inferred.mac_address) {
    return {
      mac_address: inferred.mac_address
    };
  }

  return {
    hostname: inferred.hostname
  };
};

export const registerClientSummaryTools = ({ server, context }) => {
  server.registerTool(
    "client_summary",
    {
      description: "Combine static hosts, leases, ARP, vendor info, and optional ping into one device summary.",
      inputSchema: clientSummarySchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "client_summary",
      handler: async ({ args, context: toolContext, requestId }) => {
        const searchArgs = mergeSearchArgs({
          identifier: args.identifier
        });
        const [staticHosts, leases, arp] = await Promise.all([
          getStaticHosts({
            context: toolContext,
            args: {
              ...searchArgs,
              include_disabled: true,
              include_raw: args.include_raw,
              limit: 50
            },
            requestId
          }),
          getLeases({
            context: toolContext,
            args: {
              ...searchArgs,
              include_raw: args.include_raw,
              limit: 50
            },
            requestId
          }),
          getArpRows({
            context: toolContext,
            args: {
              ...searchArgs,
              include_raw: args.include_raw
            },
            requestId
          })
        ]);
        const best = chooseBest({
          staticHosts,
          leases,
          arp
        });
        const ping = args.ping && best.ip_address
          ? await routerPing({
            context: toolContext,
            args: {
              target: best.ip_address,
              include_raw: args.include_raw
            },
            requestId
          })
          : null;

        return {
          ok: true,
          identifier: args.identifier,
          best,
          static_hosts: staticHosts,
          leases,
          arp,
          ping,
          warnings: best.ip_address || best.mac_address || best.hostname ? [] : ["No linked records found."]
        };
      }
    })
  );
};
