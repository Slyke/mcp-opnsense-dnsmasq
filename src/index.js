import http from "node:http";
import https from "node:https";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticateHttpRequest, mcpAuthInfoFromIdentity } from "./auth.js";
import { getBuildInfo } from "./buildInfo.js";
import { ensureHttpsCertificates } from "./certs.js";
import { loadConfig } from "./config.js";
import { createHistoryStore } from "./history.js";
import { createLogger } from "./logger.js";
import { createMcpServer } from "./mcpServer.js";
import { createOpnsenseClient } from "./opnsenseClient.js";

const sendJson = ({ res, statusCode = 200, body }) => {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
};

const sendMethodNotAllowed = ({ res }) => {
  sendJson({
    res,
    statusCode: 405,
    body: {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    }
  });
};

const authenticateRoute = ({ req, res, config }) => {
  const auth = authenticateHttpRequest({
    req,
    config
  });

  if (!auth.ok) {
    sendJson({
      res,
      statusCode: auth.status,
      body: auth.body
    });
    return null;
  }

  return auth.identity;
};

const shouldAuthenticateHealth = ({ config }) => {
  return config.auth.authHealthchecks;
};

const handleHealth = ({ res, buildInfo }) => {
  sendJson({
    res,
    body: {
      ok: true,
      version: buildInfo.version,
      buildHash: buildInfo.buildHash
    }
  });
};

const handleReady = async ({ res, config, opnsense, buildInfo }) => {
  if (!config.opnsense.baseUrl || !config.opnsense.apiKey || !config.opnsense.apiSecret) {
    sendJson({
      res,
      statusCode: 503,
      body: {
        ok: false,
        version: buildInfo.version,
        buildHash: buildInfo.buildHash
      }
    });
    return;
  }

  if (config.readyCheckOpnsense) {
    try {
      await opnsense.getDnsmasqStatus();
    } catch {
      sendJson({
        res,
        statusCode: 503,
        body: {
          ok: false,
          version: buildInfo.version,
          buildHash: buildInfo.buildHash
        }
      });
      return;
    }
  }

  sendJson({
    res,
    body: {
      ok: true,
      version: buildInfo.version,
      buildHash: buildInfo.buildHash
    }
  });
};

const handleMcpPost = async ({ req, res, context, buildInfo, identity }) => {
  req.auth = mcpAuthInfoFromIdentity({ identity });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });
  const server = createMcpServer({
    context,
    buildInfo
  });

  res.on("close", () => {
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
};

const createRequestHandler = ({ context, buildInfo }) => {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (url.pathname === "/healthz") {
        if (shouldAuthenticateHealth({ config: context.config })) {
          const identity = authenticateRoute({
            req,
            res,
            config: context.config
          });

          if (!identity) {
            return;
          }
        }

        if (req.method !== "GET") {
          sendMethodNotAllowed({ res });
          return;
        }

        handleHealth({
          res,
          buildInfo
        });
        return;
      }

      if (url.pathname === "/readyz") {
        if (shouldAuthenticateHealth({ config: context.config })) {
          const identity = authenticateRoute({
            req,
            res,
            config: context.config
          });

          if (!identity) {
            return;
          }
        }

        if (req.method !== "GET") {
          sendMethodNotAllowed({ res });
          return;
        }

        await handleReady({
          res,
          config: context.config,
          opnsense: context.opnsense,
          buildInfo
        });
        return;
      }

      if (url.pathname === "/mcp") {
        const identity = authenticateRoute({
          req,
          res,
          config: context.config
        });

        if (!identity) {
          return;
        }

        if (req.method !== "POST") {
          sendMethodNotAllowed({ res });
          return;
        }

        await handleMcpPost({
          req,
          res,
          context,
          buildInfo,
          identity
        });
        return;
      }

      sendJson({
        res,
        statusCode: 404,
        body: {
          ok: false,
          error: {
            code: "not_found",
            message: "Not found.",
            details: {}
          }
        }
      });
    } catch (err) {
      context.logger.generateError({
        caller: "index::request",
        reason: "HTTP request handling failed.",
        errorKey: "HTTP_REQUEST_FAILED",
        err,
        includeStackTrace: false,
        context: {
          method: req.method,
          path: url.pathname
        }
      });

      if (!res.headersSent) {
        sendJson({
          res,
          statusCode: 500,
          body: {
            ok: false,
            error: {
              code: "unknown",
              message: "Internal server error.",
              details: {}
            }
          }
        });
      }
    }
  };
};

