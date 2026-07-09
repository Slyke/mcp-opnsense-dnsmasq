import { z } from "zod";
import {
  isHostnameOrIp,
  isValidHostname,
  isValidIpv4,
  isValidMac,
  normalizeIpv4,
  normalizeMac,
  stripControlChars
} from "./ipUtils.js";

const optionalString = z.string().trim().optional();
const optionalBoolean = z.boolean().optional();
const includeRawField = {
  include_raw: optionalBoolean
};

export const macAddressSchema = z.string().refine((value) => isValidMac({ value }), {
  message: "Invalid MAC address."
});

export const ipv4AddressSchema = z.string().refine((value) => isValidIpv4({ value }), {
  message: "Invalid IPv4 address."
});

export const hostnameSchema = z.string().refine((value) => isValidHostname({ value }), {
  message: "Invalid hostname."
});

export const hostnameOrIpSchema = z.string().refine((value) => isHostnameOrIp({ value }), {
  message: "Target must be a hostname or IP address."
});

export const applySchema = z.boolean().default(false);

export const dnsmasqStatusSchema = {
  ...includeRawField
};

export const leasesSearchSchema = {
  query: optionalString,
  ip_address: optionalString,
  mac_address: optionalString,
  hostname: optionalString,
  interface: optionalString,
  only_static: optionalBoolean,
  only_dynamic: optionalBoolean,
  limit: z.number().int().min(1).max(1000).default(100).optional(),
  ...includeRawField
};

export const staticListSchema = {
  query: optionalString,
  ip_address: optionalString,
  mac_address: optionalString,
  hostname: optionalString,
  include_disabled: z.boolean().default(true).optional(),
  limit: z.number().int().min(1).max(5000).default(500).optional(),
  ...includeRawField
};

export const staticGetSchema = {
  uuid: optionalString,
  ip_address: optionalString,
  mac_address: optionalString,
  hostname: optionalString,
  ...includeRawField
};

export const conflictSchema = {
  ip_address: optionalString,
  mac_address: optionalString,
  hostname: optionalString,
  ignore_uuid: optionalString,
  include_arp: z.boolean().default(true).optional(),
  include_leases: z.boolean().default(true).optional()
};

export const staticCreateSchema = {
  hostname: z.string().min(1),
  ip_address: z.string().min(1),
  hw_address: optionalString,
  client_id: optionalString,
  domain: z.string().default("").optional(),
  description: optionalString,
  aliases: z.union([z.array(z.string()), z.string()]).optional(),
  cnames: z.union([z.array(z.string()), z.string()]).optional(),
  lease_time: optionalString,
  local: z.boolean().default(false).optional(),
  ignore: z.boolean().default(false).optional(),
  set_tag: optionalString,
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional()
};

export const staticUpdateSchema = {
  uuid: z.string().min(1),
  hostname: optionalString,
  ip_address: optionalString,
  hw_address: optionalString,
  client_id: optionalString,
  domain: optionalString,
  description: optionalString,
  aliases: z.union([z.array(z.string()), z.string()]).optional(),
  cnames: z.union([z.array(z.string()), z.string()]).optional(),
  lease_time: optionalString,
  local: optionalBoolean,
  ignore: optionalBoolean,
  set_tag: optionalString,
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional()
};

export const staticDeleteSchema = {
  uuid: z.string().min(1),
  confirm: z.boolean(),
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional()
};

const dhcpClientIdSchema = z.string().trim().refine((value) => {
  return value === "*" || /^(?:[0-9A-Fa-f]{2})(?::[0-9A-Fa-f]{2})+$/.test(value);
}, {
  message: "client_id must be * or a colon-separated hexadecimal DHCP client identifier."
}).optional();

export const dnsmasqSettingsGetSchema = {
  ...includeRawField
};

const optionalStringList = z.union([z.array(z.string()), z.string()]).optional();

