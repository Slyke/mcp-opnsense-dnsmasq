# mcp-opnsense-dnsmasq

LAN-hosted MCP server for safely querying and managing OPNsense Dnsmasq DHCP state through the official OPNsense API. Codex or other MCP clients authenticate to this server with named Bearer tokens; this server authenticates to OPNsense with API key/secret Basic Auth. OPNsense credentials are never exposed to MCP clients.

Dnsmasq static DHCP reservations are represented by Dnsmasq **Hosts** entries. This server normalizes those OPNsense model fields (`host`, `ip`, `hwaddr`, `descr`) into MCP-facing fields (`hostname`, `ip_address`, `hw_address`, `description`).

`dnsmasq_settings_update` can edit the Dnsmasq enabled flag, bound interfaces, strict interface binding, DNS listen port, DNSSEC, query logging, DNS cache/query limits, forwarding protection toggles, DHCP disabled interfaces, DHCP FQDN/local-domain behavior, DHCP `domain`, `lease_max`, authoritative mode, firewall rule registration, and `reply_delay`. `dhcp_access_block` creates or updates a Dnsmasq Host with `ignore=true`; `dhcp_access_unblock` clears `ignore` or deletes an ignore-only host entry. `dhcp_access_policy_set` maps `blacklist` to normal dynamic ranges and `whitelist` to Dnsmasq range `mode=static`.

Normalized Dnsmasq settings use explicit MCP field names: `dns_listen_port` maps to Dnsmasq `port`, `strict_interface_binding` maps to `strictbind`, `dhcp_no_interface` maps to `dhcp.no_interface`, `dhcp_fqdn` maps to `dhcp.fqdn`, `dhcp_local_domain` maps to `dhcp.local`, `dhcp_authoritative` maps to `dhcp.authoritative`, and `register_firewall_rules` maps to `dhcp.default_fw_rules`.

If no readwrite bearer tokens are configured, the server is effectively read-only.

## OPNsense Setup

Target: OPNsense 25.7.x Dnsmasq DNS & DHCP.

- Enable Dnsmasq.
- Enable Dnsmasq DHCP on LAN.
- Disable ISC DHCP.
- Disable Kea DHCP.
- Ensure hidden `Interface [no dhcp]` does not include LAN.
- DHCP authoritative mode is recommended.
- DHCP register firewall rules is recommended.


## Creating an OPNsense API Key

1. Log in to the OPNsense web UI as an administrator.
2. Go to System > Access > Users.
3. Create a dedicated local user, for example mcp-dnsmasq, or open an existing dedicated automation user.
4. Set a strong password even if the account will only use API keys.
5. In the user account, add the effective privileges OPNsense 25.7 exposes for the APIs this server uses:
   - Services: Dnsmasq DNS/DHCP: Settings
   - Diagnostics: ARP Table
   - Diagnostics: Ping
   - Status: Overview
6. Save the user.
7. Reopen the user and click the API key add button in the API keys section.
8. Download or copy the generated key and secret immediately. OPNsense shows the secret only once.
9. Set OPNSENSE_API_KEY to the generated key and OPNSENSE_API_SECRET to the generated secret.

The Dnsmasq Settings privilege covers Dnsmasq service status, leases, settings, hosts, ranges, options, DHCP tags, domain overrides, and reconfigure APIs in OPNsense 25.7. Status: Overview is needed for `interfaces_list` and `interfaces_get`. Diagnostics: ARP Table is needed for ARP tools and richer conflict/client summaries. Diagnostics: Ping is only needed for `router_ping` and `client_summary` when ping is requested. Services: Dnsmasq DNS/DHCP: Log File is not used by this MCP server.

The server sends these values to OPNsense as HTTP Basic Auth, with the key as username and the secret as password. Do not use an administrator personal API key for this integration. If OPNsense returns HTTP 403, the API user is authenticated but likely missing one of the listed privileges.

## Configuration

Required:

- `MCP_READ_BEARER_TOKENS`
- `MCP_READWRITE_BEARER_TOKENS`
- `OPNSENSE_BASE_URL`
- `OPNSENSE_API_KEY`
- `OPNSENSE_API_SECRET`

Bearer token variables are JSON5 arrays:

```json5
[{ name: "reader1", token: "replace-me" }]
```

Common optional variables:

```env
HTTP_ENABLED=true
HTTP_HOST=0.0.0.0
HTTP_PORT=3000
HTTPS_ENABLED=false
HTTPS_HOST=0.0.0.0
HTTPS_PORT=3443
CONFIG_FILE=./data/config.json5
HISTORY_FILE=./data/history.jsonl
HISTORY_COUNT=50
HISTORY_RECORD_READS=false
CERTS_DIR=./data/certs
OPNSENSE_TIMEOUT_MS=10000
OPNSENSE_TLS_REJECT_UNAUTHORIZED=true
READY_CHECK_OPNSENSE=false
AUTH_HEALTHCHECKS=false
DEFAULT_INTERFACE=LAN
DEFAULT_INTERFACE_KEY=lan
ALLOWED_STATIC_DHCP_CIDRS=192.168.1.0/24
PROTECTED_IPS=192.168.1.1,192.168.1.254
EXCLUDED_IP_RANGES=
DYNAMIC_DHCP_RANGES=
REJECT_STATIC_INSIDE_DYNAMIC_RANGE=false
STRICT_HOSTNAME=false
AUTO_RECONFIGURE_AFTER_WRITE=true
INCLUDE_RAW_DEFAULT=false
MAX_PING_COUNT=5
MAX_PING_PACKET_SIZE=128
```

