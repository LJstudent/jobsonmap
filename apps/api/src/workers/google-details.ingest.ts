import "dotenv/config";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { businesses } from "../schema/business";
import { fetchPlaceDetails } from "../services/google.service";

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY");
  }

  console.log("Starting Google details enrichment...\n");

  const rows = await db
    .select({
      id: businesses.id,
      placeId: businesses.placeId,
      name: businesses.name,
    })
    .from(businesses)
    .where(
      or(
        isNull(businesses.website),
        isNull(businesses.formattedAddress),
        eq(businesses.formattedAddress, "")
      )
    )
    .orderBy(asc(businesses.id));

  console.log(`Found ${rows.length} businesses to enrich`);

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      console.log(`Fetching details for ${row.name} (${row.placeId})`);

      const details = await fetchPlaceDetails(apiKey, row.placeId);

      await db
        .update(businesses)
        .set({
          website: details.website,
          formattedAddress: details.formattedAddress,
        })
        .where(eq(businesses.id, row.id));

      updated++;

      console.log(
        `Updated ${row.name} | website: ${details.website ?? "-"} | address: ${details.formattedAddress ?? "-"}`
      );

      await sleep(150);
    } catch (error) {
      failed++;
      console.error(`Failed to enrich ${row.name}:`, error);
    }
  }

  console.log("\n====== ENRICH SUMMARY ======");
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);
}

run().catch((err) => {
  console.error("Worker crashed:", err);
});
