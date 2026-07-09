import {
  normalizeIpv4,
  normalizeMac,
  normalizeMacList,
  normalizeStringList,
  splitList,
  stripControlChars
} from "./ipUtils.js";

export const normalizeBoolean = ({ value, fallback = false }) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "enabled", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "disabled", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};

export const includeRaw = ({ normalized, raw, enabled = false }) => {
  if (enabled) {
    normalized.raw = raw;
  }

  return normalized;
};

export const unwrapValue = ({ value, keys = [] }) => {
  if (!value || typeof value !== "object") {
    return value;
  }

  for (const key of keys) {
    if (value[key] && typeof value[key] === "object") {
      return value[key];
    }
  }

  return value;
};

export const extractRows = ({ value }) => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value.rows)) {
    return value.rows;
  }

  if (Array.isArray(value.records)) {
    return value.records;
  }

  if (Array.isArray(value.items)) {
    return value.items;
  }

  const nestedCandidates = [
    value.hosts,
    value.host,
    value.range,
    value.ranges,
    value.option,
    value.options,
    value.dhcp_ranges,
    value.dhcp_options
  ];

  for (const candidate of nestedCandidates) {
    if (candidate !== undefined && candidate !== value) {
      const rows = extractRows({ value: candidate });
      if (rows.length > 0) {
        return rows;
      }
    }
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    const uuidLikeEntries = entries.filter(([, row]) => row && typeof row === "object");

    if (uuidLikeEntries.length > 0) {
      return uuidLikeEntries.map(([uuid, row]) => ({
        uuid: row.uuid ?? uuid,
        ...row
      }));
    }
  }

  return [];
};

const pickFirst = ({ value, keys, fallback = "" }) => {
  for (const key of keys) {
    if (value?.[key] !== undefined && value[key] !== null) {
      return value[key];
    }
  }

  return fallback;
};

const firstMacFromValue = ({ value }) => {
  const normalized = normalizeMacList({ value });
  return normalized[0] ?? "";
};