Set HISTORY_RECORD_READS=true or history.recordReads: true to append read-only MCP calls to history for troubleshooting. Read history entries store request metadata, identity name, tool name, redacted arguments, result count when available, and error code when a tool returns an error; they do not store router response bodies.

Environment variables override ./data/config.json5. If HTTPS is enabled and `server.crt`/`server.key` are missing in `CERTS_DIR`, the server generates a local self-signed certificate.

## Docker

Run the published Docker Hub image:

```bash
docker run --rm \
  -p 3000:3000 \
  -v "$PWD/data:/app/data" \
  -e MCP_READ_BEARER_TOKENS='[{name:"reader1",token:"read-token"}]' \
  -e MCP_READWRITE_BEARER_TOKENS='[{name:"admin1",token:"write-token"}]' \
  -e OPNSENSE_BASE_URL='https://opnsense.lan' \
  -e OPNSENSE_API_KEY='replace-me' \
  -e OPNSENSE_API_SECRET='replace-me' \
  -e ALLOWED_STATIC_DHCP_CIDRS='192.168.1.0/24' \
  -e PROTECTED_IPS='192.168.1.1,192.168.1.254' \
  -e CONFIG_FILE="./data/config.json5" \
  -e HISTORY_FILE="./data/history.jsonl" \
  -e CERTS_DIR="./data/certs" \
  slyke/mcp-opnsense-dnsmasq:latest
```

Build a local image:

```bash
docker build -t mcp-opnsense-dnsmasq:local .
docker run --rm \
  -p 3000:3000 \
  -v "$PWD/data:/app/data" \
  -e MCP_READ_BEARER_TOKENS='[{name:"reader1",token:"read-token"}]' \
  -e MCP_READWRITE_BEARER_TOKENS='[{name:"admin1",token:"write-token"}]' \
  -e OPNSENSE_BASE_URL='https://opnsense.lan' \
  -e OPNSENSE_API_KEY='replace-me' \
  -e OPNSENSE_API_SECRET='replace-me' \
  -e ALLOWED_STATIC_DHCP_CIDRS='192.168.1.0/24' \
  -e PROTECTED_IPS='192.168.1.1,192.168.1.254' \
  -e CONFIG_FILE="./data/config.json5" \
  -e HISTORY_FILE="./data/history.jsonl" \
  -e CERTS_DIR="./data/certs" \
  mcp-opnsense-dnsmasq:local
```

## Kubernetes

<details>
<summary>Kubernetes manifest</summary>

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: opnsense-dnsmasq-mcp
type: Opaque
stringData:
  MCP_READ_BEARER_TOKENS: '[{name:"reader1",token:"read-token"}]'
  MCP_READWRITE_BEARER_TOKENS: '[{name:"admin1",token:"write-token"}]'
  OPNSENSE_BASE_URL: 'https://opnsense.lan'
  OPNSENSE_API_KEY: 'replace-me'
  OPNSENSE_API_SECRET: 'replace-me'
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: opnsense-dnsmasq-mcp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: opnsense-dnsmasq-mcp
  template:
    metadata:
      labels:
        app: opnsense-dnsmasq-mcp
    spec:
      containers:
        - name: server
          image: slyke/mcp-opnsense-dnsmasq:latest
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: opnsense-dnsmasq-mcp
          env:
            - name: HTTP_ENABLED
              value: "true"
            - name: HTTPS_ENABLED
              value: "false"
            - name: ALLOWED_STATIC_DHCP_CIDRS
              value: "192.168.1.0/24"
            - name: PROTECTED_IPS
              value: "192.168.1.1,192.168.1.254"
            - name: LOG_CONSOLE_FORMAT
              value: json
            - name: LOG_K8S_METADATA_ENABLED
              value: "true"
            - name: K8S_POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: K8S_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
          readinessProbe:
            httpGet:
              path: /readyz
              port: 3000
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3000
```

</details>

## Codex MCP Config

<details>
<summary>Full Codex MCP config</summary>

```toml
[mcp_servers.opnsense]
url = "http://opnsense-dnsmasq-mcp.lan:3000/mcp"
bearer_token_env_var = "OPNSENSE_MCP_TOKEN"
default_tools_approval_mode = "prompt"

