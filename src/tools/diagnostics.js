import {
  arpListSchema,
  arpSearchSchema,
  historySearchSchema,
  macVendorLookupSchema,
  routerPingSchema
} from "../validators.js";
import { extractRows, normalizeArpRow } from "../normalizers.js";
import { validationError } from "../errors.js";
import { isHostnameOrIp, normalizeMac } from "../ipUtils.js";
import {
  getIncludeRaw,
  makeToolHandler,
  matchesCommonFilters,
  textIncludes
} from "./shared.js";

export const getArpRows = async ({ context, args = {}, requestId }) => {
  const raw = await context.opnsense.getArp({
    requestId
  });
  const includeRaw = getIncludeRaw({ args, config: context.config });

  return extractRows({ value: raw })
    .map((row) => normalizeArpRow({ value: row, include_raw: includeRaw }))
    .filter((row) => matchesCommonFilters({ row, args }))
    .filter((row) => (args.manufacturer ? textIncludes({ value: row.manufacturer, query: args.manufacturer }) : true));
};

const parseMacInfo = ({ macAddress, raw }) => {
  const manufacturer = raw?.manufacturer ?? raw?.vendor ?? raw?.mac_info ?? raw?.description ?? "";

  return {
    mac_address: macAddress,
    manufacturer: String(manufacturer ?? ""),
    source: manufacturer ? "opnsense_mac_info" : "unknown",
    raw
  };
};

const getMacVendorFromArp = async ({ context, macAddress, requestId }) => {
  const rows = await getArpRows({
    context,
    args: {
      mac_address: macAddress
    },
    requestId
  });
  const arpMatch = rows.find((row) => row.manufacturer);

  return arpMatch
    ? {
      mac_address: macAddress,
      manufacturer: arpMatch.manufacturer,
      source: "arp"
    }
    : null;
};

const sleep = async ({ ms }) => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const normalizePingOutput = ({ target, raw, includeRaw }) => {
  const output = raw?.output ?? raw?.result ?? raw?.text ?? "";
  const text = typeof output === "string" ? output : JSON.stringify(output);
  const packetLossMatch = text.match(/([0-9.]+)%\s*packet loss/i);
  const transmittedMatch = text.match(/(\d+)\s+packets transmitted/i);
  const receivedMatch = text.match(/(\d+)\s+(?:packets )?received/i);
  const rttMatch = text.match(/(?:round-trip|rtt).*?=\s*([0-9.]+)\/([0-9.]+)\/([0-9.]+)/i);
  const normalized = {
    ok: true,
    target,
    transmitted: transmittedMatch ? Number(transmittedMatch[1]) : Number(raw?.transmitted ?? 0),
    received: receivedMatch ? Number(receivedMatch[1]) : Number(raw?.received ?? 0),
    packet_loss_percent: packetLossMatch ? Number(packetLossMatch[1]) : Number(raw?.packet_loss_percent ?? 0),
    rtt_ms: {
      min: rttMatch ? Number(rttMatch[1]) : Number(raw?.rtt_ms?.min ?? 0),
      avg: rttMatch ? Number(rttMatch[2]) : Number(raw?.rtt_ms?.avg ?? 0),
      max: rttMatch ? Number(rttMatch[3]) : Number(raw?.rtt_ms?.max ?? 0)
    },
    output: text
  };

  if (includeRaw) {
    normalized.raw = raw;
  }

  return normalized;
};

const pollPingJob = async ({ context, jobId, target, timeoutMs, includeRaw, requestId }) => {
  const startedAt = Date.now();
  let lastRaw = {};

  while (Date.now() - startedAt < timeoutMs) {
    const rawJobs = await context.opnsense.searchPingJobs({
      body: {},
      requestId
    });
    const rows = extractRows({ value: rawJobs });
    const job = rows.find((row) => row.uuid === jobId || row.id === jobId || row.jobid === jobId) ?? rows[0];
    lastRaw = job ?? rawJobs;

    const status = String(job?.status ?? job?.state ?? "").toLowerCase();
    if (["done", "finished", "stopped", "completed", "complete"].includes(status) || job?.output || job?.result) {
      return normalizePingOutput({
        target,
        raw: job,
        includeRaw
      });
    }

    await sleep({ ms: 500 });
  }

  return {
    ok: false,
    error: {
      code: "timeout",
      message: "Router ping timed out.",
      details: includeRaw ? { raw: lastRaw } : {}
    }
  };
};

