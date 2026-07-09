import {
  conflictSchema,
  staticCreateSchema,
  staticDeleteSchema,
  staticGetSchema,
  staticListSchema,
  staticUpdateSchema,
  validateStaticReservation
} from "../validators.js";
import {
  buildHostPayload,
  extractRows,
  normalizeDhcpRange,
  normalizeLease,
  normalizeStaticHost
} from "../normalizers.js";
import { conflictError, notFoundError, validationError } from "../errors.js";
import { normalizeIpv4, normalizeMac } from "../ipUtils.js";
import { findStaticReservationConflicts } from "../conflictChecks.js";
import {
  appendHistory,
  getIncludeRaw,
  makeToolHandler,
  matchesCommonFilters
} from "./shared.js";

export const getStaticHosts = async ({ context, args = {}, requestId }) => {
  const raw = await context.opnsense.searchHosts({
    body: {
      searchPhrase: args.query ?? "",
      rowCount: args.limit ?? 500
    },
    requestId
  });
  const includeRaw = getIncludeRaw({ args, config: context.config });

  return extractRows({ value: raw })
    .map((row) => normalizeStaticHost({ value: row, include_raw: includeRaw }))
    .filter((row) => (args.include_disabled === false ? row.enabled : true))
    .filter((row) => matchesCommonFilters({ row, args }))
    .slice(0, args.limit ?? 500);
};

const getStaticHostByUuid = async ({ context, uuid, includeRaw = false, requestId }) => {
  const raw = await context.opnsense.getHost({
    uuid,
    requestId
  });
  return normalizeStaticHost({
    value: raw,
    include_raw: includeRaw
  });
};

const findStaticHost = async ({ context, args, requestId }) => {
  if (args.uuid) {
    const record = await getStaticHostByUuid({
      context,
      uuid: args.uuid,
      includeRaw: getIncludeRaw({ args, config: context.config }),
      requestId
    });

    if (!record.uuid && args.uuid) {
      record.uuid = args.uuid;
    }

    return {
      ok: true,
      record
    };
  }

  const rows = await getStaticHosts({
    context,
    args: {
      ...args,
      include_disabled: true,
      limit: 5000
    },
    requestId
  });

  if (rows.length === 0) {
    return notFoundError({
      message: "No matching Dnsmasq host was found."
    });
  }

  if (rows.length > 1) {
    return conflictError({
      message: "Multiple Dnsmasq hosts matched the lookup.",
      details: {
        matches: rows
      }
    });
  }

  return {
    ok: true,
    record: rows[0]
  };
};

const getDynamicRanges = async ({ context, requestId }) => {
  try {
    const rawRanges = await context.opnsense.searchRanges({
      body: {},
      requestId
    });

    return extractRows({ value: rawRanges })
      .map((row) => normalizeDhcpRange({ value: row }))
      .filter((row) => row.is_dynamic && row.start_address && row.end_address)
      .map((row) => `${row.start_address}-${row.end_address}`);
  } catch {
    return [];
  }
};

const getConflictInputs = async ({ context, args, requestId }) => {
  const staticHosts = await getStaticHosts({
    context,
    args: {
      include_disabled: true,
      limit: 5000
    },
    requestId
  });
  const dynamicRanges = await getDynamicRanges({
    context,
    requestId
  });
  const leases = args.include_leases === false
    ? []
    : extractRows({
      value: await context.opnsense.searchLeases({
        body: {},
        requestId
      })
    }).map((row) => normalizeLease({ value: row }));
  const arp = args.include_arp === false
    ? []
    : extractRows({
      value: await context.opnsense.getArp({
        requestId
      })
    }).map((row) => ({
      ip_address: normalizeIpv4({ value: row.ip ?? row.address ?? row.ip_address }) ?? "",
      mac_address: normalizeMac({ value: row.mac ?? row.hwaddr ?? row.mac_address }) ?? ""
    }));

  return {
    staticHosts,
    dynamicRanges,
    leases,
    arp
  };
};

export const runConflictCheck = async ({ context, args, requestId }) => {
  const inputs = await getConflictInputs({
    context,
    args,
    requestId
  });

  return findStaticReservationConflicts({
    config: context.config,
    ipAddress: args.ip_address,
    macAddress: args.mac_address ?? args.hw_address,
    hostname: args.hostname,
    ignoreUuid: args.ignore_uuid,
    staticHosts: inputs.staticHosts,
    leases: inputs.leases,
    arp: inputs.arp,
    dynamicRanges: inputs.dynamicRanges
  });
};