[mcp_servers.opnsense.tools.dnsmasq_status]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_leases_search]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_static_list]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_static_get]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_static_find_conflicts]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dnsmasq_settings_get]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_access_blocks_list]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_access_policy_get]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_ranges_list]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_ranges_search]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_ranges_get]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_options_list]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_options_search]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_options_get]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_tags_list]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_tags_search]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_tags_get]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_domains_list]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_domains_search]
approval_mode = "auto"

[mcp_servers.opnsense.tools.dhcp_domains_get]
approval_mode = "auto"

[mcp_servers.opnsense.tools.interfaces_list]
approval_mode = "auto"

[mcp_servers.opnsense.tools.interfaces_get]
approval_mode = "auto"

[mcp_servers.opnsense.tools.arp_list]
approval_mode = "auto"

[mcp_servers.opnsense.tools.arp_search]
approval_mode = "auto"

[mcp_servers.opnsense.tools.mac_vendor_lookup]
approval_mode = "auto"

[mcp_servers.opnsense.tools.client_summary]
approval_mode = "auto"

[mcp_servers.opnsense.tools.router_ping]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dhcp_static_create]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dhcp_static_update]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dhcp_static_delete]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dnsmasq_settings_update]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dhcp_access_block]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dhcp_access_unblock]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dhcp_access_policy_set]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dhcp_ranges_update]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dhcp_ranges_delete]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dhcp_tags_update]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dhcp_tags_delete]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dhcp_domains_update]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dhcp_domains_delete]
approval_mode = "prompt"

[mcp_servers.opnsense.tools.dnsmasq_reconfigure]
approval_mode = "prompt"
```

</details>

## Tools

Read-only tools:

- `dnsmasq_status`
- `dnsmasq_settings_get`
- `dhcp_leases_search`
- `dhcp_static_list`
- `dhcp_static_get`
- `dhcp_static_find_conflicts`
- `dhcp_access_blocks_list`
- `dhcp_access_policy_get`
- `dhcp_ranges_list`
- `dhcp_ranges_search`
- `dhcp_ranges_get`
- `dhcp_options_list`
- `dhcp_options_search`
- `dhcp_options_get`
- `dhcp_tags_list`
- `dhcp_tags_search`
- `dhcp_tags_get`
- `dhcp_domains_list`
- `dhcp_domains_search`
- `dhcp_domains_get`
- `interfaces_list`
- `interfaces_get`
- `arp_list`
- `arp_search`
- `mac_vendor_lookup`
- `router_ping`
- `client_summary`
- `history_search`

Mutating tools require a readwrite token and include `apply`, defaulting to `false`:

- `dnsmasq_settings_update`
- `dhcp_static_create`
- `dhcp_static_update`
- `dhcp_static_delete`
- `dhcp_access_block`
- `dhcp_access_unblock`
- `dhcp_access_policy_set`
- `dhcp_ranges_update`
- `dhcp_ranges_delete`
- `dhcp_tags_update`
- `dhcp_tags_delete`
- `dhcp_domains_update`
- `dhcp_domains_delete`
- `dnsmasq_reconfigure`

## CLI MCP Clients

This server exposes Streamable HTTP MCP at `/mcp`. Start the server first, then point CLI clients at `http://<host>:3000/mcp` and use one of the configured MCP bearer tokens.

### Claude Code

For a one-machine setup, add the remote HTTP server with an Authorization header:

```bash
export OPNSENSE_MCP_TOKEN="replace-read-or-readwrite-token"
claude mcp add --transport http opnsense http://opnsense-dnsmasq-mcp.lan:3000/mcp \
  --header "Authorization: Bearer ${OPNSENSE_MCP_TOKEN}"
claude
```

For a project-shareable config, create `.mcp.json` and keep the token in the environment:

```json
{
  "mcpServers": {
    "opnsense": {
      "type": "http",
      "url": "http://opnsense-dnsmasq-mcp.lan:3000/mcp",
      "headers": {
        "Authorization": "Bearer ${OPNSENSE_MCP_TOKEN}"
      }
    }
  }
}
```

Run `OPNSENSE_MCP_TOKEN="replace-read-or-readwrite-token" claude`, then use `/mcp` inside Claude Code to confirm the server is connected.

### Codex CLI

Codex CLI uses `config.toml` for Streamable HTTP MCP servers. Add this to `~/.codex/config.toml`, or to `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.opnsense]
url = "http://opnsense-dnsmasq-mcp.lan:3000/mcp"
bearer_token_env_var = "OPNSENSE_MCP_TOKEN"
default_tools_approval_mode = "prompt"
```

Then run:

```bash
export OPNSENSE_MCP_TOKEN="replace-read-or-readwrite-token"
codex
```

Use `/mcp` in the Codex TUI to confirm the server is connected. `codex mcp add` is useful for stdio MCP servers; for this HTTP server, use the TOML form above.

## Development

```bash
npm install
npm test
mkdir -p data/certs
cp .env.example .env
cp config.example.json5 data/config.json5
node --env-file=.env src/index.js
```

Health endpoints return:

```json
{
  "ok": true,
  "version": "0.1.0",
  "buildHash": "unknown"
}
```
