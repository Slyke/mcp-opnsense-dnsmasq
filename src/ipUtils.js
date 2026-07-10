import net from "node:net";

const IPV4_PART_PATTERN = /^(?:0|[1-9][0-9]{0,2})$/;
const MAC_HEX_PATTERN = /^[0-9a-f]{12}$/i;
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f]/g;
const DNS_SAFE_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}\.)*[a-zA-Z0-9-]{1,63}(?<!-)$/;

export const stripControlChars = ({ value }) => {
  return String(value ?? "").replace(CONTROL_CHARS_PATTERN, "").trim();
};

export const isValidIpv4 = ({ value }) => {
  const parts = String(value ?? "").trim().split(".");

  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!IPV4_PART_PATTERN.test(part)) {
      return false;
    }

    const parsed = Number(part);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255;
  });
};

export const normalizeIpv4 = ({ value }) => {
  const trimmed = String(value ?? "").trim();

  if (!isValidIpv4({ value: trimmed })) {
    return null;
  }

  return trimmed.split(".").map((part) => String(Number(part))).join(".");
};

const stripIpv6Zone = ({ value }) => {
  return String(value ?? "")
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split("%")[0];
};

export const normalizeIpv6 = ({ value }) => {
  const trimmed = stripIpv6Zone({ value });

  if (net.isIP(trimmed) !== 6) {
    return null;
  }

  return trimmed.toLowerCase();
};

export const normalizeIpAddress = ({ value }) => {
  return normalizeIpv4({ value }) ?? normalizeIpv6({ value }) ?? "";
};

export const ipVersionOf = ({ value }) => {
  const normalized = normalizeIpAddress({ value });

  if (!normalized) {
    return null;
  }

  return net.isIP(normalized);
};

export const ipv4ToInt = ({ value }) => {
  const normalized = normalizeIpv4({ value });

  if (!normalized) {
    return null;
  }

  return normalized
    .split(".")
    .reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
};

export const intToIpv4 = ({ value }) => {
  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0xffffffff) {
    return null;
  }

  return [
    (numeric >>> 24) & 255,
    (numeric >>> 16) & 255,
    (numeric >>> 8) & 255,
    numeric & 255
  ].join(".");
};

export const parseCidr = ({ cidr }) => {
  const [ipPart, prefixPart] = String(cidr ?? "").trim().split("/");
  const ip = normalizeIpv4({ value: ipPart });
  const prefix = Number(prefixPart);

  if (!ip || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }

  const ipInt = ipv4ToInt({ value: ip });
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return {
    cidr: `${ip}/${prefix}`,
    network: ipInt & mask,
    broadcast: (ipInt & mask) | (~mask >>> 0),
    prefix
  };
};

export const cidrContainsIp = ({ cidr, ip }) => {
  const parsed = parseCidr({ cidr });
  const ipInt = ipv4ToInt({ value: ip });

  if (!parsed || ipInt === null) {
    return false;
  }

  return ipInt >= parsed.network && ipInt <= parsed.broadcast;
};

export const parseIpRange = ({ range }) => {
  const raw = String(range ?? "").trim();

  if (!raw) {
    return null;
  }

  if (raw.includes("/")) {
    const parsed = parseCidr({ cidr: raw });
    return parsed
      ? {
        raw,
        start: parsed.network,
        end: parsed.broadcast
      }
      : null;
  }

  if (raw.includes("-")) {
    const [startRaw, endRaw] = raw.split("-").map((part) => part.trim());
    const start = ipv4ToInt({ value: startRaw });
    const end = ipv4ToInt({ value: endRaw });

    if (start === null || end === null || start > end) {
      return null;
    }

    return { raw, start, end };
  }

  const single = ipv4ToInt({ value: raw });
  return single === null ? null : { raw, start: single, end: single };
};

export const rangeContainsIp = ({ range, ip }) => {
  const parsed = parseIpRange({ range });
  const ipInt = ipv4ToInt({ value: ip });

  if (!parsed || ipInt === null) {
    return false;
  }

  return ipInt >= parsed.start && ipInt <= parsed.end;
};

export const findMatchingRanges = ({ ranges = [], ip }) => {
  return ranges.filter((range) => rangeContainsIp({ range, ip }));
};

export const normalizeMac = ({ value }) => {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return "";
  }

  const compact = raw.replace(/[^0-9a-f]/gi, "").toLowerCase();

  if (!MAC_HEX_PATTERN.test(compact)) {
    return null;
  }

  return compact.match(/.{2}/g).join(":");
};

export const isValidMac = ({ value }) => {
  return normalizeMac({ value }) !== null;
};

export const splitList = ({ value }) => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitList({ value: item }));
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export const normalizeMacList = ({ value }) => {
  return splitList({ value })
    .map((item) => normalizeMac({ value: item }))
    .filter(Boolean);
};

export const normalizeStringList = ({ value }) => {
  return splitList({ value }).map((item) => stripControlChars({ value: item }));
};

export const isValidHostname = ({ value, strict = false }) => {
  const hostname = stripControlChars({ value });

  if (!hostname) {
    return false;
  }

  if (/\s/.test(hostname)) {
    return false;
  }

  if (strict) {
    return DNS_SAFE_HOSTNAME_PATTERN.test(hostname);
  }

  return /^[A-Za-z0-9_.-]+$/.test(hostname);
};

export const isHostnameOrIp = ({ value }) => {
  const normalized = String(value ?? "").trim();
  return Boolean(normalizeIpAddress({ value: normalized }) || isValidHostname({ value: normalized }));
};
