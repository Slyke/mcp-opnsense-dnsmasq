import fs from "node:fs";
import path from "node:path";

const parseHistoryEntries = ({ raw }) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  }

  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
};

const readHistoryEntries = ({ historyFile }) => {
  if (!fs.existsSync(historyFile)) {
    return [];
  }

  try {
    return parseHistoryEntries({ raw: fs.readFileSync(historyFile, "utf8") });
  } catch {
    return [];
  }
};

const writeHistoryEntries = ({ historyFile, entries }) => {
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  const payload = entries.length > 0 ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
  fs.writeFileSync(historyFile, payload, "utf8");
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
