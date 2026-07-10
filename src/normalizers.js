import {
  ipVersionOf,
  normalizeIpAddress,
  normalizeIpv4,
  normalizeIpv6,
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
    value.tag,
    value.tags,
    value.dhcp_tags,
    value.domainoverride,
    value.domainoverrides,
    value.domain_overrides,
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

const dhcpRangeModeParts = ({ value }) => {
  return splitList({ value }).map((item) => item.toLowerCase());
};

export const dhcpRangePolicyMode = ({ mode }) => {
  return dhcpRangeModeParts({ value: mode }).includes("static") ? "whitelist" : "blacklist";
};

export const dhcpRangeRawModeFromPolicy = ({ policyMode }) => {
  return ["whitelist", "static", "static_only"].includes(String(policyMode ?? "").toLowerCase()) ? "static" : "";
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
    is_blocked: normalizeBoolean({ value: pickFirst({ value: row, keys: ["ignore"] }) }),
    is_block_only: Boolean(normalizeBoolean({ value: pickFirst({ value: row, keys: ["ignore"] }) }) && !ipAddress),
    is_dhcp_reservation: Boolean(ipAddress && (hwAddress || row.client_id))
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const normalizeLease = ({ value, include_raw = false }) => {
  const row = value ?? {};
  const ipAddress = normalizeIpAddress({
    value: pickFirst({ value: row, keys: ["ip_address", "address", "ip", "ipv6", "ipv6_address"] })
  });
  const uuid = String(pickFirst({ value: row, keys: ["uuid", "_uuid", "id"], fallback: "" }));
  const normalized = {
    uuid,
    ip_address: ipAddress,
    ip_version: ipVersionOf({ value: ipAddress }),
    mac_address: firstMacFromValue({
      value: pickFirst({ value: row, keys: ["mac_address", "hwaddr", "hw_address", "mac"] })
    }),
    hostname: stripControlChars({ value: pickFirst({ value: row, keys: ["hostname", "host", "name"] }) }),
    client_id: stripControlChars({ value: pickFirst({ value: row, keys: ["client_id"] }) }),
    client_uuid: stripControlChars({
      value: pickFirst({ value: row, keys: ["client_uuid", "clientid_uuid", "client_id_uuid"] })
    }),
    duid: stripControlChars({ value: pickFirst({ value: row, keys: ["duid", "dhcp_unique_identifier"] }) }),
    iaid: stripControlChars({ value: pickFirst({ value: row, keys: ["iaid", "identity_association_id"] }) }),
    lease_uuid: stripControlChars({ value: pickFirst({ value: row, keys: ["lease_uuid"], fallback: uuid }) }),
    interface: stripControlChars({
      value: pickFirst({ value: row, keys: ["if_descr", "interface", "interface_name", "if_name"] })
    }),
    interface_name: stripControlChars({
      value: pickFirst({ value: row, keys: ["intf_description", "interface_description", "if_descr"] })
    }),
    vlan: stripControlChars({ value: pickFirst({ value: row, keys: ["vlan", "vlan_tag", "tag"] }) }),
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
    set_tag: stripControlChars({ value: pickFirst({ value: row, keys: ["set_tag", "tag"] }) }),
    start_address: startAddress,
    end_address: endAddress,
    subnet_mask: normalizeIpv4({
      value: pickFirst({ value: row, keys: ["subnet_mask"] })
    }) ?? "",
    constructor: stripControlChars({ value: pickFirst({ value: row, keys: ["constructor"] }) }),
    mode,
    is_static_only: splitList({ value: mode }).includes("static"),
    is_dynamic: !splitList({ value: mode }).includes("static"),
    policy_mode: dhcpRangePolicyMode({ mode }),
    prefix_len: String(pickFirst({ value: row, keys: ["prefix_len"], fallback: "" })),
    lease_time: String(pickFirst({ value: row, keys: ["lease_time"], fallback: "" })),
    domain_type: stripControlChars({
      value: pickFirst({ value: row, keys: ["domain_type"], fallback: "range" })
    }),
    domain: stripControlChars({ value: pickFirst({ value: row, keys: ["domain"] }) }),
    nosync: normalizeBoolean({ value: pickFirst({ value: row, keys: ["nosync"] }) }),
    ra_mode: normalizeStringList({ value: pickFirst({ value: row, keys: ["ra_mode"] }) }),
    ra_priority: stripControlChars({ value: pickFirst({ value: row, keys: ["ra_priority"] }) }),
    ra_mtu: String(pickFirst({ value: row, keys: ["ra_mtu"], fallback: "" })),
    ra_interval: String(pickFirst({ value: row, keys: ["ra_interval"], fallback: "" })),
    ra_router_lifetime: String(pickFirst({ value: row, keys: ["ra_router_lifetime"], fallback: "" })),
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
    option6: stripControlChars({ value: pickFirst({ value: row, keys: ["option6"], fallback: "" }) }),
    value: String(pickFirst({ value: row, keys: ["value"], fallback: "" })),
    tag: normalizeStringList({ value: pickFirst({ value: row, keys: ["tag"] }) }),
    set_tag: stripControlChars({ value: pickFirst({ value: row, keys: ["set_tag"] }) }),
    force: normalizeBoolean({ value: pickFirst({ value: row, keys: ["force"] }) }),
    description: stripControlChars({
      value: pickFirst({ value: row, keys: ["description", "descr"] })
    })
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const normalizeDhcpTag = ({ value, include_raw = false }) => {
  const row = unwrapValue({ value, keys: ["tag"] }) ?? {};
  const normalized = {
    uuid: String(pickFirst({ value: row, keys: ["uuid", "_uuid", "id"], fallback: "" })),
    tag: stripControlChars({ value: pickFirst({ value: row, keys: ["tag", "name"] }) })
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const normalizeDhcpDomain = ({ value, include_raw = false }) => {
  const row = unwrapValue({ value, keys: ["domainoverride"] }) ?? {};
  const normalized = {
    uuid: String(pickFirst({ value: row, keys: ["uuid", "_uuid", "id"], fallback: "" })),
    sequence: String(pickFirst({ value: row, keys: ["sequence"], fallback: "" })),
    domain: stripControlChars({ value: pickFirst({ value: row, keys: ["domain"] }) }),
    ipset: stripControlChars({ value: pickFirst({ value: row, keys: ["ipset"] }) }),
    srcip: stripControlChars({ value: pickFirst({ value: row, keys: ["srcip"] }) }),
    port: String(pickFirst({ value: row, keys: ["port"], fallback: "" })),
    ip: stripControlChars({ value: pickFirst({ value: row, keys: ["ip"] }) }),
    description: stripControlChars({
      value: pickFirst({ value: row, keys: ["description", "descr"] })
    })
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const normalizeArpRow = ({ value, include_raw = false }) => {
  const row = value ?? {};
  const ipAddress = normalizeIpv4({
    value: pickFirst({ value: row, keys: ["ip_address", "ip", "address"] })
  }) ?? "";
  const normalized = {
    ip_address: ipAddress,
    ip_version: ipVersionOf({ value: ipAddress }),
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
    vlan: stripControlChars({ value: pickFirst({ value: row, keys: ["vlan", "vlan_tag", "tag"] }) }),
    hostname: stripControlChars({ value: pickFirst({ value: row, keys: ["hostname", "host", "name"] }) })
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const normalizeNdpRow = ({ value, include_raw = false }) => {
  const row = value ?? {};
  const ipAddress = normalizeIpv6({
    value: pickFirst({
      value: row,
      keys: ["ip_address", "ipv6_address", "ipv6", "ip", "address", "neighbor", "target"]
    })
  }) ?? "";
  const normalized = {
    ip_address: ipAddress,
    ip_version: ipVersionOf({ value: ipAddress }),
    mac_address: firstMacFromValue({
      value: pickFirst({ value: row, keys: ["mac_address", "mac", "hwaddr", "ether", "lladdr"] })
    }),
    manufacturer: stripControlChars({
      value: pickFirst({ value: row, keys: ["manufacturer", "mac_info", "vendor"] })
    }),
    interface: stripControlChars({ value: pickFirst({ value: row, keys: ["intf", "interface", "if", "if_name"] }) }),
    interface_name: stripControlChars({
      value: pickFirst({ value: row, keys: ["intf_description", "interface_name", "if_descr"] })
    }),
    vlan: stripControlChars({ value: pickFirst({ value: row, keys: ["vlan", "vlan_tag", "tag"] }) }),
    hostname: stripControlChars({ value: pickFirst({ value: row, keys: ["hostname", "host", "name"] }) }),
    state: stripControlChars({ value: pickFirst({ value: row, keys: ["state", "status"] }) }),
    expires: String(pickFirst({ value: row, keys: ["expires", "expiry", "expire"] }))
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const normalizeDnsmasqSettings = ({ value, include_raw = false }) => {
  const row = unwrapValue({ value, keys: ["dnsmasq"] }) ?? {};
  const dhcp = row.dhcp ?? {};
  const normalized = {
    enabled: normalizeBoolean({ value: pickFirst({ value: row, keys: ["enable"] }) }),
    register_dhcp: normalizeBoolean({ value: pickFirst({ value: row, keys: ["regdhcp"] }) }),
    register_dhcp_static: normalizeBoolean({ value: pickFirst({ value: row, keys: ["regdhcpstatic"] }) }),
    dhcp_first: normalizeBoolean({ value: pickFirst({ value: row, keys: ["dhcpfirst"] }) }),
    strict_interface_binding: normalizeBoolean({ value: pickFirst({ value: row, keys: ["strictbind"] }) }),
    dnssec: normalizeBoolean({ value: pickFirst({ value: row, keys: ["dnssec"] }) }),
    log_queries: normalizeBoolean({ value: pickFirst({ value: row, keys: ["log_queries"] }) }),
    dns_forward_max: String(pickFirst({ value: row, keys: ["dns_forward_max"], fallback: "" })),
    cache_size: String(pickFirst({ value: row, keys: ["cache_size"], fallback: "" })),
    no_ident: normalizeBoolean({ value: pickFirst({ value: row, keys: ["no_ident"] }), fallback: true }),
    strict_order: normalizeBoolean({ value: pickFirst({ value: row, keys: ["strict_order"] }) }),
    domain_needed: normalizeBoolean({ value: pickFirst({ value: row, keys: ["domain_needed"] }) }),
    no_private_reverse: normalizeBoolean({ value: pickFirst({ value: row, keys: ["no_private_reverse"] }) }),
    no_resolv: normalizeBoolean({ value: pickFirst({ value: row, keys: ["no_resolv"] }) }),
    no_hosts: normalizeBoolean({ value: pickFirst({ value: row, keys: ["no_hosts"] }) }),
    interface: normalizeStringList({ value: pickFirst({ value: row, keys: ["interface"] }) }),
    interfaces: normalizeStringList({ value: pickFirst({ value: row, keys: ["interface"] }) }),
    dns_listen_port: String(pickFirst({ value: row, keys: ["port"], fallback: "" })),
    port: String(pickFirst({ value: row, keys: ["port"], fallback: "" })),
    dhcp: {
      disabled_interfaces: normalizeStringList({ value: pickFirst({ value: dhcp, keys: ["no_interface"] }) }),
      no_interface: normalizeStringList({ value: pickFirst({ value: dhcp, keys: ["no_interface"] }) }),
      fqdn: normalizeBoolean({ value: pickFirst({ value: dhcp, keys: ["fqdn"] }), fallback: true }),
      dhcp_fqdn: normalizeBoolean({ value: pickFirst({ value: dhcp, keys: ["fqdn"] }), fallback: true }),
      domain: stripControlChars({ value: pickFirst({ value: dhcp, keys: ["domain", "%domain"] }) }),
      local: normalizeBoolean({ value: pickFirst({ value: dhcp, keys: ["local"] }), fallback: true }),
      local_domain: normalizeBoolean({ value: pickFirst({ value: dhcp, keys: ["local"] }), fallback: true }),
      lease_max: String(pickFirst({ value: dhcp, keys: ["lease_max"], fallback: "" })),
      authoritative: normalizeBoolean({ value: pickFirst({ value: dhcp, keys: ["authoritative"] }) }),
      dhcp_authoritative: normalizeBoolean({ value: pickFirst({ value: dhcp, keys: ["authoritative"] }) }),
      default_firewall_rules: normalizeBoolean({
        value: pickFirst({ value: dhcp, keys: ["default_fw_rules"] }),
        fallback: true
      }),
      register_firewall_rules: normalizeBoolean({
        value: pickFirst({ value: dhcp, keys: ["default_fw_rules"] }),
        fallback: true
      }),
      reply_delay: String(pickFirst({ value: dhcp, keys: ["reply_delay"], fallback: "" })),
      enable_ra: normalizeBoolean({ value: pickFirst({ value: dhcp, keys: ["enable_ra"] }) }),
      host_ping: normalizeBoolean({ value: pickFirst({ value: dhcp, keys: ["host_ping"] }), fallback: true }),
      nosync: normalizeBoolean({ value: pickFirst({ value: dhcp, keys: ["nosync"] }) }),
      log_dhcp: normalizeBoolean({ value: pickFirst({ value: dhcp, keys: ["log_dhcp"] }) }),
      log_quiet: normalizeBoolean({ value: pickFirst({ value: dhcp, keys: ["log_quiet"] }) })
    }
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

export const normalizeInterfaceSummary = ({ value, include_raw = false }) => {
  const row = value ?? {};
  const normalized = {
    identifier: stripControlChars({ value: pickFirst({ value: row, keys: ["identifier"] }) }),
    device: stripControlChars({ value: pickFirst({ value: row, keys: ["device", "name"] }) }),
    description: stripControlChars({ value: pickFirst({ value: row, keys: ["description", "descr"] }) }),
    status: stripControlChars({ value: pickFirst({ value: row, keys: ["status"] }) }),
    enabled: normalizeBoolean({ value: pickFirst({ value: row, keys: ["enabled"] }) }),
    link_type: stripControlChars({ value: pickFirst({ value: row, keys: ["link_type"] }) }),
    mac_address: firstMacFromValue({ value: pickFirst({ value: row, keys: ["macaddr", "mac_address"] }) }),
    ipv4: Array.isArray(row.ipv4) ? row.ipv4 : [],
    ipv6: Array.isArray(row.ipv6) ? row.ipv6 : [],
    addr4: String(pickFirst({ value: row, keys: ["addr4"], fallback: "" })),
    addr6: String(pickFirst({ value: row, keys: ["addr6"], fallback: "" })),
    gateways: Array.isArray(row.gateways) ? row.gateways : [],
    routes: Array.isArray(row.routes) ? row.routes : [],
    vlan_tag: row.vlan_tag ?? null
  };

  return includeRaw({ normalized, raw: value, enabled: include_raw });
};

export const normalizeInterfaceDetail = ({ value, include_raw = false }) => {
  const row = value?.message && typeof value.message === "object" ? value.message : value ?? {};
  const flattened = Object.fromEntries(
    Object.entries(row).map(([key, entry]) => [
      key,
      entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, "value") ? entry.value : entry
    ])
  );
  const normalized = {
    ...normalizeInterfaceSummary({ value: flattened }),
    fields: flattened
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
