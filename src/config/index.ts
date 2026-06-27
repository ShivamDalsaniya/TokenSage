import path from "node:path";

export interface TokenSageConfig {
  dashboard: {
    port: number;
    host: string;
    enabled: boolean;
    projectName: string;
    projectPath: string;
  };
  compression: {
    maxFileSizeBytes: number;
    defaultTopK: number;
    minSavingsToReport: number;
  };
  logging: {
    level: "trace" | "debug" | "info" | "warn" | "error";
    pretty: boolean;
  };
}

/** Deterministic port 7100–7999 from project path hash. */
export function computeProjectPort(projectPath: string): number {
  let hash = 5381;
  for (let i = 0; i < projectPath.length; i++) {
    hash = ((hash << 5) + hash) ^ projectPath.charCodeAt(i);
    hash = hash >>> 0;
  }
  return 7100 + (hash % 900);
}

const projectPath = process.env["PROJECT_PATH"] ?? process.cwd();
const projectName = process.env["PROJECT_NAME"] ?? path.basename(projectPath);

const defaultPort = computeProjectPort(projectPath);

export const DEFAULT_CONFIG: TokenSageConfig = {
  dashboard: {
    port: parseInt(process.env["DASHBOARD_PORT"] ?? String(defaultPort), 10),
    host: process.env["DASHBOARD_HOST"] ?? "localhost",
    enabled: process.env["DASHBOARD_ENABLED"] !== "false",
    projectName,
    projectPath,
  },
  compression: {
    maxFileSizeBytes: parseInt(process.env["MAX_FILE_SIZE_BYTES"] ?? String(500 * 1024), 10),
    defaultTopK: parseInt(process.env["DEFAULT_TOP_K"] ?? "10", 10),
    minSavingsToReport: parseInt(process.env["MIN_SAVINGS_PERCENT"] ?? "10", 10),
  },
  logging: {
    level: (process.env["LOG_LEVEL"] as TokenSageConfig["logging"]["level"]) ?? "info",
    pretty: process.env["LOG_PRETTY"] === "true",
  },
};