const listen = async ({ server, host, port }) => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
};

const closeServer = async ({ server }) => {
  await new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
};

const collectAvailableEnv = ({ keys, env = process.env }) => {
  return Object.fromEntries(
    keys
      .filter((key) => env[key] !== undefined && env[key] !== "")
      .map((key) => [key, env[key]])
  );
};

const logStartupDiagnostics = ({ logger, buildInfo, config }) => {
  const kubernetes = collectAvailableEnv({
    keys: [
      "K8S_POD_NAME",
      "K8S_DEPLOYMENT",
      "K8S_NAMESPACE",
      "K8S_POD_IP",
      "K8S_POD_IPS",
      "K8S_NODE_NAME"
    ]
  });
  const context = {
    version: buildInfo.version,
    buildHash: buildInfo.buildHash,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    configPath: config.configPath,
    httpEnabled: config.http.enabled,
    httpsEnabled: config.https.enabled,
    httpHost: config.http.host,
    httpPort: config.http.port,
    httpsHost: config.https.host,
    httpsPort: config.https.port,
    opnsenseBaseUrlConfigured: Boolean(config.opnsense.baseUrl),
    opnsenseApiKeyConfigured: Boolean(config.opnsense.apiKey),
    opnsenseApiSecretConfigured: Boolean(config.opnsense.apiSecret)
  };

  if (Object.keys(kubernetes).length > 0 && process.env.LOG_K8S_METADATA_ENABLED !== "true") {
    context.kubernetes = kubernetes;
  }

  logger.generateLog({
    level: "info",
    caller: "index::main",
    loggerKey: "SERVICE_BOOT_DIAGNOSTICS",
    message: "Service boot diagnostics.",
    context
  });
};

export const main = async () => {
  const config = loadConfig();
  const buildInfo = getBuildInfo();
  const logger = createLogger({ config });
  const history = createHistoryStore({ config });
  const opnsense = createOpnsenseClient({
    config,
    logger
  });
  const context = {
    config,
    logger,
    history,
    opnsense
  };
  const requestHandler = createRequestHandler({
    context,
    buildInfo
  });
  const servers = [];

  logStartupDiagnostics({
    logger,
    buildInfo,
    config
  });

  if (config.http.enabled) {
    const httpServer = http.createServer(requestHandler);
    await listen({
      server: httpServer,
      host: config.http.host,
      port: config.http.port
    });
    servers.push(httpServer);
    logger.generateLog({
      level: "info",
      caller: "index::main",
      loggerKey: "HTTP_SERVER_LISTENING",
      message: "HTTP server listening.",
      context: {
        host: config.http.host,
        port: config.http.port
      }
    });
  }

  if (config.https.enabled) {
    const certificates = ensureHttpsCertificates({
      certsDir: config.certsDir
    });
    const httpsServer = https.createServer(certificates, requestHandler);
    await listen({
      server: httpsServer,
      host: config.https.host,
      port: config.https.port
    });
    servers.push(httpsServer);
    logger.generateLog({
      level: "info",
      caller: "index::main",
      loggerKey: "HTTPS_SERVER_LISTENING",
      message: "HTTPS server listening.",
      context: {
        host: config.https.host,
        port: config.https.port
      }
    });
  }

  const shutdown = async ({ signal }) => {
    logger.generateLog({
      level: "info",
      caller: "index::shutdown",
      loggerKey: "SERVICE_SHUTDOWN",
      message: "Service shutdown requested.",
      context: {
        signal
      }
    });

    await Promise.all(servers.map((server) => closeServer({ server })));
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown({ signal: "SIGTERM" });
  });
  process.on("SIGINT", () => {
    void shutdown({ signal: "SIGINT" });
  });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
