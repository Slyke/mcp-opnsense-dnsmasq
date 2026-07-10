import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createInventoryStore } from "../src/inventoryStore.js";

let sqliteAvailable = true;
try {
  await import("node:sqlite");
} catch {
  sqliteAvailable = false;
}

const createStore = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-inventory-"));
  const store = await createInventoryStore({
    config: {
      inventory: {
        dbPath: path.join(dir, "inventory.sqlite")
      }
    }
  });

  return { dir, store };
};

test("inventory store records devices, pairings, observations, and poll runs", {
  skip: sqliteAvailable ? false : "node:sqlite is not available in this Node runtime"
}, async () => {
  const { dir, store } = await createStore();

  try {
    const pollRunId = store.startPollRun({
      trigger: "manual",
      startedAt: "2026-07-10T00:00:00.000Z"
    });

    store.recordObservations({
      pollRunId,
      updatedAt: "2026-07-10T00:00:02.000Z",
      observations: [
        {
          observed_at: "2026-07-10T00:00:01.000Z",
          source: "arp",
          ip_address: "10.7.2.10",
          ip_version: 4,
          mac_address: "aa:bb:cc:dd:ee:ff",
          hostname: "=workstation",
          interface: "lan",
          raw: { note: "router raw payload" },
          interface_name: "LAN",
          vlan: "20"
        },
        {
          observed_at: "2026-07-10T00:00:02.000Z",
          source: "ndp",
          ip_address: "fe80::aabb",
          ip_version: 6,
          mac_address: "aa:bb:cc:dd:ee:ff",
          interface: "lan",
          interface_name: "LAN",
          vlan: "20",
          duid: "duid-1"
        }
      ]
    });

    store.finishPollRun({
      id: pollRunId,
      finishedAt: "2026-07-10T00:00:03.000Z",
      status: "ok",
      counts: {
        leases: 0,
        arp: 1,
        ndp: 1,
        static_hosts: 0,
        interfaces: 1,
        observations: 2
      },
      error: null
    });

    const devices = store.searchDevices({
      mac_address: "AA-BB-CC-DD-EE-FF"
    });
    const pairings = store.searchPairings({
      mac_address: "aa:bb:cc:dd:ee:ff",
      vlan: "20"
    });
    const observations = store.searchObservations({
      poll_run_id: pollRunId
    });
    const pollRuns = store.searchPollRuns({
      trigger: "manual"
    });
    const pairingsCsv = store.exportCsv({ table: "pairings" });
    const observationsCsv = store.exportCsv({ table: "observations" });
    const observationsRawCsv = store.exportCsv({ table: "observations", includeRaw: true });
    const status = store.status();

    assert.equal(devices.length, 1);
    assert.equal(devices[0].mac_address, "aa:bb:cc:dd:ee:ff");
    assert.equal(devices[0].last_ip_address, "fe80::aabb");
    assert.equal(devices[0].last_duid, "duid-1");
    assert.equal(pairings.length, 2);
    assert.deepEqual(pairings.map((row) => row.ip_version).sort(), [4, 6]);
    assert.equal(observations.length, 2);
    assert.equal(Object.hasOwn(observations[0], "raw_json"), false);
    assert.equal(pollRuns.length, 1);
    assert.equal(pollRuns[0].status, "ok");
    assert.equal(pairingsCsv.row_count, 2);
    assert.match(pairingsCsv.csv, /^ip_address,ip_version,mac_address,/);
    assert.match(pairingsCsv.csv, /10\.7\.2\.10/);
    assert.equal(observationsCsv.columns.includes("raw_json"), false);
    assert.equal(observationsRawCsv.columns.includes("raw_json"), true);
    assert.match(observationsCsv.csv, /'=workstation/);
    assert.equal(store.exportCsv({ table: "bad" }), null);
    assert.equal(status.counts.devices, 1);
    assert.equal(status.counts.pairings, 2);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
