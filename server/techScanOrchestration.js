import { normalizeTechScanOptions } from '../shared/techScanOptions.js'

export function createSkippedClickAuditResult() {
  return { items: [], meta: {} }
}

export function createSkippedLandingAuditResult() {
  return {
    items: [],
    meta: {},
  }
}

export function createSkippedInteractionAuditResult() {
  return {
    items: [],
    meta: {},
  }
}

export function createLandingAuditSourceItems(interactionTargets = []) {
  return (Array.isArray(interactionTargets) ? interactionTargets : []).reduce((items, item, index) => {
    const url = String(item?.url || item?.href || '').trim()
    if (!url) return items
    items.push({
      auditId: item.auditId || `landing-source-${index + 1}`,
      label: item.label || item.text || item.ariaLabel || `클릭 요소 ${index + 1}`,
      selector: item.selector || '',
      section: item.section || '',
      interactionOutcome: item.target === '_blank' ? 'new-window' : 'navigation',
      url,
      href: item.href || url,
      target: item.target || '',
    })
    return items
  }, [])
}

export async function runOptionalTechAudits({
  browser,
  targetUrl,
  snapshot,
  techScanOptions,
  instrumentation,
  auditClickableActions,
  auditLandingPages,
  auditForms,
  auditHoverInteractions,
  auditModalInteractions,
  auditScrollInteractions,
  auditResponsiveLayouts,
  auditDownloadResources,
  auditCookies,
  auditImages,
}) {
  const normalizedOptions = normalizeTechScanOptions(techScanOptions)
  const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : { clickableCandidates: [], interactionTargets: [], links: [] }
  let clickActionAuditResult = createSkippedClickAuditResult()
  let landingAuditResult = createSkippedLandingAuditResult()
  let formAuditResult = createSkippedInteractionAuditResult()
  let hoverAuditResult = createSkippedInteractionAuditResult()
  let modalAuditResult = createSkippedInteractionAuditResult()
  let scrollAuditResult = createSkippedInteractionAuditResult()
  let responsiveAuditResult = createSkippedInteractionAuditResult()
  let downloadAuditResult = createSkippedInteractionAuditResult()
  let cookieAuditResult = createSkippedInteractionAuditResult()
  let imageAuditResult = createSkippedInteractionAuditResult()

  if (normalizedOptions.click) {
    clickActionAuditResult = await auditClickableActions(browser, targetUrl, safeSnapshot.clickableCandidates || [], instrumentation).catch((error) => ({
      items: [],
      meta: { candidateCount: safeSnapshot.clickableCandidates?.length || 0, safeClickAttemptCount: 0, safeClickLimit: 0, error: error instanceof Error ? error.message : 'click audit failed' },
    }))
  }

  if (normalizedOptions.landing) {
    const landingSources = normalizedOptions.click ? clickActionAuditResult.items : createLandingAuditSourceItems(safeSnapshot.interactionTargets)
    landingAuditResult = await auditLandingPages(browser, targetUrl, landingSources, instrumentation).catch((error) => ({
      items: [],
      meta: {
        candidateCount: 0,
        inspectedCount: 0,
        okCount: 0,
        warningCount: 0,
        errorCount: 1,
        redirectCount: 0,
        newWindowCount: 0,
        noTarget: true,
        error: error instanceof Error ? error.message : 'landing audit failed',
      },
    }))
  }

  if (normalizedOptions.form) {
    formAuditResult = await auditForms(browser, targetUrl, instrumentation).catch((error) => ({
      items: [],
      meta: {
        candidateCount: 0,
        inspectedCount: 0,
        okCount: 0,
        warningCount: 0,
        errorCount: 1,
        skippedCount: 0,
        noTarget: true,
        error: error instanceof Error ? error.message : 'form audit failed',
      },
    }))
  }

  if (normalizedOptions.hover) {
    hoverAuditResult = await auditHoverInteractions(browser, targetUrl, instrumentation).catch((error) => ({
      items: [],
      meta: {
        candidateCount: 0,
        inspectedCount: 0,
        okCount: 0,
        warningCount: 0,
        errorCount: 1,
        skippedCount: 0,
        noTarget: true,
        error: error instanceof Error ? error.message : 'hover audit failed',
      },
    }))
  }

  if (normalizedOptions.modal) {
    const modalClickItems = normalizedOptions.click ? clickActionAuditResult.items : []
    modalAuditResult = await auditModalInteractions(browser, targetUrl, modalClickItems, instrumentation).catch((error) => ({
      items: [],
      meta: {
        candidateCount: 0,
        inspectedCount: 0,
        okCount: 0,
        warningCount: 0,
        errorCount: 1,
        skippedCount: 0,
        noTarget: true,
        error: error instanceof Error ? error.message : 'modal audit failed',
      },
    }))
  }

  if (normalizedOptions.scroll) {
    scrollAuditResult = await auditScrollInteractions(browser, targetUrl, instrumentation).catch((error) => ({
      items: [],
      meta: {
        candidateCount: 0,
        inspectedCount: 0,
        okCount: 0,
        warningCount: 0,
        errorCount: 1,
        skippedCount: 0,
        noTarget: true,
        error: error instanceof Error ? error.message : 'scroll audit failed',
      },
    }))
  }

  if (normalizedOptions.responsive) {
    responsiveAuditResult = await auditResponsiveLayouts(browser, targetUrl, instrumentation).catch((error) => ({
      items: [],
      meta: {
        candidateCount: 0,
        inspectedCount: 0,
        okCount: 0,
        warningCount: 0,
        errorCount: 1,
        skippedCount: 0,
        noTarget: true,
        error: error instanceof Error ? error.message : 'responsive audit failed',
      },
    }))
  }

  if (normalizedOptions.download) {
    downloadAuditResult = await auditDownloadResources(targetUrl, safeSnapshot.links || [], instrumentation).catch((error) => ({
      items: [],
      meta: {
        candidateCount: 0,
        inspectedCount: 0,
        okCount: 0,
        warningCount: 0,
        errorCount: 1,
        skippedCount: 0,
        noTarget: true,
        error: error instanceof Error ? error.message : 'download audit failed',
      },
    }))
  }

  if (normalizedOptions.cookie) {
    cookieAuditResult = await auditCookies(browser, targetUrl, instrumentation).catch((error) => ({
      items: [],
      meta: {
        candidateCount: 0,
        inspectedCount: 0,
        okCount: 0,
        warningCount: 0,
        errorCount: 1,
        skippedCount: 0,
        noTarget: true,
        error: error instanceof Error ? error.message : 'cookie audit failed',
      },
    }))
  }

  if (normalizedOptions.image) {
    imageAuditResult = await auditImages(browser, targetUrl, instrumentation).catch((error) => ({
      items: [],
      meta: {
        candidateCount: 0,
        inspectedCount: 0,
        okCount: 0,
        warningCount: 0,
        errorCount: 1,
        skippedCount: 0,
        noTarget: true,
        error: error instanceof Error ? error.message : 'image audit failed',
      },
    }))
  }

  return {
    techScanOptions: normalizedOptions,
    clickActionAuditResult,
    landingAuditResult,
    formAuditResult,
    hoverAuditResult,
    modalAuditResult,
    scrollAuditResult,
    responsiveAuditResult,
    downloadAuditResult,
    cookieAuditResult,
    imageAuditResult,
  }
}

export async function runUrlAudit({
  enabled,
  targetUrl,
  snapshot,
  createTechLinkAudit,
  getLinksToCheck,
  checkLinkStatuses,
  mergeTechLinkAuditResults,
}) {
  if (!enabled) return { links: [], missingHrefLinks: [], uiControlWithoutUrlCount: 0, linkAuditResult: { links: [], meta: {} } }

  const linkAudit = createTechLinkAudit(snapshot.interactionTargets, targetUrl)
  const linksToCheck = getLinksToCheck(linkAudit.requestableLinks)
  const checkedLinks = await checkLinkStatuses(linksToCheck)
  const linkAuditResult = mergeTechLinkAuditResults(linkAudit, checkedLinks)

  return {
    links: linkAuditResult.links,
    missingHrefLinks: linkAudit.missingHrefLinks,
    uiControlWithoutUrlCount: linkAudit.uiControlsWithoutUrl.length,
    linkAuditResult,
  }
}
