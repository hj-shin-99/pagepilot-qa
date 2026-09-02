const INTENT_SCHEMA_VERSION = 'navigation-intent-reference-v1'
const GENERIC_LABELS = new Set(['view', 'more', 'list', 'detail', 'details', 'open', 'go', 'link', 'menu', '보기', '더보기', '목록', '상세', '이동'])
const VALID_MATCH_MODES = new Set(['exact-url', 'path-and-query', 'pattern'])
const STATUS_ORDER = ['matched-mismatch', 'ambiguous-match', 'target-evidence-unavailable', 'identity-unresolved', 'reference-not-observed', 'matched-correct']

export function evaluateNavigationIntentQa(referenceMap, scanResult = {}, options = {}) {
  const validated = normalizeNavigationReferenceMap(referenceMap)
  if (!validated.available) return createUnavailableResult(validated.reason)

  const device = normalizeText(options.device || scanResult.deviceId || scanResult.device?.deviceId || 'desktop', 40) || 'desktop'
  const baseUrl = normalizeText(options.baseUrl || scanResult.targetUrl, 1000)
  const actualCandidates = collectActualNavigationCandidates(scanResult)
  const items = validated.items.map((referenceItem) => evaluateReferenceItem(referenceItem, actualCandidates, { baseUrl, device }))
    .sort(compareIntentItems)

  return {
    summary: summarizeIntentItems(items),
    items,
    meta: {
      available: true,
      schemaVersion: validated.schemaVersion,
      referenceItemCount: validated.items.length,
      actualCandidateCount: actualCandidates.length,
      device,
    },
  }
}

export function normalizeNavigationReferenceMap(referenceMap) {
  if (!referenceMap || typeof referenceMap !== 'object' || Array.isArray(referenceMap)) return { available: false, reason: 'missing-reference-map', items: [] }
  const schemaVersion = normalizeText(referenceMap.schemaVersion, 120)
  if (schemaVersion !== INTENT_SCHEMA_VERSION) return { available: false, reason: 'invalid-schema-version', items: [] }
  if (!Array.isArray(referenceMap.items)) return { available: false, reason: 'invalid-items', items: [] }

  const items = referenceMap.items.map(normalizeReferenceItem).filter(Boolean)
  if (items.length === 0) return { available: false, reason: 'no-confirmed-reference-items', items: [] }
  return { available: true, schemaVersion, items }
}

export function collectActualNavigationCandidates(scanResult = {}) {
  return [
    ...collectLinkCandidates(scanResult.links),
    ...collectClickCandidates(scanResult.clickActions),
    ...collectLandingCandidates(scanResult.landingPages),
  ].filter((candidate) => candidate.normalizedLabel || candidate.normalizedAliases.length > 0 || candidate.targetEvidence.length > 0)
}

export function matchExpectedUrl(expectedUrl, actualUrl, options = {}) {
  const expected = normalizeExpectedUrl(expectedUrl)
  const actual = parseComparableUrl(actualUrl, options.baseUrl)
  if (!expected || !actual) return false

  if (expected.isAbsolute && expected.origin !== actual.origin) return false
  if (!matchPath(expected, actual)) return false

  if (expected.matchMode !== 'pattern' && !sameQuery(expected.query, actual.query)) return false
  if (expected.matchMode === 'pattern' && !expectedQueryMatches(expected.query, actual.query)) return false
  if (expected.hash && expected.hash !== actual.hash) return false

  if (expected.matchMode === 'exact-url' && expected.isAbsolute) {
    return `${expected.origin}${expected.path}${formatQuery(expected.query)}${expected.hash ? `#${expected.hash}` : ''}` === `${actual.origin}${actual.path}${formatQuery(actual.query)}${actual.hash ? `#${actual.hash}` : ''}`
  }

  return true
}

