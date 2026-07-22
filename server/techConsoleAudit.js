export function classifyConsoleMessages(messages = [], pageUrl = '') {
  const pageOrigin = getOrigin(pageUrl)
  const representatives = new Map()
  const rawMessages = arrayOfObjects(messages).map((message) => classifyConsoleMessage(message, pageOrigin))

  rawMessages.forEach((message) => {
    const key = getConsoleDedupeKey(message)
    const existing = representatives.get(key)
    if (existing) {
      existing.repeatCount += 1
      existing.duplicateSources.push(message.sourceUrl || message.source || '')
      message.duplicateOf = existing.id
      message.classification = 'repeated-duplicate'
      return
    }

    representatives.set(key, {
      ...message,
      id: `console-${representatives.size + 1}`,
      repeatCount: 1,
      duplicateSources: [],
    })
  })

  const items = Array.from(representatives.values())
  const errorItems = items.filter((item) => item.status === 'error')
  const warningItems = items.filter((item) => item.status === 'warn')
  const referenceItems = items.filter((item) => item.status === 'ok')

  return {
    status: errorItems.length > 0 ? 'error' : warningItems.length > 0 ? 'warn' : 'ok',
    value: `first-party ${errorItems.filter((item) => item.party === 'first-party').length} · third-party ${warningItems.filter((item) => item.party === 'third-party').length}`,
    detail: items.length > 0
      ? 'Console/pageerror를 source origin, event type, level, 중복 메시지 기준으로 분류했습니다.'
      : '콘솔 오류가 감지되지 않았습니다.',
    items: errorItems.concat(warningItems),
    referenceItems,
    rawMessages,
    meta: {
      firstPartyRuntimeErrorCount: items.filter((item) => item.classification === 'first-party-runtime-error').length,
      firstPartyConsoleErrorCount: items.filter((item) => item.classification === 'first-party-console-error').length,
      thirdPartyScriptErrorCount: items.filter((item) => item.classification === 'third-party-script-error').length,
      warningInfoCount: items.filter((item) => item.classification === 'warning-info').length,
      repeatedDuplicateCount: rawMessages.filter((item) => item.classification === 'repeated-duplicate').length,
      representativeCount: items.length,
      rawCount: rawMessages.length,
    },
  }
}

function classifyConsoleMessage(message = {}, pageOrigin = '') {
  const eventType = message.eventType === 'pageerror' || message.source === 'pageerror' ? 'pageerror' : 'console'
  const level = String(message.level || message.type || (eventType === 'pageerror' ? 'error' : '')).toLowerCase()
  const sourceUrl = getSourceUrl(message)
  const sourceOrigin = getOrigin(sourceUrl)
  const party = !sourceOrigin || !pageOrigin || sourceOrigin === pageOrigin ? 'first-party' : 'third-party'
  const stackSnippet = getStackSnippet(message.stack || message.message)
  const isErrorLevel = level === 'error' || eventType === 'pageerror'
  const classification = getClassification({ eventType, level, party, isErrorLevel })
  const status = getStatus(classification)

  return {
    ...message,
    eventType,
    level: level || 'info',
    message: String(message.message || '').trim(),
    sourceUrl: sourceUrl || message.source || '',
    sourceOrigin,
    party,
    stackSnippet,
    classification,
    status,
    owner: party === 'first-party' ? 'UID팀' : '개발팀',
    reason: getReason(classification, party, eventType, level),
  }
}

function getClassification({ eventType, level, party, isErrorLevel }) {
  if (!isErrorLevel) return 'warning-info'
  if (party === 'third-party') return 'third-party-script-error'
  if (eventType === 'pageerror') return 'first-party-runtime-error'
  if (level === 'error') return 'first-party-console-error'
  return 'warning-info'
}

function getStatus(classification) {
  if (classification === 'first-party-runtime-error' || classification === 'first-party-console-error') return 'error'
  if (classification === 'third-party-script-error') return 'warn'
  return 'ok'
}

function getReason(classification, party, eventType, level) {
  if (classification === 'first-party-runtime-error') return 'pageerror 런타임 오류이며 source origin이 검사 페이지와 같습니다.'
  if (classification === 'first-party-console-error') return 'console.error이며 source origin이 검사 페이지와 같습니다. 영향 범위 확인이 필요합니다.'
  if (classification === 'third-party-script-error') return `${eventType}/${level}이지만 source origin이 검사 페이지와 달라 배포 차단 오류로 단정하지 않습니다.`
  if (classification === 'warning-info') return `${party} ${level || 'info'} 로그로 오류 count에서 제외했습니다.`
  return '동일 normalized message 반복으로 대표 항목의 repeatCount에 합산했습니다.'
}

function getConsoleDedupeKey(message = {}) {
  return [message.classification, normalizeConsoleMessage(message.message)].join('|')
}

function normalizeConsoleMessage(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function getSourceUrl(message = {}) {
  const direct = textOf(message.sourceUrl || message.url || message.source)
  if (isHttpUrl(direct)) return direct
  const stackUrl = extractUrlFromText(message.stack || message.message)
  return stackUrl || ''
}

function extractUrlFromText(value) {
  const match = String(value || '').match(/https?:\/\/[^\s)]+/i)
  return match ? match[0] : ''
}

function getStackSnippet(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ')
}

function getOrigin(value) {
  try {
    if (!isHttpUrl(value)) return ''
    return new URL(value).origin
  } catch {
    return ''
  }
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''))
}

function arrayOfObjects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim()
}
