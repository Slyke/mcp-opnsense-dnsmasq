import { randomUUID } from "node:crypto";
import { createInventoryStore } from "./inventoryStore.js";
import {
  extractRows,
  normalizeArpRow,
  normalizeInterfaceSummary,
  normalizeLease,
  normalizeNdpRow,
  normalizeStaticHost
} from "./normalizers.js";
import { ipVersionOf, normalizeIpAddress, normalizeMac, stripControlChars } from "./ipUtils.js";

const emptyCounts = () => ({
  leases: 0,
  arp: 0,
  ndp: 0,
  static_hosts: 0,
  interfaces: 0,
  observations: 0
});

const errorSummary = ({ err }) => {
  return {
    code: err?.code ?? "unknown",
    message: err?.message ?? "Unknown error.",
    status_code: err?.statusCode
  };
};

const pickFirst = ({ value, keys, fallback = "" }) => {
  for (const key of keys) {
    if (value?.[key] !== undefined && value[key] !== null && value[key] !== "") {
      return value[key];
    }
  }

  return fallback;
};

const firstText = ({ value, keys, fallback = "" }) => {
  return stripControlChars({
    value: pickFirst({ value, keys, fallback })
  });
};

const firstMac = ({ value, keys }) => {
  for (const key of keys) {
    const normalized = normalizeMac({ value: value?.[key] });
    if (normalized) {
      return normalized;
    }
  }

  return "";
};

const firstIp = ({ value, keys }) => {
  for (const key of keys) {
    const normalized = normalizeIpAddress({ value: value?.[key] });
    if (normalized) {
      return normalized;
    }
  }

  return "";
};

