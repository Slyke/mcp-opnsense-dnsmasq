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
