import assert from "node:assert/strict";
import test from "node:test";
import {
  extractRows,
  normalizeArpRow,
  normalizeLease,
  normalizeStaticHost
} from "../src/normalizers.js";

test("extracts rows from arrays and uuid-keyed objects", () => {
  assert.deepEqual(extractRows({ value: { rows: [{ uuid: "a" }] } }), [{ uuid: "a" }]);
  assert.deepEqual(extractRows({ value: { abc: { host: "nas" } } }), [{ uuid: "abc", host: "nas" }]);
});

test("normalizes OPNsense host fields to MCP static host fields", () => {
  const row = normalizeStaticHost({
    value: {
      uuid: "u1",
      host: "SynologyNAS",
      ip: "10.7.2.10",
      hwaddr: "00-11-32-EE-7D-55",
      descr: "Synology NAS"
    }
  });

  assert.equal(row.hostname, "SynologyNAS");
  assert.equal(row.ip_address, "10.7.2.10");
  assert.equal(row.hw_address, "00:11:32:ee:7d:55");
  assert.equal(row.description, "Synology NAS");
  assert.equal(row.is_dhcp_reservation, true);
});

test("normalizes lease and ARP rows", () => {
  const lease = normalizeLease({
    value: {
      address: "10.7.100.10",
      hwaddr: "AA:BB:CC:DD:EE:FF",
      if_descr: "LAN",
      is_reserved: "1"
    }
  });
  const arp = normalizeArpRow({
    value: {
      ip: "10.7.100.10",
      mac: "AA-BB-CC-DD-EE-FF",
      intf_description: "LAN"
    }
  });

  assert.equal(lease.is_static, true);
  assert.equal(lease.interface, "LAN");
  assert.equal(arp.mac_address, "aa:bb:cc:dd:ee:ff");
});