const buildCreateRecord = ({ args }) => {
  return {
    hostname: args.hostname,
    ip_address: args.ip_address,
    hw_address: args.hw_address ?? "",
    client_id: args.client_id ?? "",
    domain: args.domain ?? "",
    description: args.description ?? "",
    aliases: args.aliases ?? [],
    cnames: args.cnames ?? [],
    lease_time: args.lease_time ?? "",
    local: args.local ?? false,
    ignore: args.ignore ?? false,
    set_tag: args.set_tag ?? ""
  };
};

const mergeUpdateRecord = ({ before, args }) => {
  return {
    ...before,
    hostname: args.hostname ?? before.hostname,
    ip_address: args.ip_address ?? before.ip_address,
    hw_address: args.hw_address ?? before.hw_address,
    client_id: args.client_id ?? before.client_id,
    domain: args.domain ?? before.domain,
    description: args.description ?? before.description,
    aliases: args.aliases ?? before.aliases,
    cnames: args.cnames ?? before.cnames,
    lease_time: args.lease_time ?? before.lease_time,
    local: args.local ?? before.local,
    ignore: args.ignore ?? before.ignore,
    set_tag: args.set_tag ?? before.set_tag
  };
};

const diffRecords = ({ before, after }) => {
  return Object.fromEntries(
    Object.keys(after)
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => [key, {
        before: before[key],
        after: after[key]
      }])
  );
};

const validateAndDetectConflicts = async ({ context, record, ignoreUuid, requestId }) => {
  const validation = validateStaticReservation({
    record,
    config: context.config
  });

  if (!validation.ok) {
    return {
      ok: false,
      result: validationError({
        message: "Static DHCP reservation validation failed.",
        details: {
          errors: validation.errors
        }
      })
    };
  }

  const conflictReport = await runConflictCheck({
    context,
    args: {
      ip_address: validation.normalized.ip_address,
      mac_address: validation.normalized.hw_address,
      hostname: validation.normalized.hostname,
      ignore_uuid: ignoreUuid,
      include_arp: true,
      include_leases: true
    },
    requestId
  });
  const errorConflicts = conflictReport.conflicts.filter((conflict) => conflict.severity === "error");

  if (errorConflicts.length > 0) {
    return {
      ok: false,
      result: conflictError({
        message: "Static DHCP reservation conflicts with existing DHCP state or guardrails.",
        details: conflictReport
      })
    };
  }

  return {
    ok: true,
    record: validation.normalized,
    conflictReport
  };
};

const reconfigureIfRequested = async ({ context, reconfigure, requestId }) => {
  if (!reconfigure) {
    return false;
  }

  await context.opnsense.reconfigureDnsmasq({ requestId });
  return true;
};

