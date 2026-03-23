// apps/api/src/schema/business.ts
import {
  pgTable,
  serial,
  text,
  doublePrecision,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const businesses = pgTable(
  'businesses',
  {
    id: serial('id').primaryKey(),

    name: text('name').notNull(),

    placeId: text('place_id').notNull(),

    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),

    website: text('website'),

    formattedAddress: text('formatted_address'),

    hasJobsPage: boolean('has_jobs_page').default(false),

    // discovery result
    jobsUrl: text('jobs_url'),

    jobsPlatform: text('jobs_platform'),

    jobsDiscoveryStatus: text('jobs_discovery_status'),

    jobsDiscoveryCheckedAt: timestamp('jobs_discovery_checked_at'),

    jobsScrapeStatus: text('jobs_scrape_status'),

    jobsScrapeCheckedAt: timestamp('jobs_scrape_checked_at'),

    // scheduling (VERY useful for workers)
    nextDiscoveryAt: timestamp('next_discovery_at'),
    nextScrapeAt: timestamp('next_scrape_at'),

    // analytics
    lastJobsFoundAt: timestamp('last_jobs_found_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    placeIdIdx: uniqueIndex('business_place_id_unique').on(table.placeId),
  }),
);
