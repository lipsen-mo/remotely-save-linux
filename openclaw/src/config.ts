import fs from "node:fs";
import path from "node:path";
import { DaemonConfig } from "./types";

const REQUIRED_KEYS = [
  "oss.endpoint",
  "oss.region",
  "oss.bucket",
  "oss.accessKeyId",
  "oss.secretAccessKey",
  "vault.id",
  "vault.rootDir",
] as const;

function parseScalar(raw: string): string | number | boolean {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v.replace(/^['\"]|['\"]$/g, "");
}

function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let section = "";
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^[^\s][^:]+:\s*$/.test(line)) {
      section = line.split(":")[0].trim();
      result[section] = result[section] ?? {};
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;

    const key = trimmed.slice(0, idx).trim();
    const value = parseScalar(trimmed.slice(idx + 1));
    if (section && line.startsWith("  ")) {
      const sec = (result[section] as Record<string, unknown>) ?? {};
      sec[key] = value;
      result[section] = sec;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function ensureLinuxOnly(): void {
  if (process.platform !== "linux") {
    throw new Error("rs-openclaw only supports Linux terminal runtime");
  }
}

function ensureAlibabaOssEndpoint(endpoint: string): void {
  if (!endpoint.includes("aliyuncs.com")) {
    throw new Error("only Alibaba OSS endpoints are supported (aliyuncs.com)");
  }
}

function ensureDefaults(config: DaemonConfig): DaemonConfig {
  const stateDir = config.vault.stateDir || path.join(config.vault.rootDir, ".rs-openclaw");
  return {
    ...config,
    oss: {
      ...config.oss,
      dataPrefix: config.oss.dataPrefix || `vaults/${config.vault.id}/`,
      lockPrefix: config.oss.lockPrefix || `locks/${config.vault.id}/`,
    },
    vault: {
      ...config.vault,
      stateDir,
      socketPath: config.vault.socketPath || path.join(stateDir, "daemon.sock"),
      debounceMs: config.vault.debounceMs || 1000,
      conflictPolicy: config.vault.conflictPolicy || "keep_both_and_rename",
      excludeGlobs: config.vault.excludeGlobs || [".obsidian/cache", "*.swp", "*.tmp"],
      lockTtlSec: config.vault.lockTtlSec || 45,
    },
  };
}

export function loadConfig(configPath: string): DaemonConfig {
  ensureLinuxOnly();
  if (!configPath.endsWith(".yaml") && !configPath.endsWith(".yml")) {
    throw new Error("only YAML config files are supported");
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = parseSimpleYaml(raw);
  const config = ensureDefaults(parsed as DaemonConfig);

  for (const key of REQUIRED_KEYS) {
    const [left, right] = key.split(".");
    const target = (config as any)[left]?.[right];
    if (!target) {
      throw new Error(`missing required config: ${key}`);
    }
  }

  ensureAlibabaOssEndpoint(config.oss.endpoint);
  fs.mkdirSync(config.vault.stateDir, { recursive: true });
  return config;
}
