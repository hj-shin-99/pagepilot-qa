const TEXT_NORMALIZER = /\s+/g
const LAYOUT_TOLERANCE = 8

export function parseFigmaJsonInput(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  return extractFigmaElements(parsed)
}

export function extractFigmaElements(source) {
  const roots = getFigmaRoots(source)
  const elements = []

  roots.forEach((root) => walkFigmaNode(root, elements))
  return elements
}

export function compareDesignElements(figmaElements, webElements) {
  if (figmaElements.length === 0) {
    const issues = [createComparisonWaitingIssue(webElements.length)]

    return {
      counts: getDesignCounts(issues),
      issues,
    }
  }

  const figmaGroups = groupByText(figmaElements)
  const webGroups = groupByText(webElements)
  const issues = []

  figmaGroups.forEach((figmaGroup, textKey) => {
    const webGroup = webGroups.get(textKey)

    if (!webGroup) {
      figmaGroup.items.forEach((figmaElement) => {
        issues.push(createIssue('error', 'Figma에만 있는 텍스트', figmaElement.text, '웹 화면에서 같은 문구를 찾지 못했습니다.', figmaElement, null))
      })
      return
    }

    compareCommonText(figmaGroup.items[0], webGroup.items[0], issues)
    webGroup.items.filter(isCtaElement).forEach((webElement) => {
      issues.push(createIssue('warn', 'CTA 링크 검토 필요', figmaGroup.text, getCtaDetail(webElement), figmaGroup.items[0], webElement))
    })
  })

  webGroups.forEach((webGroup, textKey) => {
    if (figmaGroups.has(textKey)) return

    webGroup.items.forEach((webElement) => {
      issues.push(createIssue('error', '웹에만 있는 텍스트', webElement.text, 'Figma JSON에서 같은 문구를 찾지 못했습니다.', null, webElement))
    })
  })

  return {
    counts: getDesignCounts(issues),
    issues,
  }
}

export function normalizeDesignText(value) {
  return String(value || '').trim().replace(TEXT_NORMALIZER, ' ').toLowerCase()
}

function getFigmaRoots(source) {
  if (!source || typeof source !== 'object') return []

  if (source.document) return [source.document]
  if (source.nodes && typeof source.nodes === 'object') {
    return Object.values(source.nodes).map((node) => node?.document || node).filter(Boolean)
  }
  return [source]
}

function walkFigmaNode(node, elements) {
  if (!node || typeof node !== 'object') return

  const element = createFigmaElement(node, elements.length + 1)
  if (element) elements.push(element)

  if (Array.isArray(node.children)) {
    node.children.forEach((child) => walkFigmaNode(child, elements))
  }
}

function createFigmaElement(node, index) {
  if (node.type !== 'TEXT') return null

  const rawText = typeof node.characters === 'string' ? node.characters : ''
  const text = rawText.trim().replace(TEXT_NORMALIZER, ' ')
  if (!text) return null

  const style = node.style || {}
  const bounds = node.absoluteBoundingBox || {}

  return {
    index,
    tag: node.type || 'FIGMA',
    text,
    fontFamily: style.fontFamily || '',
    fontStyle: style.fontStyle || '',
    fontSize: style.fontSize ?? '',
    fontWeight: style.fontWeight ?? '',
    lineHeight: style.lineHeightPx ?? style.lineHeightPercentFontSize ?? style.lineHeightPercent ?? '',
    letterSpacing: style.letterSpacing ?? node.letterSpacing ?? '',
    color: getFigmaColor(node.fills),
    opacity: node.opacity ?? '',
    x: bounds.x ?? '',
    y: bounds.y ?? '',
    width: bounds.width ?? '',
    height: bounds.height ?? '',
    href: '',
  }
}

