# Project Context: Jobsonmap

## Current Focus

This context file is intentionally focused on job discovery and job scraping work.

The codebase contains a frontend map app and a generic businesses API, but the most relevant active area for future coding sessions is under `apps/api/src/services/job-discovery`, `apps/api/src/workers`, and the database schemas for businesses, jobs, discovery runs, and scrape runs.

Job discovery is implemented in visible code. Job scraping is represented by database tables and status fields, but a scraper implementation is not visible in the inspected files.

## Purpose

Code-visible purpose:

- `apps/web/README.md` describes a map-first app that shows nearby businesses that are hiring, including cases where formal job ads may not exist.
- The backend stores businesses with website URLs and discovery fields such as `jobsUrl`, `jobsPlatform`, `jobsDiscoveryStatus`, and `jobsDiscoveryCheckedAt`.
- The discovery worker attempts to find a jobs/careers URL for each selected business website.
- The schema includes a `jobs` table and `job_scrape_runs` table, indicating planned or partial support for storing scraped jobs and scrape run metadata.

## Tech Stack

- Root workspace uses npm workspaces for `apps/*` and `packages/*`.
- Backend: TypeScript, Fastify, Drizzle ORM, PostgreSQL, `pg`, `axios`, `dotenv`, `h3-js`.
- Backend workers run with `ts-node-dev` or `tsx`; `ingest:jobs-discovery` runs `tsx src/workers/jobs-discovery.ingest.ts`.
- Frontend: Vite, React, React Query, React Router, Leaflet/React Leaflet, Tailwind CSS.
- Local database: `docker-compose.yml` defines PostgreSQL `17.8` on host port `5433`.

## Repository Areas Relevant To Scraping

- `apps/api/src/workers/jobs-discovery.ingest.ts`
  - Loads businesses, calls `JobPageDiscoveryService`, persists discovery results, inserts `job_discovery_runs`, and writes result/error logs.
- `apps/api/src/workers/utrecht.ingest.ts`
  - Imports Google Places businesses into `businesses`.
- `apps/api/src/workers/google-details.ingest.ts`
  - Enriches businesses with `website` and `formattedAddress` from Google Place Details.
- `apps/api/src/services/job-discovery/job-page-discovery.service.ts`
  - Thin service wrapper around `discoverByHeuristics`.
- `apps/api/src/services/job-discovery/heuristic-discovery.service.ts`
  - Main discovery engine: crawl discovery, footer/HTML inspection, sitemap candidates, path guesses, Dutch recruitment domain guesses, scoring, classification orchestration, canonicalization, ATS detection, and result construction.
- `apps/api/src/services/job-discovery/sitemap-discovery.service.ts`
  - Fetches `/sitemap.xml`, follows sitemap indexes, extracts job-related URLs, groups them into parent listing clusters, and selects the best parent.
- `apps/api/src/services/job-discovery/page-classification.service.ts`
  - Extracts page features, classifies page type, ranks internal job links, detects external ATS links, and builds canonical selections.
- `apps/api/src/services/job-discovery/http-client.ts`
  - Shared Axios client and helpers for reachability checks and HTML fetching.
- `apps/api/src/services/job-discovery/domain.utils.ts`
  - URL normalization, root-domain comparison, protocol handling, file-like URL detection, and absolute URL resolution.
- `apps/api/src/services/job-discovery/discovery-logger.ts`
  - Structured discovery logs under `logs/job-discovery`.
- `apps/api/src/services/job-discovery/sitemap-discovery.test.ts`
  - Tests sitemap parent derivation, sitemap confidence, tie-breaking, and a sitemap score scenario.
- `apps/api/src/schema/businesses.ts`
  - Business records and discovery/scrape status fields.
- `apps/api/src/schema/jobs.ts`
  - Job records.
- `apps/api/src/schema/job_discovery_runs.ts`
  - Discovery attempt/run records.
- `apps/api/src/schema/job_scrape_runs.ts`
  - Scrape attempt/run records.

## Core Scraping / Discovery Concepts

- Business
  - A row in `businesses` with `name`, `placeId`, coordinates, optional `website`, optional `formattedAddress`, discovery fields, scrape fields, scheduling fields, and timestamps.
- Job
  - A row in `jobs` linked to `businesses.id`; fields include `title`, `locationText`, `city`, `description`, `url`, `externalId`, `sourcePlatform`, `firstSeenAt`, `lastSeenAt`, and `isActive`.
