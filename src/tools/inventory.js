import {
  inventoryDevicesSearchSchema,
  inventoryExportCsvSchema,
  inventoryObservationsSearchSchema,
  inventoryPairingsSearchSchema,
  inventoryPollRunsSearchSchema,
  inventoryRefreshSchema,
  inventoryStatusSchema
} from "../validators.js";
import { errorResponse, validationError } from "../errors.js";
import { makeToolHandler } from "./shared.js";

const inventoryDisabled = ({ context }) => {
  return errorResponse({
    code: "inventory_disabled",
    message: "Inventory is disabled. Set INVENTORY_ENABLED=true or inventory.enabled=true.",
    details: {
      db_path: context.config.inventory.dbPath
    }
  });
};

const requireInventory = ({ context }) => {
  return context.inventory.enabled ? null : inventoryDisabled({ context });
};

const sourceOverridesFromArgs = ({ args }) => {
  return {
    leases: args.leases,
    arp: args.arp,
    ndp: args.ndp,
    static_hosts: args.static_hosts,
    interfaces: args.interfaces
  };
};

export const registerInventoryTools = ({ server, context }) => {
  server.registerTool(
    "inventory_status",
    {
      description: "Show local device inventory status, counts, DB path, poll config, and latest poll run.",
      inputSchema: inventoryStatusSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "inventory_status",
      handler: async ({ context: toolContext }) => {
        return {
          ok: true,
          inventory: toolContext.inventory.status()
        };
      }
    })
  );

  server.registerTool(
    "inventory_export_csv",
    {
      description: "TOKEN-HEAVY: Dump one complete local inventory table as CSV through MCP. Prefer GET /inventory/export.csv?table=... for bulk exports to avoid model-token usage.",
      inputSchema: inventoryExportCsvSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "inventory_export_csv",
      handler: async ({ args, context: toolContext }) => {
        const disabled = requireInventory({ context: toolContext });
        if (disabled) {
          return disabled;
        }

        const exported = toolContext.inventory.exportCsv({
          table: args.table,
          includeRaw: args.include_raw ?? false
        });
        if (!exported) {
          return validationError({
            message: "Unsupported inventory export table.",
            details: {
              allowed_tables: ["devices", "pairings", "observations", "poll_runs"]
            }
          });
        }

        return {
          ok: true,
          token_warning: "This tool returns the full CSV body through MCP and can consume many model tokens. Prefer the authenticated HTTP /inventory/export.csv endpoint for large exports.",
          table: exported.table,
          columns: exported.columns,
          row_count: exported.row_count,
          csv: exported.csv
        };
      }
    })
  );

  server.registerTool(
    "inventory_refresh",
    {
      description: "Immediately read latest DHCP leases, ARP, NDP, static hosts, and interfaces from OPNsense into SQLite inventory.",
      inputSchema: inventoryRefreshSchema
    },
    makeToolHandler({
      context,
      toolName: "inventory_refresh",
      handler: async ({ args, context: toolContext, requestId }) => {
        return await toolContext.inventory.refresh({
          trigger: "manual",
          requestId,
          sourceOverrides: sourceOverridesFromArgs({ args }),
          includeRaw: args.include_raw ?? toolContext.config.inventory.includeRaw
        });
      }
    })
  );

  server.registerTool(
    "inventory_devices_search",
    {
      description: "Search current inventory device rollups by MAC, last IP, hostname, source, interface, VLAN, client UUID, client ID, DUID, or time range.",
      inputSchema: inventoryDevicesSearchSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "inventory_devices_search",
      handler: async ({ args, context: toolContext }) => {
        const disabled = requireInventory({ context: toolContext });
        if (disabled) {
          return disabled;
        }

        return {
          ok: true,
          devices: toolContext.inventory.searchDevices(args)
        };
      }
    })
  );

  server.registerTool(
    "inventory_pairings_search",
    {
      description: "Search historical IP/MAC/interface/VLAN pairings, including IPv4, IPv6, client UUIDs, DHCP client IDs, DUIDs, and source metadata.",
      inputSchema: inventoryPairingsSearchSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "inventory_pairings_search",
      handler: async ({ args, context: toolContext }) => {
        const disabled = requireInventory({ context: toolContext });
        if (disabled) {
          return disabled;
        }

        return {
          ok: true,
          pairings: toolContext.inventory.searchPairings(args)
        };
      }
    })
  );

  server.registerTool(
    "inventory_observations_search",
    {
      description: "Search raw inventory observation history from DHCP leases, ARP, NDP, and static hosts.",
      inputSchema: inventoryObservationsSearchSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "inventory_observations_search",
      handler: async ({ args, context: toolContext }) => {
        const disabled = requireInventory({ context: toolContext });
        if (disabled) {
          return disabled;
        }

        return {
          ok: true,
          observations: toolContext.inventory.searchObservations(args)
        };
      }
    })
  );

  server.registerTool(
    "inventory_poll_runs_search",
    {
      description: "Search inventory poll and manual refresh runs.",
      inputSchema: inventoryPollRunsSearchSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "inventory_poll_runs_search",
      handler: async ({ args, context: toolContext }) => {
        const disabled = requireInventory({ context: toolContext });
        if (disabled) {
          return disabled;
        }

        return {
          ok: true,
          poll_runs: toolContext.inventory.searchPollRuns(args)
        };
      }
    })
  );
};
