const EMPTY_TITLE_PATTERNS = [/^페이지\s*(제목|타이틀)\s*없음$/i, /^untitled$/i, /^no\s*title$/i]

export function createVisualQaTitle({ pageTitle, result = {}, url } = {}) {
  const title = selectPageTitle(pageTitle, result)
  if (title) return title.includes('Visual QA 결과') ? title : `${title} Visual QA 결과`

  const hostTitle = createHostnameTitle(url || result.meta?.webUrl || result.webUrl || result.web?.url || result.url)
  return hostTitle ? `${hostTitle} Visual QA 결과` : 'Visual QA 결과'
}

function selectPageTitle(pageTitle, result) {
  return [
    pageTitle,
    result.pageTitle,
    result.web?.page?.title,
    result.web?.pageTitle,
    result.meta?.pageTitle,
    result.meta?.webTitle,
  ].map(normalizePageTitle).find(Boolean) || ''
}

function normalizePageTitle(value) {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title) return ''
  if (EMPTY_TITLE_PATTERNS.some((pattern) => pattern.test(title))) return ''
  return title
}

function createHostnameTitle(value) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./i, '').replace(/:\d+$/, '')
    const parts = hostname.split('.').filter((part) => part && !/^(co|com|net|org|kr|jp|cn|io|dev|app)$/i.test(part))
    const base = parts[0] || hostname.split('.')[0] || ''
    return base
      .replace(/[-_]+/g, ' ')
      .trim()
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
  } catch {
    return ''
  }
}
