import assert from "node:assert/strict";
import test from "node:test";
import { validateStaticReservation } from "../src/validators.js";

const baseConfig = {
  strictHostname: false
};

test("allows underscores when STRICT_HOSTNAME is false", () => {
  const result = validateStaticReservation({
    config: baseConfig,
    record: {
      hostname: "IPC_Backyard",
      ip_address: "10.7.2.20",
      hw_address: "aa:bb:cc:dd:ee:ff"
    }
  });

  assert.equal(result.ok, true);
});

test("rejects underscores when STRICT_HOSTNAME is true", () => {
  const result = validateStaticReservation({
    config: {
      strictHostname: true
    },
    record: {
      hostname: "IPC_Backyard",
      ip_address: "10.7.2.20",
      hw_address: "aa:bb:cc:dd:ee:ff"
    }
  });

  assert.equal(result.ok, false);
});

test("requires valid IPv4 and MAC or client ID", () => {
  const result = validateStaticReservation({
    config: baseConfig,
    record: {
      hostname: "device",
      ip_address: "10.7.999.1",
      hw_address: "not-a-mac"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((entry) => entry.field === "ip_address"), true);
  assert.equal(result.errors.some((entry) => entry.field === "hw_address"), true);
});
