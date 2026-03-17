import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { businesses } from "./businesses";

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),

  businessId: integer("business_id").notNull().references(() => businesses.id),

  title: text("title").notNull(),

  locationText: text("location_text"),

  city: text("city"),

  description: text("description"),

  url: text("url").notNull(),

  externalId: text("external_id"),

  sourcePlatform: text("source_platform"),

  firstSeenAt: timestamp("first_seen_at").defaultNow(),

  lastSeenAt: timestamp("last_seen_at").defaultNow(),

  isActive: boolean("is_active").default(true)
});