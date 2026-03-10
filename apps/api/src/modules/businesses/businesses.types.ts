export type GetAllBusinessesQuery = {
  limit: number;
  offset: number;
  formattedAddress?: string;
  hasJobsPage?: boolean;
};

export type BusinessRecord = {
  id: number;
  name: string;
  placeId: string;
  latitude: number;
  longitude: number;
  website: string | null;
  formattedAddress: string | null;
  hasJobsPage: boolean | null;
  crawlAttempted: boolean | null;
  createdAt: Date;
};

export type GetAllBusinessesResult = {
  data: BusinessRecord[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
};

export type GetBusinessesRequest = {
  Querystring: GetAllBusinessesQuery;
};