export const dnsmasqSettingsUpdateSchema = {
  enabled: optionalBoolean,
  interface: optionalStringList,
  strict_interface_binding: optionalBoolean,
  dns_listen_port: z.number().int().min(0).max(65535).optional(),
  dnssec: optionalBoolean,
  log_queries: optionalBoolean,
  dns_forward_max: z.number().int().min(0).optional(),
  cache_size: z.number().int().min(0).optional(),
  no_ident: optionalBoolean,
  strict_order: optionalBoolean,
  domain_needed: optionalBoolean,
  no_private_reverse: optionalBoolean,
  no_resolv: optionalBoolean,
  no_hosts: optionalBoolean,
  dhcp_no_interface: optionalStringList,
  dhcp_fqdn: optionalBoolean,
  domain: optionalString,
  dhcp_local_domain: optionalBoolean,
  lease_max: z.number().int().min(0).optional(),
  dhcp_authoritative: optionalBoolean,
  register_firewall_rules: optionalBoolean,
  reply_delay: z.number().int().min(0).max(60).optional(),
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional(),
  ...includeRawField
};

export const dhcpOptionsSearchSchema = {
  query: optionalString,
  interface: optionalString,
  tag: optionalString,
  set_tag: optionalString,
  type: z.enum(["set", "match"]).optional(),
  option: optionalString,
  value: optionalString,
  description: optionalString,
  limit: z.number().int().min(1).max(5000).default(500).optional(),
  ...includeRawField
};

export const dhcpOptionGetSchema = {
  uuid: z.string().min(1),
  ...includeRawField
};

export const dhcpAccessBlocksListSchema = {
  query: optionalString,
  uuid: optionalString,
  mac_address: optionalString,
  client_id: optionalString,
  hostname: optionalString,
  limit: z.number().int().min(1).max(5000).default(500).optional(),
  ...includeRawField
};

export const dhcpAccessBlockSchema = {
  uuid: optionalString,
  mac_address: optionalString,
  client_id: dhcpClientIdSchema,
  hostname: optionalString,
  description: optionalString,
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional()
};

export const dhcpAccessUnblockSchema = {
  uuid: optionalString,
  mac_address: optionalString,
  client_id: dhcpClientIdSchema,
  delete_block_only: z.boolean().default(true).optional(),
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional()
};

export const dhcpAccessPolicyGetSchema = {
  uuid: optionalString,
  interface: optionalString,
  ...includeRawField
};

export const dhcpAccessPolicySetSchema = {
  mode: z.enum(["blacklist", "whitelist"]),
  uuid: optionalString,
  interface: optionalString,
  confirm_all_ranges: z.boolean().default(false).optional(),
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional(),
  ...includeRawField
};

export const dhcpRangeSearchSchema = {
  query: optionalString,
  uuid: optionalString,
  interface: optionalString,
  mode: z.enum(["blacklist", "whitelist", "dynamic", "static"]).optional(),
  domain: optionalString,
  description: optionalString,
  limit: z.number().int().min(1).max(5000).default(500).optional(),
  ...includeRawField
};

export const dhcpRangeGetSchema = {
  uuid: z.string().min(1),
  ...includeRawField
};

export const dhcpRangeUpdateSchema = {
  uuid: z.string().min(1),
  interface: optionalString,
  set_tag: optionalString,
  start_address: optionalString,
  end_address: optionalString,
  subnet_mask: optionalString,
  constructor: optionalString,
  mode: z.enum(["blacklist", "whitelist", "dynamic", "static"]).optional(),
  prefix_len: optionalString,
  lease_time: optionalString,
  domain_type: z.enum(["interface", "range"]).optional(),
  domain: optionalString,
  nosync: optionalBoolean,
  ra_mode: z.union([z.array(z.string()), z.string()]).optional(),
  ra_priority: optionalString,
  ra_mtu: optionalString,
  ra_interval: optionalString,
  ra_router_lifetime: optionalString,
  description: optionalString,
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional(),
  ...includeRawField
};

export const dhcpRangeDeleteSchema = {
  uuid: z.string().min(1),
  confirm: z.boolean(),
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional()
};

export const dhcpTagSearchSchema = {
  query: optionalString,
  uuid: optionalString,
  tag: optionalString,
  limit: z.number().int().min(1).max(5000).default(500).optional(),
  ...includeRawField
};

export const dhcpTagGetSchema = {
  uuid: z.string().min(1),
  ...includeRawField
};

