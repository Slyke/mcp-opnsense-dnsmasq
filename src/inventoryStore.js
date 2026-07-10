import fs from "node:fs";
import path from "node:path";
import { normalizeIpAddress, normalizeMac } from "./ipUtils.js";

const NETWORK_SOURCES = new Set(["dhcp_lease", "arp", "ndp"]);
const EXPORT_TABLES = {
  devices: {
    tableName: "inventory_devices",
    orderBy: "last_seen_at DESC, mac_address ASC",
    rawColumns: []
  },
  pairings: {
    tableName: "inventory_ip_mac_pairings",
    orderBy: "last_seen_at DESC, ip_address ASC, mac_address ASC",
    rawColumns: []
  },
  observations: {
    tableName: "inventory_observations",
    orderBy: "observed_at DESC, id DESC",
    rawColumns: ["raw_json"]
  },
  poll_runs: {
    tableName: "inventory_poll_runs",
    orderBy: "started_at DESC, id DESC",
    rawColumns: []
  }
};

const nullableText = ({ value }) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return String(value);
};

const keyText = ({ value }) => {
  return nullableText({ value }) ?? "";
};

const nullableInteger = ({ value }) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const jsonOrNull = ({ value }) => {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.stringify(value);
};

const limitValue = ({ value, fallback, max }) => {
  const parsed = Number(value ?? fallback);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(parsed, max));
};

const normalizeTime = ({ value }) => {
  return nullableText({ value });
};

const normalizeSearchIp = ({ value }) => {
  return value ? normalizeIpAddress({ value }) : "";
};

const normalizeSearchMac = ({ value }) => {
  return value ? normalizeMac({ value }) : "";
};

const addExactFilter = ({ clauses, params, column, value, lower = true }) => {
  const normalized = nullableText({ value });

  if (!normalized) {
    return;
  }

  if (lower) {
    clauses.push(`lower(${column}) = lower(?)`);
    params.push(normalized);
    return;
  }

  clauses.push(`${column} = ?`);
  params.push(normalized);
};

const addTimeFilter = ({ clauses, params, column, operator, value }) => {
  const normalized = normalizeTime({ value });

  if (!normalized) {
    return;
  }

  clauses.push(`${column} ${operator} ?`);
  params.push(normalized);
};

const addQueryFilter = ({ clauses, params, columns, query }) => {
  const normalized = nullableText({ value: query });

  if (!normalized) {
    return;
  }

  clauses.push(`(${columns.map((column) => `lower(coalesce(${column}, '')) LIKE ?`).join(" OR ")})`);
  for (const _column of columns) {
    params.push(`%${normalized.toLowerCase()}%`);
  }
};

const withWhere = ({ clauses }) => {
  return clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
};

const stripRawJson = ({ rows, includeRaw }) => {
  if (includeRaw) {
    return rows;
  }

  return rows.map(({ raw_json: _rawJson, ...row }) => row);
};

const escapeCsvValue = ({ value }) => {
  if (value === undefined || value === null) {
    return String();
  }

  const raw = String(value);
  const quote = String.fromCharCode(34);
  const safe = /^[=+\-@]/.test(raw) ? String.fromCharCode(39) + raw : raw;
  const needsQuote = safe.includes(quote)
    || safe.includes(String.fromCharCode(44))
    || safe.includes(String.fromCharCode(13))
    || safe.includes(String.fromCharCode(10));

  return needsQuote ? quote + safe.replaceAll(quote, quote + quote) + quote : safe;
};

const quoteIdentifier = ({ value }) => {
  const quote = String.fromCharCode(34);
  return quote + String(value).replaceAll(quote, quote + quote) + quote;
};

const rowsToCsv = ({ columns, rows }) => {
  const comma = String.fromCharCode(44);
  const lines = [
    columns.map((column) => escapeCsvValue({ value: column })).join(comma),
    ...rows.map((row) => columns.map((column) => escapeCsvValue({ value: row[column] })).join(comma))
  ];

  return lines.join(String.fromCharCode(10)) + String.fromCharCode(10);
};