const compactObservation = ({ observation }) => {
  return Object.fromEntries(
    Object.entries(observation)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
};

const shouldKeepObservation = ({ observation }) => {
  return Boolean(
    observation.ip_address ||
    observation.mac_address ||
    observation.hostname ||
    observation.client_uuid ||
    observation.client_id ||
    observation.duid ||
    observation.static_host_uuid ||
    observation.lease_uuid
  );
};

const interfaceKeys = ({ row }) => {
  return [
    row.identifier,
    row.device,
    row.description,
    row.interface,
    row.interface_name
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
};

const buildInterfaceMap = ({ rows }) => {
  const map = new Map();

  for (const row of rows) {
    const metadata = {
      interface: row.identifier || row.device || row.description || "",
      interface_name: row.description || row.device || row.identifier || "",
      vlan: row.vlan_tag === undefined || row.vlan_tag === null ? "" : String(row.vlan_tag)
    };

    for (const key of interfaceKeys({ row })) {
      map.set(key, metadata);
    }
  }

  return map;
};

const enrichInterface = ({ observation, interfaceMap }) => {
  const candidates = [
    observation.interface,
    observation.interface_name
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  const metadata = candidates.map((key) => interfaceMap.get(key)).find(Boolean);

  if (!metadata) {
    return observation;
  }

  return {
    ...observation,
    interface: observation.interface || metadata.interface,
    interface_name: observation.interface_name || metadata.interface_name,
    vlan: observation.vlan || metadata.vlan
  };
};

const makeObservation = ({ source, row, raw, observedAt, includeRaw, interfaceMap }) => {
  const ipAddress = row.ip_address || firstIp({
    value: raw,
    keys: ["ip_address", "address", "ip", "ipv6_address", "ipv6"]
  });
  const macAddress = row.mac_address || row.hw_address || firstMac({
    value: raw,
    keys: ["mac_address", "hw_address", "hwaddr", "mac", "ether", "lladdr"]
  });
  const routerUuid = row.uuid || firstText({ value: raw, keys: ["uuid", "_uuid", "id"] });
  const observation = enrichInterface({
    interfaceMap,
    observation: compactObservation({
      observation: {
        observed_at: observedAt,
        source,
        ip_address: ipAddress,
        ip_version: row.ip_version ?? ipVersionOf({ value: ipAddress }),
        mac_address: macAddress,
        hostname: row.hostname || firstText({ value: raw, keys: ["hostname", "host", "name"] }),
        vendor: row.manufacturer || firstText({ value: raw, keys: ["manufacturer", "mac_info", "vendor"] }),
        interface: row.interface || firstText({ value: raw, keys: ["if_descr", "intf", "interface", "if_name"] }),
        interface_name: row.interface_name || firstText({
          value: raw,
          keys: ["intf_description", "interface_description", "interface_name", "if_descr"]
        }),
        vlan: row.vlan || firstText({ value: raw, keys: ["vlan", "vlan_tag", "tag"] }),
        client_uuid: row.client_uuid || firstText({
          value: raw,
          keys: ["client_uuid", "clientid_uuid", "client_id_uuid"]
        }),
        client_id: row.client_id || firstText({ value: raw, keys: ["client_id"] }),
        duid: row.duid || firstText({ value: raw, keys: ["duid", "dhcp_unique_identifier"] }),
        iaid: row.iaid || firstText({ value: raw, keys: ["iaid", "identity_association_id"] }),
        lease_uuid: row.lease_uuid || (source === "dhcp_lease" ? routerUuid : ""),
        static_host_uuid: source === "static_host" ? routerUuid : "",
        router_uuid: routerUuid,
        raw: includeRaw ? raw : undefined
      }
    })
  });

  return shouldKeepObservation({ observation }) ? observation : null;
};

const collectInterfaces = async ({ context, requestId, warnings }) => {
  try {
    const raw = await context.opnsense.getInterfacesInfo({
      body: {
        searchPhrase: "",
        rowCount: context.config.inventory.rowLimit
      },
      details: true,
      requestId
    });
    const rows = extractRows({ value: raw }).map((row) => normalizeInterfaceSummary({ value: row }));

    return {
      rows,
      count: rows.length
    };
  } catch (err) {
    warnings.push({
      source: "interfaces",
      ...errorSummary({ err })
    });
    return {
      rows: [],
      count: 0
    };
  }
};

const collectRows = async ({ source, enabled, fetch, normalize, toObservations, warnings }) => {
  if (!enabled) {
    return {
      count: 0,
      observations: []
    };
  }

  try {
    const raw = await fetch();
    const rows = extractRows({ value: raw });

    return {
      count: rows.length,
      observations: rows
        .map((row) => toObservations({ row: normalize({ value: row }), raw: row }))
        .filter(Boolean)
    };
  } catch (err) {
    warnings.push({
      source,
      ...errorSummary({ err })
    });
    return {
      count: 0,
      observations: []
    };
  }
};

const sourceOptions = ({ config, overrides = {} }) => {
  return {
    leases: overrides.leases ?? config.inventory.collectLeases,
    arp: overrides.arp ?? config.inventory.collectArp,
    ndp: overrides.ndp ?? config.inventory.collectNdp,
    static_hosts: overrides.static_hosts ?? config.inventory.collectStaticHosts,
    interfaces: overrides.interfaces ?? config.inventory.collectInterfaces
  };
};

const collectInventory = async ({ context, requestId, sourceOverrides = {}, includeRaw = false }) => {
  const observedAt = new Date().toISOString();
  const warnings = [];
  const counts = emptyCounts();
  const options = sourceOptions({
    config: context.config,
    overrides: sourceOverrides
  });
  const interfaces = options.interfaces
    ? await collectInterfaces({ context, requestId, warnings })
    : { rows: [], count: 0 };
  const interfaceMap = buildInterfaceMap({
    rows: interfaces.rows
  });
  counts.interfaces = interfaces.count;
  const make = ({ source, row, raw }) => makeObservation({
    source,
    row,
    raw,
    observedAt,
    includeRaw,
    interfaceMap
  });
  const leases = await collectRows({
    source: "dhcp_lease",
    enabled: options.leases,
    warnings,
    fetch: async () => await context.opnsense.searchLeases({
      body: {
        searchPhrase: "",
        rowCount: context.config.inventory.rowLimit
      },
      requestId
    }),
    normalize: normalizeLease,
    toObservations: ({ row, raw }) => make({ source: "dhcp_lease", row, raw })
  });
  const arp = await collectRows({
    source: "arp",
    enabled: options.arp,
    warnings,
    fetch: async () => await context.opnsense.getArp({ requestId }),
    normalize: normalizeArpRow,
    toObservations: ({ row, raw }) => make({ source: "arp", row, raw })
  });
  const ndp = await collectRows({
    source: "ndp",
    enabled: options.ndp,
    warnings,
    fetch: async () => await context.opnsense.getNdp({ requestId }),
    normalize: normalizeNdpRow,
    toObservations: ({ row, raw }) => make({ source: "ndp", row, raw })
  });
  const staticHosts = await collectRows({
    source: "static_host",
    enabled: options.static_hosts,
    warnings,
    fetch: async () => await context.opnsense.searchHosts({
      body: {
        searchPhrase: "",
        rowCount: context.config.inventory.rowLimit
      },
      requestId
    }),
    normalize: normalizeStaticHost,
    toObservations: ({ row, raw }) => make({ source: "static_host", row, raw })
  });
  const observations = [
    ...leases.observations,
    ...arp.observations,
    ...ndp.observations,
    ...staticHosts.observations
  ];

  counts.leases = leases.count;
  counts.arp = arp.count;
  counts.ndp = ndp.count;
  counts.static_hosts = staticHosts.count;
  counts.observations = observations.length;

  return {
    observed_at: observedAt,
    counts,
    observations,
    warnings
  };
};

const pruneCutoff = ({ retentionDays }) => {
  if (!retentionDays) {
    return null;
  }

  return new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000)).toISOString();
};

const createDisabledInventoryService = ({ config }) => {
  return {
    enabled: false,
    refresh: async () => ({
      ok: false,
      error: {
        code: "inventory_disabled",
        message: "Inventory is disabled. Set INVENTORY_ENABLED=true or inventory.enabled=true.",
        details: {
          db_path: config.inventory.dbPath
        }
      }
    }),
    searchDevices: () => [],
    searchPairings: () => [],
    searchObservations: () => [],
    searchPollRuns: () => [],
    exportCsv: () => null,
    status: () => ({
      enabled: false,
      db_path: config.inventory.dbPath,
      poll_enabled: false
    }),
    close: () => {}
  };
};

export const createInventoryService = async ({ context }) => {
  if (!context.config.inventory.enabled) {
    return createDisabledInventoryService({
      config: context.config
    });
  }

  const store = await createInventoryStore({
    config: context.config,
    logger: context.logger
  });

  const refresh = async ({ trigger = "manual", requestId = randomUUID(), sourceOverrides = {}, includeRaw = false } = {}) => {
    const startedAt = new Date().toISOString();
    const pollRunId = store.startPollRun({
      trigger,
      startedAt
    });

    try {
      const collected = await collectInventory({
        context,
        requestId,
        sourceOverrides,
        includeRaw: includeRaw || context.config.inventory.includeRaw
      });
      const updatedAt = new Date().toISOString();
      store.recordObservations({
        pollRunId,
        observations: collected.observations,
        updatedAt
      });

      const prunedObservations = store.pruneObservations({
        before: pruneCutoff({
          retentionDays: context.config.inventory.retentionDays
        })
      });
      const status = collected.warnings.length === 0
        ? "ok"
        : (collected.observations.length > 0 ? "partial" : "failed");
      const finishedAt = new Date().toISOString();
      store.finishPollRun({
        id: pollRunId,
        finishedAt,
        status,
        counts: collected.counts,
        error: collected.warnings.length > 0 ? collected.warnings : null
      });

      return {
        ok: status !== "failed",
        poll_run_id: pollRunId,
        trigger,
        status,
        started_at: startedAt,
        finished_at: finishedAt,
        observed_at: collected.observed_at,
        counts: collected.counts,
        pruned_observations: prunedObservations,
        warnings: collected.warnings
      };
    } catch (err) {
      store.finishPollRun({
        id: pollRunId,
        finishedAt: new Date().toISOString(),
        status: "failed",
        counts: emptyCounts(),
        error: [errorSummary({ err })]
      });
      throw err;
    }
  };

  return {
    enabled: true,
    refresh,
    searchDevices: store.searchDevices,
    searchPairings: store.searchPairings,
    searchObservations: store.searchObservations,
    searchPollRuns: store.searchPollRuns,
    exportCsv: store.exportCsv,
    status: () => ({
      enabled: true,
      db_path: context.config.inventory.dbPath,
      poll_enabled: context.config.inventory.pollEnabled,
      poll_interval_ms: context.config.inventory.pollIntervalMs,
      retention_days: context.config.inventory.retentionDays,
      collect: {
        leases: context.config.inventory.collectLeases,
        arp: context.config.inventory.collectArp,
        ndp: context.config.inventory.collectNdp,
        static_hosts: context.config.inventory.collectStaticHosts,
        interfaces: context.config.inventory.collectInterfaces
      },
      ...store.status()
    }),
    close: store.close
  };
};

export const createInventoryPoller = ({ context }) => {
  let timer = null;
  let running = false;
  let stopped = false;

  const run = async ({ trigger = "scheduled" } = {}) => {
    if (!context.inventory.enabled || running) {
      return;
    }

    running = true;
    const requestId = randomUUID();

    try {
      const result = await context.inventory.refresh({
        trigger,
        requestId
      });

      context.logger.generateLog({
        level: result.status === "ok" ? "debug" : "warn",
        caller: "inventory::poller",
        loggerKey: "INVENTORY_REFRESH",
        message: "Inventory refresh completed.",
        correlationId: requestId,
        context: {
          poll_run_id: result.poll_run_id,
          status: result.status,
          counts: result.counts
        }
      });
    } catch (err) {
      context.logger.generateError({
        caller: "inventory::poller",
        reason: "Inventory refresh failed.",
        errorKey: "INVENTORY_REFRESH_FAILED",
        err,
        includeStackTrace: false,
        correlationId: requestId
      });
    } finally {
      running = false;
    }
  };

  const schedule = () => {
    if (stopped || !context.inventory.enabled || !context.config.inventory.pollEnabled) {
      return;
    }

    timer = setTimeout(() => {
      void run({ trigger: "scheduled" }).finally(schedule);
    }, context.config.inventory.pollIntervalMs);
    timer.unref?.();
  };

  return {
    start: () => {
      if (!context.inventory.enabled || !context.config.inventory.pollEnabled) {
        return;
      }

      if (context.config.inventory.pollOnStart) {
        void run({ trigger: "startup" });
      }

      schedule();
    },
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
};
