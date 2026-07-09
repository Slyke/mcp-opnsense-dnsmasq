import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";

const DEFAULT_CONFIG_FILE = "./config.json5";
const DEFAULT_HISTORY_FILE = "./history.json5";
const DEFAULT_CERTS_DIR = "./certs";

const parseBoolean = ({ value, fallback = false }) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
};

const parseNumber = ({ value, fallback, min, max }) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const boundedMin = min === undefined ? parsed : Math.max(parsed, min);
  return max === undefined ? boundedMin : Math.min(boundedMin, max);
};

const parseList = ({ value }) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  const raw = String(value).trim();

  if (raw.startsWith("[") || raw.startsWith("{")) {
    const parsed = JSON5.parse(raw);
    return parseList({ value: parsed });
  }

  return raw.split(",").map((item) => item.trim()).filter(Boolean);
};

const readJson5File = ({ filePath }) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  return JSON5.parse(fs.readFileSync(filePath, "utf8"));
};

const hasOwn = ({ obj, key }) => {
  return Object.prototype.hasOwnProperty.call(obj ?? {}, key);
};

const envOrConfig = ({ env, config, envKey, configPath, fallback }) => {
  if (env[envKey] !== undefined) {
    return env[envKey];
  }

  const parts = configPath.split(".");
  let current = config;

  for (const part of parts) {
    if (!hasOwn({ obj: current, key: part })) {
      return fallback;
    }

    current = current[part];
  }

  return current ?? fallback;
};