function evaluateReferenceItem(referenceItem, actualCandidates, options) {
  const matches = actualCandidates
    .map((candidate) => ({ candidate, ...scoreCandidateMatch(referenceItem, candidate) }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score)

  if (matches.length === 0) return classifyUnresolvedIdentity(referenceItem, actualCandidates, options)

  const topScore = matches[0].score
  const topMatches = matches.filter((match) => Math.abs(match.score - topScore) < 0.0001)
  if (topMatches.some((match) => match.weak)) {
    return createIntentItem(referenceItem, topMatches[0].candidate, 'ambiguous-match', 'Reference identity evidence가 짧거나 일반적인 segment에만 의존해 실제 element를 확정하지 않습니다.', 0.52, options, topMatches.map(({ candidate }) => candidate.label).filter(Boolean))
  }
  if ((isGenericLabel(referenceItem.normalizedLabel) && matches.length > 1) || topMatches.length > 1) {
    return classifyDuplicateIdentityMatches(referenceItem, topMatches, options)
  }
  if (topMatches[0].identityStrength !== 'strong') {
    return classifySupportingOnlyMatch(referenceItem, topMatches[0].candidate, actualCandidates, options, topMatches[0].score)
  }

  return classifyMatchedCandidate(referenceItem, matches[0].candidate, options, topScore)
}

function classifyUnresolvedIdentity(referenceItem, actualCandidates, options) {
  const observedEvidence = findExpectedTargetEvidence(referenceItem.expectedUrls, actualCandidates, options.baseUrl)
  if (observedEvidence.length > 0) {
    return createIntentItem(referenceItem, { label: '', normalizedLabel: '', normalizedAliases: [], targetEvidence: observedEvidence }, 'identity-unresolved', 'Expected target은 현재 페이지에서 관찰되었지만 Reference element와 실제 element identity를 확정하지 못했습니다.', 0.5, options, [], { evidence: observedEvidence })
  }
  return createIntentItem(referenceItem, null, 'reference-not-observed', '현재 페이지에서 해당 Reference element를 관찰하지 못했고 Expected target evidence도 확인되지 않았습니다.', 0.4, options)
}

function classifyDuplicateIdentityMatches(referenceItem, matches, options) {
  const candidates = matches.map((match) => match.candidate)
  if (matches.some((match) => match.identityStrength !== 'strong')) {
    return createIntentItem(referenceItem, candidates[0], 'ambiguous-match', '복수 후보가 supporting identity evidence를 포함해 실제 element를 확정하지 않습니다.', 0.55, options, candidates.map((candidate) => candidate.label).filter(Boolean))
  }
  const targetGroups = candidates.map((candidate) => ({ candidate, evidence: candidate.targetEvidence.filter((item) => item.url) }))
  if (targetGroups.some((group) => group.evidence.length === 0)) {
    return createIntentItem(referenceItem, candidates[0], 'target-evidence-unavailable', '동일 identity 후보 중 일부에 target evidence가 없어 자동 판정하지 않습니다.', 0.58, options, candidates.map((candidate) => candidate.label).filter(Boolean))
  }
  const uniqueTargets = new Set(targetGroups.flatMap((group) => group.evidence.map((item) => normalizeActualTargetIdentity(item.url, options.baseUrl))).filter(Boolean))
  if (uniqueTargets.size === 1) {
    return classifyMatchedCandidate(referenceItem, mergeEquivalentCandidates(candidates, options.baseUrl), options, Math.min(matches[0].score, 0.88))
  }
  return createIntentItem(referenceItem, candidates[0], 'ambiguous-match', 'Reference identity와 일치하는 후보가 여러 개이며 target URL이 서로 달라 자동 불일치로 단정하지 않습니다.', 0.55, options, candidates.map((candidate) => candidate.label).filter(Boolean))
}

function classifySupportingOnlyMatch(referenceItem, candidate, actualCandidates, options, score) {
  const targetResult = evaluateCandidateTargets(referenceItem.expectedUrls, candidate.targetEvidence, options.baseUrl)
  if (targetResult.status === 'matched-correct') return createIntentItem(referenceItem, candidate, 'matched-correct', 'supporting identity evidence와 실제 target URL이 Expected URL과 일치합니다.', Math.max(score, 0.78), options, [], targetResult)
  const observedEvidence = findExpectedTargetEvidence(referenceItem.expectedUrls, actualCandidates, options.baseUrl)
  if (observedEvidence.length > 0) {
    return createIntentItem(referenceItem, candidate, 'identity-unresolved', 'Expected target은 현재 페이지에서 관찰되었지만 supporting identity evidence만으로 Reference element를 확정하지 못했습니다.', Math.min(score, 0.62), options, [], { evidence: observedEvidence })
  }
  if (targetResult.status === 'target-evidence-unavailable') return createIntentItem(referenceItem, candidate, 'target-evidence-unavailable', targetResult.reason, Math.min(score, 0.6), options)
  if (targetResult.status === 'ambiguous-match') return createIntentItem(referenceItem, candidate, 'ambiguous-match', targetResult.reason, Math.min(score, 0.62), options, [], targetResult)
  return createIntentItem(referenceItem, candidate, 'ambiguous-match', 'supporting identity evidence만으로 실제 element를 확정할 수 없어 Expected URL 불일치로 단정하지 않습니다.', Math.min(score, 0.6), options, [], targetResult)
}

function mergeEquivalentCandidates(candidates, baseUrl) {
  const [first] = candidates
  return {
    ...first,
    label: first.label || candidates.map((candidate) => candidate.label).filter(Boolean)[0] || '',
    targetEvidence: dedupeTargetEvidence(candidates.flatMap((candidate) => candidate.targetEvidence), baseUrl),
  }
}

function classifyMatchedCandidate(referenceItem, candidate, options, score) {
  const targetResult = evaluateCandidateTargets(referenceItem.expectedUrls, candidate.targetEvidence, options.baseUrl)
  if (targetResult.status === 'target-evidence-unavailable') return createIntentItem(referenceItem, candidate, targetResult.status, targetResult.reason, Math.min(score, 0.68), options)
  if (targetResult.status === 'ambiguous-match') return createIntentItem(referenceItem, candidate, targetResult.status, targetResult.reason, Math.min(score, 0.72), options)
  if (targetResult.status === 'matched-correct') return createIntentItem(referenceItem, candidate, targetResult.status, targetResult.reason, Math.max(score, 0.9), options, [], targetResult)
  return createIntentItem(referenceItem, candidate, 'matched-mismatch', targetResult.reason, Math.max(score, 0.86), options, [], targetResult)
}

function evaluateCandidateTargets(expectedUrls, targetEvidence = [], baseUrl) {
  const evidence = targetEvidence.filter((item) => item.url)
  if (evidence.length === 0) return { status: 'target-evidence-unavailable', reason: 'element는 매칭됐지만 href/click/landing target evidence가 부족합니다.' }

  const matchingEvidence = evidence.filter((item) => expectedUrls.some((expected) => evidenceMatchesExpected(expected, item, baseUrl)))
  const uniqueTargets = new Set(evidence.map((item) => normalizeActualTargetIdentity(item.url, baseUrl)).filter(Boolean))
  const redirectAllowedMatch = matchingEvidence.some((item) => item.redirected && expectedUrls.some((expected) => expected.allowRedirect === true && matchExpectedUrl(expected, item.url, { baseUrl })))
  const redirectBlockedMatch = matchingEvidence.length === 0 && evidence.some((item) => item.redirected && expectedUrls.some((expected) => expected.allowRedirect !== true && matchExpectedUrl(expected, item.url, { baseUrl })))

  if (uniqueTargets.size > 1 && redirectAllowedMatch) return { status: 'matched-correct', reason: 'redirect 허용 정책에 따라 최종 URL이 Expected URL과 일치합니다.', evidence: matchingEvidence }
  if (uniqueTargets.size > 1 && redirectBlockedMatch) return { status: 'matched-mismatch', reason: '최종 URL은 맞지만 redirect가 허용되지 않은 Reference target입니다.', evidence }
  if (uniqueTargets.size > 1 && matchingEvidence.length > 0) return { status: 'ambiguous-match', reason: 'href/click/landing URL evidence가 서로 달라 자동 불일치로 단정하지 않습니다.', evidence }
  if (matchingEvidence.length > 0) return { status: 'matched-correct', reason: '실제 target URL이 Expected URL 중 하나와 일치합니다.', evidence: matchingEvidence }
  return { status: 'matched-mismatch', reason: '실제 target URL이 Expected URL과 일치하지 않습니다.', evidence }
}

function evidenceMatchesExpected(expected, evidence, baseUrl) {
  if (evidence.redirected && expected.allowRedirect !== true) return false
  return matchExpectedUrl(expected, evidence.url, { baseUrl })
}

function findExpectedTargetEvidence(expectedUrls, actualCandidates, baseUrl) {
  return dedupeTargetEvidence(actualCandidates.flatMap((candidate) => candidate.targetEvidence).filter((evidence) => expectedUrls.some((expected) => evidenceMatchesExpected(expected, evidence, baseUrl))), baseUrl)
}

function createIntentItem(referenceItem, candidate, status, reason, confidence, options, ambiguousCandidates = [], targetResult = {}) {
  const evidence = Array.isArray(targetResult.evidence) ? targetResult.evidence : candidate?.targetEvidence || []
  return {
    referenceId: referenceItem.referenceId,
    label: referenceItem.label,
    expectedUrls: referenceItem.expectedUrls.map((url) => ({ raw: url.raw, matchMode: url.matchMode, allowRedirect: url.allowRedirect, allowTrailingSlashVariant: url.allowTrailingSlashVariant })),
    actualLabel: candidate?.label || '',
    actualUrlEvidence: evidence.map((item) => ({ kind: item.kind, url: item.url, requestedUrl: item.requestedUrl || '', redirected: item.redirected === true })).slice(0, 4),
    status,
    reason,
    confidence: roundConfidence(confidence),
    matchEvidence: createMatchEvidence(referenceItem, candidate, ambiguousCandidates),
    source: referenceItem.source,
    device: options.device,
  }
}

function createUnavailableResult(reason) {
  return {
    summary: { evaluated: 0, correct: 0, mismatch: 0, review: 1, notObserved: 0 },
    items: [],
    meta: { available: false, reason: normalizeText(reason, 120) || 'invalid-reference' },
  }
}

function summarizeIntentItems(items) {
  return items.reduce((summary, item) => {
    summary.evaluated += item.status === 'reference-not-observed' ? 0 : 1
    if (item.status === 'matched-correct') summary.correct += 1
    else if (item.status === 'matched-mismatch') summary.mismatch += 1
    else if (item.status === 'reference-not-observed') summary.notObserved += 1
    else summary.review += 1
    return summary
  }, { evaluated: 0, correct: 0, mismatch: 0, review: 0, notObserved: 0 })
}

function normalizeReferenceItem(item) {
  if (!item || typeof item !== 'object') return null
  if (item.userDecision && item.userDecision.status !== 'confirmed') return null
  const referenceId = normalizeText(item.referenceId, 80)
  const label = normalizeText(item.element?.label || item.label, 240)
  const expectedUrls = Array.isArray(item.expected?.urls) ? item.expected.urls.map(normalizeExpectedUrl).filter(Boolean) : []
  if (!referenceId || !label || expectedUrls.length === 0) return null
  return {
    referenceId,
    label,
    normalizedLabel: normalizeLabel(label),
    aliases: normalizeStringArray(item.element?.aliases, 12, 160),
    normalizedAliases: normalizeStringArray(item.element?.aliases, 12, 160).map(normalizeLabel).filter(Boolean),
    identitySegments: createReferenceIdentitySegments(label, item.element?.aliases, item.pageContext),
    hasHierarchyLabel: hasIdentityDelimiter(label) || normalizeStringArray(item.element?.aliases, 12, 160).some(hasIdentityDelimiter),
    roleHint: normalizeText(item.element?.roleHint, 80),
    actionHint: normalizeText(item.element?.actionHint, 80),
    pageContext: {
      sectionHint: normalizeText(item.pageContext?.sectionHint, 160),
      depthPath: normalizeStringArray(item.pageContext?.depthPath, 8, 160),
    },
    expectedUrls,
    source: {
      sheetName: normalizeText(item.source?.sheetName, 160),
      rowNumber: Number.isFinite(Number(item.source?.rowNumber)) ? Number(item.source.rowNumber) : null,
      evidenceText: normalizeText(item.source?.evidenceText, 300),
    },
  }
}

function normalizeExpectedUrl(url) {
  const raw = normalizeText(url?.raw || url, 1000)
  if (!raw) return null
  const parsed = parseComparableUrl(raw, 'https://reference.local')
  if (!parsed) return null
  return {
    raw,
    isAbsolute: /^https?:\/\//i.test(raw),
    origin: parsed.origin,
      path: decodePathname(normalizeText(url?.normalizedPath, 800) || parsed.path),
    query: url?.query && typeof url.query === 'object' && !Array.isArray(url.query) ? normalizeQueryObject(url.query) : parsed.query,
    hash: normalizeText(url?.hash, 200) || parsed.hash,
    matchMode: VALID_MATCH_MODES.has(url?.matchMode) ? url.matchMode : 'path-and-query',
    allowRedirect: url?.allowRedirect === true,
    allowTrailingSlashVariant: url?.allowTrailingSlashVariant !== false,
    dynamicParameters: normalizeStringArray(url?.dynamicParameters, 20, 80),
  }
}

function collectLinkCandidates(links = []) {
  return arrayOfObjects(links).map((link, index) => createActualCandidate({
    id: `link-${index}`,
    label: link.label || link.text || link.title || '',
    aliases: [link.text, link.accessibleName, link.ariaLabel],
    role: link.role || 'link',
    action: 'navigation',
    section: link.section || link.sectionHint || '',
    targetEvidence: createTargetEvidence([
      { kind: 'href', url: link.url || link.href || '', requestedUrl: link.url || link.href || '' },
      { kind: 'landing-final', url: link.finalUrl || '', requestedUrl: link.url || link.href || '', redirected: Boolean(link.finalUrl && link.url && normalizeActualTargetIdentity(link.finalUrl) !== normalizeActualTargetIdentity(link.url)) },
    ]),
  }))
}

function collectClickCandidates(clickActions = []) {
  return arrayOfObjects(clickActions).map((item, index) => createActualCandidate({
    id: `click-${index}`,
    label: item.label || item.text || item.accessibleName || item.ariaLabel || '',
    aliases: [item.text, item.accessibleName, item.ariaLabel],
    role: item.role || item.tagName || item.kind || 'button',
    action: item.actionHint || item.actionType || item.interactionOutcome || (item.url || item.requestedUrl || item.landingUrl ? 'navigation' : ''),
    section: item.section || item.sectionPath || item.userLocation || '',
    targetEvidence: createTargetEvidence([
      { kind: 'href', url: item.url || item.requestedUrl || '', requestedUrl: item.url || item.requestedUrl || '' },
      { kind: item.interactionOutcome === 'new-window' ? 'new-window' : 'click-navigation', url: item.landingUrl || '', requestedUrl: item.url || item.requestedUrl || item.href || '', redirected: Boolean(item.landingUrl && (item.url || item.requestedUrl) && normalizeActualTargetIdentity(item.landingUrl) !== normalizeActualTargetIdentity(item.url || item.requestedUrl)) },
    ]),
  }))
}

function collectLandingCandidates(landingPages = []) {
  return arrayOfObjects(landingPages).map((item, index) => createActualCandidate({
    id: `landing-${index}`,
    label: item.label || item.sources?.[0]?.label || '',
    aliases: arrayOfObjects(item.sources).map((source) => source.label),
    role: 'link',
    action: 'navigation',
    section: item.section || item.sources?.[0]?.section || '',
    targetEvidence: createTargetEvidence([
      { kind: 'href', url: item.requestedUrl || '', requestedUrl: item.requestedUrl || '' },
      { kind: 'landing-final', url: item.finalUrl || '', requestedUrl: item.requestedUrl || '', redirected: item.redirected === true },
    ]),
  }))
}

function createActualCandidate(candidate) {
  const aliases = normalizeStringArray(candidate.aliases, 8, 160)
  const label = normalizeText(candidate.label, 240) || aliases[0] || ''
  return {
    ...candidate,
    label,
    normalizedLabel: normalizeLabel(label),
    normalizedAliases: aliases.map(normalizeLabel).filter(Boolean),
    identitySegments: createActualIdentitySegments(label, aliases),
    role: normalizeText(candidate.role, 80),
    action: normalizeText(candidate.action, 80),
    section: normalizeText(candidate.section, 160),
    targetEvidence: Array.isArray(candidate.targetEvidence) ? candidate.targetEvidence : [],
  }
}

function createTargetEvidence(items) {
  return dedupeTargetEvidence(items)
}

function dedupeTargetEvidence(items, baseUrl = 'https://reference.local') {
  const seen = new Set()
  return items.filter((item) => {
    const url = normalizeText(item.url, 1000)
    if (!url) return false
    const key = `${item.kind}\u0000${normalizeActualTargetIdentity(url, baseUrl)}\u0000${item.requestedUrl || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map((item) => ({
    kind: normalizeText(item.kind, 80),
    url: normalizeText(item.url, 1000),
    requestedUrl: normalizeText(item.requestedUrl, 1000),
    redirected: item.redirected === true,
  }))
}

function scoreCandidateMatch(referenceItem, candidate) {
  if (!candidate.normalizedLabel && candidate.normalizedAliases.length === 0) return { score: 0, matchType: '', weak: false }
  if (candidate.normalizedLabel === referenceItem.normalizedLabel) return createScore(1, 'label', referenceItem, candidate)
  if (referenceItem.normalizedAliases.includes(candidate.normalizedLabel) || candidate.normalizedAliases.includes(referenceItem.normalizedLabel)) return createScore(0.95, 'alias', referenceItem, candidate)

  const candidateLabels = [candidate.normalizedLabel, ...candidate.normalizedAliases].filter(Boolean)
  const strongAtomic = candidateLabels.find((label) => referenceItem.identitySegments.strong.includes(label))
  if (strongAtomic) return createScore(0.78, 'atomic', referenceItem, candidate, false, referenceItem.hasHierarchyLabel ? 'supporting' : 'strong')

  const supportingAtomic = candidateLabels.find((label) => referenceItem.identitySegments.supporting.includes(label))
  if (supportingAtomic) return createScore(0.68, 'supporting-atomic', referenceItem, candidate, false, 'supporting')

  const weakAtomic = candidateLabels.find((label) => referenceItem.identitySegments.weak.includes(label))
  if (weakAtomic) return createScore(0.52, 'weak-atomic', referenceItem, candidate, true, 'supporting')

  const candidateStrongSegments = candidate.identitySegments.strong || []
  if (candidateStrongSegments.includes(referenceItem.normalizedLabel)) return createScore(0.76, 'atomic', referenceItem, candidate, false, 'supporting')

  if (isGenericLabel(referenceItem.normalizedLabel) || isGenericLabel(candidate.normalizedLabel)) return { score: 0, matchType: '', weak: false }
  if (isConservativeTokenMatch(referenceItem.normalizedLabel, candidate.normalizedLabel)) return createScore(0.66, 'token-similarity', referenceItem, candidate, false, 'supporting')
  return { score: 0, matchType: '', weak: false }
}

function createScore(baseScore, matchType, referenceItem, candidate, weak = false, identityStrength = 'strong') {
  return { score: addContextScore(baseScore, referenceItem, candidate), matchType, weak, identityStrength }
}

function addContextScore(score, referenceItem, candidate) {
  let nextScore = score
  const sectionHint = normalizeLabel(referenceItem.pageContext.sectionHint)
  const candidateSection = normalizeLabel(candidate.section)
  if (sectionHint && candidateSection && (sectionHint.includes(candidateSection) || candidateSection.includes(sectionHint))) nextScore += 0.03
  if (isRoleCompatible(referenceItem.roleHint, candidate.role)) nextScore += 0.02
  if (isActionCompatible(referenceItem.actionHint, candidate.action)) nextScore += 0.02
  return Math.min(1, nextScore)
}

function isRoleCompatible(roleHint, role) {
  const expected = normalizeLabel(roleHint)
  const actual = normalizeLabel(role)
  if (!expected || !actual || expected === 'unknown') return false
  if (expected === actual) return true
  if (expected === 'link' && actual === 'a') return true
  if (expected === 'button' && actual === 'inputbutton') return true
  return false
}

function isActionCompatible(actionHint, action) {
  const expected = normalizeLabel(actionHint)
  const actual = normalizeLabel(action)
  if (!expected || !actual) return false
  if (expected === actual) return true
  if (expected === 'navigation' && ['link', 'href', 'click navigation', 'new window'].includes(actual)) return true
  return false
}

function isConservativeTokenMatch(left, right) {
  const leftTokens = tokenizeLabel(left)
  const rightTokens = tokenizeLabel(right)
  if (leftTokens.length < 2 || rightTokens.length < 2) return false
  const overlap = leftTokens.filter((token) => rightTokens.includes(token))
  return overlap.length >= Math.min(leftTokens.length, rightTokens.length) && overlap.join('').length >= 6
}

function matchPath(expected, actual) {
  const expectedPath = normalizePath(expected.path, expected.allowTrailingSlashVariant)
  const actualPath = normalizePath(actual.path, expected.allowTrailingSlashVariant)
  if (expected.matchMode !== 'pattern') return expectedPath === actualPath
  return pathPatternToRegExp(expectedPath, expected.dynamicParameters).test(actualPath)
}

function pathPatternToRegExp(path, dynamicParameters = []) {
  const escaped = path.split('/').map((part) => {
    if (!part) return ''
    if (/^\{[^}]+\}$|^:[A-Za-z0-9_-]+$|^\[[^\]]+\]$/.test(part) || dynamicParameters.includes(part)) return '[^/]+'
    if (part === '*') return '.*'
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('/')
  return new RegExp(`^${escaped}$`, 'i')
}

function sameQuery(left = {}, right = {}) {
  const leftEntries = Object.entries(left).sort()
  const rightEntries = Object.entries(right).sort()
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}

function expectedQueryMatches(expected = {}, actual = {}) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value)
}

function parseComparableUrl(raw, baseUrl = 'https://reference.local') {
  const value = normalizeText(raw, 1000)
  if (!value) return null
  try {
    const base = /^https?:\/\//i.test(baseUrl) ? baseUrl : 'https://reference.local'
    const parsed = /^https?:\/\//i.test(value) ? new URL(value) : new URL(value, base)
    return {
      origin: parsed.origin.toLowerCase(),
      path: decodePathname(parsed.pathname || '/'),
      query: Object.fromEntries(parsed.searchParams.entries()),
      hash: parsed.hash ? parsed.hash.slice(1) : '',
    }
  } catch {
    return null
  }
}

function normalizeActualTargetIdentity(url, baseUrl = 'https://reference.local') {
  const parsed = parseComparableUrl(url, baseUrl)
  if (!parsed) return ''
  return `${parsed.origin}${normalizePath(parsed.path, true)}${formatQuery(parsed.query)}${parsed.hash ? `#${parsed.hash}` : ''}`
}

function decodePathname(path) {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function normalizePath(path, allowTrailingSlashVariant) {
  const normalized = normalizeText(path, 800) || '/'
  if (allowTrailingSlashVariant === false || normalized === '/') return normalized.toLowerCase()
  return normalized.replace(/\/+$/g, '').toLowerCase() || '/'
}

function formatQuery(query = {}) {
  const entries = Object.entries(query).sort()
  if (entries.length === 0) return ''
  return `?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
}

function normalizeQueryObject(query = {}) {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [normalizeText(key, 120), normalizeText(value, 300)]).filter(([key]) => key))
}

function createMatchEvidence(referenceItem, candidate, ambiguousCandidates = []) {
  const evidence = []
  if (candidate?.normalizedLabel === referenceItem.normalizedLabel) evidence.push('label exact match')
  else if (candidate && (referenceItem.normalizedAliases.includes(candidate.normalizedLabel) || candidate.normalizedAliases.includes(referenceItem.normalizedLabel))) evidence.push('alias exact match')
  else if (candidate && referenceItem.identitySegments?.strong?.includes(candidate.normalizedLabel)) evidence.push('atomic segment exact match')
  else if (candidate && referenceItem.identitySegments?.supporting?.includes(candidate.normalizedLabel)) evidence.push('supporting atomic segment match')
  else if (candidate && referenceItem.identitySegments?.weak?.includes(candidate.normalizedLabel)) evidence.push('weak atomic segment match')
  else if (candidate && candidate.targetEvidence?.length > 0 && !candidate.normalizedLabel) evidence.push('expected target observed without identity match')
  if (isRoleCompatible(referenceItem.roleHint, candidate?.role)) evidence.push('compatible role')
  if (ambiguousCandidates.length > 0) evidence.push(`ambiguous candidates: ${ambiguousCandidates.join(', ')}`)
  return evidence
}

function compareIntentItems(left, right) {
  const statusDiff = STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status)
  if (statusDiff !== 0) return statusDiff
  return String(left.referenceId).localeCompare(String(right.referenceId))
}

