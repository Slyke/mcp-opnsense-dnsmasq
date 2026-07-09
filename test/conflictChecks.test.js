import assert from "node:assert/strict";
import test from "node:test";
import { findStaticReservationConflicts } from "../src/conflictChecks.js";

const config = {
  allowedStaticDhcpCidrs: ["10.7.0.0/16"],
  protectedIps: ["10.7.1.1", "10.7.7.77"],
  excludedIpRanges: ["10.7.20.0/24"],
  metallbRanges: ["10.7.30.10-10.7.30.20"],
  dynamicDhcpRanges: ["10.7.100.10-10.7.102.245"],
  rejectStaticInsideDynamicRange: false
};

test("rejects protected and out-of-CIDR IPs", () => {
  const protectedReport = findStaticReservationConflicts({
    config,
    ipAddress: "10.7.7.77"
  });
  const outsideReport = findStaticReservationConflicts({
    config,
    ipAddress: "10.8.1.1"
  });

  assert.equal(protectedReport.can_create, false);
  assert.equal(protectedReport.conflicts.some((entry) => entry.type === "protected_ip"), true);
  assert.equal(outsideReport.can_create, false);
  assert.equal(outsideReport.conflicts.some((entry) => entry.type === "outside_allowed_cidr"), true);
});

test("rejects excluded and MetalLB ranges", () => {
  const excluded = findStaticReservationConflicts({
    config,
    ipAddress: "10.7.20.5"
  });
  const metallb = findStaticReservationConflicts({
    config,
    ipAddress: "10.7.30.15"
  });

  assert.equal(excluded.can_create, false);
  assert.equal(metallb.can_create, false);
});

test("detects duplicate static IP and MAC", () => {
  const report = findStaticReservationConflicts({
    config,
    ipAddress: "10.7.2.10",
    macAddress: "00:11:32:ee:7d:55",
    staticHosts: [
      {
        uuid: "u1",
        ip_address: "10.7.2.10",
        hw_address: "00:11:32:ee:7d:55"
      }
    ]
  });

  assert.equal(report.can_create, false);
  assert.equal(report.conflicts.some((entry) => entry.type === "static_host_duplicate_ip"), true);
  assert.equal(report.conflicts.some((entry) => entry.type === "static_host_duplicate_mac"), true);
});

test("warns for dynamic range overlap by default", () => {
  const report = findStaticReservationConflicts({
    config,
    ipAddress: "10.7.100.20"
  });

  assert.equal(report.can_create, true);
  assert.equal(report.conflicts.find((entry) => entry.type === "dynamic_range_overlap").severity, "warning");
});
