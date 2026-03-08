import { useQuery } from "@tanstack/react-query";
import type { Business } from "@/data/businesses";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const BUSINESS_LIMIT = 2000;

type BusinessesResponse = {
  data: Array<{
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    city: string | null;
  }>;
  meta: {
    total: number;
  };
};

const toBusiness = (item: BusinessesResponse["data"][number]): Business => ({
  id: String(item.id),
  name: item.name,
  area: item.city ?? "Utrecht",
  city: (item.city ?? "Utrecht") as Business["city"],
  lat: item.latitude,
  lng: item.longitude,
  status: "likely-hiring",
});

async function fetchBusinesses(): Promise<{ businesses: Business[]; total: number }> {
  const response = await fetch(`${API_BASE_URL}/businesses?offset=0&limit=${BUSINESS_LIMIT}`);

  if (!response.ok) {
    throw new Error(`Failed to load businesses (${response.status})`);
  }

  const payload = (await response.json()) as BusinessesResponse;

  return {
    businesses: payload.data.map(toBusiness),
    total: payload.meta.total,
  };
}

export const useBusinessesQuery = () =>
  useQuery({
    queryKey: ["businesses", BUSINESS_LIMIT],
    queryFn: fetchBusinesses,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