- Candidate URL
  - A possible job/careers URL represented by `Candidate` in `heuristic-discovery.service.ts`.
  - Candidate sources are `subdomain`, `path`, `crawl`, `sitemap`, and `html`.
  - Sitemap candidates may carry cluster metadata such as `clusterCount`, `clusterConfidence`, `clusterKeywordStrength`, `clusterPathDepth`, `clusterSameRootDomain`, and `isSitemapClusterWinner`.
- Discovery attempt
  - A `DiscoveryAttempt` has `method`, `status`, `foundUrl`, `durationMs`, and `message`.
  - Methods are `crawl`, `sitemap`, and `path_guess`.
- Discovery result
  - `JobPageDiscoveryResult` includes `status`, `jobsUrl`, `canonicalUrl`, `pageType`, `jobsOverviewUrl`, `employerBrandUrl`, `externalAtsUrl`, `confidence`, `reasons`, `method`, `platform`, `attempts`, and `topCandidates`.
- Job discovery run
  - A database row in `job_discovery_runs` inserted for each discovery attempt.
- Job scrape run
  - A database row shape exists in `job_scrape_runs`, but no visible code writes to it.
- ATS provider
  - Detected from known host patterns. `heuristic-discovery.service.ts` maps some ATS hosts to provider strings used as `platform`.
- Page classification
  - `page-classification.service.ts` classifies fetched pages as `job_overview`, `career_landing`, `job_detail`, `article_or_news`, `external_ats`, or `other`.

## Job Discovery Flow

1. Business selection
   - `jobs-discovery.ingest.ts` selects businesses with non-null, non-empty `website`.
   - It currently also filters to a hard-coded list of business IDs.
   - Rows are ordered by ascending `businesses.id`.
   - Default worker concurrency is `8`; `JOB_DISCOVERY_CONCURRENCY` can override it, capped at `10`.

2. Discovery service call
   - The worker calls `JobPageDiscoveryService.discover(target.website)`.
   - `JobPageDiscoveryService` delegates to `discoverByHeuristics`.
   - `discoverByGoogle` exists but throws an error saying Google discovery is no longer part of the active jobs discovery flow.

3. Reachability check
   - `discoverByHeuristics` calls `resolveReachableUrl`.
   - `testLightweightUrl` tries `HEAD`; for statuses `403`, `405`, or `501`, it falls back to a streaming `GET`.
   - If the website is unreachable, discovery returns `not_found` for some non-5xx statuses and `error` otherwise.

4. Candidate URL gathering
   - If reachable, discovery gathers candidates from:
     - `crawlForJobPage`
     - `inspectFooterForJobPage`
     - `discoverFromSitemapCandidates`
     - `guessCommonPaths`
     - `guessDutchRecruitmentDomains`
   - All candidate arrays are combined before selection.

5. Candidate scoring and classification
   - `selectBestCandidate` builds evidence by normalized URL, scores candidates, logs the top scoring candidates, deduplicates candidates by host and path, and fetches/classifies candidates that pass domain/ATS/recruitment checks.
   - `fetchClassifiedCandidate` skips file-like URLs and rejects candidates that are neither same-root, ATS, nor recruitment-domain candidates.
   - Fetched pages are converted into `PageFeatures`, classified, and converted into `CanonicalSelection`.

6. Selection and canonicalization
   - Classified candidates are sorted by `rankingScore`, then legacy score.
   - Candidates without canonical targets are skipped unless they are `job_detail`.
   - `article_or_news` candidates are skipped unless they have a strong career target via `jobsOverviewUrl` or `externalAtsUrl`.
   - `getCanonicalizationTargets` expands targets from canonical selection, job-detail parent guesses, overview URLs, external ATS URLs, and detail URLs.
   - `finalizeCandidateUrl` validates reachability, rejects some redirects to root pivots, checks soft 404 titles for path/subdomain candidates, validates final pages when needed, and returns the finalized jobs URL and platform.
   - Detail pages can be promoted to parent listing URLs through `normalizeSelectedDetailPageToParentListing`.

7. Persistence
   - The worker updates `businesses.jobsUrl`, `businesses.jobsPlatform`, `businesses.hasJobsPage`, `businesses.jobsDiscoveryStatus`, and `businesses.jobsDiscoveryCheckedAt`.
   - It inserts one `job_discovery_runs` row per returned attempt.
   - On worker exceptions it clears jobs URL/platform, marks discovery status `error`, and inserts an error discovery run.

