// apps/api/src/services/google.service.ts
import axios from "axios";
import { polygonToCells, cellToLatLng } from "h3-js";

const BASE_URL =
  "https://maps.googleapis.com/maps/api/place/nearbysearch/json";

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const keywords = [
  "software company",
  "softwarebedrijf",
  "IT consultancy",
  "IT adviesbureau",
  "SaaS company",
  "ingenieursbureau",
  "engineering company",
  "installatiebedrijf",
  "energiebedrijf",
  "renewable energy",
  "duurzame energie bedrijf",
  "Energieopwekkingsapparatuur en -oplossingen",
];

/*
Polygon covering:
Utrecht
Zeist
De Bilt
Nieuwegein
Houten
*/

const areaPolygon = [
  [52.1710, 5.0200], // NW - west of Maarssen
  [52.1750, 5.2000], // N  - north of Bilthoven
  [52.1350, 5.3000], // NE - east Zeist
  [52.0400, 5.3300], // E  - east Driebergen
  [51.9850, 5.2000], // SE - south Houten
  [51.9800, 5.0200], // S  - south IJsselstein
  [52.0400, 4.9300], // SW - west De Meern
  [52.1200, 4.9500], // W  - west Maarssen
];

export async function fetchUtrechtBusinesses(apiKey: string) {
  const allResults: any[] = [];

  let totalRequests = 0;
  let totalResults = 0;

  // resolution 7 ≈ ~2–3km hexagons
  const resolution = 7;

  const hexagons = polygonToCells(areaPolygon, resolution);

  const centers = hexagons.map((h) => {
    const [lat, lng] = cellToLatLng(h);
    return { lat, lng };
  });

  console.log("Total hex cells:", centers.length);

  for (const center of centers) {
    console.log(
      `\n📍 Searching hex center: ${center.lat}, ${center.lng}`
    );

    for (const keyword of keywords) {
      console.log(`🔎 Keyword: ${keyword}`);

      let nextPageToken: string | undefined;

      do {
        totalRequests++;

        const params: any = {
          location: `${center.lat},${center.lng}`,
          radius: 2000,
          keyword,
          key: apiKey,
        };

        // Only send pagetoken if it exists
        if (nextPageToken) {
          params.pagetoken = nextPageToken;
        }

        const { data } = await axios.get(BASE_URL, { params });

        console.log(`Status: ${data.status}`);

        const results = data.results ?? [];

        console.log(
          `Request ${totalRequests} → ${results.length} results`
        );

        if (results.length > 0) {
          console.log("Example company:", results[0].name);
        }

        totalResults += results.length;

        console.log(`Total collected so far: ${totalResults}`);

        if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
          console.error("Google API issue:", data.status);
        }

        allResults.push(...results);

        nextPageToken = data.next_page_token;

        if (nextPageToken) {
          console.log("Waiting for next page token...");
          await sleep(2000);
        }

      } while (nextPageToken);
    }
  }

  console.log("\n====== FETCH SUMMARY ======");
  console.log("Total API requests:", totalRequests);
  console.log("Total places collected:", totalResults);

  return allResults;
}