const parseTokenEntries = ({ value, label }) => {
  const parsed = typeof value === "string" ? JSON5.parse(value) : value;

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be an array of { name, token } objects.`);
  }

  return parsed.map((entry, index) => {
    const name = String(entry?.name ?? "").trim();
    const token = String(entry?.token ?? "");

    if (!name || !token) {
      throw new Error(`${label}[${index}] must include non-empty name and token fields.`);
    }

    return { name, token };
  });
};

const resolveTokenEntries = ({ env, config, envKey, configPath }) => {
  const rawValue = envOrConfig({
    env,
    config,
    envKey,
    configPath,
    fallback: undefined
  });

  if (rawValue === undefined) {
    return [];
  }

  return parseTokenEntries({
    value: rawValue,
    label: envKey
  });
};

const resolveLogging = ({ config }) => {
  return config.logging ?? {
    sinks: {
      console: {
        enabled: true,
        format: "json",
        levels: []
      }
    },
    gates: {
      SERVICE_BOOT_DIAGNOSTICS: {
        level: "info",
        console: true
      },
      MCP_TOOL_CALL: {
        level: "info",
        console: true
      },
      OPNSENSE_API_REQUEST: {
        level: "debug",
        console: true
      }
    }
  };
};

export const loadConfig = ({
  env = process.env,
  cwd = process.cwd(),
  requireRequired = true
} = {}) => {
  const configFile = env.CONFIG_FILE ?? DEFAULT_CONFIG_FILE;
  const configPath = path.resolve(cwd, configFile);
  const fileConfig = readJson5File({ filePath: configPath });
  const httpEnabled = parseBoolean({
    value: envOrConfig({ env, config: fileConfig, envKey: "HTTP_ENABLED", configPath: "http.enabled", fallback: true }),
    fallback: true
  });
  const httpsEnabled = parseBoolean({
    value: envOrConfig({ env, config: fileConfig, envKey: "HTTPS_ENABLED", configPath: "https.enabled", fallback: false }),
    fallback: false
  });

  if (!httpEnabled && !httpsEnabled) {
    throw new Error("At least one of HTTP_ENABLED or HTTPS_ENABLED must be true.");
  }

  const readTokens = resolveTokenEntries({
    env,
    config: fileConfig,
    envKey: "MCP_READ_BEARER_TOKENS",
    configPath: "auth.readBearerTokens"
  });
  const readWriteTokens = resolveTokenEntries({
    env,
    config: fileConfig,
    envKey: "MCP_READWRITE_BEARER_TOKENS",
    configPath: "auth.readWriteBearerTokens"
  });
  const requiredValues = {
    OPNSENSE_BASE_URL: envOrConfig({
      env,
      config: fileConfig,
      envKey: "OPNSENSE_BASE_URL",
      configPath: "opnsense.baseUrl",
      fallback: ""
    }),
    OPNSENSE_API_KEY: envOrConfig({
      env,
      config: fileConfig,
      envKey: "OPNSENSE_API_KEY",
      configPath: "opnsense.apiKey",
      fallback: ""
    }),
    OPNSENSE_API_SECRET: envOrConfig({
      env,
      config: fileConfig,
      envKey: "OPNSENSE_API_SECRET",
      configPath: "opnsense.apiSecret",
      fallback: ""
    })
  };

  if (requireRequired) {
    const missing = Object.entries(requiredValues)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (readTokens.length === 0 && readWriteTokens.length === 0) {
      missing.push("MCP_READ_BEARER_TOKENS or MCP_READWRITE_BEARER_TOKENS");
    }

    if (missing.length > 0) {
      throw new Error(`Missing required configuration: ${missing.join(", ")}`);
    }
  }

  return {
    configPath,
    http: {
      enabled: httpEnabled,
      host: String(envOrConfig({ env, config: fileConfig, envKey: "HTTP_HOST", configPath: "http.host", fallback: "0.0.0.0" })),
      port: parseNumber({
        value: envOrConfig({ env, config: fileConfig, envKey: "HTTP_PORT", configPath: "http.port", fallback: 3000 }),
        fallback: 3000,
        min: 1,
        max: 65535
      })
    },
    https: {
      enabled: httpsEnabled,
      host: String(envOrConfig({ env, config: fileConfig, envKey: "HTTPS_HOST", configPath: "https.host", fallback: "0.0.0.0" })),
      port: parseNumber({
        value: envOrConfig({ env, config: fileConfig, envKey: "HTTPS_PORT", configPath: "https.port", fallback: 3443 }),
        fallback: 3443,
        min: 1,
        max: 65535
      })
    },
    auth: {
      readTokens,
      readWriteTokens,
      authHealthchecks: parseBoolean({
        value: envOrConfig({
          env,
          config: fileConfig,
          envKey: "AUTH_HEALTHCHECKS",
          configPath: "auth.healthchecks",
          fallback: false
        })
      })
    },
    opnsense: {
      baseUrl: String(requiredValues.OPNSENSE_BASE_URL ?? "").replace(/\/+$/, ""),
      apiKey: String(requiredValues.OPNSENSE_API_KEY ?? ""),
      apiSecret: String(requiredValues.OPNSENSE_API_SECRET ?? ""),
      timeoutMs: parseNumber({
        value: envOrConfig({
          env,
          config: fileConfig,
          envKey: "OPNSENSE_TIMEOUT_MS",
          configPath: "opnsense.timeoutMs",
          fallback: 10000
        }),
        fallback: 10000,
        min: 1000,
        max: 120000
      }),
      tlsRejectUnauthorized: parseBoolean({
        value: envOrConfig({
          env,
          config: fileConfig,
          envKey: "OPNSENSE_TLS_REJECT_UNAUTHORIZED",
          configPath: "opnsense.tlsRejectUnauthorized",
          fallback: true
        }),
        fallback: true
      })
    },
    historyFile: path.resolve(cwd, String(envOrConfig({
      env,
      config: fileConfig,
      envKey: "HISTORY_FILE",
      configPath: "history.file",
      fallback: DEFAULT_HISTORY_FILE
    }))),
    historyCount: parseNumber({
      value: envOrConfig({ env, config: fileConfig, envKey: "HISTORY_COUNT", configPath: "history.count", fallback: 50 }),
      fallback: 50,
      min: 1,
      max: 5000
    }),
    certsDir: path.resolve(cwd, String(envOrConfig({
      env,
      config: fileConfig,
      envKey: "CERTS_DIR",
      configPath: "certsDir",
      fallback: DEFAULT_CERTS_DIR
    }))),
    readyCheckOpnsense: parseBoolean({
      value: envOrConfig({
        env,
        config: fileConfig,
        envKey: "READY_CHECK_OPNSENSE",
        configPath: "readyCheckOpnsense",
        fallback: false
      })
    }),
    readOnly: parseBoolean({
      value: envOrConfig({ env, config: fileConfig, envKey: "READ_ONLY", configPath: "readOnly", fallback: false })
    }),
    defaultInterface: String(envOrConfig({
      env,
      config: fileConfig,
      envKey: "DEFAULT_INTERFACE",
      configPath: "defaultInterface",
      fallback: "LAN"
    })),
    defaultInterfaceKey: String(envOrConfig({
      env,
      config: fileConfig,
      envKey: "DEFAULT_INTERFACE_KEY",
      configPath: "defaultInterfaceKey",
      fallback: "lan"
    })),
    allowedStaticDhcpCidrs: parseList({
      value: envOrConfig({
        env,
        config: fileConfig,
        envKey: "ALLOWED_STATIC_DHCP_CIDRS",
        configPath: "allowedStaticDhcpCidrs",
        fallback: []
      })
    }),
    protectedIps: parseList({
      value: envOrConfig({ env, config: fileConfig, envKey: "PROTECTED_IPS", configPath: "protectedIps", fallback: [] })
    }),
    excludedIpRanges: parseList({
      value: envOrConfig({
        env,
        config: fileConfig,
        envKey: "EXCLUDED_IP_RANGES",
        configPath: "excludedIpRanges",
        fallback: []
      })
    }),
    metallbRanges: parseList({
      value: envOrConfig({ env, config: fileConfig, envKey: "METALLB_RANGES", configPath: "metallbRanges", fallback: [] })
    }),
    dynamicDhcpRanges: parseList({
      value: envOrConfig({
        env,
        config: fileConfig,
        envKey: "DYNAMIC_DHCP_RANGES",
        configPath: "dynamicDhcpRanges",
        fallback: []
      })
    }),
    rejectStaticInsideDynamicRange: parseBoolean({
      value: envOrConfig({
        env,
        config: fileConfig,
        envKey: "REJECT_STATIC_INSIDE_DYNAMIC_RANGE",
        configPath: "rejectStaticInsideDynamicRange",
        fallback: false
      })
    }),
    strictHostname: parseBoolean({
      value: envOrConfig({ env, config: fileConfig, envKey: "STRICT_HOSTNAME", configPath: "strictHostname", fallback: false })
    }),
    autoReconfigureAfterWrite: parseBoolean({
      value: envOrConfig({
        env,
        config: fileConfig,
        envKey: "AUTO_RECONFIGURE_AFTER_WRITE",
        configPath: "autoReconfigureAfterWrite",
        fallback: true
      }),
      fallback: true
    }),
    includeRawDefault: parseBoolean({
      value: envOrConfig({
        env,
        config: fileConfig,
        envKey: "INCLUDE_RAW_DEFAULT",
        configPath: "includeRawDefault",
        fallback: false
      })
    }),
    maxPingCount: parseNumber({
      value: envOrConfig({ env, config: fileConfig, envKey: "MAX_PING_COUNT", configPath: "maxPingCount", fallback: 5 }),
      fallback: 5,
      min: 1,
      max: 20
    }),
    maxPingPacketSize: parseNumber({
      value: envOrConfig({
        env,
        config: fileConfig,
        envKey: "MAX_PING_PACKET_SIZE",
        configPath: "maxPingPacketSize",
        fallback: 128
      }),
      fallback: 128,
      min: 0,
      max: 65535
    }),
    logging: resolveLogging({ config: fileConfig })
  };
};

export const publicConfigSummary = ({ config }) => {
  return {
    read_only: config.readOnly,
    default_interface: config.defaultInterface,
    default_interface_key: config.defaultInterfaceKey,
    allowed_lan_cidrs: config.allowedStaticDhcpCidrs,
    protected_ips: config.protectedIps,
    excluded_ip_ranges: config.excludedIpRanges,
    metallb_ranges: config.metallbRanges,
    reject_static_inside_dynamic_range: config.rejectStaticInsideDynamicRange
  };
};
