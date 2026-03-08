// apps/api/src/schema/business.ts
import {
    pgTable,
    serial,
    text,
    doublePrecision,
    boolean,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";

export const businesses = pgTable(
    "businesses",
    {
        id: serial("id").primaryKey(),

        name: text("name").notNull(),

        placeId: text("place_id").notNull(),

        latitude: doublePrecision("latitude").notNull(),
        longitude: doublePrecision("longitude").notNull(),

        website: text("website"),

        formattedAddress: text("formatted_address"),

        hasJobsPage: boolean("has_jobs_page").default(false),

        crawlAttempted: boolean("crawl_attempted").default(false),

        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        placeIdIdx: uniqueIndex("business_place_id_unique").on(table.placeId),
    })
);