8. Logging
   - The worker logs final `results` and `errors`.
   - Discovery services log scoring, features, classifications, canonicalization, skipped candidates, low-confidence outcomes, parent promotion, final decisions, and sitemap clusters.

## Candidate Sources

- Crawl discovery
  - `crawlForJobPage` starts from the reachable website URL, crawls same-root links up to `MAX_CRAWL_DEPTH = 2`, and can add one extra depth for career/pivot signals.
  - Same-domain links are prioritized by strong signal, about-page signal, then weak signal.
  - Up to `MAX_LINKS_PER_PAGE = 25` links are used, plus an extra budget of `10` when deeper exploration is allowed.
  - Direct ATS URLs, pages with job signals, URLs with strong/weak keywords, and job-detail patterns can become candidates.

- Footer / HTML inspection
  - `inspectFooterForJobPage` fetches the start URL, extracts `<footer>...</footer>` when present, extracts links from both the footer and full page, and adds HTML-sourced candidates from job/recruitment signals.

- Sitemap discovery
  - `discoverFromSitemap` starts at `/sitemap.xml`.
  - It follows sitemap indexes to `MAX_SITEMAP_DEPTH = 3`.
  - It keeps URLs containing job-related patterns such as `vacature`, `vacatures`, `job`, `jobs`, `career`, `careers`, `werken-bij`, `werkenbij`, `join-us`, and `open-positions`.
  - `selectBestSitemapParent` groups URLs by derived parent path and chooses by count, keyword strength, shorter path depth, same-host preference, then lexical parent order.
  - Cluster confidence is `LOW` for one URL, `MEDIUM` for two URLs, and `HIGH` for three or more URLs.

- Common path guesses
  - `guessCommonPaths` generates paths on the site origin, including `/jobs`, `/careers`, `/vacatures`, `/werken-bij`, `/career`, `/join-us`, `/work-with-us`, and `/open-positions`.
  - Recruitment-style hosts also include listing paths such as `/vacature`, `/job`, `/carriere`, and `/vacancies`.

- Dutch recruitment domain guesses
  - `guessDutchRecruitmentDomains` builds candidates like `https://werkenbij{company}.nl`, `https://werkenbij-{company}.nl`, and a dashed-label variant.
  - It also adds paths such as `/vacatures`, `/jobs`, `/careers`, `/werken-bij`, and `/werkenbij` on those domains.

- External ATS links/providers
  - `heuristic-discovery.service.ts` maps final platform detection for Greenhouse, Lever, Ashby, Teamtailor, Recruitee, Workable, Homerun, SmartRecruiters, Breezy, and Personio.
  - `page-classification.service.ts` also treats Workday, Jobvite, Onlyfy, Rexx Systems, and BambooHR hosts as ATS for page classification.

## Page Classification

Visible page types:

- `job_overview`
  - Returned for pages with strong overview signals, many vacancy links, listing cards, filters, or shallow job-keyword URLs with supporting listing evidence.
  - Canonical URL is the page itself.
- `career_landing`
  - Returned for pages with career landing keywords plus internal job links, external ATS links, or overview keywords, with fewer detail signals.
  - Canonical selection hands off to an internal overview URL, external ATS URL, or the landing page itself.
- `job_detail`
  - Returned when detail signals are high and vacancy link count is low.
  - Canonical selection tries internal overview links or parent overview candidates.
- `article_or_news`
  - Returned for article/news paths, date paths, article markers, or mixed-intent slug penalties.
  - Canonical selection rejects the article unless it has a strong internal overview or external ATS target.
- `external_ats`
  - Returned when the normalized URL itself matches an ATS host pattern in `page-classification.service.ts`.
  - Canonical URL is the ATS URL itself.
- `other`
  - Returned for soft 404 titles, job keywords without page evidence, or no job page evidence.

Extracted features include title, h1, meta description, breadcrumbs, nav labels, CTA texts, visible text snippet, path segments, article/date hints, job keyword hints, vacancy link count, apply button count, listing card count, external ATS links, internal job links, parent overview candidates, and detected page type hints.

## Scoring and Selection Principles

Visible candidate scoring behavior:

