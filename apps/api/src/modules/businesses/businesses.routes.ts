import { type FastifyPluginAsync } from "fastify";
import { BusinessesRepository } from "./businesses.repository";
import { BusinessesService } from "./businesses.service";
import { GetBusinessesRequest } from "./businesses.types";

const getAllBusinessesQuerySchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    offset: { type: "integer", minimum: 0, default: 0 },
    city: { type: "string", minLength: 1 },
    hasJobsPage: { type: "boolean" },
  },
} as const;
export const businessesRoutes: FastifyPluginAsync = async (fastify) => {
  const repo = new BusinessesRepository();
  const service = new BusinessesService(repo);

  fastify.get<GetBusinessesRequest>(
    "/businesses",
    {
      schema: {
        tags: ["businesses"],
        querystring: getAllBusinessesQuerySchema,
      },
    },
    async (request, reply) => {
      const result = await service.getAllBusinesses(request.query);
      return reply.send(result);
    }
  );
};