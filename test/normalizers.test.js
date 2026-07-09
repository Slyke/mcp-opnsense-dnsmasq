import assert from "node:assert/strict";
import test from "node:test";
import {
  extractRows,
  dhcpRangePolicyMode,
  dhcpRangeRawModeFromPolicy,
  normalizeArpRow,
  normalizeDhcpDomain,
  normalizeDhcpRange,
  normalizeDhcpTag,
  normalizeDnsmasqSettings,
  normalizeInterfaceDetail,
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


test("normalizes DHCP range policy, tags, domains, settings, and interfaces", () => {
  const range = normalizeDhcpRange({ value: { uuid: "r1", start_addr: "10.7.1.10", mode: "static" } });
  const tag = normalizeDhcpTag({ value: { uuid: "t1", tag: "known" } });
  const domain = normalizeDhcpDomain({ value: { uuid: "d1", domain: "example.lan", descr: "lab" } });
  const settings = normalizeDnsmasqSettings({
    value: {
      dnsmasq: {
        enable: "1",
        interface: "lan",
        strictbind: "0",
        port: "0",
        dnssec: "0",
        log_queries: "0",
        dns_forward_max: "5000",
        cache_size: "10000",
        no_ident: "1",
        domain_needed: "0",
        no_private_reverse: "0",
        no_resolv: "0",
        no_hosts: "0",
        dhcp: {
          no_interface: "",
          fqdn: "1",
          domain: "internal",
          local: "1",
          lease_max: "1000",
          authoritative: "1",
          default_fw_rules: "1",
          reply_delay: "2"
        }
      }
    }
  });
  const detail = normalizeInterfaceDetail({ value: { message: { device: { value: "igb0" }, status: { value: "up" } } } });

  assert.equal(range.policy_mode, "whitelist");
  assert.equal(dhcpRangePolicyMode({ mode: "" }), "blacklist");
  assert.equal(dhcpRangeRawModeFromPolicy({ policyMode: "whitelist" }), "static");
  assert.equal(dhcpRangeRawModeFromPolicy({ policyMode: "blacklist" }), "");
  assert.equal(tag.tag, "known");
  assert.equal(domain.description, "lab");
  assert.equal(settings.enabled, true);
  assert.deepEqual(settings.interface, ["lan"]);
  assert.equal(settings.strict_interface_binding, false);
  assert.equal(settings.dns_listen_port, "0");
  assert.equal(settings.dnssec, false);
  assert.equal(settings.log_queries, false);
  assert.equal(settings.dns_forward_max, "5000");
  assert.equal(settings.cache_size, "10000");
  assert.equal(settings.no_ident, true);
  assert.equal(settings.domain_needed, false);
  assert.equal(settings.no_private_reverse, false);
  assert.equal(settings.no_resolv, false);
  assert.equal(settings.no_hosts, false);
  assert.deepEqual(settings.dhcp.no_interface, []);
  assert.equal(settings.dhcp.dhcp_fqdn, true);
  assert.equal(settings.dhcp.lease_max, "1000");
  assert.equal(settings.dhcp.reply_delay, "2");
  assert.equal(settings.dhcp.domain, "internal");
  assert.equal(settings.dhcp.local_domain, true);
  assert.equal(settings.dhcp.dhcp_authoritative, true);
  assert.equal(settings.dhcp.register_firewall_rules, true);
  assert.equal(detail.device, "igb0");
  assert.equal(detail.status, "up");
});