function isGenericLabel(label) {
  const normalized = normalizeLabel(label)
  return normalized.length <= 4 || GENERIC_LABELS.has(normalized)
}

function createReferenceIdentitySegments(label, aliases = [], pageContext = {}) {
  const strong = []
  const supporting = []
  const weak = []
  addIdentityTerms(hasIdentityDelimiter(label) ? supporting : strong, weak, [label])
  normalizeStringArray(aliases, 12, 160).forEach((alias) => addIdentityTerms(hasIdentityDelimiter(alias) ? supporting : strong, weak, [alias]))
  addIdentityTerms(supporting, weak, normalizeStringArray(pageContext?.depthPath, 8, 160))
  addIdentityTerms(supporting, weak, [pageContext?.sectionHint])
  const strongSegments = dedupeStrings(strong)
  const supportingSegments = dedupeStrings(supporting).filter((segment) => !strongSegments.includes(segment))
  return { strong: strongSegments, supporting: supportingSegments, weak: dedupeStrings(weak).filter((segment) => !strongSegments.includes(segment) && !supportingSegments.includes(segment)) }
}

function createActualIdentitySegments(label, aliases = []) {
  const strong = []
  const weak = []
  addIdentityTerms(strong, weak, [label, ...aliases])
  return { strong: dedupeStrings(strong), weak: dedupeStrings(weak).filter((segment) => !strong.includes(segment)) }
}

