import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createLandingAuditSourceItems, runOptionalTechAudits, runUrlAudit } from './techScanOrchestration.js'

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
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: true, markup: false, scroll: false, responsive: false, download: false },
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
  })

  assert.deepEqual(calls, ['modal:0'])
})

test('optional tech audit orchestration runs landing without click audit by using common interaction targets', async () => {
  const calls = []
  await runOptionalTechAudits({
    browser: {},
    targetUrl: 'https://example.com',
    snapshot: { clickableCandidates: [{ selector: '#cta' }], interactionTargets: [{ label: 'CTA', url: 'https://example.com/next', target: '_blank', selector: '#cta', section: 'hero' }] },
    techScanOptions: { url: false, click: false, landing: true, form: false, hover: false, modal: false, markup: false, scroll: false, responsive: false, download: false },
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
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, markup: false, scroll: true, responsive: true, download: true },
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
    techScanOptions: { url: false, click: false, landing: false, form: false, hover: false, modal: false, markup: false, scroll: true, responsive: true, download: true },
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
  })

  assert.equal(result.scrollAuditResult.meta.error.includes('scroll failed'), true)
  assert.equal(result.responsiveAuditResult.items.length, 1)
  assert.equal(result.downloadAuditResult.items.length, 1)
})

test('tech scan option orchestration sources do not hardcode specific sites or hostnames', () => {
  const source = [
    fs.readFileSync('server/techScanOrchestration.js', 'utf8'),
    fs.readFileSync('shared/techScanOptions.js', 'utf8'),
  ].join('\n')

  assert.equal(/BMW|BMWFS|NAVER/.test(source), false)
  assert.equal(/hostname\s*===|location\.hostname|includes\(['"]naver|includes\(['"]bmw/i.test(source), false)
})
