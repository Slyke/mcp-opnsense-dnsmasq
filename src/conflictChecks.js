import {
  cidrContainsIp,
  findMatchingRanges,
  normalizeIpv4,
  normalizeMac
} from "./ipUtils.js";

const addConflict = ({ conflicts, type, severity, message, match = {} }) => {
  conflicts.push({
    type,
    severity,
    message,
    match
  });
};

const normalizeComparableHostname = ({ value }) => {
  return String(value ?? "").trim().toLowerCase();
};

const isSameUuid = ({ row, ignoreUuid }) => {
  return ignoreUuid && row.uuid && row.uuid === ignoreUuid;
};

const ipAllowedByCidrs = ({ ip, cidrs }) => {
  if (!ip || cidrs.length === 0) {
    return false;
  }

  return cidrs.some((cidr) => cidrContainsIp({ cidr, ip }));
};

export const findStaticReservationConflicts = ({
  config,
  ipAddress,
  macAddress,
  hostname,
  ignoreUuid,
  staticHosts = [],
  leases = [],
  arp = [],
  dynamicRanges = []
}) => {
  const conflicts = [];
  const normalizedIp = normalizeIpv4({ value: ipAddress });
  const normalizedMac = macAddress ? normalizeMac({ value: macAddress }) : "";
  const normalizedHostname = normalizeComparableHostname({ value: hostname });

  if (normalizedIp) {
    if (config.allowedStaticDhcpCidrs.length === 0) {
      addConflict({
        conflicts,
        type: "outside_allowed_cidr",
        severity: "error",
        message: "No allowed static DHCP CIDRs are configured.",
        match: {
          ip_address: normalizedIp
        }
      });
    } else if (!ipAllowedByCidrs({ ip: normalizedIp, cidrs: config.allowedStaticDhcpCidrs })) {
      addConflict({
        conflicts,
        type: "outside_allowed_cidr",
        severity: "error",
        message: "IP address is outside allowed static DHCP CIDRs.",
        match: {
          ip_address: normalizedIp,
          allowed_static_dhcp_cidrs: config.allowedStaticDhcpCidrs
        }
      });
    }

    if (config.protectedIps.includes(normalizedIp)) {
      addConflict({
        conflicts,
        type: "protected_ip",
        severity: "error",
        message: "IP address is protected.",
        match: {
          ip_address: normalizedIp
        }
      });
    }

    for (const range of findMatchingRanges({ ranges: config.excludedIpRanges, ip: normalizedIp })) {
      addConflict({
        conflicts,
        type: "excluded_range",
        severity: "error",
        message: "IP address is inside an excluded range.",
        match: {
          ip_address: normalizedIp,
          range
        }
      });
    }

    for (const range of findMatchingRanges({
      ranges: [...config.dynamicDhcpRanges, ...dynamicRanges],
      ip: normalizedIp
    })) {
      addConflict({
        conflicts,
        type: "dynamic_range_overlap",
        severity: config.rejectStaticInsideDynamicRange ? "error" : "warning",
        message: "IP address is inside a dynamic DHCP range.",
        match: {
          ip_address: normalizedIp,
          range
        }
      });
    }
  }

  for (const host of staticHosts) {
    if (isSameUuid({ row: host, ignoreUuid })) {
      continue;
    }

    if (normalizedIp && host.ip_address === normalizedIp) {
      addConflict({
        conflicts,
        type: "static_host_duplicate_ip",
        severity: "error",
        message: "Another Dnsmasq host uses this IP address.",
        match: host
      });
    }

    if (normalizedMac && host.hw_address === normalizedMac) {
      addConflict({
        conflicts,
        type: "static_host_duplicate_mac",
        severity: "error",
        message: "Another Dnsmasq host uses this MAC address.",
        match: host
      });
    }

    if (normalizedHostname && normalizeComparableHostname({ value: host.hostname }) === normalizedHostname) {
      addConflict({
        conflicts,
        type: "static_host_duplicate_hostname",
        severity: "warning",
        message: "Another Dnsmasq host uses this hostname.",
        match: host
      });
    }
  }

  for (const lease of leases) {
    if (normalizedIp && lease.ip_address === normalizedIp && normalizedMac && lease.mac_address !== normalizedMac) {
      addConflict({
        conflicts,
        type: "lease_uses_ip",
        severity: "warning",
        message: "A DHCP lease shows this IP address belongs to a different MAC address.",
        match: lease
      });
    }

    if (normalizedMac && lease.mac_address === normalizedMac && normalizedIp && lease.ip_address !== normalizedIp) {
      addConflict({
        conflicts,
        type: "lease_uses_mac",
        severity: "warning",
        message: "A DHCP lease shows this MAC address currently has a different IP address.",
        match: lease
      });
    }
  }

  for (const row of arp) {
    if (normalizedIp && row.ip_address === normalizedIp && normalizedMac && row.mac_address !== normalizedMac) {
      addConflict({
        conflicts,
        type: "arp_uses_ip",
        severity: "warning",
        message: "ARP shows this IP address belongs to a different MAC address.",
        match: row
      });
    }
  }

  return {
    ok: true,
    conflicts,
    can_create: !conflicts.some((conflict) => conflict.severity === "error"),
    can_update: !conflicts.some((conflict) => conflict.severity === "error")
  };
};
