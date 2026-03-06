import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { businessesRoutes } from "./modules/businesses/businesses.routes";

const app = Fastify({ logger: true });

async function start() {
  // Swagger spec
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Jobsonmap API",
        description: "API documentation for Jobsonmap backend",
        version: "1.0.0",
      },
    },
  });

  // Swagger UI
  await app.register(swaggerUI, {
    routePrefix: "/docs",
  });

  app.get("/", async () => {
    try {
      const result = await db.execute(sql`SELECT 1 as test`);
      return { db: result.rows[0] };
    } catch (error) {
      console.error(error);
      return { error };
    }
  });

  app.register(businessesRoutes);

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    reply.code(500).send({ message: "Internal Server Error" });
  });

  await app.listen({ port: 4000 });

  console.log("API running on http://localhost:4000");
  console.log("Swagger docs on http://localhost:4000/docs");
}

start();