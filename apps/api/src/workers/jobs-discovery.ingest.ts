import 'dotenv/config';
import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
import { db } from '../db';
import { businesses } from '../schema/businesses';
import { jobDiscoveryRuns } from '../schema/job_discovery_runs';
import { logDiscovery } from '../services/job-discovery/discovery-logger';
import { JobPageDiscoveryService } from '../services/job-discovery/job-page-discovery.service';
import { type DiscoveryStatus } from '../services/job-discovery/heuristic-discovery.service';

type DiscoveryTarget = {
  id: number;
  name: string;
  website: string;
};

const DEFAULT_CONCURRENCY = 8;
const discoveryService = new JobPageDiscoveryService();

function getConcurrency(): number {
  const parsed = Number(
    process.env.JOB_DISCOVERY_CONCURRENCY ?? DEFAULT_CONCURRENCY,
  );

  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_CONCURRENCY;
  }

  return Math.min(10, Math.floor(parsed));
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>,
): Promise<void> {
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const item = items[currentIndex];
      currentIndex += 1;
      await handler(item);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}

async function loadBusinesses(): Promise<DiscoveryTarget[]> {
  return db
    .select({
      id: businesses.id,
      name: businesses.name,
      website: businesses.website,
    })
    .from(businesses)
    .where(and(isNotNull(businesses.website), ne(businesses.website, '')))
    .orderBy(asc(businesses.id)) as Promise<DiscoveryTarget[]>;
}

async function persistDiscoveryResult(target: DiscoveryTarget) {
  const result = await discoveryService.discover(target.website);
  const checkedAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(businesses)
      .set({
        jobsUrl: result.jobsUrl,
        jobsPlatform: result.platform,
        hasJobsPage: result.status === 'found',
        jobsDiscoveryStatus: result.status,
        jobsDiscoveryCheckedAt: checkedAt,
      })
      .where(eq(businesses.id, target.id));

    if (result.attempts.length > 0) {
      await tx.insert(jobDiscoveryRuns).values(
        result.attempts.map((attempt) => ({
          businessId: target.id,
          method: attempt.method,
          status: attempt.status,
          foundUrl: attempt.foundUrl,
          durationMs: attempt.durationMs,
          message: attempt.message,
        })),
      );
    }
  });

  return result;
}

async function run() {
  const rows = await loadBusinesses();
  const concurrency = getConcurrency();

  console.log(
    `Starting jobs discovery for ${rows.length} businesses with concurrency ${concurrency}`,
  );

  const summary: Record<DiscoveryStatus, number> = {
    found: 0,
    not_found: 0,
    error: 0,
  };

  await mapWithConcurrency(rows, concurrency, async (row) => {
    try {
      console.log(`Discovering jobs page for ${row.name} (${row.website})`);
      const result = await persistDiscoveryResult(row);
      summary[result.status] += 1;
      logDiscovery('results', {
        businessId: row.id,
        name: row.name,
        website: row.website,
        status: result.status,
        jobsUrl: result.jobsUrl,
        method: result.method,
        platform: result.platform,
        attempts: result.attempts,
      });

      if (result.status === 'error') {
        logDiscovery('errors', {
          businessId: row.id,
          name: row.name,
          website: row.website,
          attempts: result.attempts,
          reason: 'discovery-returned-error-status',
        });
      }

      console.log(
        `Finished ${row.name} -> ${result.status}${result.jobsUrl ? ` | ${result.jobsUrl}` : ''}${result.platform ? ` | ${result.platform}` : ''}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      summary.error += 1;

      await db.transaction(async (tx) => {
        await tx
          .update(businesses)
          .set({
            jobsUrl: null,
            jobsPlatform: null,
            hasJobsPage: false,
            jobsDiscoveryStatus: 'error',
            jobsDiscoveryCheckedAt: new Date(),
          })
          .where(eq(businesses.id, row.id));

        await tx.insert(jobDiscoveryRuns).values({
          businessId: row.id,
          method: 'crawl',
          status: 'error',
          foundUrl: null,
          durationMs: 0,
          message,
        });
      });

      logDiscovery('errors', {
        businessId: row.id,
        name: row.name,
        website: row.website,
        message,
        reason: 'worker-exception',
      });
      console.error(`Discovery failed for ${row.name}: ${message}`);
    }
  });

  console.log('\n====== JOB DISCOVERY SUMMARY ======');
  console.log(`Found: ${summary.found}`);
  console.log(`Not found: ${summary.not_found}`);
  console.log(`Errors: ${summary.error}`);
}

run().catch((error) => {
  console.error('Worker crashed:', error);
  process.exitCode = 1;
});
