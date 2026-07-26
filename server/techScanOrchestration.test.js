import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createLandingAuditSourceItems, runOptionalTechAudits, runUrlAudit } from './techScanOrchestration.js'
import { auditPerformanceResources } from './techPerformanceAudit.js'
import { auditSeoReadiness } from './techSeoAudit.js'

test('optional tech audit orchestration skips unselected audit functions and supports modal-only execution', async () => {
  const calls = []
  const auditClickableActions = async () => {
    calls.push('click')
    return { items: [{ auditId: 'click-1' }], meta: { candidateCount: 1 } }
  }
  const auditLandingPages = async () => {
    calls.push('landing')
    return { items: [], meta: { candidateCount: 0, noTarget: true } }
  }
  const auditForms = async () => {
    calls.push('form')
    return { items: [], meta: { candidateCount: 0, noTarget: true } }
  }
  const auditHoverInteractions = async () => {
    calls.push('hover')
    return { items: [], meta: { candidateCount: 0, noTarget: true } }
  }
  const auditModalInteractions = async (browser, targetUrl, clickItems) => {
    calls.push(`modal:${clickItems.length}`)
    return { items: [], meta: { candidateCount: 0, noTarget: true } }
  }

  await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { clickableCandidates: [{ selector: '#cta' }], interactionTargets: [{ label: 'CTA', url: 'https://example.com/next' }] },
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: true, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: false, seo: false, markup: false },
    instrumentation: {},
    auditClickableActions,
    auditLandingPages,
    auditForms,
    auditHoverInteractions,
    auditModalInteractions,
    auditScrollInteractions: async () => {
      calls.push('scroll')
      return { items: [], meta: { candidateCount: 0, noTarget: true } }
    },
    auditResponsiveLayouts: async () => {
      calls.push('responsive')
      return { items: [], meta: { candidateCount: 0, noTarget: true } }
    },
    auditDownloadResources: async () => {
      calls.push('download')
      return { items: [], meta: { candidateCount: 0, noTarget: true } }
    },
    auditCookies: async () => {
      calls.push('cookie')
      return { items: [], meta: { candidateCount: 0, noTarget: true } }
    },
    auditImages: async () => {
      calls.push('image')
      return { items: [], meta: { candidateCount: 0, noTarget: true } }
    },
    auditPerformanceResources: async () => {
      calls.push('performance')
      return { items: [], meta: { candidateCount: 0, noTarget: true } }
    },
    auditSeoReadiness: async () => {
      calls.push('seo')
      return { items: [], meta: { candidateCount: 0, noTarget: true } }
    },
  })

  assert.deepEqual(calls, ['modal:0'])
})

test('optional tech audit orchestration runs landing without click audit by using common interaction targets', async () => {
  const calls = []
  await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { clickableCandidates: [{ selector: '#cta' }], interactionTargets: [{ label: 'CTA', url: 'https://example.com/next', target: '_blank', selector: '#cta', section: 'hero' }] },
    techScanOptions: { url: false, click: false, landing: true, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: false, seo: false, markup: false },
    instrumentation: {},
    auditClickableActions: async () => {
      calls.push('click')
      return { items: [], meta: {} }
    },
    auditLandingPages: async (browser, targetUrl, items) => {
      calls.push(items[0]?.interactionOutcome)
      return { items: [], meta: { candidateCount: items.length, noTarget: items.length === 0 } }
    },
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => ({ items: [], meta: {} }),
    auditImages: async () => ({ items: [], meta: {} }),
    auditPerformanceResources: async () => ({ items: [], meta: {} }),
    auditSeoReadiness: async () => ({ items: [], meta: {} }),
  })

  assert.deepEqual(calls, ['new-window'])
  assert.deepEqual(createLandingAuditSourceItems([{ label: 'CTA', url: 'https://example.com/next', target: '_blank' }])[0].interactionOutcome, 'new-window')
})