export const normalizeStaticHost = ({ value, include_raw = false }) => {
  const row = unwrapValue({
    value,
    keys: ["host"]
  }) ?? {};
  const uuid = String(pickFirst({ value: row, keys: ["uuid", "_uuid", "id"], fallback: "" }));
  const hostname = stripControlChars({ value: pickFirst({ value: row, keys: ["hostname", "host"] }) });
  const ipAddress = normalizeIpv4({
    value: pickFirst({ value: row, keys: ["ip_address", "ip", "address"] })
  }) ?? "";
  const hwAddress = firstMacFromValue({
    value: pickFirst({ value: row, keys: ["hw_address", "hwaddr", "mac_address", "mac"] })
  });
  const enabled = !normalizeBoolean({
    value: pickFirst({ value: row, keys: ["disabled"], fallback: false }),
    fallback: false
  });
  const normalized = {
    uuid,
    hostname,
    domain: stripControlChars({ value: pickFirst({ value: row, keys: ["domain"] }) }),
    local: normalizeBoolean({ value: pickFirst({ value: row, keys: ["local"] }) }),
    ip_address: ipAddress,
    cnames: normalizeStringList({ value: pickFirst({ value: row, keys: ["cnames", "cname"] }) }),
    client_id: stripControlChars({ value: pickFirst({ value: row, keys: ["client_id"] }) }),
    hw_address: hwAddress,
    lease_time: String(pickFirst({ value: row, keys: ["lease_time"], fallback: "" })),
    ignore: normalizeBoolean({ value: pickFirst({ value: row, keys: ["ignore"] }) }),
    set_tag: stripControlChars({ value: pickFirst({ value: row, keys: ["set_tag", "tag"] }) }),
    description: stripControlChars({
      value: pickFirst({ value: row, keys: ["description", "descr", "comments"] })
    }),
    aliases: normalizeStringList({ value: pickFirst({ value: row, keys: ["aliases"] }) }),
    enabled,
    is_dhcp_reservation: Boolean(ipAddress && (hwAddress || row.client_id))
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const normalizeLease = ({ value, include_raw = false }) => {
  const row = value ?? {};
  const normalized = {
    ip_address: normalizeIpv4({
      value: pickFirst({ value: row, keys: ["ip_address", "address", "ip"] })
    }) ?? "",
    mac_address: firstMacFromValue({
      value: pickFirst({ value: row, keys: ["mac_address", "hwaddr", "hw_address", "mac"] })
    }),
    hostname: stripControlChars({ value: pickFirst({ value: row, keys: ["hostname", "host", "name"] }) }),
    client_id: stripControlChars({ value: pickFirst({ value: row, keys: ["client_id"] }) }),
    interface: stripControlChars({
      value: pickFirst({ value: row, keys: ["if_descr", "interface", "interface_name", "if_name"] })
    }),
    lease_start: String(pickFirst({ value: row, keys: ["lease_start", "start"] })),
    lease_end: String(pickFirst({ value: row, keys: ["lease_end", "end"] })),
    expires: String(pickFirst({ value: row, keys: ["expires", "expiry", "valid_until"] })),
    is_static: normalizeBoolean({
      value: pickFirst({ value: row, keys: ["is_static", "is_reserved", "static"] })
    }),
    source: stripControlChars({ value: pickFirst({ value: row, keys: ["source"], fallback: "dnsmasq" }) })
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const normalizeDhcpRange = ({ value, include_raw = false }) => {
  const row = unwrapValue({ value, keys: ["range"] }) ?? {};
  const mode = String(pickFirst({ value: row, keys: ["mode"], fallback: "" }));
  const startAddress = normalizeIpv4({
    value: pickFirst({ value: row, keys: ["start_address", "start_addr", "start"] })
  }) ?? "";
  const endAddress = normalizeIpv4({
    value: pickFirst({ value: row, keys: ["end_address", "end_addr", "end"] })
  }) ?? "";
  const normalized = {
    uuid: String(pickFirst({ value: row, keys: ["uuid", "_uuid", "id"], fallback: "" })),
    interface: stripControlChars({ value: pickFirst({ value: row, keys: ["interface"] }) }),
    start_address: startAddress,
    end_address: endAddress,
    mode,
    is_static_only: splitList({ value: mode }).includes("static"),
    is_dynamic: !splitList({ value: mode }).includes("static"),
    domain: stripControlChars({ value: pickFirst({ value: row, keys: ["domain"] }) }),
    description: stripControlChars({
      value: pickFirst({ value: row, keys: ["description", "descr"] })
    })
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const normalizeDhcpOption = ({ value, include_raw = false }) => {
  const row = unwrapValue({ value, keys: ["option"] }) ?? {};
  const normalized = {
    uuid: String(pickFirst({ value: row, keys: ["uuid", "_uuid", "id"], fallback: "" })),
    interface: stripControlChars({ value: pickFirst({ value: row, keys: ["interface"] }) }),
    type: stripControlChars({ value: pickFirst({ value: row, keys: ["type"], fallback: "set" }) }),
    option: stripControlChars({
      value: pickFirst({ value: row, keys: ["option", "option6"], fallback: "" })
    }),
    value: String(pickFirst({ value: row, keys: ["value"], fallback: "" })),
    tag: stripControlChars({ value: pickFirst({ value: row, keys: ["tag", "set_tag"] }) }),
    force: normalizeBoolean({ value: pickFirst({ value: row, keys: ["force"] }) }),
    description: stripControlChars({
      value: pickFirst({ value: row, keys: ["description", "descr"] })
    })
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const normalizeArpRow = ({ value, include_raw = false }) => {
  const row = value ?? {};
  const normalized = {
    ip_address: normalizeIpv4({
      value: pickFirst({ value: row, keys: ["ip_address", "ip", "address"] })
    }) ?? "",
    mac_address: firstMacFromValue({
      value: pickFirst({ value: row, keys: ["mac_address", "mac", "hwaddr", "ether"] })
    }),
    manufacturer: stripControlChars({
      value: pickFirst({ value: row, keys: ["manufacturer", "mac_info", "vendor"] })
    }),
    interface: stripControlChars({ value: pickFirst({ value: row, keys: ["intf", "interface"] }) }),
    interface_name: stripControlChars({
      value: pickFirst({ value: row, keys: ["intf_description", "interface_name"] })
    }),
    hostname: stripControlChars({ value: pickFirst({ value: row, keys: ["hostname", "host", "name"] }) })
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const normalizeDnsmasqStatus = ({ value, include_raw = false }) => {
  const statusRaw = pickFirst({
    value: value ?? {},
    keys: ["status", "result", "state"],
    fallback: "unknown"
  });
  const statusString = String(statusRaw).toLowerCase();
  const status = statusString.includes("run") || statusString === "ok" ? "running" : (
    statusString.includes("stop") ? "stopped" : "unknown"
  );
  const normalized = {
    ok: true,
    service: "dnsmasq",
    status
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const buildHostPayload = ({ record }) => {
  return {
    host: stripControlChars({ value: record.hostname }),
    domain: stripControlChars({ value: record.domain }),
    local: record.local ? "1" : "0",
    ip: normalizeIpv4({ value: record.ip_address }) ?? "",
    cnames: normalizeStringList({ value: record.cnames }).join(","),
    client_id: stripControlChars({ value: record.client_id }),
    hwaddr: normalizeMacList({ value: record.hw_address }).join(","),
    lease_time: String(record.lease_time ?? ""),
    ignore: record.ignore ? "1" : "0",
    set_tag: stripControlChars({ value: record.set_tag }),
    descr: stripControlChars({ value: record.description }),
    aliases: normalizeStringList({ value: record.aliases }).join(",")
  };
};
