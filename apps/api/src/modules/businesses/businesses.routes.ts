import { type FastifyPluginAsync } from "fastify";
import { BusinessesRepository } from "./businesses.repository";
import { BusinessesService } from "./businesses.service";
import { GetBusinessesRequest } from "./businesses.types";

const getAllBusinessesQuerySchema = {
  type: "object",
  properties: {
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