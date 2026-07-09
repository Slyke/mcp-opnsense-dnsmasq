import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerClientSummaryTools } from "./tools/clientSummary.js";
import { registerDiagnosticTools } from "./tools/diagnostics.js";
import { registerDhcpAccessTools } from "./tools/dhcpAccess.js";
import { registerDhcpDomainTools } from "./tools/dhcpDomains.js";
import { registerDhcpLeaseTools } from "./tools/dhcpLeases.js";
import { registerDhcpOptionTools } from "./tools/dhcpOptions.js";
import { registerDhcpRangeTools } from "./tools/dhcpRanges.js";
import { registerDhcpStaticTools } from "./tools/dhcpStatic.js";
import { registerDhcpTagTools } from "./tools/dhcpTags.js";
import { registerDnsmasqTools } from "./tools/dnsmasq.js";
import { registerInterfaceTools } from "./tools/interfaces.js";

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
  registerDhcpAccessTools({ server, context });
  registerDhcpRangeTools({ server, context });
  registerDhcpOptionTools({ server, context });
  registerDhcpTagTools({ server, context });
  registerDhcpDomainTools({ server, context });
  registerDiagnosticTools({ server, context });
  registerInterfaceTools({ server, context });
  registerClientSummaryTools({ server, context });

  return server;
};