export const routerPing = async ({ context, args, requestId }) => {
  if (!isHostnameOrIp({ value: args.target })) {
    return validationError({
      message: "target must be a hostname or IP address."
    });
  }

  const count = Math.min(args.count ?? 3, context.config.maxPingCount);
  const packetSize = Math.min(args.packet_size ?? 56, context.config.maxPingPacketSize);
  const fam = args.address_family === "ipv6" ? "ip6" : "ip";
  const rawSet = await context.opnsense.setPing({
    ping: {
      settings: {
        hostname: args.target,
        fam,
        source_address: args.source_address ?? "",
        packetsize: String(packetSize),
        count: String(count)
      }
    },
    requestId
  });
  const jobId = rawSet.uuid ?? rawSet.jobid ?? rawSet.id ?? rawSet.result?.uuid;

  if (!jobId) {
    return normalizePingOutput({
      target: args.target,
      raw: rawSet,
      includeRaw: getIncludeRaw({ args, config: context.config })
    });
  }

  await context.opnsense.startPing({
    jobId,
    requestId
  });

  try {
    return await pollPingJob({
      context,
      jobId,
      target: args.target,
      timeoutMs: args.timeout_ms ?? 10000,
      includeRaw: getIncludeRaw({ args, config: context.config }),
      requestId
    });
  } finally {
    await context.opnsense.stopPing({ jobId, requestId }).catch(() => {});
    await context.opnsense.removePing({ jobId, requestId }).catch(() => {});
  }
};

export const registerDiagnosticTools = ({ server, context }) => {
  server.registerTool(
    "arp_list",
    {
      description: "List current ARP table entries from OPNsense.",
      inputSchema: arpListSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "arp_list",
      handler: async ({ args, context: toolContext, requestId }) => {
        const rows = await getArpRows({
          context: toolContext,
          args,
          requestId
        });

        return {
          ok: true,
          arp: rows
        };
      }
    })
  );

  server.registerTool(
    "arp_search",
    {
      description: "Search ARP table entries by IP, MAC, hostname, or manufacturer.",
      inputSchema: arpSearchSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "arp_search",
      handler: async ({ args, context: toolContext, requestId }) => {
        const rows = await getArpRows({
          context: toolContext,
          args,
          requestId
        });

        return {
          ok: true,
          arp: rows
        };
      }
    })
  );

  server.registerTool(
    "mac_vendor_lookup",
    {
      description: "Get local OPNsense vendor/manufacturer info for a MAC address.",
      inputSchema: macVendorLookupSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "mac_vendor_lookup",
      handler: async ({ args, context: toolContext, requestId }) => {
        const macAddress = normalizeMac({ value: args.mac_address });
        if (!macAddress) {
          return validationError({
            message: "mac_address must be a valid MAC address."
          });
        }

        let info = null;
        let macInfoError = null;

        try {
          const raw = await toolContext.opnsense.getMacInfo({
            macAddress,
            requestId
          });
          info = parseMacInfo({
            macAddress,
            raw
          });
        } catch (err) {
          macInfoError = err;
        }

        if (info?.manufacturer) {
          return info;
        }

        if (args.include_arp_fallback !== false) {
          const arpInfo = await getMacVendorFromArp({
            context: toolContext,
            macAddress,
            requestId
          });

          if (arpInfo) {
            return {
              ...arpInfo,
              warning: macInfoError
                ? "Direct OPNsense MAC info lookup failed; used ARP fallback."
                : undefined
            };
          }
        }

        return info ?? {
          mac_address: macAddress,
          manufacturer: "",
          source: "unknown",
          warning: macInfoError
            ? "Direct OPNsense MAC info lookup failed and no ARP fallback match was available."
            : undefined
        };
      }
    })
  );

  server.registerTool(
    "router_ping",
    {
      description: "Ping a target from the OPNsense router using bounded diagnostics API jobs.",
      inputSchema: routerPingSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "router_ping",
      handler: async ({ args, context: toolContext, requestId }) => {
        return await routerPing({
          context: toolContext,
          args,
          requestId
        });
      }
    })
  );

  server.registerTool(
    "history_search",
    {
      description: "Search recent MCP action history recorded by this server.",
      inputSchema: historySearchSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "history_search",
      handler: async ({ args, context: toolContext }) => {
        return {
          ok: true,
          history: toolContext.history.search(args)
        };
      }
    })
  );
};
