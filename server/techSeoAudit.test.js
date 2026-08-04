import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { auditSeoReadiness, SEO_AUDIT_TEST_ONLY } from './techSeoAudit.js'

test('seo audit keeps normal title description canonical and structured data healthy', async () => {
  const result = await auditSeoReadiness('https://example.com', snapshot({
    seoInfo: {
      titleText: 'Example Product',
      titleCount: 1,
      metaDescriptions: ['Example product page description for search engines and social previews.'],
      canonicalLinks: ['https://example.com/product'],
      robotsMetas: [{ name: 'robots', content: 'index,follow' }],
      htmlLang: 'ko-KR',
      og: { title: ['Example Product'], description: ['OG description'], image: ['https://example.com/og.jpg'], url: ['https://example.com/product'], type: ['website'] },
      twitter: { card: ['summary_large_image'], title: ['Example Product'], description: ['Twitter description'], image: ['https://example.com/twitter.jpg'] },
      hreflangs: [{ hreflang: 'ko-KR', href: 'https://example.com/ko' }],
      jsonLdScripts: ['{"@context":"https://schema.org","@type":"WebPage"}'],
      h1Texts: ['Example Product'],
    },
  }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 200, 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 200, '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>', 'application/xml'),
  ]))

  assert.equal(result.items.find((item) => item.category === 'search-meta').status, 'ok')
  assert.equal(result.items.find((item) => item.category === 'canonical').status, 'ok')
  assert.equal(result.items.find((item) => item.category === 'structured-data').status, 'ok')
})

test('seo audit warns on missing title description and lang', async () => {
  const result = await auditSeoReadiness('https://example.com', snapshot({
    seoInfo: {
      titleText: '',
      titleCount: 0,
      metaDescriptions: [],
      canonicalLinks: ['https://example.com/'],
      robotsMetas: [],
      htmlLang: '',
      og: {},
      twitter: {},
      hreflangs: [],
      jsonLdScripts: [],
      h1Texts: [],
    },
  }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))

  assert.equal(result.items.find((item) => item.category === 'search-meta').status, 'warn')
  assert.equal(result.items.find((item) => item.category === 'indexing').status, 'warn')
})

test('phase 3A SEO fixtures keep intent-dependent signals review or not applicable and only objective failures as problem', async () => {
  const problem = await auditSeoReadiness('https://example.com', snapshot({ seoInfo: { titleText: '', titleCount: 0, metaDescriptions: ['Public page description long enough for a generic search preview.'], canonicalLinks: ['https://example.com/'], robotsMetas: [{ name: 'robots', content: 'index,follow' }], htmlLang: 'en', og: {}, twitter: {}, hreflangs: [], jsonLdScripts: [], h1Texts: ['Public H1'] } }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))
  const review = await auditSeoReadiness('https://example.com', snapshot({ seoInfo: { titleText: 'Review page', titleCount: 1, metaDescriptions: [], canonicalLinks: ['https://canonical.example/page'], robotsMetas: [{ name: 'robots', content: 'noindex,follow' }], htmlLang: '', og: { title: ['Review page'] }, twitter: {}, hreflangs: [{ hreflang: 'bad_code', href: '' }], jsonLdScripts: [], h1Texts: ['Review page'] } }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 200, 'User-agent: *\nDisallow: /', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))
  const normal = await auditSeoReadiness('https://example.com', snapshot({ seoInfo: { titleText: 'Normal page', titleCount: 1, metaDescriptions: ['Normal page description for generic search result snippets.'], canonicalLinks: ['https://example.com/'], robotsMetas: [{ name: 'robots', content: 'index,follow' }], htmlLang: 'en', og: {}, twitter: {}, hreflangs: [], jsonLdScripts: ['{"@context":"https://schema.org","@type":"WebPage"}'], h1Texts: ['Normal page'] } }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))

  assert.equal(problem.items.find((item) => item.category === 'search-meta').status, 'error')
  assert.equal(review.items.find((item) => item.category === 'indexing').status, 'warn')
  assert.equal(review.items.find((item) => item.category === 'canonical').status, 'warn')
  assert.equal(review.items.find((item) => item.category === 'robots-txt').status, 'warn')
  assert.equal(review.items.find((item) => item.category === 'hreflang').status, 'warn')
  assert.equal(normal.items.find((item) => item.category === 'structured-data').status, 'ok')
  assert.equal(normal.items.find((item) => item.category === 'hreflang').status, 'info')
})

