import assert from "node:assert/strict";
import test from "node:test";
import {
  cidrContainsIp,
  isValidIpv4,
  normalizeIpv4,
  normalizeMac,
  rangeContainsIp
} from "../src/ipUtils.js";

test("normalizes supported MAC address formats", () => {
  assert.equal(normalizeMac({ value: "AA-BB-CC-DD-EE-FF" }), "aa:bb:cc:dd:ee:ff");
  assert.equal(normalizeMac({ value: "aabb.ccdd.eeff" }), "aa:bb:cc:dd:ee:ff");
  assert.equal(normalizeMac({ value: "aabbccddeeff" }), "aa:bb:cc:dd:ee:ff");
  assert.equal(normalizeMac({ value: "bad" }), null);
});

test("validates and normalizes IPv4 addresses", () => {
  assert.equal(isValidIpv4({ value: "10.7.1.1" }), true);
  assert.equal(normalizeIpv4({ value: "010.7.1.1" }), null);
  assert.equal(isValidIpv4({ value: "10.7.1.999" }), false);
});

test("matches IPv4 CIDRs and ranges", () => {
  assert.equal(cidrContainsIp({ cidr: "10.7.0.0/16", ip: "10.7.1.1" }), true);
  assert.equal(cidrContainsIp({ cidr: "10.7.0.0/16", ip: "10.8.1.1" }), false);
  assert.equal(rangeContainsIp({ range: "10.7.100.10-10.7.100.20", ip: "10.7.100.15" }), true);
  assert.equal(rangeContainsIp({ range: "10.7.100.10-10.7.100.20", ip: "10.7.100.21" }), false);
});