export const dhcpTagUpdateSchema = {
  uuid: z.string().min(1),
  tag: z.string().trim().min(1),
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional(),
  ...includeRawField
};

export const dhcpTagDeleteSchema = {
  uuid: z.string().min(1),
  confirm: z.boolean(),
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional()
};

export const dhcpDomainSearchSchema = {
  query: optionalString,
  uuid: optionalString,
  domain: optionalString,
  ip: optionalString,
  srcip: optionalString,
  description: optionalString,
  limit: z.number().int().min(1).max(5000).default(500).optional(),
  ...includeRawField
};

export const dhcpDomainGetSchema = {
  uuid: z.string().min(1),
  ...includeRawField
};

export const dhcpDomainUpdateSchema = {
  uuid: z.string().min(1),
  sequence: optionalString,
  domain: optionalString,
  ipset: optionalString,
  srcip: optionalString,
  port: optionalString,
  ip: optionalString,
  description: optionalString,
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional(),
  ...includeRawField
};

export const dhcpDomainDeleteSchema = {
  uuid: z.string().min(1),
  confirm: z.boolean(),
  apply: applySchema.optional(),
  reconfigure: z.boolean().optional()
};

export const interfacesListSchema = {
  query: optionalString,
  identifier: optionalString,
  device: optionalString,
  status: optionalString,
  detailed: z.boolean().default(false).optional(),
  limit: z.number().int().min(1).max(5000).default(500).optional(),
  ...includeRawField
};

export const interfaceGetSchema = {
  interface: z.string().min(1),
  ...includeRawField
};

export const emptyIncludeRawSchema = {
  ...includeRawField
};

export const arpListSchema = {
  interface: optionalString,
  ...includeRawField
};

export const arpSearchSchema = {
  query: optionalString,
  ip_address: optionalString,
  mac_address: optionalString,
  hostname: optionalString,
  manufacturer: optionalString,
  ...includeRawField
};

export const macVendorLookupSchema = {
  mac_address: z.string().min(1),
  include_arp_fallback: z.boolean().default(true).optional()
};

export const routerPingSchema = {
  target: z.string().min(1),
  count: z.number().int().min(1).optional(),
  packet_size: z.number().int().min(0).optional(),
  source_address: optionalString,
  address_family: z.enum(["ipv4", "ipv6", "any"]).default("ipv4").optional(),
  timeout_ms: z.number().int().min(1000).max(120000).default(10000).optional(),
  ...includeRawField
};

export const clientSummarySchema = {
  identifier: z.string().min(1),
  ping: z.boolean().default(false).optional(),
  ...includeRawField
};

export const reconfigureSchema = {
  apply: applySchema.optional()
};

export const historySearchSchema = {
  query: optionalString,
  tool_name: optionalString,
  identity_name: optionalString,
  applied: optionalBoolean,
  limit: z.number().int().min(1).max(500).default(50).optional()
};

export const validateStaticReservation = ({ record, config }) => {
  const errors = [];
  const hostname = stripControlChars({ value: record.hostname });
  const ipAddress = normalizeIpv4({ value: record.ip_address });
  const hwAddress = record.hw_address ? normalizeMac({ value: record.hw_address }) : "";
  const clientId = stripControlChars({ value: record.client_id });

  if (!hostname || !isValidHostname({ value: hostname, strict: config.strictHostname })) {
    errors.push({
      field: "hostname",
      message: "hostname is required and must be valid."
    });
  }

  if (!ipAddress) {
    errors.push({
      field: "ip_address",
      message: "ip_address is required and must be a valid IPv4 address."
    });
  }

  if (!hwAddress && !clientId) {
    errors.push({
      field: "hw_address",
      message: "At least one of hw_address or client_id is required."
    });
  }

  if (record.hw_address && !hwAddress) {
    errors.push({
      field: "hw_address",
      message: "hw_address must be a valid MAC address."
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      ...record,
      hostname,
      ip_address: ipAddress ?? "",
      hw_address: hwAddress || "",
      client_id: clientId,
      description: stripControlChars({ value: record.description })
    }
  };
};