test('url audit normalization path skips requests when url option is disabled', async () => {
  const result = await runUrlAudit({
    enabled: false,
    targetUrl: 'https://example.com',
    snapshot: { interactionTargets: [] },
    createTechLinkAudit() {
      throw new Error('should not run')
    },
    getLinksToCheck() {
      throw new Error('should not run')
    },
    async checkLinkStatuses() {
      throw new Error('should not run')
    },
    mergeTechLinkAuditResults() {
      throw new Error('should not run')
    },
  })

  assert.deepEqual(result, {
    links: [],
    missingHrefLinks: [],
    uiControlWithoutUrlCount: 0,
    linkAuditResult: { links: [], meta: {} },
  })
})

test('optional tech audit orchestration runs only scroll responsive and download when newly selected', async () => {
  const calls = []
  const result = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { links: [{ href: '/file.pdf', url: 'https://example.com/file.pdf', label: 'PDF' }], clickableCandidates: [], interactionTargets: [] },
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: true, responsive: true, download: true, cookie: false, image: false, performance: false, seo: false, markup: false },
    instrumentation: {},
    auditClickableActions: async () => {
      calls.push('click')
      return { items: [], meta: {} }
    },
    auditLandingPages: async () => {
      calls.push('landing')
      return { items: [], meta: {} }
    },
    auditForms: async () => {
      calls.push('form')
      return { items: [], meta: {} }
    },
    auditHoverInteractions: async () => {
      calls.push('hover')
      return { items: [], meta: {} }
    },
    auditModalInteractions: async () => {
      calls.push('modal')
      return { items: [], meta: {} }
    },
    auditScrollInteractions: async () => {
      calls.push('scroll')
      return { items: [{ auditId: 'scroll-1' }], meta: { candidateCount: 1 } }
    },
    auditResponsiveLayouts: async () => {
      calls.push('responsive')
      return { items: [{ auditId: 'responsive-1' }], meta: { candidateCount: 3 } }
    },
    auditDownloadResources: async () => {
      calls.push('download')
      return { items: [{ auditId: 'download-1' }], meta: { candidateCount: 1 } }
    },
    auditCookies: async () => {
      calls.push('cookie')
      return { items: [{ label: 'sid' }], meta: { candidateCount: 1 } }
    },
    auditImages: async () => {
      calls.push('image')
      return { items: [{ label: 'hero.webp' }], meta: { candidateCount: 1 } }
    },
    auditPerformanceResources: async () => {
      calls.push('performance')
      return { items: [{ label: 'large resource' }], meta: { candidateCount: 6 } }
    },
    auditSeoReadiness: async () => {
      calls.push('seo')
      return { items: [{ label: 'canonical' }], meta: { candidateCount: 8 } }
    },
  })

  assert.deepEqual(calls, ['scroll', 'responsive', 'download'])
  assert.equal(result.scrollAuditResult.items.length, 1)
  assert.equal(result.responsiveAuditResult.items.length, 1)
  assert.equal(result.downloadAuditResult.items.length, 1)
})

test('optional tech audit orchestration isolates failures in new audits', async () => {
  const result = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { links: [{ href: '/file.pdf', url: 'https://example.com/file.pdf', label: 'PDF' }], clickableCandidates: [], interactionTargets: [] },
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: true, responsive: true, download: true, cookie: false, image: false, performance: false, seo: false, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => {
      throw new Error('scroll failed')
    },
    auditResponsiveLayouts: async () => ({ items: [{ auditId: 'responsive-1' }], meta: { candidateCount: 3 } }),
    auditDownloadResources: async () => ({ items: [{ auditId: 'download-1' }], meta: { candidateCount: 1 } }),
    auditCookies: async () => ({ items: [], meta: {} }),
    auditImages: async () => ({ items: [], meta: {} }),
    auditPerformanceResources: async () => ({ items: [], meta: {} }),
    auditSeoReadiness: async () => ({ items: [], meta: {} }),
  })

  assert.equal(result.scrollAuditResult.meta.error.includes('scroll failed'), true)
  assert.equal(result.responsiveAuditResult.items.length, 1)
  assert.equal(result.downloadAuditResult.items.length, 1)
})

