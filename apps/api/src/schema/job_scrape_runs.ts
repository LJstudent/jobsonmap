import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const jobScrapeRuns = pgTable("job_scrape_runs", {
  id: serial("id").primaryKey(),

  businessId: integer("business_id").notNull(),

  status: text("status"),

  jobsFound: integer("jobs_found"),

  durationMs: integer("duration_ms"),

  httpStatus: integer("http_status"),

  message: text("message"),

  createdAt: timestamp("created_at").defaultNow(),
});