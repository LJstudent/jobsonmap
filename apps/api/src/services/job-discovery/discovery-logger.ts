import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export type DiscoveryLogType =
  | 'results'
  | 'recruitment-style-host'
  | 'recruitment-root-pivot'
  | 'recruitment-root-preferred-path'
  | 'sitemap-cluster'
  | 'scoring'
  | 'crawl-deeper'
  | 'debug-priority'
  | 'decision'
  | 'finalize-reject'
  | 'skipped'
  | 'low-confidence'
  | 'parent-promotion'
  | 'pivot-explore'
  | 'errors';

type DiscoveryLogEntry = {
  timestamp: string;
  runId: string;
  type: DiscoveryLogType;
  payload: Record<string, unknown>;
};

const LOG_DIRECTORY = path.resolve(process.cwd(), 'logs', 'job-discovery');

// ✅ Create a safe run id (no ":" or "." for Windows/filesystems)
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');

function getLogFilePath(type: DiscoveryLogType): string {
  return path.join(LOG_DIRECTORY, `${type}-${RUN_ID}.jsonl`);
}

export function logDiscovery(
  type: DiscoveryLogType,
  payload: Record<string, unknown>,
): void {
  const entry: DiscoveryLogEntry = {
    timestamp: new Date().toISOString(),
    runId: RUN_ID,
    type,
    payload,
  };

  mkdirSync(LOG_DIRECTORY, { recursive: true });

  appendFileSync(
    getLogFilePath(type),
    JSON.stringify(entry, null, 2) + '\n\n',
    'utf8',
  );
}
