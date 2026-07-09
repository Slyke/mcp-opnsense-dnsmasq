import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

export class OpnsenseClientError extends Error {
  constructor({ message, code = "opnsense_error", statusCode, path, details = {} }) {
    super(message);
    this.name = "OpnsenseClientError";
    this.code = code;
    this.statusCode = statusCode;
    this.path = path;
    this.details = details;
  }
}

export const buildBasicAuthHeader = ({ apiKey, apiSecret }) => {
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`, "utf8").toString("base64")}`;
};

const isRetryableNetworkError = ({ err }) => {
  return ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"].includes(err?.code);
};

const parseResponseBody = ({ text }) => {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      text
    };
  }
};

const makeQueryString = ({ query }) => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
      continue;
    }

    params.set(key, String(value));
  }

  const rendered = params.toString();
  return rendered ? `?${rendered}` : "";
};

export const createOpnsenseClient = ({ config, logger }) => {
  const baseUrl = new URL(config.opnsense.baseUrl);
  const authHeader = buildBasicAuthHeader({
    apiKey: config.opnsense.apiKey,
    apiSecret: config.opnsense.apiSecret
  });

  const requestOnce = async ({ method = "GET", path, query, body, timeoutMs, requestId }) => {
    const requestPath = `${path}${makeQueryString({ query })}`;
    const payload = body === undefined ? null : JSON.stringify(body);
    const requestOptions = {
      method,
      protocol: baseUrl.protocol,
      hostname: baseUrl.hostname,
      port: baseUrl.port || undefined,
      path: `${baseUrl.pathname.replace(/\/+$/, "")}${requestPath}`,
      timeout: timeoutMs ?? config.opnsense.timeoutMs,
      rejectUnauthorized: config.opnsense.tlsRejectUnauthorized,
      headers: {
        accept: "application/json",
        authorization: authHeader,
        ...(payload
          ? {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload)
          }
          : {})
      }
    };
    const transport = baseUrl.protocol === "https:" ? https : http;

    logger?.generateLog({
      level: "debug",
      caller: "opnsenseClient::request",
      loggerKey: "OPNSENSE_API_REQUEST",
      message: "Calling OPNsense API.",
      correlationId: requestId,
      context: {
        method,
        path
      }
    });

    return await new Promise((resolve, reject) => {
      const req = transport.request(requestOptions, (res) => {
        const chunks = [];

        res.on("data", (chunk) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const parsed = parseResponseBody({ text });

          logger?.generateLog({
            level: "debug",
            caller: "opnsenseClient::request",
            loggerKey: "OPNSENSE_API_RESPONSE",
            message: "OPNsense API response received.",
            correlationId: requestId,
            context: {
              method,
              path,
              statusCode: res.statusCode
            }
          });

          if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
            reject(new OpnsenseClientError({
              message: `OPNsense API returned HTTP ${res.statusCode}.`,
              statusCode: res.statusCode,
              path,
              details: {
                response: parsed
              }
            }));
            return;
          }

          resolve(parsed);
        });
      });

      req.on("timeout", () => {
        req.destroy(new OpnsenseClientError({
          message: "OPNsense API request timed out.",
          code: "timeout",
          path
        }));
      });

      req.on("error", (err) => {
        reject(err);
      });

      if (payload) {
        req.write(payload);
      }

      req.end();
    });
  };

  const request = async ({ method = "GET", path, query, body, timeoutMs, requestId }) => {
    try {
      return await requestOnce({ method, path, query, body, timeoutMs, requestId });
    } catch (err) {
      if (method === "GET" && isRetryableNetworkError({ err })) {
        return await requestOnce({ method, path, query, body, timeoutMs, requestId });
      }

      if (err instanceof OpnsenseClientError) {
        throw err;
      }

      throw new OpnsenseClientError({
        message: err?.message ?? "OPNsense API request failed.",
        code: err?.code === "ETIMEDOUT" ? "timeout" : "opnsense_error",
        path,
        details: {
          causeCode: err?.code
        }
      });
    }
  };

  const get = async ({ path, query, timeoutMs, requestId }) => {
    return await request({ method: "GET", path, query, timeoutMs, requestId });
  };

  const post = async ({ path, body = {}, timeoutMs, requestId }) => {
    return await request({ method: "POST", path, body, timeoutMs, requestId });
  };

  const query = async ({ path, body = {}, timeoutMs, requestId }) => {
    return await post({ path, body, timeoutMs, requestId });
  };

  return {
    request,
    get,
    post,
    query,
    getDnsmasqStatus: ({ requestId } = {}) => get({
      path: "/api/dnsmasq/service/status",
      requestId
    }),
    reconfigureDnsmasq: ({ requestId } = {}) => post({
      path: "/api/dnsmasq/service/reconfigure",
      requestId
    }),
    searchLeases: ({ body = {}, requestId } = {}) => query({
      path: "/api/dnsmasq/leases/search",
      body,
      requestId
    }),
    getDnsmasqSettings: ({ requestId } = {}) => get({
      path: "/api/dnsmasq/settings/get",
      requestId
    }),
    searchHosts: ({ body = {}, requestId } = {}) => query({
      path: "/api/dnsmasq/settings/search_host",
      body,
      requestId
    }),
    getHost: ({ uuid, requestId }) => get({
      path: `/api/dnsmasq/settings/get_host/${encodeURIComponent(uuid)}`,
      requestId
    }),
    addHost: ({ host, requestId }) => post({
      path: "/api/dnsmasq/settings/add_host",
      body: { host },
      requestId
    }),
    setHost: ({ uuid, host, requestId }) => post({
      path: `/api/dnsmasq/settings/set_host/${encodeURIComponent(uuid)}`,
      body: { host },
      requestId
    }),
    deleteHost: ({ uuid, requestId }) => post({
      path: `/api/dnsmasq/settings/del_host/${encodeURIComponent(uuid)}`,
      requestId
    }),
    searchRanges: ({ body = {}, requestId } = {}) => query({
      path: "/api/dnsmasq/settings/search_range",
      body,
      requestId
    }),
    searchOptions: ({ body = {}, requestId } = {}) => query({
      path: "/api/dnsmasq/settings/search_option",
      body,
      requestId
    }),
    getArp: ({ requestId } = {}) => get({
      path: "/api/diagnostics/interface/get_arp",
      requestId
    }),
    searchArp: ({ body = {}, requestId } = {}) => query({
      path: "/api/diagnostics/interface/search_arp",
      body,
      requestId
    }),
    getMacInfo: ({ macAddress, requestId }) => get({
      path: `/api/diagnostics/packet_capture/mac_info/${encodeURIComponent(macAddress)}`,
      requestId
    }),
    getPingDefaults: ({ requestId } = {}) => get({
      path: "/api/diagnostics/ping/get",
      requestId
    }),
    setPing: ({ ping, requestId }) => post({
      path: "/api/diagnostics/ping/set",
      body: { ping },
      requestId
    }),
    startPing: ({ jobId, requestId }) => post({
      path: `/api/diagnostics/ping/start/${encodeURIComponent(jobId)}`,
      requestId
    }),
    searchPingJobs: ({ body = {}, requestId } = {}) => query({
      path: "/api/diagnostics/ping/search_jobs",
      body,
      requestId
    }),
    stopPing: ({ jobId, requestId }) => post({
      path: `/api/diagnostics/ping/stop/${encodeURIComponent(jobId)}`,
      requestId
    }),
    removePing: ({ jobId, requestId }) => post({
      path: `/api/diagnostics/ping/remove/${encodeURIComponent(jobId)}`,
      requestId
    })
  };
};