test('phase 3A SEO fixture keeps invalid JSON-LD as objective problem', async () => {
  const result = await auditSeoReadiness('https://example.com', snapshot({ seoInfo: { titleText: 'Structured page', titleCount: 1, metaDescriptions: ['Structured page description for generic search result snippets.'], canonicalLinks: ['https://example.com/'], robotsMetas: [], htmlLang: 'en', og: {}, twitter: {}, hreflangs: [], jsonLdScripts: ['{invalid json'], h1Texts: ['Structured page'] } }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))

  assert.equal(result.items.find((item) => item.category === 'structured-data').status, 'error')
})

test('seo audit warns on duplicate title and meta description', async () => {
  const result = await auditSeoReadiness('https://example.com', snapshot({
    seoInfo: {
      titleText: 'Duplicate Title',
      titleCount: 2,
      metaDescriptions: ['Description one', 'Description two'],
      canonicalLinks: ['https://example.com/'],
      robotsMetas: [],
      htmlLang: 'en',
      og: {},
      twitter: {},
      hreflangs: [],
      jsonLdScripts: [],
      h1Texts: ['Duplicate Title'],
    },
  }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))

  assert.equal(result.items.find((item) => item.category === 'search-meta').issues.some((issue) => issue.includes('title 요소')), true)
  assert.equal(result.items.find((item) => item.category === 'search-meta').issues.some((issue) => issue.includes('meta description이 2개')), true)
})

test('seo audit errors on conflicting canonicals but only warns on different-origin canonical', async () => {
  const conflicting = await auditSeoReadiness('https://example.com', snapshot({
    seoInfo: {
      titleText: 'Example',
      titleCount: 1,
      metaDescriptions: ['Description'],
      canonicalLinks: ['https://example.com/a', 'https://example.com/b'],
      robotsMetas: [],
      htmlLang: 'en',
      og: {},
      twitter: {},
      hreflangs: [],
      jsonLdScripts: [],
      h1Texts: ['Example'],
    },
  }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))
  const crossOrigin = await auditSeoReadiness('https://example.com', snapshot({
    seoInfo: {
      titleText: 'Example',
      titleCount: 1,
      metaDescriptions: ['Description'],
      canonicalLinks: ['https://www.example.org/page'],
      robotsMetas: [],
      htmlLang: 'en',
      og: {},
      twitter: {},
      hreflangs: [],
      jsonLdScripts: [],
      h1Texts: ['Example'],
    },
  }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))

  assert.equal(conflicting.items.find((item) => item.category === 'canonical').status, 'error')
  assert.equal(crossOrigin.items.find((item) => item.category === 'canonical').status, 'warn')
})

test('seo audit warns on noindex and errors on robots directive conflicts', async () => {
  const result = await auditSeoReadiness('https://example.com', snapshot({
    seoInfo: {
      titleText: 'Example',
      titleCount: 1,
      metaDescriptions: ['Description'],
      canonicalLinks: ['https://example.com/'],
      robotsMetas: [{ name: 'robots', content: 'index,noindex' }],
      htmlLang: 'en',
      og: {},
      twitter: {},
      hreflangs: [],
      jsonLdScripts: [],
      h1Texts: ['Example'],
    },
  }), documentResponses([{ xRobotsTag: 'nofollow,follow' }]), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))

  assert.equal(result.items.find((item) => item.category === 'indexing').status, 'error')
})

test('seo audit warns on partial OG and keeps missing twitter card non-blocking', async () => {
  const result = await auditSeoReadiness('https://example.com', snapshot({
    seoInfo: {
      titleText: 'Example',
      titleCount: 1,
      metaDescriptions: ['Description'],
      canonicalLinks: ['https://example.com/'],
      robotsMetas: [],
      htmlLang: 'en',
      og: { title: ['Example'], description: [], image: [], url: [], type: [] },
      twitter: {},
      hreflangs: [],
      jsonLdScripts: [],
      h1Texts: ['Example'],
    },
  }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))

  assert.equal(result.items.find((item) => item.category === 'social-meta').status, 'warn')
})

test('seo audit treats missing hreflang as info and invalid hreflang as warn', async () => {
  const missing = await auditSeoReadiness('https://example.com', snapshot({
    seoInfo: {
      titleText: 'Example', titleCount: 1, metaDescriptions: ['Description'], canonicalLinks: ['https://example.com/'], robotsMetas: [], htmlLang: 'en', og: {}, twitter: {}, hreflangs: [], jsonLdScripts: [], h1Texts: ['Example'],
    },
  }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))
  const invalid = await auditSeoReadiness('https://example.com', snapshot({
    seoInfo: {
      titleText: 'Example', titleCount: 1, metaDescriptions: ['Description'], canonicalLinks: ['https://example.com/'], robotsMetas: [], htmlLang: 'en', og: {}, twitter: {}, hreflangs: [{ hreflang: 'bad_code', href: '' }], jsonLdScripts: [], h1Texts: ['Example'],
    },
  }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))

  assert.equal(missing.items.find((item) => item.category === 'hreflang').status, 'info')
  assert.equal(invalid.items.find((item) => item.category === 'hreflang').status, 'warn')
})