function addIdentityTerms(target, weak, values) {
  const rawValues = Array.isArray(values) ? values : [values]
  rawValues.slice(0, 20).forEach((value) => {
    splitIdentitySegments(value).forEach((segment) => {
      const normalized = normalizeLabel(segment)
      if (!normalized) return
      if (isGenericLabel(normalized)) weak.push(normalized)
      else target.push(normalized)
    })
  })
}

function splitIdentitySegments(value) {
  const raw = typeof value === 'string' ? value : ''
  const parts = raw.split(/(?:\/|>|\u2192|\||\r?\n)+/u).map((part) => normalizeText(part, 160)).filter(Boolean)
  return parts.length > 0 ? parts : [raw]
}

function hasIdentityDelimiter(value) {
  return typeof value === 'string' && /(?:\/|>|\u2192|\||\r?\n)+/u.test(value)
}

function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))]
}

function tokenizeLabel(label) {
  return normalizeText(label, 240).split(/\s+/).filter((token) => token.length > 1)
}

function normalizeLabel(value) {
  return normalizeText(value, 240).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeText(item, maxLength)).filter(Boolean).slice(0, maxItems)
}

function arrayOfObjects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : []
}

function normalizeText(value, maxLength) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : ''
}

function roundConfidence(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(1, Math.round(number * 100) / 100))
}