test('optional tech audit orchestration runs cookie and image independently and skips them when unselected', async () => {
  const calls = []
  const cookieOnly = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { links: [], clickableCandidates: [], interactionTargets: [] },
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: true, image: false, performance: false, seo: false, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => {
      calls.push('cookie')
      return { items: [{ label: 'sid' }], meta: { candidateCount: 1 } }
    },
    auditImages: async () => {
      calls.push('image')
      return { items: [{ label: 'hero.webp' }], meta: { candidateCount: 1 } }
    },
    auditPerformanceResources: async () => {
      calls.push('performance')
      return { items: [{ label: 'large resource' }], meta: { candidateCount: 6 } }
    },
    auditSeoReadiness: async () => {
      calls.push('seo')
      return { items: [{ label: 'canonical' }], meta: { candidateCount: 8 } }
    },
  })

  const imageOnly = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { links: [], clickableCandidates: [], interactionTargets: [] },
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: true, performance: false, seo: false, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => {
      calls.push('cookie')
      return { items: [{ label: 'sid' }], meta: { candidateCount: 1 } }
    },
    auditImages: async () => {
      calls.push('image')
      return { items: [{ label: 'hero.webp' }], meta: { candidateCount: 1 } }
    },
    auditPerformanceResources: async () => {
      calls.push('performance')
      return { items: [{ label: 'large resource' }], meta: { candidateCount: 6 } }
    },
    auditSeoReadiness: async () => {
      calls.push('seo')
      return { items: [{ label: 'canonical' }], meta: { candidateCount: 8 } }
    },
  })

  assert.deepEqual(calls, ['cookie', 'image'])
  assert.equal(cookieOnly.cookieAuditResult.items.length, 1)
  assert.equal(cookieOnly.imageAuditResult.items.length, 0)
  assert.equal(imageOnly.cookieAuditResult.items.length, 0)
  assert.equal(imageOnly.imageAuditResult.items.length, 1)
})

test('optional tech audit orchestration isolates failures in cookie and image audits', async () => {
  const result = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { links: [], clickableCandidates: [], interactionTargets: [] },
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: true, image: true, performance: false, seo: false, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => {
      throw new Error('cookie failed')
    },
    auditImages: async () => ({ items: [{ label: 'hero.webp' }], meta: { candidateCount: 1 } }),
    auditPerformanceResources: async () => ({ items: [], meta: {} }),
    auditSeoReadiness: async () => ({ items: [], meta: {} }),
  })

  assert.equal(result.cookieAuditResult.meta.error.includes('cookie failed'), true)
  assert.equal(result.imageAuditResult.items.length, 1)
})

test('optional tech audit orchestration runs performance and seo independently', async () => {
  const calls = []
  const performanceOnly = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { performanceInfo: { resources: [] }, seoInfo: {} },
    resourceResponses: [],
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: true, seo: false, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => ({ items: [], meta: {} }),
    auditImages: async () => ({ items: [], meta: {} }),
    auditPerformanceResources: async () => {
      calls.push('performance')
      return { items: [{ label: 'large resource' }], meta: { candidateCount: 6 } }
    },
    auditSeoReadiness: async () => {
      calls.push('seo')
      return { items: [{ label: 'canonical' }], meta: { candidateCount: 8 } }
    },
  })

  const seoOnly = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { performanceInfo: { resources: [] }, seoInfo: {} },
    resourceResponses: [],
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: false, seo: true, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => ({ items: [], meta: {} }),
    auditImages: async () => ({ items: [], meta: {} }),
    auditPerformanceResources: async () => {
      calls.push('performance')
      return { items: [{ label: 'large resource' }], meta: { candidateCount: 6 } }
    },
    auditSeoReadiness: async () => {
      calls.push('seo')
      return { items: [{ label: 'canonical' }], meta: { candidateCount: 8 } }
    },
  })

  assert.deepEqual(calls, ['performance', 'seo'])
  assert.equal(performanceOnly.performanceAuditResult.items.length, 1)
  assert.equal(performanceOnly.seoAuditResult.items.length, 0)
  assert.equal(seoOnly.performanceAuditResult.items.length, 0)
  assert.equal(seoOnly.seoAuditResult.items.length, 1)
})

