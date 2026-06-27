import { describe, it, expect } from "vitest";
import { compressLogs } from "../src/compression/log-compressor.js";

const SAMPLE_LOGS = `
2024-01-15T10:23:45.123Z INFO  Server starting on port 3000
2024-01-15T10:23:45.200Z INFO  Connected to database
2024-01-15T10:23:46.001Z WARN  Deprecated API endpoint /api/v1/users called
2024-01-15T10:23:46.100Z ERROR Cannot find module './services/auth'
    at Object.<anonymous> (/app/src/server.ts:12:3)
    at Module._compile (node:internal/modules/cjs/loader:1241:14)
    at Object.Module._extensions..js (node:internal/modules/cjs/loader:1295:10)
2024-01-15T10:23:46.200Z ERROR Cannot find module './services/auth'
    at Object.<anonymous> (/app/src/server.ts:12:3)
2024-01-15T10:23:46.300Z WARN  Missing environment variable: DATABASE_URL
2024-01-15T10:23:47.000Z INFO  Build complete
`;

describe("compressLogs", () => {
  it("returns error status when errors present", () => {
    const result = compressLogs(SAMPLE_LOGS);
    expect(result.status).toBe("error");
  });

  it("extracts errors", () => {
    const result = compressLogs(SAMPLE_LOGS);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("deduplicates repeated errors", () => {
    const result = compressLogs(SAMPLE_LOGS);
    // The "Cannot find module" error appears twice — should be deduplicated
    const moduleError = result.errors.find((e) => e.message.includes("Cannot find module"));
    expect(moduleError).toBeDefined();
    expect(moduleError?.count).toBe(2);
  });

  it("extracts warnings", () => {
    const result = compressLogs(SAMPLE_LOGS);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("provides recommended actions", () => {
    const result = compressLogs(SAMPLE_LOGS);
    expect(result.recommendedActions.length).toBeGreaterThan(0);
    // Should recommend npm install for module not found
    const hasInstallRec = result.recommendedActions.some((a) => a.includes("npm install") || a.includes("import"));
    expect(hasInstallRec).toBe(true);
  });

  it("saves tokens", () => {
    const result = compressLogs(SAMPLE_LOGS);
    expect(result.tokens.saved).toBeGreaterThanOrEqual(0);
    expect(result.tokens.original).toBeGreaterThan(result.tokens.optimized);
  });

  it("handles empty logs", () => {
    const result = compressLogs("");
    expect(result.status).toBe("success");
    expect(result.errors.length).toBe(0);
  });

  it("returns success for clean logs", () => {
    const cleanLogs = "INFO  Build successful\nINFO  Tests passed: 42/42\nINFO  Done";
    const result = compressLogs(cleanLogs);
    expect(result.status).toBe("success");
    expect(result.errors.length).toBe(0);
  });
});
