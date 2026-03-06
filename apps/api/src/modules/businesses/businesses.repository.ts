import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { businesses } from "../../schema/business";
import { type BusinessRecord, type GetAllBusinessesQuery, type GetAllBusinessesResult } from "./businesses.types";

export class BusinessesRepository {
  async getAll(query: GetAllBusinessesQuery): Promise<GetAllBusinessesResult> {
    const whereClauses: SQL[] = [];

    if (query.city) {
      whereClauses.push(eq(businesses.city, query.city));
    }

    if (typeof query.hasJobsPage === "boolean") {
      whereClauses.push(eq(businesses.hasJobsPage, query.hasJobsPage));
    }

    const whereExpression = whereClauses.length > 0 ? and(...whereClauses) : undefined;

    const businessRows: BusinessRecord[] = await db
      .select({
        id: businesses.id,
        name: businesses.name,
        placeId: businesses.placeId,
        latitude: businesses.latitude,
        longitude: businesses.longitude,
        website: businesses.website,
        city: businesses.city,
        hasJobsPage: businesses.hasJobsPage,
        crawlAttempted: businesses.crawlAttempted,
        createdAt: businesses.createdAt,
      })
      .from(businesses)
      .where(whereExpression)
      .orderBy(desc(businesses.createdAt))
      .limit(query.limit)
      .offset(query.offset);

    const countResult = await db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(businesses)
      .where(whereExpression);

    return {
      data: businessRows,
      meta: {
        total: countResult[0]?.total ?? 0,
        limit: query.limit,
        offset: query.offset,
      },
    };
  }
}