test('optional tech audit orchestration isolates failures in performance and seo audits', async () => {
  const result = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { performanceInfo: { resources: [] }, seoInfo: {} },
    resourceResponses: [],
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: true, seo: true, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => ({ items: [], meta: {} }),
    auditImages: async () => ({ items: [], meta: {} }),
    auditPerformanceResources: async () => {
      throw new Error('performance failed')
    },
    auditSeoReadiness: async () => ({ items: [{ label: 'canonical' }], meta: { candidateCount: 8 } }),
  })

  assert.equal(result.performanceAuditResult.meta.error.includes('performance failed'), true)
  assert.equal(result.seoAuditResult.items.length, 1)
})

test('optional tech audit orchestration accepts synchronous performance audit return objects', async () => {
  const result = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { performanceInfo: { resources: [] }, seoInfo: {} },
    resourceResponses: [],
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: true, seo: true, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => ({ items: [], meta: {} }),
    auditImages: async () => ({ items: [], meta: {} }),
    auditPerformanceResources() {
      return { items: [{ label: 'sync performance' }], meta: { candidateCount: 1 } }
    },
    auditSeoReadiness: async () => ({ items: [], meta: {} }),
  })

  assert.equal(result.performanceAuditResult.items[0].label, 'sync performance')
})

test('optional tech audit orchestration accepts promised performance audit results', async () => {
  const result = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { performanceInfo: { resources: [] }, seoInfo: {} },
    resourceResponses: [],
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: true, seo: true, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => ({ items: [], meta: {} }),
    auditImages: async () => ({ items: [], meta: {} }),
    auditPerformanceResources: async () => ({ items: [{ label: 'async performance' }], meta: { candidateCount: 1 } }),
    auditSeoReadiness: async () => ({ items: [], meta: {} }),
  })

  assert.equal(result.performanceAuditResult.items[0].label, 'async performance')
})

test('optional tech audit orchestration isolates synchronous performance throws and rejected performance promises', async () => {
  const syncThrow = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { performanceInfo: { resources: [] }, seoInfo: {} },
    resourceResponses: [],
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: true, seo: true, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => ({ items: [], meta: {} }),
    auditImages: async () => ({ items: [], meta: {} }),
    auditPerformanceResources() {
      throw new Error('sync performance throw')
    },
    auditSeoReadiness: async () => ({ items: [{ label: 'seo survived' }], meta: { candidateCount: 1 } }),
  })
  const rejected = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { performanceInfo: { resources: [] }, seoInfo: {} },
    resourceResponses: [],
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: true, seo: false, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => ({ items: [], meta: {} }),
    auditImages: async () => ({ items: [], meta: {} }),
    auditPerformanceResources: async () => Promise.reject(new Error('rejected performance')),
    auditSeoReadiness: async () => ({ items: [{ label: 'seo survived' }], meta: { candidateCount: 1 } }),
  })

  assert.equal(syncThrow.performanceAuditResult.meta.error.includes('sync performance throw'), true)
  assert.equal(syncThrow.seoAuditResult.items[0].label, 'seo survived')
  assert.equal(rejected.performanceAuditResult.meta.error.includes('rejected performance'), true)
})

