import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";

const readHistoryEntries = ({ historyFile }) => {
  if (!fs.existsSync(historyFile)) {
    return [];
  }

  try {
    const parsed = JSON5.parse(fs.readFileSync(historyFile, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeHistoryEntries = ({ historyFile, entries }) => {
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.writeFileSync(historyFile, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
};

export const createHistoryStore = ({ config }) => {
  const append = ({ toolName, identityName, action, applied = false, ok = true, target = {}, requestId }) => {
    const entries = readHistoryEntries({ historyFile: config.historyFile });
    const entry = {
      timestamp: new Date().toISOString(),
      request_id: requestId,
      tool_name: toolName,
      identity_name: identityName,
      action,
      applied,
      ok,
      target
    };
    const nextEntries = [entry, ...entries].slice(0, config.historyCount);
    writeHistoryEntries({
      historyFile: config.historyFile,
      entries: nextEntries
    });
    return entry;
  };

  const search = ({ query, tool_name, identity_name, applied, limit = 50 } = {}) => {
    const normalizedQuery = String(query ?? "").trim().toLowerCase();
    const entries = readHistoryEntries({ historyFile: config.historyFile });

    return entries
      .filter((entry) => {
        if (tool_name && entry.tool_name !== tool_name) {
          return false;
        }

        if (identity_name && entry.identity_name !== identity_name) {
          return false;
        }

        if (applied !== undefined && entry.applied !== applied) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        return JSON.stringify(entry).toLowerCase().includes(normalizedQuery);
      })
      .slice(0, limit);
  };

  return {
    append,
    search
  };
};