function getFigmaColor(fills) {
  if (!Array.isArray(fills)) return ''

  const fill = fills.find((item) => item?.type === 'SOLID' && item.visible !== false && item.color)
  if (!fill) return ''

  const alpha = fill.opacity ?? fill.color.a ?? 1
  const red = toRgbChannel(fill.color.r)
  const green = toRgbChannel(fill.color.g)
  const blue = toRgbChannel(fill.color.b)

  if (alpha < 1) return `rgba(${red}, ${green}, ${blue}, ${roundNumber(alpha)})`
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function groupByText(elements) {
  return elements.reduce((groups, element) => {
    const textKey = normalizeDesignText(element.text)
    if (!textKey) return groups

    const group = groups.get(textKey) || { text: element.text, items: [] }
    group.items.push(element)
    groups.set(textKey, group)
    return groups
  }, new Map())
}

function compareCommonText(figmaElement, webElement, issues) {
  let hasDifference = false
  const figmaFontSize = toNumber(figmaElement.fontSize)
  const webFontSize = toNumber(webElement.fontSize)

  if (figmaFontSize !== null && webFontSize !== null && Math.abs(figmaFontSize - webFontSize) > 1) {
    hasDifference = true
    issues.push(createIssue('warn', '폰트 크기 차이', figmaElement.text, `Figma ${formatSize(figmaFontSize)} / Web ${formatSize(webFontSize)}로 다릅니다.`, figmaElement, webElement))
  }

  if (normalizeFontFamily(figmaElement.fontFamily) && normalizeFontFamily(webElement.fontFamily) && normalizeFontFamily(figmaElement.fontFamily) !== normalizeFontFamily(webElement.fontFamily)) {
    hasDifference = true
    issues.push(createIssue('warn', '폰트 패밀리 차이', figmaElement.text, `Figma ${figmaElement.fontFamily} / Web ${webElement.fontFamily}로 다릅니다.`, figmaElement, webElement))
  }

  if (normalizeColor(figmaElement.color) && normalizeColor(webElement.color) && normalizeColor(figmaElement.color) !== normalizeColor(webElement.color)) {
    hasDifference = true
    issues.push(createIssue('warn', '컬러 차이', figmaElement.text, `Figma ${figmaElement.color} / Web ${webElement.color}로 다릅니다.`, figmaElement, webElement))
  }

  if (hasLayoutDifference(figmaElement, webElement)) {
    hasDifference = true
    issues.push(createIssue('warn', '위치/크기 검토 필요', figmaElement.text, `Figma (${formatRect(figmaElement)}) / Web (${formatRect(webElement)}) 배치 차이를 확인하세요.`, figmaElement, webElement))
  }

  if (!hasDifference) {
    issues.push(createIssue('ok', '텍스트와 주요 스타일 일치', figmaElement.text, '문구, 폰트 크기, 폰트 패밀리, 컬러가 기준 범위 안에 있습니다.', figmaElement, webElement))
  }
}

function createIssue(status, label, text, detail, figmaElement, webElement) {
  return {
    status,
    label,
    text: text || '텍스트 없음',
    detail,
    figma: figmaElement ? pickEvidence(figmaElement) : null,
    web: webElement ? pickEvidence(webElement) : null,
  }
}

function createComparisonWaitingIssue(webElementCount) {
  return {
    status: 'warn',
    label: '비교 대기',
    text: 'Figma 기준 없음',
    detail: webElementCount > 0
      ? `웹에서 디자인 요소 ${webElementCount}개를 수집했습니다. Figma JSON을 입력하면 텍스트와 스타일 차이를 비교합니다.`
      : '좌측 패널에서 Figma JSON을 입력하고 URL 검사를 실행하면 Design QA가 생성됩니다.',
    figma: null,
    web: null,
  }
}

function pickEvidence(element) {
  return {
    tag: element.tag,
    fontFamily: element.fontFamily,
    fontStyle: element.fontStyle,
    fontSize: element.fontSize,
    fontWeight: element.fontWeight,
    lineHeight: element.lineHeight,
    letterSpacing: element.letterSpacing,
    color: element.color,
    opacity: element.opacity,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    href: element.href,
  }
}

function getDesignCounts(issues) {
  return issues.reduce(
    (counts, issue) => ({
      ...counts,
      [issue.status]: counts[issue.status] + 1,
    }),
    { ok: 0, warn: 0, error: 0 },
  )
}

function hasLayoutDifference(figmaElement, webElement) {
  return ['x', 'y', 'width', 'height'].some((key) => {
    const figmaValue = toNumber(figmaElement[key])
    const webValue = toNumber(webElement[key])
    return figmaValue !== null && webValue !== null && Math.abs(figmaValue - webValue) > LAYOUT_TOLERANCE
  })
}

function isCtaElement(webElement) {
  return webElement.tag === 'a' || webElement.tag === 'button' || Boolean(webElement.href)
}

function getCtaDetail(webElement) {
  if (webElement.href) return `웹 CTA가 ${webElement.href}로 이동합니다. 기획 의도와 맞는지 확인하세요.`
  return '웹 버튼에 이동 URL이 없습니다. 클릭 액션 기획 확인이 필요합니다.'
}

function normalizeFontFamily(value) {
  return String(value || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase()
}

function normalizeColor(value) {
  const color = String(value || '').trim().toLowerCase()
  const rgbMatch = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (rgbMatch) {
    const hex = `#${toHex(Number(rgbMatch[1]))}${toHex(Number(rgbMatch[2]))}${toHex(Number(rgbMatch[3]))}`
    const alpha = rgbMatch[4] === undefined ? 1 : Number.parseFloat(rgbMatch[4])
    return Number.isFinite(alpha) && alpha < 1 ? `${hex}@${roundNumber(alpha)}` : hex
  }
  return color
}

function toNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number.parseFloat(String(value))
  return Number.isFinite(number) ? number : null
}

function toRgbChannel(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255)
}

function toHex(value) {
  return Math.max(0, Math.min(255, Number(value) || 0)).toString(16).padStart(2, '0')
}

function roundNumber(value) {
  return Math.round(value * 100) / 100
}

function formatSize(value) {
  return `${roundNumber(value)}px`
}

function formatRect(element) {
  return `x ${element.x || '-'}, y ${element.y || '-'}, w ${element.width || '-'}, h ${element.height || '-'}`
}