const exportTableConfig = ({ table }) => {
  return EXPORT_TABLES[String(table ?? String())] ?? null;
};

export const inventoryExportTableNames = () => {
  return Object.keys(EXPORT_TABLES);
};

const initializeSchema = ({ db }) => {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS inventory_poll_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      leases_count INTEGER NOT NULL DEFAULT 0,
      arp_count INTEGER NOT NULL DEFAULT 0,
      ndp_count INTEGER NOT NULL DEFAULT 0,
      static_hosts_count INTEGER NOT NULL DEFAULT 0,
      interfaces_count INTEGER NOT NULL DEFAULT 0,
      observations_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory_devices (
      mac_address TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_network_seen_at TEXT,
      last_seen_source TEXT NOT NULL,
      last_ip_address TEXT,
      last_ip_version INTEGER,
      last_hostname TEXT,
      last_vendor TEXT,
      last_interface TEXT,
      last_interface_name TEXT,
      last_vlan TEXT,
      last_client_uuid TEXT,
      last_client_id TEXT,
      last_duid TEXT,
      last_iaid TEXT,
      last_lease_uuid TEXT,
      last_static_host_uuid TEXT,
      last_router_uuid TEXT,
      last_updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_ip_mac_pairings (
      ip_address TEXT NOT NULL,
      ip_version INTEGER NOT NULL,
      mac_address TEXT NOT NULL,
      interface TEXT NOT NULL DEFAULT '',
      vlan TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_network_seen_at TEXT,
      first_source TEXT NOT NULL,
      last_source TEXT NOT NULL,
      hostname TEXT,
      vendor TEXT,
      interface_name TEXT,
      client_uuid TEXT,
      client_id TEXT,
      duid TEXT,
      iaid TEXT,
      lease_uuid TEXT,
      static_host_uuid TEXT,
      router_uuid TEXT,
      observation_count INTEGER NOT NULL DEFAULT 0,
      last_updated_at TEXT NOT NULL,
      PRIMARY KEY (ip_address, ip_version, mac_address, interface, vlan)
    );

    CREATE TABLE IF NOT EXISTS inventory_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observed_at TEXT NOT NULL,
      poll_run_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      ip_address TEXT,
      ip_version INTEGER,
      mac_address TEXT,
      hostname TEXT,
      vendor TEXT,
      interface TEXT,
      interface_name TEXT,
      vlan TEXT,
      client_uuid TEXT,
      client_id TEXT,
      duid TEXT,
      iaid TEXT,
      lease_uuid TEXT,
      static_host_uuid TEXT,
      router_uuid TEXT,
      raw_json TEXT,
      FOREIGN KEY (poll_run_id) REFERENCES inventory_poll_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_devices_last_seen
      ON inventory_devices(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_inventory_devices_ip
      ON inventory_devices(last_ip_address);
    CREATE INDEX IF NOT EXISTS idx_inventory_devices_interface_vlan
      ON inventory_devices(last_interface, last_vlan);

    CREATE INDEX IF NOT EXISTS idx_inventory_pairings_ip
      ON inventory_ip_mac_pairings(ip_address, ip_version);
    CREATE INDEX IF NOT EXISTS idx_inventory_pairings_mac
      ON inventory_ip_mac_pairings(mac_address);
    CREATE INDEX IF NOT EXISTS idx_inventory_pairings_interface_vlan
      ON inventory_ip_mac_pairings(interface, vlan);
    CREATE INDEX IF NOT EXISTS idx_inventory_pairings_last_seen
      ON inventory_ip_mac_pairings(last_seen_at);

    CREATE INDEX IF NOT EXISTS idx_inventory_observations_observed
      ON inventory_observations(observed_at);
    CREATE INDEX IF NOT EXISTS idx_inventory_observations_ip
      ON inventory_observations(ip_address, ip_version);
    CREATE INDEX IF NOT EXISTS idx_inventory_observations_mac
      ON inventory_observations(mac_address);
    CREATE INDEX IF NOT EXISTS idx_inventory_observations_source
      ON inventory_observations(source);
  `);
};

const runTransaction = ({ db, fn }) => {
  if (db.isTransaction) {
    return fn();
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};

export const createInventoryStore = async ({ config }) => {
  fs.mkdirSync(path.dirname(config.inventory.dbPath), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(config.inventory.dbPath);

  initializeSchema({ db });

  const statements = {
    startPollRun: db.prepare(`
      INSERT INTO inventory_poll_runs (trigger, started_at, status)
      VALUES (?, ?, 'running')
    `),
    finishPollRun: db.prepare(`
      UPDATE inventory_poll_runs
      SET finished_at = ?,
        status = ?,
        leases_count = ?,
        arp_count = ?,
        ndp_count = ?,
        static_hosts_count = ?,
        interfaces_count = ?,
        observations_count = ?,
        error = ?
      WHERE id = ?
    `),
    insertObservation: db.prepare(`
      INSERT INTO inventory_observations (
        observed_at,
        poll_run_id,
        source,
        ip_address,
        ip_version,
        mac_address,
        hostname,
        vendor,
        interface,
        interface_name,
        vlan,
        client_uuid,
        client_id,
        duid,
        iaid,
        lease_uuid,
        static_host_uuid,
        router_uuid,
        raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    upsertDevice: db.prepare(`
      INSERT INTO inventory_devices (
        mac_address,
        first_seen_at,
        last_seen_at,
        last_network_seen_at,
        last_seen_source,
        last_ip_address,
        last_ip_version,
        last_hostname,
        last_vendor,
        last_interface,
        last_interface_name,
        last_vlan,
        last_client_uuid,
        last_client_id,
        last_duid,
        last_iaid,
        last_lease_uuid,
        last_static_host_uuid,
        last_router_uuid,
        last_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mac_address) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        last_network_seen_at = coalesce(excluded.last_network_seen_at, inventory_devices.last_network_seen_at),
        last_seen_source = excluded.last_seen_source,
        last_ip_address = coalesce(excluded.last_ip_address, inventory_devices.last_ip_address),
        last_ip_version = coalesce(excluded.last_ip_version, inventory_devices.last_ip_version),
        last_hostname = coalesce(excluded.last_hostname, inventory_devices.last_hostname),
        last_vendor = coalesce(excluded.last_vendor, inventory_devices.last_vendor),
        last_interface = coalesce(excluded.last_interface, inventory_devices.last_interface),
        last_interface_name = coalesce(excluded.last_interface_name, inventory_devices.last_interface_name),
        last_vlan = coalesce(excluded.last_vlan, inventory_devices.last_vlan),
        last_client_uuid = coalesce(excluded.last_client_uuid, inventory_devices.last_client_uuid),
        last_client_id = coalesce(excluded.last_client_id, inventory_devices.last_client_id),
        last_duid = coalesce(excluded.last_duid, inventory_devices.last_duid),
        last_iaid = coalesce(excluded.last_iaid, inventory_devices.last_iaid),
        last_lease_uuid = coalesce(excluded.last_lease_uuid, inventory_devices.last_lease_uuid),
        last_static_host_uuid = coalesce(excluded.last_static_host_uuid, inventory_devices.last_static_host_uuid),
        last_router_uuid = coalesce(excluded.last_router_uuid, inventory_devices.last_router_uuid),
        last_updated_at = excluded.last_updated_at
    `),
    upsertPairing: db.prepare(`
      INSERT INTO inventory_ip_mac_pairings (
        ip_address,
        ip_version,
        mac_address,
        interface,
        vlan,
        first_seen_at,
        last_seen_at,
        last_network_seen_at,
        first_source,
        last_source,
        hostname,
        vendor,
        interface_name,
        client_uuid,
        client_id,
        duid,
        iaid,
        lease_uuid,
        static_host_uuid,
        router_uuid,
        observation_count,
        last_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(ip_address, ip_version, mac_address, interface, vlan) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        last_network_seen_at = coalesce(excluded.last_network_seen_at, inventory_ip_mac_pairings.last_network_seen_at),
        last_source = excluded.last_source,
        hostname = coalesce(excluded.hostname, inventory_ip_mac_pairings.hostname),
        vendor = coalesce(excluded.vendor, inventory_ip_mac_pairings.vendor),
        interface_name = coalesce(excluded.interface_name, inventory_ip_mac_pairings.interface_name),
        client_uuid = coalesce(excluded.client_uuid, inventory_ip_mac_pairings.client_uuid),
        client_id = coalesce(excluded.client_id, inventory_ip_mac_pairings.client_id),
        duid = coalesce(excluded.duid, inventory_ip_mac_pairings.duid),
        iaid = coalesce(excluded.iaid, inventory_ip_mac_pairings.iaid),
        lease_uuid = coalesce(excluded.lease_uuid, inventory_ip_mac_pairings.lease_uuid),
        static_host_uuid = coalesce(excluded.static_host_uuid, inventory_ip_mac_pairings.static_host_uuid),
        router_uuid = coalesce(excluded.router_uuid, inventory_ip_mac_pairings.router_uuid),
        observation_count = inventory_ip_mac_pairings.observation_count + 1,
        last_updated_at = excluded.last_updated_at
    `),
    deleteOldObservations: db.prepare(`
      DELETE FROM inventory_observations
      WHERE observed_at < ?
    `),
    lastPollRun: db.prepare(`
      SELECT *
      FROM inventory_poll_runs
      ORDER BY id DESC
      LIMIT 1
    `),
    counts: db.prepare(`
      SELECT
        (SELECT count(*) FROM inventory_devices) AS devices,
        (SELECT count(*) FROM inventory_ip_mac_pairings) AS pairings,
        (SELECT count(*) FROM inventory_observations) AS observations,
        (SELECT count(*) FROM inventory_poll_runs) AS poll_runs
    `)
  };

  const startPollRun = ({ trigger, startedAt }) => {
    const result = statements.startPollRun.run(trigger, startedAt);
    return Number(result.lastInsertRowid);
  };

  const finishPollRun = ({ id, finishedAt, status, counts, error }) => {
    statements.finishPollRun.run(
      finishedAt,
      status,
      counts.leases ?? 0,
      counts.arp ?? 0,
      counts.ndp ?? 0,
      counts.static_hosts ?? 0,
      counts.interfaces ?? 0,
      counts.observations ?? 0,
      jsonOrNull({ value: error }),
      id
    );
  };

  const recordObservations = ({ pollRunId, observations, updatedAt }) => {
    return runTransaction({
      db,
      fn: () => {
        for (const observation of observations) {
          const observedAt = observation.observed_at;
          const networkSeenAt = NETWORK_SOURCES.has(observation.source) ? observedAt : null;
          const macAddress = nullableText({ value: observation.mac_address });
          const ipAddress = nullableText({ value: observation.ip_address });
          const ipVersion = nullableInteger({ value: observation.ip_version });
          const interfaceKey = keyText({ value: observation.interface });
          const vlanKey = keyText({ value: observation.vlan });

          statements.insertObservation.run(
            observedAt,
            pollRunId,
            observation.source,
            ipAddress,
            ipVersion,
            macAddress,
            nullableText({ value: observation.hostname }),
            nullableText({ value: observation.vendor }),
            nullableText({ value: observation.interface }),
            nullableText({ value: observation.interface_name }),
            nullableText({ value: observation.vlan }),
            nullableText({ value: observation.client_uuid }),
            nullableText({ value: observation.client_id }),
            nullableText({ value: observation.duid }),
            nullableText({ value: observation.iaid }),
            nullableText({ value: observation.lease_uuid }),
            nullableText({ value: observation.static_host_uuid }),
            nullableText({ value: observation.router_uuid }),
            jsonOrNull({ value: observation.raw })
          );

          if (macAddress) {
            statements.upsertDevice.run(
              macAddress,
              observedAt,
              observedAt,
              networkSeenAt,
              observation.source,
              ipAddress,
              ipVersion,
              nullableText({ value: observation.hostname }),
              nullableText({ value: observation.vendor }),
              nullableText({ value: observation.interface }),
              nullableText({ value: observation.interface_name }),
              nullableText({ value: observation.vlan }),
              nullableText({ value: observation.client_uuid }),
              nullableText({ value: observation.client_id }),
              nullableText({ value: observation.duid }),
              nullableText({ value: observation.iaid }),
              nullableText({ value: observation.lease_uuid }),
              nullableText({ value: observation.static_host_uuid }),
              nullableText({ value: observation.router_uuid }),
              updatedAt
            );
          }

          if (ipAddress && ipVersion && macAddress) {
            statements.upsertPairing.run(
              ipAddress,
              ipVersion,
              macAddress,
              interfaceKey,
              vlanKey,
              observedAt,
              observedAt,
              networkSeenAt,
              observation.source,
              observation.source,
              nullableText({ value: observation.hostname }),
              nullableText({ value: observation.vendor }),
              nullableText({ value: observation.interface_name }),
              nullableText({ value: observation.client_uuid }),
              nullableText({ value: observation.client_id }),
              nullableText({ value: observation.duid }),
              nullableText({ value: observation.iaid }),
              nullableText({ value: observation.lease_uuid }),
              nullableText({ value: observation.static_host_uuid }),
              nullableText({ value: observation.router_uuid }),
              updatedAt
            );
          }
        }

        return observations.length;
      }
    });
  };

  const pruneObservations = ({ before }) => {
    if (!before) {
      return 0;
    }

    return statements.deleteOldObservations.run(before).changes;
  };

  const searchDevices = (args = {}) => {
    const clauses = [];
    const params = [];
    const ipAddress = normalizeSearchIp({ value: args.ip_address });
    const macAddress = normalizeSearchMac({ value: args.mac_address });

    addQueryFilter({
      clauses,
      params,
      query: args.query,
      columns: [
        "mac_address",
        "last_ip_address",
        "last_hostname",
        "last_vendor",
        "last_interface",
        "last_interface_name",
        "last_vlan",
        "last_client_uuid",
        "last_client_id",
        "last_duid",
        "last_iaid",
        "last_lease_uuid",
        "last_static_host_uuid",
        "last_router_uuid",
        "last_seen_source"
      ]
    });

    if (ipAddress) {
      clauses.push("last_ip_address = ?");
      params.push(ipAddress);
    }

    if (macAddress) {
      clauses.push("mac_address = ?");
      params.push(macAddress);
    }

    if (args.ip_version) {
      clauses.push("last_ip_version = ?");
      params.push(args.ip_version);
    }

    addExactFilter({ clauses, params, column: "last_hostname", value: args.hostname });
    addExactFilter({ clauses, params, column: "last_interface", value: args.interface });
    addExactFilter({ clauses, params, column: "last_interface_name", value: args.interface_name });
    addExactFilter({ clauses, params, column: "last_vlan", value: args.vlan });
    addExactFilter({ clauses, params, column: "last_seen_source", value: args.source });
    addExactFilter({ clauses, params, column: "last_client_uuid", value: args.client_uuid });
    addExactFilter({ clauses, params, column: "last_client_id", value: args.client_id });
    addExactFilter({ clauses, params, column: "last_duid", value: args.duid });
    addExactFilter({ clauses, params, column: "last_iaid", value: args.iaid });
    addExactFilter({ clauses, params, column: "last_lease_uuid", value: args.lease_uuid });
    addExactFilter({ clauses, params, column: "last_static_host_uuid", value: args.static_host_uuid });
    addExactFilter({ clauses, params, column: "last_router_uuid", value: args.router_uuid });
    addTimeFilter({ clauses, params, column: "last_seen_at", operator: ">=", value: args.seen_since ?? args.observed_since });
    addTimeFilter({ clauses, params, column: "last_seen_at", operator: "<=", value: args.seen_before ?? args.observed_before });

    const limit = limitValue({ value: args.limit, fallback: 100, max: 5000 });
    return db.prepare(`
      SELECT *
      FROM inventory_devices
      ${withWhere({ clauses })}
      ORDER BY last_seen_at DESC, mac_address ASC
      LIMIT ?
    `).all(...params, limit);
  };

  const searchPairings = (args = {}) => {
    const clauses = [];
    const params = [];
    const ipAddress = normalizeSearchIp({ value: args.ip_address });
    const macAddress = normalizeSearchMac({ value: args.mac_address });

    addQueryFilter({
      clauses,
      params,
      query: args.query,
      columns: [
        "ip_address",
        "mac_address",
        "hostname",
        "vendor",
        "interface",
        "interface_name",
        "vlan",
        "client_uuid",
        "client_id",
        "duid",
        "iaid",
        "lease_uuid",
        "static_host_uuid",
        "router_uuid",
        "first_source",
        "last_source"
      ]
    });

    if (ipAddress) {
      clauses.push("ip_address = ?");
      params.push(ipAddress);
    }

    if (macAddress) {
      clauses.push("mac_address = ?");
      params.push(macAddress);
    }

    if (args.ip_version) {
      clauses.push("ip_version = ?");
      params.push(args.ip_version);
    }

    addExactFilter({ clauses, params, column: "hostname", value: args.hostname });
    addExactFilter({ clauses, params, column: "interface", value: args.interface });
    addExactFilter({ clauses, params, column: "interface_name", value: args.interface_name });
    addExactFilter({ clauses, params, column: "vlan", value: args.vlan });
    addExactFilter({ clauses, params, column: "client_uuid", value: args.client_uuid });
    addExactFilter({ clauses, params, column: "client_id", value: args.client_id });
    addExactFilter({ clauses, params, column: "duid", value: args.duid });
    addExactFilter({ clauses, params, column: "iaid", value: args.iaid });
    addExactFilter({ clauses, params, column: "lease_uuid", value: args.lease_uuid });
    addExactFilter({ clauses, params, column: "static_host_uuid", value: args.static_host_uuid });
    addExactFilter({ clauses, params, column: "router_uuid", value: args.router_uuid });

    if (args.source) {
      clauses.push("(lower(first_source) = lower(?) OR lower(last_source) = lower(?))");
      params.push(args.source, args.source);
    }

    addTimeFilter({ clauses, params, column: "last_seen_at", operator: ">=", value: args.seen_since ?? args.observed_since });
    addTimeFilter({ clauses, params, column: "last_seen_at", operator: "<=", value: args.seen_before ?? args.observed_before });

    const limit = limitValue({ value: args.limit, fallback: 100, max: 5000 });
    return db.prepare(`
      SELECT *
      FROM inventory_ip_mac_pairings
      ${withWhere({ clauses })}
      ORDER BY last_seen_at DESC, ip_address ASC, mac_address ASC
      LIMIT ?
    `).all(...params, limit);
  };

  const searchObservations = (args = {}) => {
    const clauses = [];
    const params = [];
    const ipAddress = normalizeSearchIp({ value: args.ip_address });
    const macAddress = normalizeSearchMac({ value: args.mac_address });

    addQueryFilter({
      clauses,
      params,
      query: args.query,
      columns: [
        "ip_address",
        "mac_address",
        "hostname",
        "vendor",
        "interface",
        "interface_name",
        "vlan",
        "client_uuid",
        "client_id",
        "duid",
        "iaid",
        "lease_uuid",
        "static_host_uuid",
        "router_uuid",
        "source",
        "raw_json"
      ]
    });

    if (ipAddress) {
      clauses.push("ip_address = ?");
      params.push(ipAddress);
    }

    if (macAddress) {
      clauses.push("mac_address = ?");
      params.push(macAddress);
    }

    if (args.ip_version) {
      clauses.push("ip_version = ?");
      params.push(args.ip_version);
    }

    if (args.poll_run_id) {
      clauses.push("poll_run_id = ?");
      params.push(args.poll_run_id);
    }

    addExactFilter({ clauses, params, column: "hostname", value: args.hostname });
    addExactFilter({ clauses, params, column: "interface", value: args.interface });
    addExactFilter({ clauses, params, column: "interface_name", value: args.interface_name });
    addExactFilter({ clauses, params, column: "vlan", value: args.vlan });
    addExactFilter({ clauses, params, column: "source", value: args.source });
    addExactFilter({ clauses, params, column: "client_uuid", value: args.client_uuid });
    addExactFilter({ clauses, params, column: "client_id", value: args.client_id });
    addExactFilter({ clauses, params, column: "duid", value: args.duid });
    addExactFilter({ clauses, params, column: "iaid", value: args.iaid });
    addExactFilter({ clauses, params, column: "lease_uuid", value: args.lease_uuid });
    addExactFilter({ clauses, params, column: "static_host_uuid", value: args.static_host_uuid });
    addExactFilter({ clauses, params, column: "router_uuid", value: args.router_uuid });
    addTimeFilter({ clauses, params, column: "observed_at", operator: ">=", value: args.observed_since ?? args.seen_since });
    addTimeFilter({ clauses, params, column: "observed_at", operator: "<=", value: args.observed_before ?? args.seen_before });

    const limit = limitValue({ value: args.limit, fallback: 100, max: 5000 });
    const rows = db.prepare(`
      SELECT *
      FROM inventory_observations
      ${withWhere({ clauses })}
      ORDER BY observed_at DESC, id DESC
      LIMIT ?
    `).all(...params, limit);

    return stripRawJson({ rows, includeRaw: args.include_raw });
  };

  const searchPollRuns = (args = {}) => {
    const clauses = [];
    const params = [];

    addExactFilter({ clauses, params, column: "trigger", value: args.trigger });
    addExactFilter({ clauses, params, column: "status", value: args.status });
    addTimeFilter({ clauses, params, column: "started_at", operator: ">=", value: args.started_since });
    addTimeFilter({ clauses, params, column: "started_at", operator: "<=", value: args.started_before });

    const limit = limitValue({ value: args.limit, fallback: 50, max: 500 });
    return db.prepare(`
      SELECT *
      FROM inventory_poll_runs
      ${withWhere({ clauses })}
      ORDER BY started_at DESC, id DESC
      LIMIT ?
    `).all(...params, limit);
  };

  const exportColumns = ({ tableConfig, includeRaw }) => {
    const rawColumns = new Set(includeRaw ? [] : tableConfig.rawColumns);
    return db.prepare('PRAGMA table_info(' + tableConfig.tableName + ')')
      .all()
      .map((row) => row.name)
      .filter((column) => !rawColumns.has(column));
  };

  const exportRows = ({ table, includeRaw = false } = {}) => {
    const tableConfig = exportTableConfig({ table });
    if (tableConfig === null) {
      return null;
    }

    const columns = exportColumns({ tableConfig, includeRaw });
    const separator = String.fromCharCode(44) + String.fromCharCode(32);
    const sql = [
      'SELECT ' + columns.map((column) => quoteIdentifier({ value: column })).join(separator),
      'FROM ' + tableConfig.tableName,
      'ORDER BY ' + tableConfig.orderBy
    ].join(String.fromCharCode(10));
    const rows = db.prepare(sql).all();

    return {
      table,
      columns,
      row_count: rows.length,
      rows
    };
  };

  const exportCsv = ({ table, includeRaw = false } = {}) => {
    const exported = exportRows({ table, includeRaw });
    return exported ? {
      ...exported,
      csv: rowsToCsv(exported)
    } : null;
  };

  const status = () => {
    return {
      counts: statements.counts.get(),
      last_poll_run: statements.lastPollRun.get() ?? null
    };
  };

  return {
    startPollRun,
    finishPollRun,
    recordObservations,
    pruneObservations,
    searchDevices,
    searchPairings,
    searchObservations,
    searchPollRuns,
    exportCsv,
    exportRows,
    status,
    close: () => {
      db.close();
    }
  };
};
