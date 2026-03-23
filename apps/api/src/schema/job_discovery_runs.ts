import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const jobDiscoveryRuns = pgTable('job_discovery_runs', {
  id: serial('id').primaryKey(),

  businessId: integer('business_id').notNull(),

  method: text('method'),

  status: text('status'),

  foundUrl: text('found_url'),

  platform: text('platform'),

  durationMs: integer('duration_ms'),

  message: text('message'),

  createdAt: timestamp('created_at').defaultNow(),
});