- Strong job keywords add score; weak job keywords add smaller score.
- Recruitment-style hostnames add score.
- False-positive URL patterns such as blog/news/privacy/product/about/team/project-style paths subtract score.
- URLs containing `jobs` plus portfolio/project/case context receive an additional penalty.
- Likely overview/listing pages get overview and listing-preferred bonuses.
- Generic employer branding pages are penalized.
- Same-root-domain candidates are rewarded; external-domain candidates are slightly penalized unless other checks keep them viable.
- ATS candidates receive an ATS bonus.
- Job-detail-like URLs are penalized at initial candidate scoring.
- Candidate source weights are visible: sitemap, subdomain, path, HTML, and crawl each have different weights.
- Sitemap candidates receive extra scoring from cluster winner status, cluster count, cluster confidence, keyword strength, path depth, and same-root-domain status.
- Multi-source and multi-group evidence can add small bonuses.

Visible classified ranking behavior:

- Page type multiplier is applied to candidate score:
  - `job_overview`: `1.0`
  - `career_landing`: `1.15`
  - `external_ats`: `1.05`
  - `job_detail`: `0.55`
  - `article_or_news`: `0.2`
  - `other`: `0.85`
- Classification confidence multiplies the score.
- Having a canonical URL adds `80`; missing one subtracts `80`.
- Having a `jobsOverviewUrl` or `externalAtsUrl` adds `35`.
- `article_or_news` subtracts `250`.
- A `career_landing` without overview or external ATS target subtracts `60`.

Visible selection and canonicalization behavior:

- Candidates are deduplicated by hostname plus pathname.
- For duplicates on the same host/path, URLs with query strings lose to cleaner URLs.
- If query presence is equal, shorter normalized URLs win.
- If length is equal, higher score wins.
- Detail URLs can be expanded to parent listing targets.
- Job detail pages can be promoted to parent listings when the parent finalizes successfully.
- Article/news candidates without a strong career target are skipped.
- Path and subdomain candidates get soft-404 title checks during finalization.
- Redirects from non-root candidates to a root page can be rejected as `redirected-to-root-pivot` when the final host is not recruitment-style.

## Logging and Debugging

Logs are written by `logDiscovery` to:

- `logs/job-discovery/<type>-<runId>.jsonl`

Each entry contains:

- `timestamp`
- `runId`
- `type`
- `payload`

Visible log types:

- `results`
- `recruitment-style-host`
- `recruitment-root-pivot`
- `recruitment-root-preferred-path`
- `sitemap-cluster`
- `scoring`
- `features`
- `classification`
- `canonicalization`
- `crawl-deeper`
- `debug-priority`
- `decision`
- `finalize-reject`
- `skipped`
- `low-confidence`
- `parent-promotion`
- `pivot-explore`
- `errors`

Evidence useful for false positive / false negative analysis:

- `sitemap-cluster` logs all parent groups, counts, keyword strength, path depth, same-root-domain flags, selected parent, and confidence.
- `scoring` logs candidate count and top scored candidates with reasons.
- `features` logs extracted page features for each classified candidate.
- `classification` logs page type, confidence, reasons, canonical selection, legacy score, and ranking score.
- `debug-priority` logs ordered candidates with canonical URL and ranking information.
- `skipped` logs why candidates were rejected, including duplicate, fetch/classification failure, no canonical target, article without strong career target, and canonical finalization failure.
- `decision`, `parent-promotion`, and `finalize-reject` logs explain final selected URLs, parent promotion, recruitment-host handling, and rejected redirects.
- `low-confidence` logs no-candidate and canonicalization-failed outcomes.

## Database Tables Related To Scraping

### `businesses`

Relevant fields:

- `id`, `name`, `placeId`, `latitude`, `longitude`
- `website`, `formattedAddress`
- `hasJobsPage`
- `jobsUrl`
- `jobsPlatform`
- `jobsDiscoveryStatus`
- `jobsDiscoveryCheckedAt`
- `jobsScrapeStatus`
- `jobsScrapeCheckedAt`
- `nextDiscoveryAt`
- `nextScrapeAt`
- `lastJobsFoundAt`
- `createdAt`

Discovery worker writes:

- `jobsUrl`
- `jobsPlatform`
- `hasJobsPage`
- `jobsDiscoveryStatus`
- `jobsDiscoveryCheckedAt`

### `jobs`

Fields:

- `id`
- `businessId` references `businesses.id`
- `title`
- `locationText`
- `city`
- `description`
- `url`
- `externalId`
- `sourcePlatform`
- `firstSeenAt`
- `lastSeenAt`
- `isActive`

