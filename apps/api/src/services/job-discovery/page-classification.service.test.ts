import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCanonicalSelection,
  classifyPageType,
  extractPageFeatures,
  isLikelyQuestionArticleUrl,
} from './page-classification.service';

const APPLYFIN_QUESTION_ARTICLE_URLS = [
  'https://applyfin.com/blog/2025/12/11/hoe-kan-ai-helpen-bij-meerdere-vacatures-tegelijk',
  'https://applyfin.com/blog/2026/03/17/wat-maakt-een-goede-vacaturetekst',
];

function articleHtml(title: string): string {
  return `
    <html>
      <head>
        <title>${title}</title>
        <meta name="description" content="Een artikel over vacatures en vacaturetekst." />
      </head>
      <body>
        <nav>
          <a href="/blog/2026/03/17/wat-maakt-een-goede-vacaturetekst">Vacaturetekst tips</a>
          <a href="/blog/2025/12/11/hoe-kan-ai-helpen-bij-meerdere-vacatures-tegelijk">Meerdere vacatures tegelijk</a>
        </nav>
        <article>
          <h1>${title}</h1>
          <p>Published by Applyfin. Share this article.</p>
          <p>Vacatures beheren kost tijd, zeker wanneer er meerdere rollen openstaan.</p>
          <p>Een goede vacaturetekst helpt om kandidaten duidelijker aan te spreken.</p>
        </article>
      </body>
    </html>
  `;
}

test('isLikelyQuestionArticleUrl detects Dutch question slugs in article contexts', () => {
  for (const url of [
    ...APPLYFIN_QUESTION_ARTICLE_URLS,
    'https://example.com/nieuws/waarom-vacatures-soms-niet-werken',
    'https://example.com/insights/welke-vacaturetekst-werkt-het-best',
  ]) {
    assert.equal(isLikelyQuestionArticleUrl(url), true, url);
  }
});

test('isLikelyQuestionArticleUrl does not match normal job pages', () => {
  for (const url of [
    'https://example.com/vacatures',
    'https://example.com/werken-bij',
    'https://example.com/jobs',
    'https://example.com/careers',
    'https://example.com/open-positions',
    'https://example.com/vacatures/software-engineer',
    'https://example.com/werken-bij/applyfin',
  ]) {
    assert.equal(isLikelyQuestionArticleUrl(url), false, url);
  }
});

test('classifyPageType marks Applyfin question blog URLs as article_or_news', () => {
  for (const url of APPLYFIN_QUESTION_ARTICLE_URLS) {
    const features = extractPageFeatures(
      articleHtml('Wat maakt een goede vacaturetekst?'),
      url,
      'https://applyfin.com',
    );
    const classification = classifyPageType(features);

    assert.equal(classification.pageType, 'article_or_news', url);
    assert.ok(classification.confidence >= 0.95, url);
    assert.ok(classification.reasons.includes('article-question-slug'), url);
  }
});

test('buildCanonicalSelection hard rejects question articles with internal job-like links', () => {
  for (const url of APPLYFIN_QUESTION_ARTICLE_URLS) {
    const features = extractPageFeatures(
      articleHtml('Hoe kan AI helpen bij meerdere vacatures tegelijk?'),
      url,
      'https://applyfin.com',
    );
    const classification = classifyPageType(features);
    const canonicalSelection = buildCanonicalSelection(features, classification);

    assert.equal(canonicalSelection.canonicalUrl, null, url);
    assert.equal(canonicalSelection.jobsOverviewUrl, null, url);
    assert.equal(canonicalSelection.employerBrandUrl, null, url);
    assert.ok(
      canonicalSelection.reasons.includes('hard-rejected-question-article'),
      url,
    );
  }
});
