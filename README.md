# mcp-opnsense-dnsmasq

LAN-hosted MCP server for safely querying and managing OPNsense Dnsmasq DHCP state through the official OPNsense API. Codex or other MCP clients authenticate to this server with named Bearer tokens; this server authenticates to OPNsense with API key/secret Basic Auth. OPNsense credentials are never exposed to MCP clients.

Dnsmasq static DHCP reservations are represented by Dnsmasq **Hosts** entries. This server normalizes those OPNsense model fields (`host`, `ip`, `hwaddr`, `descr`) into MCP-facing fields (`hostname`, `ip_address`, `hw_address`, `description`).

## Tools

Read-only tools:

- `dnsmasq_status`
- `dhcp_leases_search`
- `dhcp_static_list`
- `dhcp_static_get`
- `dhcp_static_find_conflicts`
- `dhcp_ranges_list`
- `dhcp_options_list`
- `arp_list`
- `arp_search`
- `mac_vendor_lookup`
- `router_ping`
- `client_summary`
- `history_search`

Mutating tools require a readwrite token and include `apply`, defaulting to `false`:

- `dhcp_static_create`
- `dhcp_static_update`
- `dhcp_static_delete`
- `dnsmasq_reconfigure`

When `READ_ONLY=true`, mutating tools return a structured `read_only` error.

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
6. Save the user.
7. Reopen the user and click the API key add button in the API keys section.
8. Download or copy the generated key and secret immediately. OPNsense shows the secret only once.
9. Set OPNSENSE_API_KEY to the generated key and OPNSENSE_API_SECRET to the generated secret.

The Dnsmasq Settings privilege covers Dnsmasq service status, leases, settings, hosts, ranges, options, and reconfigure APIs in OPNsense 25.7. Diagnostics: ARP Table is needed for ARP tools and richer conflict/client summaries. Diagnostics: Ping is only needed for router_ping and client_summary when ping is requested. Services: Dnsmasq DNS/DHCP: Log File is not used by this MCP server.

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
HISTORY_FILE=./data/history.json5
HISTORY_COUNT=50
CERTS_DIR=./data/certs
OPNSENSE_TIMEOUT_MS=10000
OPNSENSE_TLS_REJECT_UNAUTHORIZED=true
READY_CHECK_OPNSENSE=false
AUTH_HEALTHCHECKS=false
READ_ONLY=false
DEFAULT_INTERFACE=LAN
DEFAULT_INTERFACE_KEY=lan
ALLOWED_STATIC_DHCP_CIDRS=10.7.0.0/16
PROTECTED_IPS=10.7.1.1,10.7.7.77
EXCLUDED_IP_RANGES=
METALLB_RANGES=
DYNAMIC_DHCP_RANGES=
REJECT_STATIC_INSIDE_DYNAMIC_RANGE=false
STRICT_HOSTNAME=false
AUTO_RECONFIGURE_AFTER_WRITE=true
INCLUDE_RAW_DEFAULT=false
MAX_PING_COUNT=5
MAX_PING_PACKET_SIZE=128
```

Environment variables override ./data/config.json5. If HTTPS is enabled and `server.crt`/`server.key` are missing in `CERTS_DIR`, the server generates a local self-signed certificate.

## Docker

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
  -e ALLOWED_STATIC_DHCP_CIDRS='10.7.0.0/16' \
  -e PROTECTED_IPS='10.7.1.1,10.7.7.77' \
  -e CONFIG_FILE="./data/config.json5" \
  -e HISTORY_FILE="./data/history.json5" \
  -e CERTS_DIR="./data/certs" \
  mcp-opnsense-dnsmasq:local
```

## Kubernetes

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
          image: registry.example.com/home/opnsense-dnsmasq-mcp:v0.1.0
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
              value: "10.7.0.0/16"
            - name: PROTECTED_IPS
              value: "10.7.1.1,10.7.7.77"
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

## Codex MCP Config

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

[mcp_servers.opnsense.tools.dnsmasq_reconfigure]
approval_mode = "prompt"
```

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
