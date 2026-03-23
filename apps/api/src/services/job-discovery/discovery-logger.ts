import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type DiscoveryLogType = "results" | "low-confidence" | "errors";

type DiscoveryLogEntry = {
  timestamp: string;
  type: DiscoveryLogType;
  payload: Record<string, unknown>;
};

const LOG_DIRECTORY = path.resolve(process.cwd(), "logs", "job-discovery");

function getLogFilePath(type: DiscoveryLogType): string {
  return path.join(LOG_DIRECTORY, `${type}.jsonl`);
}

export function logDiscovery(type: DiscoveryLogType, payload: Record<string, unknown>): void {
  const entry: DiscoveryLogEntry = {
    timestamp: new Date().toISOString(),
    type,
    payload,
  };

  mkdirSync(LOG_DIRECTORY, { recursive: true });
  appendFileSync(getLogFilePath(type), `${JSON.stringify(entry)}\n`, "utf8");
}
