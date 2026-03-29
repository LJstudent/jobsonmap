import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveParentPath,
  getSitemapClusterConfidence,
  selectBestSitemapParent,
} from './sitemap-discovery.service';
import { scoreCandidate } from './heuristic-discovery.service';

test('deriveParentPath keeps the deepest listing segment when present', () => {
  assert.equal(
    deriveParentPath('https://example.com/vacatures/dev'),
    'https://example.com/vacatures',
  );
  assert.equal(
    deriveParentPath('https://example.com/careers/backend'),
    'https://example.com/careers',
  );
  assert.equal(
    deriveParentPath('https://example.com/werken-bij/vacatures/dev'),
    'https://example.com/werken-bij/vacatures',
  );
});

test('deriveParentPath falls back to removing the last segment for small datasets', () => {
  assert.equal(
    deriveParentPath('https://example.com/jobs/dev'),
    'https://example.com/jobs',
  );
  assert.equal(
    deriveParentPath('https://example.com/vacature-frontend'),
    'https://example.com/vacature-frontend',
  );
});

test('selectBestSitemapParent returns the dominant parent and medium confidence for two jobs', () => {
  const result = selectBestSitemapParent(
    [
      'https://example.com/vacatures/dev',
      'https://example.com/vacatures/test',
    ],
    'https://example.com',
  );

  assert.deepEqual(result, {
    bestParent: 'https://example.com/vacatures',
    cluster: {
      parent: 'https://example.com/vacatures',
      count: 2,
      keywordStrength: 3,
      pathDepth: 1,
      sameRootDomain: true,
      confidence: 'MEDIUM',
    },
  });
});

test('selectBestSitemapParent still reconstructs a parent when there is only one sitemap URL', () => {
  const result = selectBestSitemapParent(
    ['https://example.com/jobs/dev'],
    'https://example.com',
  );

  assert.deepEqual(result, {
    bestParent: 'https://example.com/jobs',
    cluster: {
      parent: 'https://example.com/jobs',
      count: 1,
      keywordStrength: 2,
      pathDepth: 1,
      sameRootDomain: true,
      confidence: 'LOW',
    },
  });
});

test('selectBestSitemapParent breaks ties by keyword strength and shorter path depth', () => {
  const result = selectBestSitemapParent(
    [
      'https://example.com/company/careers/backend',
      'https://example.com/company/careers/design',
      'https://example.com/work/opportunity-one',
      'https://example.com/work/opportunity-two',
    ],
    'https://example.com',
  );

  assert.deepEqual(result, {
    bestParent: 'https://example.com/company/careers',
    cluster: {
      parent: 'https://example.com/company/careers',
      count: 2,
      keywordStrength: 1,
      pathDepth: 2,
      sameRootDomain: true,
      confidence: 'MEDIUM',
    },
  });
});

test('getSitemapClusterConfidence maps counts to the expected confidence levels', () => {
  assert.equal(getSitemapClusterConfidence(1), 'LOW');
  assert.equal(getSitemapClusterConfidence(2), 'MEDIUM');
  assert.equal(getSitemapClusterConfidence(3), 'HIGH');
});

test('sitemap cluster winner outranks noisier employer-branding candidates', () => {
  const sitemapScore = scoreCandidate(
    {
      url: 'https://koning-ict.nl/vacatures',
      source: 'sitemap',
      clusterCount: 3,
      clusterConfidence: 'HIGH',
      clusterKeywordStrength: 3,
      clusterPathDepth: 1,
      clusterSameRootDomain: true,
      isSitemapClusterWinner: true,
    },
    'koning-ict',
    'https://koning-ict.nl',
    {
      sources: new Set(['sitemap']),
      groups: new Set(['sitemap_discovery']),
      sightings: 1,
    } as Parameters<typeof scoreCandidate>[3],
  );

  const noisyConsensusScore = scoreCandidate(
    {
      url: 'https://koning-ict.nl/werken-bij-de-koning',
      source: 'crawl',
    },
    'koning-ict',
    'https://koning-ict.nl',
    {
      sources: new Set(['crawl', 'html', 'path']),
      groups: new Set(['on_site_link_discovery', 'synthetic_guess']),
      sightings: 3,
    } as Parameters<typeof scoreCandidate>[3],
  );

  assert.ok(
    sitemapScore > noisyConsensusScore,
    `Expected sitemap listing to win (${sitemapScore} > ${noisyConsensusScore})`,
  );
});