UNKNOWN: no visible code inserts, updates, or queries `jobs`.

### `job_discovery_runs`

Fields:

- `id`
- `businessId`
- `method`
- `status`
- `foundUrl`
- `platform`
- `durationMs`
- `message`
- `createdAt`

Worker inserts:

- `businessId`
- `method`
- `status`
- `foundUrl`
- `durationMs`
- `message`

### `job_scrape_runs`

Fields:

- `id`
- `businessId`
- `status`
- `jobsFound`
- `durationMs`
- `httpStatus`
- `message`
- `createdAt`

UNKNOWN: no visible code writes to `job_scrape_runs`.

## Frontend / API Context

- The frontend shows businesses on a Leaflet map and loads data through `useBusinessesQuery`.
- The backend exposes a `GET /businesses` API and a Fastify server on port `4000`.
- Frontend and generic API structure exist, but they are not the main focus for scraping/discovery tasks unless a user explicitly asks for them.

## AI Coding Rules

- Focus on scraping/discovery code unless the user asks otherwise.
- Do not refactor frontend or unrelated API code during scraping tasks.
- Make small, testable changes.
- Preserve existing result shapes and logs unless intentionally changing them.
- Avoid early returns in discovery if they skip useful candidate evidence.
- Prefer collecting multiple candidate signals before selecting a result.
- Be careful with false positives and false negatives.
- When changing scoring, explain expected impact.
- Keep structured logs useful.
- Do not invent schema fields, providers, or platforms.
- If something is unclear, inspect code or mark it as UNKNOWN.

## Known Issues / Unknowns

- The discovery worker currently filters businesses to a hard-coded list of IDs:
  - `8583, 14, 149, 2, 76, 338, 8459, 174, 1144, 1660, 1411, 3471, 80, 323, 3621, 4282, 112, 8584, 3404, 3549, 56, 3624, 152`
- `job_scrape_runs`, `jobsScrapeStatus`, `jobsScrapeCheckedAt`, `nextScrapeAt`, and `lastJobsFoundAt` exist, but no visible scraping worker/service writes them.
- The `jobs` table exists, but no visible code inserts scraped job rows.
- `nextDiscoveryAt` and `nextScrapeAt` exist, but no visible scheduler uses them.
- `job_discovery_runs.platform` exists in the schema, but the worker does not insert `platform` into discovery run rows.
- The worker summary tracks `ambiguous`, but the console summary only prints found, not found, and errors.
- The frontend API client expects a `city` field from `/businesses`, while the backend repository selects `formattedAddress` and not `city`.
- The Fastify query schema for `/businesses` has `properties: {}`, while the repository reads `limit`, `offset`, `formattedAddress`, and `hasJobsPage`. UNKNOWN whether validation/defaulting happens elsewhere.
- `heuristic-discovery.service.ts` has a temporary-looking comment `// hier even checken` above an older commented-out ranking implementation.
- `discoverByHeuristics` contains commented debug `console.log` blocks for crawl, footer, and sitemap results.
- `discovery-logger.ts` defines log types `recruitment-root-pivot`, `recruitment-root-preferred-path`, and `pivot-explore`, but the searched discovery files did not show active `logDiscovery` calls using those names.
- `http-client.ts` exports or declares `DEFAULT_REQUEST_TIMEOUT_MS`, `USER_AGENT`, and `MAX_REDIRECTS`, but the Axios client uses literal `timeout: 10000`, `maxRedirects: 5`, and a browser-like user-agent string. UNKNOWN if the constants are stale or intentionally unused.
- ATS host detection is split across files:
  - `heuristic-discovery.service.ts` maps final platform names for Greenhouse, Lever, Ashby, Teamtailor, Recruitee, Workable, Homerun, SmartRecruiters, Breezy, and Personio.
  - `page-classification.service.ts` also classifies Workday, Jobvite, Onlyfy, Rexx Systems, and BambooHR as ATS hosts.
  - UNKNOWN whether the provider lists are intentionally different.
- `google-discovery.service.ts` exists, but its exported function throws because Google discovery is no longer part of the active jobs discovery flow.
- `apps/api/package.json` has `"test": "echo \"Error: no test specified\" && exit 1"`, while `sitemap-discovery.test.ts` exists under the job discovery service. UNKNOWN how this test is intended to be run.
- Some source comments contain mojibake characters, for example in discovery false-positive comments and logger comments. UNKNOWN if this matters functionally.