test('seo audit parses valid json-ld and errors on invalid json-ld', async () => {
  const valid = await auditSeoReadiness('https://example.com', snapshot({
    seoInfo: {
      titleText: 'Example', titleCount: 1, metaDescriptions: ['Description'], canonicalLinks: ['https://example.com/'], robotsMetas: [], htmlLang: 'en', og: {}, twitter: {}, hreflangs: [], jsonLdScripts: ['{"@context":"https://schema.org","@type":"WebSite"}'], h1Texts: ['Example'],
    },
  }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))
  const invalid = await auditSeoReadiness('https://example.com', snapshot({
    seoInfo: {
      titleText: 'Example', titleCount: 1, metaDescriptions: ['Description'], canonicalLinks: ['https://example.com/'], robotsMetas: [], htmlLang: 'en', og: {}, twitter: {}, hreflangs: [], jsonLdScripts: ['{invalid json'], h1Texts: ['Example'],
    },
  }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 404, '', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))

  assert.equal(valid.items.find((item) => item.category === 'structured-data').status, 'ok')
  assert.equal(invalid.items.find((item) => item.category === 'structured-data').status, 'error')
})

test('seo audit warns on robots disallow all and keeps robots or sitemap 404 non-blocking', async () => {
  const result = await auditSeoReadiness('https://example.com', snapshot({
    seoInfo: {
      titleText: 'Example', titleCount: 1, metaDescriptions: ['Description'], canonicalLinks: ['https://example.com/'], robotsMetas: [], htmlLang: 'en', og: {}, twitter: {}, hreflangs: [], jsonLdScripts: [], h1Texts: ['Example'],
    },
  }), documentResponses(), null, apiFactory([
    textResponse('https://example.com/robots.txt', 200, 'User-agent: *\nDisallow: /', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 404, '', 'application/xml'),
  ]))

  assert.equal(result.items.find((item) => item.category === 'robots-txt').status, 'warn')
  assert.equal(result.items.find((item) => item.category === 'sitemap-xml').status, 'info')
})

test('seo audit checks one robots and one sitemap request only and does not crawl sitemap URLs', async () => {
  const calls = []
  const api = apiFactory([
    textResponse('https://example.com/robots.txt', 200, 'User-agent: *\nSitemap: https://example.com/sitemap.xml', 'text/plain'),
    textResponse('https://example.com/sitemap.xml', 200, '<?xml version="1.0"?><urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>', 'application/xml'),
  ], calls)
  await auditSeoReadiness('https://example.com', snapshot({ seoInfo: { titleText: 'Example', titleCount: 1, metaDescriptions: ['Description'], canonicalLinks: ['https://example.com/'], robotsMetas: [], htmlLang: 'en', og: {}, twitter: {}, hreflangs: [], jsonLdScripts: [], h1Texts: ['Example'] } }), documentResponses(), null, api)

  assert.deepEqual(calls, ['https://example.com/robots.txt', 'https://example.com/sitemap.xml'])
})

test('seo audit source does not use external validators or site-specific hardcoding', () => {
  const source = fs.readFileSync(new URL('./techSeoAudit.js', import.meta.url), 'utf8')

  assert.equal(/schema\.org\/docs|search console|validator|lighthouse/i.test(source), false)
  assert.equal(/BMW|BMWFS|NAVER/.test(source), false)
  assert.equal(SEO_AUDIT_TEST_ONLY.isValidLangCode('ko-KR'), true)
})

function snapshot(overrides = {}) {
  return { seoInfo: {}, ...overrides }
}

function documentResponses(overrides = []) {
  return [{ url: 'https://example.com/', resourceType: 'document', method: 'GET', statusCode: 200, xRobotsTag: '', ...overrides[0] }]
}

function textResponse(url, statusCode, body, contentType) {
  return {
    url,
    statusCode,
    body,
    contentType,
  }
}

function apiFactory(responses, calls = []) {
  return async () => ({
    async fetch(url) {
      calls.push(url)
      const match = responses.find((entry) => entry.url === url)
      if (!match) throw new Error(`unexpected url ${url}`)
      return {
        status() { return match.statusCode },
        headers() { return { 'content-type': match.contentType } },
        async text() { return match.body },
        async dispose() {},
      }
    },
    async dispose() {},
  })
}