test('optional tech audit orchestration accepts synchronous seo return objects and isolates synchronous seo throws', async () => {
  const syncSeo = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { performanceInfo: { resources: [] }, seoInfo: {} },
    resourceResponses: [],
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: false, seo: true, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => ({ items: [], meta: {} }),
    auditImages: async () => ({ items: [], meta: {} }),
    auditPerformanceResources: async () => ({ items: [], meta: {} }),
    auditSeoReadiness() {
      return { items: [{ label: 'sync seo' }], meta: { candidateCount: 1 } }
    },
  })
  const thrownSeo = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { performanceInfo: { resources: [] }, seoInfo: {} },
    resourceResponses: [],
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: true, seo: true, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => ({ items: [], meta: {} }),
    auditImages: async () => ({ items: [], meta: {} }),
    auditPerformanceResources() {
      return { items: [{ label: 'sync performance' }], meta: { candidateCount: 1 } }
    },
    auditSeoReadiness() {
      throw new Error('sync seo throw')
    },
  })

  assert.equal(syncSeo.seoAuditResult.items[0].label, 'sync seo')
  assert.equal(thrownSeo.performanceAuditResult.items[0].label, 'sync performance')
  assert.equal(thrownSeo.seoAuditResult.meta.error.includes('sync seo throw'), true)
})

test('optional tech audit orchestration accepts synchronous performance and production-style seo together', async () => {
  const result = await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: {
      performanceInfo: {
        resources: [{ url: 'https://example.com/app.js', resourceType: 'script', transferSize: 10000, encodedBodySize: 9000, decodedBodySize: 10000, duration: 120 }],
        renderBlockingCandidates: [],
      },
      seoInfo: {
        titleText: 'Example Title',
        titleCount: 1,
        metaDescriptions: ['Example description for search previews and results.'],
        canonicalLinks: ['https://example.com/'],
        robotsMetas: [],
        htmlLang: 'en',
        og: {},
        twitter: {},
        hreflangs: [],
        jsonLdScripts: [],
        h1Texts: ['Example Title'],
      },
    },
    resourceResponses: [{ url: 'https://example.com/', resourceType: 'document', method: 'GET', statusCode: 200 }],
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, scroll: false, responsive: false, download: false, cookie: false, image: false, performance: true, seo: true, markup: false },
    instrumentation: {},
    auditClickableActions: async () => ({ items: [], meta: {} }),
    auditLandingPages: async () => ({ items: [], meta: {} }),
    auditForms: async () => ({ items: [], meta: {} }),
    auditHoverInteractions: async () => ({ items: [], meta: {} }),
    auditModalInteractions: async () => ({ items: [], meta: {} }),
    auditScrollInteractions: async () => ({ items: [], meta: {} }),
    auditResponsiveLayouts: async () => ({ items: [], meta: {} }),
    auditDownloadResources: async () => ({ items: [], meta: {} }),
    auditCookies: async () => ({ items: [], meta: {} }),
    auditImages: async () => ({ items: [], meta: {} }),
    auditPerformanceResources,
    auditSeoReadiness: (...args) => auditSeoReadiness(...args, null, async () => ({
      async fetch(url) {
        return {
          status() { return /robots\.txt$/i.test(url) ? 404 : 404 },
          headers() { return { 'content-type': 'text/plain' } },
          async text() { return '' },
          async dispose() {},
        }
      },
      async dispose() {},
    })),
  })

  assert.equal(Array.isArray(result.performanceAuditResult.items), true)
  assert.equal(Array.isArray(result.seoAuditResult.items), true)
})

test('tech scan option orchestration sources do not hardcode specific sites or hostnames', () => {
  const source = [
    fs.readFileSync('server/techScanOrchestration.js', 'utf8'),
    fs.readFileSync('shared/techScanOptions.js', 'utf8'),
  ].join('\n')

  assert.equal(/BMW|BMWFS|NAVER/.test(source), false)
  assert.equal(/hostname\s*===|location\.hostname|includes\(['"]naver|includes\(['"]bmw/i.test(source), false)
})