export const registerDhcpStaticTools = ({ server, context }) => {
  server.registerTool(
    "dhcp_static_list",
    {
      description: "List Dnsmasq host entries used as static DHCP reservations.",
      inputSchema: staticListSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_static_list",
      handler: async ({ args, context: toolContext, requestId }) => {
        const hosts = await getStaticHosts({
          context: toolContext,
          args,
          requestId
        });

        return {
          ok: true,
          hosts
        };
      }
    })
  );

  server.registerTool(
    "dhcp_static_get",
    {
      description: "Get one Dnsmasq static host by UUID, IP, MAC, or hostname.",
      inputSchema: staticGetSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_static_get",
      handler: async ({ args, context: toolContext, requestId }) => {
        if (!args.uuid && !args.ip_address && !args.mac_address && !args.hostname) {
          return validationError({
            message: "One of uuid, ip_address, mac_address, or hostname is required."
          });
        }

        return await findStaticHost({
          context: toolContext,
          args,
          requestId
        });
      }
    })
  );

  server.registerTool(
    "dhcp_static_find_conflicts",
    {
      description: "Check whether an IP, MAC, or hostname conflicts before creating or updating a reservation.",
      inputSchema: conflictSchema,
      annotations: {
        readOnlyHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_static_find_conflicts",
      handler: async ({ args, context: toolContext, requestId }) => {
        if (!args.ip_address && !args.mac_address && !args.hostname) {
          return validationError({
            message: "At least one of ip_address, mac_address, or hostname is required."
          });
        }

        return await runConflictCheck({
          context: toolContext,
          args,
          requestId
        });
      }
    })
  );

  server.registerTool(
    "dhcp_static_create",
    {
      description: "Create a new Dnsmasq host entry / DHCP reservation.",
      inputSchema: staticCreateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_static_create",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;
        const validation = await validateAndDetectConflicts({
          context: toolContext,
          record: buildCreateRecord({ args }),
          requestId
        });

        if (!validation.ok) {
          appendHistory({
            context: toolContext,
            toolName: "dhcp_static_create",
            identity,
            requestId,
            action: "create_rejected",
            applied: false,
            ok: false,
            target: {
              ip_address: args.ip_address,
              hostname: args.hostname
            }
          });
          return validation.result;
        }

        const plannedPayload = buildHostPayload({
          record: validation.record
        });

        if (!args.apply) {
          appendHistory({
            context: toolContext,
            toolName: "dhcp_static_create",
            identity,
            requestId,
            action: "plan_create",
            applied: false,
            ok: true,
            target: {
              ip_address: validation.record.ip_address,
              hostname: validation.record.hostname
            }
          });

          return {
            ok: true,
            applied: false,
            planned_payload: plannedPayload,
            conflicts: validation.conflictReport.conflicts
          };
        }

        const raw = await toolContext.opnsense.addHost({
          host: plannedPayload,
          requestId
        });
        const uuid = raw.uuid ?? raw.host?.uuid ?? raw.result?.uuid ?? "";
        const reconfigured = await reconfigureIfRequested({
          context: toolContext,
          reconfigure,
          requestId
        });

        appendHistory({
          context: toolContext,
          toolName: "dhcp_static_create",
          identity,
          requestId,
          action: "create",
          applied: true,
          ok: true,
          target: {
            uuid,
            ip_address: validation.record.ip_address,
            hostname: validation.record.hostname
          }
        });

        return {
          ok: true,
          applied: true,
          reconfigured,
          uuid,
          record: validation.record
        };
      }
    })
  );

  server.registerTool(
    "dhcp_static_update",
    {
      description: "Update an existing Dnsmasq host entry.",
      inputSchema: staticUpdateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_static_update",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;
        const before = await getStaticHostByUuid({
          context: toolContext,
          uuid: args.uuid,
          requestId
        });
        const after = mergeUpdateRecord({
          before,
          args
        });
        const validation = await validateAndDetectConflicts({
          context: toolContext,
          record: after,
          ignoreUuid: args.uuid,
          requestId
        });

        if (!validation.ok) {
          appendHistory({
            context: toolContext,
            toolName: "dhcp_static_update",
            identity,
            requestId,
            action: "update_rejected",
            applied: false,
            ok: false,
            target: {
              uuid: args.uuid
            }
          });
          return validation.result;
        }

        const diff = diffRecords({
          before,
          after: validation.record
        });
        const plannedPayload = buildHostPayload({
          record: validation.record
        });

        if (!args.apply) {
          appendHistory({
            context: toolContext,
            toolName: "dhcp_static_update",
            identity,
            requestId,
            action: "plan_update",
            applied: false,
            ok: true,
            target: {
              uuid: args.uuid
            }
          });

          return {
            ok: true,
            applied: false,
            before,
            after: validation.record,
            diff,
            planned_payload: plannedPayload,
            conflicts: validation.conflictReport.conflicts
          };
        }

        await toolContext.opnsense.setHost({
          uuid: args.uuid,
          host: plannedPayload,
          requestId
        });
        const reconfigured = await reconfigureIfRequested({
          context: toolContext,
          reconfigure,
          requestId
        });

        appendHistory({
          context: toolContext,
          toolName: "dhcp_static_update",
          identity,
          requestId,
          action: "update",
          applied: true,
          ok: true,
          target: {
            uuid: args.uuid
          }
        });

        return {
          ok: true,
          applied: true,
          reconfigured,
          before,
          after: validation.record,
          diff
        };
      }
    })
  );

  server.registerTool(
    "dhcp_static_delete",
    {
      description: "Delete a Dnsmasq host entry.",
      inputSchema: staticDeleteSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true
      }
    },
    makeToolHandler({
      context,
      toolName: "dhcp_static_delete",
      mutating: true,
      handler: async ({ args, context: toolContext, identity, requestId }) => {
        if (args.confirm !== true) {
          return validationError({
            message: "confirm must be true to delete a Dnsmasq host."
          });
        }

        const reconfigure = args.reconfigure ?? toolContext.config.autoReconfigureAfterWrite;
        const deleted = await getStaticHostByUuid({
          context: toolContext,
          uuid: args.uuid,
          requestId
        });

        if (!args.apply) {
          appendHistory({
            context: toolContext,
            toolName: "dhcp_static_delete",
            identity,
            requestId,
            action: "plan_delete",
            applied: false,
            ok: true,
            target: {
              uuid: args.uuid
            }
          });

          return {
            ok: true,
            applied: false,
            planned_delete: deleted
          };
        }

        await toolContext.opnsense.deleteHost({
          uuid: args.uuid,
          requestId
        });
        const reconfigured = await reconfigureIfRequested({
          context: toolContext,
          reconfigure,
          requestId
        });

        appendHistory({
          context: toolContext,
          toolName: "dhcp_static_delete",
          identity,
          requestId,
          action: "delete",
          applied: true,
          ok: true,
          target: {
            uuid: args.uuid
          }
        });

        return {
          ok: true,
          applied: true,
          reconfigured,
          deleted
        };
      }
    })
  );
};
