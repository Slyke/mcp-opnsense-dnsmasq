import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerClientSummaryTools } from "./tools/clientSummary.js";
import { registerDiagnosticTools } from "./tools/diagnostics.js";
import { registerDhcpLeaseTools } from "./tools/dhcpLeases.js";
import { registerDhcpOptionTools } from "./tools/dhcpOptions.js";
import { registerDhcpRangeTools } from "./tools/dhcpRanges.js";
import { registerDhcpStaticTools } from "./tools/dhcpStatic.js";
import { registerDnsmasqTools } from "./tools/dnsmasq.js";

export const createMcpServer = ({ context, buildInfo }) => {
  const server = new McpServer(
    {
      name: "mcp-opnsense-dnsmasq",
      version: buildInfo.version
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  registerDnsmasqTools({ server, context });
  registerDhcpLeaseTools({ server, context });
  registerDhcpStaticTools({ server, context });
  registerDhcpRangeTools({ server, context });
  registerDhcpOptionTools({ server, context });
  registerDiagnosticTools({ server, context });
  registerClientSummaryTools({ server, context });

  return server;
};
