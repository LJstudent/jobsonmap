import "dotenv/config";
import { db } from "../db";
import { businesses } from "../schema/business";
import { fetchUtrechtBusinesses } from "../services/google.service";

async function run() {
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY");
  }

  console.log("Starting Utrecht ingestion...\n");

  const places = await fetchUtrechtBusinesses(apiKey);

  console.log(`\nFetched ${places.length} places from Google`);

  let inserted = 0;

  for (const place of places) {
    try {
      const result = await db
        .insert(businesses)
        .values({
          name: place.name,
          placeId: place.place_id,
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng,
        })
        .onConflictDoNothing()
        .returning();

      if (result.length > 0) {
        inserted++;
      }

    } catch (err) {
      console.error("Insert failed:", err);
    }
  }

  console.log("\n====== INSERT SUMMARY ======");
  console.log(`Inserted ${inserted} new businesses`);
  console.log(`Skipped duplicates: ${places.length - inserted}`);
}

run().catch((err) => {
  console.error("Worker crashed:", err);
});