import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { buildBasicAuthHeader, createOpnsenseClient } from "../src/opnsenseClient.js";

const listen = async ({ server }) => {
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return server.address().port;
};

const close = async ({ server }) => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
};

const readJson = async ({ req }) => {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
};

test("OPNsense client sends Basic Auth and calls Dnsmasq endpoints", async () => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    calls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body: await readJson({ req })
    });

    if (req.url === "/api/dnsmasq/settings/add_host") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ uuid: "created-uuid" }));
      return;
    }

    if (req.url === "/api/dnsmasq/service/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "running" }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "missing" }));
  });
  const port = await listen({ server });
  const loggerEntries = [];
  const client = createOpnsenseClient({
    config: {
      opnsense: {
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: "key",
        apiSecret: "secret",
        timeoutMs: 5000,
        tlsRejectUnauthorized: true
      }
    },
    logger: {
      generateLog: (entry) => {
        loggerEntries.push(entry);
      }
    }
  });

  try {
    const result = await client.addHost({
      host: {
        host: "device",
        ip: "10.7.2.10"
      }
    });
    await client.getDnsmasqStatus();

    assert.equal(result.uuid, "created-uuid");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, "/api/dnsmasq/settings/add_host");
    assert.equal(calls[0].authorization, buildBasicAuthHeader({ apiKey: "key", apiSecret: "secret" }));
    assert.deepEqual(calls[0].body, {
      host: {
        host: "device",
        ip: "10.7.2.10"
      }
    });
    assert.equal(JSON.stringify(loggerEntries).includes("secret"), false);
    assert.equal(JSON.stringify(loggerEntries).includes("key"), false);
  } finally {
    await close({ server });
  }
});

test("OPNsense client calls Dnsmasq range/tag/domain/option and interface endpoints", async () => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    calls.push({
      method: req.method,
      url: req.url,
      body: await readJson({ req })
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const port = await listen({ server });
  const client = createOpnsenseClient({
    config: {
      opnsense: {
        baseUrl: "http://127.0.0.1:" + port,
        apiKey: "key",
        apiSecret: "secret",
        timeoutMs: 5000,
        tlsRejectUnauthorized: true
      }
    },
    logger: { generateLog: () => {} }
  });

  try {
    await client.setDnsmasqSettings({ dnsmasq: { dhcp: { lease_max: "100" } } });
    await client.getRange({ uuid: "range-1" });
    await client.setRange({ uuid: "range-1", range: { mode: "static" } });
    await client.deleteRange({ uuid: "range-1" });
    await client.getOption({ uuid: "option-1" });
    await client.setTag({ uuid: "tag-1", tag: { tag: "known" } });
    await client.setDomain({ uuid: "domain-1", domain: { domain: "example.lan" } });
    await client.getInterfacesInfo({ details: true, body: { rowCount: 10 } });
    await client.getInterface({ interfaceName: "igb0" });

    assert.deepEqual(calls.map((call) => call.url), [
      "/api/dnsmasq/settings/set",
      "/api/dnsmasq/settings/get_range/range-1",
      "/api/dnsmasq/settings/set_range/range-1",
      "/api/dnsmasq/settings/del_range/range-1",
      "/api/dnsmasq/settings/get_option/option-1",
      "/api/dnsmasq/settings/set_tag/tag-1",
      "/api/dnsmasq/settings/set_domain/domain-1",
      "/api/interfaces/overview/interfaces_info/1",
      "/api/interfaces/overview/get_interface/igb0"
    ]);
    assert.deepEqual(calls[0].body, { dnsmasq: { dhcp: { lease_max: "100" } } });
    assert.deepEqual(calls[2].body, { range: { mode: "static" } });
    assert.deepEqual(calls[5].body, { tag: { tag: "known" } });
    assert.deepEqual(calls[6].body, { domainoverride: { domain: "example.lan" } });
  } finally {
    await close({ server });
  }
});
