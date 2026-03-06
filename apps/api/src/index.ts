import Fastify from "fastify";
import { sql } from "drizzle-orm";
import { db } from "./db";

const app = Fastify();

app.get("/", async () => {
  try {
    const result = await db.execute(sql`SELECT 1 as test`);
    return { db: result.rows[0] };
  } catch (error) {
    console.error(error);
    return { error };
  }
});

app.listen({ port: 4000 }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  console.log("API running on http://localhost:4000");
});