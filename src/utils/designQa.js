const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g
const SPECIAL_WHITESPACE = /[\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g
const REPEATED_WHITESPACE = /\s+/g
const PUNCTUATION_VARIANTS = /[.,，。ㆍ·:：;；!！?？"'“”‘’`´\-‐‑‒–—―_/\\()[\]{}<>《》]/g
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

export function compareDesignElements(figmaElements = [], webElements = []) {
  if (figmaElements.length === 0) {
    const issues = [createComparisonWaitingIssue(webElements.length)]

    return createComparisonResult(issues)
  }

  const figmaGroups = groupByText(figmaElements)
  const webGroups = groupByText(webElements)
  const issues = []

  figmaGroups.forEach((figmaGroup, textKey) => {
    const webGroup = webGroups.get(textKey)

    if (!webGroup) {
      figmaGroup.items.forEach((figmaElement) => {
        issues.push(createGroupedIssue({
          status: 'error',
          label: '웹 화면 누락 텍스트',
          text: figmaElement.text,
          detail: 'Figma에는 있지만 웹 화면에서 같은 문구를 찾지 못했습니다.',
          categories: ['text'],
          differences: [createDifference('text', '텍스트 누락', '웹 화면에서 동일 문구를 수집하지 못했습니다.')],
          figmaElement,
          webElement: null,
        }))
      })
      return
    }

    const figmaItems = sortByPosition(figmaGroup.items)
    const webItems = sortByPosition(webGroup.items)
    const pairCount = Math.min(figmaItems.length, webItems.length)

    for (let index = 0; index < pairCount; index += 1) {
      issues.push(compareMatchedElements(figmaItems[index], webItems[index], index))
    }

    figmaItems.slice(pairCount).forEach((figmaElement) => {
      issues.push(createGroupedIssue({
        status: 'error',
        label: '웹 화면 누락 텍스트',
        text: figmaElement.text,
        detail: '같은 문구가 반복되는 Figma 요소 중 일부가 웹 화면에서 매칭되지 않았습니다.',
        categories: ['text'],
        differences: [createDifference('text', '반복 문구 누락', 'Figma 반복 요소에 대응하는 웹 요소가 부족합니다.')],
        figmaElement,
        webElement: null,
      }))
    })

    webItems.slice(pairCount).forEach((webElement) => {
      issues.push(createGroupedIssue({
        status: 'error',
        label: '웹에만 있는 텍스트',
        text: webElement.text,
        detail: '같은 문구가 반복되는 웹 요소 중 일부가 Figma 기준에서 매칭되지 않았습니다.',
        categories: ['text'],
        differences: [createDifference('text', '반복 문구 초과', '웹 반복 요소에 대응하는 Figma 요소가 부족합니다.')],
        figmaElement: null,
        webElement,
      }))
    })
  })

  webGroups.forEach((webGroup, textKey) => {
    if (figmaGroups.has(textKey)) return

    webGroup.items.forEach((webElement) => {
      issues.push(createGroupedIssue({
        status: 'error',
        label: '웹에만 있는 텍스트',
        text: webElement.text,
        detail: '웹 화면에는 있지만 Figma JSON에서 같은 문구를 찾지 못했습니다.',
        categories: ['text'],
        differences: [createDifference('text', 'Figma 기준 누락', 'Figma JSON에서 동일 문구를 수집하지 못했습니다.')],
        figmaElement: null,
        webElement,
      }))
    })
  })

  return createComparisonResult(sortIssuesByPosition(issues))
}

export function normalizeDesignText(value) {
  return cleanText(value)
    .replace(PUNCTUATION_VARIANTS, '')
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

function getFigmaRoots(source) {
  if (!source || typeof source !== 'object') return []

  if (Array.isArray(source)) return source
  if (source.document) return [source.document]
  if (source.nodes && typeof source.nodes === 'object') {
    return Object.values(source.nodes).map((node) => node?.document || node).filter(Boolean)
  }
  if (Array.isArray(source.elements)) return source.elements
  if (Array.isArray(source.children)) return [source]
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
  const rawText = getFigmaNodeText(node)
  const text = cleanText(rawText)
  if (!text) return null

  const style = node.style || {}
  const bounds = node.absoluteBoundingBox || node.absoluteRenderBounds || node.bounds || {}

  return {
    index,
    tag: node.type || node.tag || 'FIGMA',
    text,
    fontFamily: style.fontFamily || node.fontFamily || '',
    fontStyle: style.fontStyle || node.fontStyle || '',
    fontSize: style.fontSize ?? node.fontSize ?? '',
    fontWeight: style.fontWeight ?? node.fontWeight ?? '',
    lineHeight: style.lineHeightPx ?? style.lineHeightPercentFontSize ?? style.lineHeightPercent ?? node.lineHeight ?? '',
    letterSpacing: style.letterSpacing ?? node.letterSpacing ?? '',
    color: getFigmaColor(node.fills) || node.color || '',
    opacity: node.opacity ?? '',
    x: bounds.x ?? node.x ?? '',
    y: bounds.y ?? node.y ?? '',
    width: bounds.width ?? node.width ?? '',
    height: bounds.height ?? node.height ?? '',
    href: '',
  }
}

function getFigmaNodeText(node) {
  if (typeof node.characters === 'string') return node.characters
  if (typeof node.text === 'string') return node.text
  if (typeof node.name === 'string' && (node.type === 'TEXT' || node.fontSize || node.style)) return node.name
  return ''
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

    const group = groups.get(textKey) || { text: cleanText(element.text), items: [] }
    group.items.push({ ...element, text: cleanText(element.text) })
    groups.set(textKey, group)
    return groups
  }, new Map())
}

function compareMatchedElements(figmaElement, webElement, matchIndex) {
  const differences = []
  const styleLabels = []
  const figmaFontSize = toNumber(figmaElement.fontSize)
  const webFontSize = toNumber(webElement.fontSize)

  if (figmaFontSize !== null && webFontSize !== null && Math.abs(figmaFontSize - webFontSize) > 1) {
    styleLabels.push('폰트 크기')
    differences.push(createDifference('style', '폰트 크기', `Figma ${formatSize(figmaFontSize)} / Web ${formatSize(webFontSize)}`))
  }

  const figmaFontFamily = normalizeFontFamily(figmaElement.fontFamily)
  const webFontFamily = normalizeFontFamily(webElement.fontFamily)
  if (figmaFontFamily && webFontFamily && figmaFontFamily !== webFontFamily) {
    styleLabels.push('폰트 패밀리')
    differences.push(createDifference('style', '폰트 패밀리', `Figma ${figmaElement.fontFamily} / Web ${webElement.fontFamily}`))
  }

  const figmaColor = normalizeColor(figmaElement.color)
  const webColor = normalizeColor(webElement.color)
  if (figmaColor && webColor && figmaColor !== webColor) {
    styleLabels.push('컬러')
    differences.push(createDifference('style', '컬러', `Figma ${figmaElement.color} / Web ${webElement.color}`))
  }

  if (hasLayoutDifference(figmaElement, webElement)) {
    differences.push(createDifference('layout', '위치/크기', `Figma (${formatRect(figmaElement)}) / Web (${formatRect(webElement)})`))
  }

  if (isCtaElement(webElement)) {
    differences.push(createDifference('cta', 'CTA 확인', getCtaDetail(webElement)))
  }

  if (differences.length === 0) {
    return createGroupedIssue({
      status: 'ok',
      label: matchIndex > 0 ? '반복 요소 일치' : '텍스트와 주요 스타일 일치',
      text: figmaElement.text,
      detail: '문구, 폰트 크기, 폰트 패밀리, 컬러가 기준 범위 안에 있습니다.',
      categories: [],
      differences: [],
      figmaElement,
      webElement,
    })
  }

  const categories = Array.from(new Set(differences.map((difference) => difference.type)))
  const label = getGroupedLabel(categories, styleLabels)

  return createGroupedIssue({
    status: 'warn',
    label,
    text: figmaElement.text,
    detail: differences.map((difference) => `${difference.label}: ${difference.detail}`).join(' · '),
    categories,
    differences,
    figmaElement,
    webElement,
  })
}

function createGroupedIssue({ status, label, text, detail, categories, differences, figmaElement, webElement }) {
  const primaryElement = figmaElement || webElement
  const sort = getSortPosition(figmaElement, webElement)
  const region = getRegionLabel(primaryElement, sort.y)

  return {
    id: `${status}-${label}-${normalizeDesignText(text)}-${sort.y}-${sort.x}-${figmaElement?.index || 'no-figma'}-${webElement?.index || 'no-web'}`,
    status,
    label,
    text: text || '텍스트 없음',
    detail,
    region,
    categories,
    differences,
    anchor: { x: sort.x, y: sort.y },
    figma: figmaElement ? pickEvidence(figmaElement) : null,
    web: webElement ? pickEvidence(webElement) : null,
  }
}

function createDifference(type, label, detail) {
  return { type, label, detail }
}

function createComparisonWaitingIssue(webElementCount) {
  return createGroupedIssue({
    status: 'warn',
    label: '비교 대기',
    text: 'Figma 기준 없음',
    detail: webElementCount > 0
      ? `웹에서 디자인 요소 ${webElementCount}개를 수집했습니다. Figma JSON을 입력하면 텍스트와 스타일 차이를 비교합니다.`
      : '좌측 패널에서 Figma JSON을 입력하고 URL 검사를 실행하면 시안 비교 QA가 생성됩니다.',
    categories: ['text'],
    differences: [createDifference('text', 'Figma 기준 없음', '비교할 Figma JSON이 아직 없습니다.')],
    figmaElement: null,
    webElement: null,
  })
}

function createComparisonResult(issues) {
  return {
    counts: getDesignCounts(issues),
    summaryCounts: getSummaryCounts(issues),
    issues,
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

function getSummaryCounts(issues) {
  return issues.reduce(
    (counts, issue) => {
      if (issue.status === 'ok') return counts

      return {
        total: counts.total + 1,
        text: counts.text + (issue.categories.includes('text') ? 1 : 0),
        style: counts.style + (issue.categories.includes('style') ? 1 : 0),
        layout: counts.layout + (issue.categories.includes('layout') ? 1 : 0),
        cta: counts.cta + (issue.categories.includes('cta') ? 1 : 0),
      }
    },
    { total: 0, text: 0, style: 0, layout: 0, cta: 0 },
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

function getGroupedLabel(categories, styleLabels) {
  const labels = []
  if (categories.includes('style')) labels.push(styleLabels.length > 0 ? `${styleLabels.join('/')} 차이` : '스타일 차이')
  if (categories.includes('layout')) labels.push('위치/크기 확인 필요')
  if (categories.includes('cta')) labels.push('CTA 확인 필요')
  return labels.join(' + ')
}

function getSortPosition(figmaElement, webElement) {
  const y = firstNumber(figmaElement?.y, webElement?.y)
  const x = firstNumber(figmaElement?.x, webElement?.x)
  return { x: x ?? 0, y: y ?? 0 }
}

function sortByPosition(elements) {
  return [...elements].sort((first, second) => {
    const firstY = toNumber(first.y) ?? Number.MAX_SAFE_INTEGER
    const secondY = toNumber(second.y) ?? Number.MAX_SAFE_INTEGER
    if (firstY !== secondY) return firstY - secondY
    return (toNumber(first.x) ?? Number.MAX_SAFE_INTEGER) - (toNumber(second.x) ?? Number.MAX_SAFE_INTEGER)
  })
}

function sortIssuesByPosition(issues) {
  return [...issues].sort((first, second) => {
    if (first.anchor.y !== second.anchor.y) return first.anchor.y - second.anchor.y
    return first.anchor.x - second.anchor.x
  })
}

function getRegionLabel(element, y) {
  const text = cleanText(element?.text || '')
  if (/hero|kv|히어로|키비주얼/i.test(text)) return 'Hero/KV'
  if (/footer|푸터|disclaimer|유의|고지|약관/i.test(text)) return 'Footer/Disclaimer'
  const sectionMatch = text.match(/(?:section|섹션)\s*([\w가-힣-]+)/i)
  if (sectionMatch) return `섹션 ${sectionMatch[1]}`
  if (y < 700) return 'Hero/KV'
  if (y < 1800) return 'Content Section'
  return 'Footer/Disclaimer'
}

function cleanText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH_CHARS, '')
    .replace(SPECIAL_WHITESPACE, ' ')
    .replace(REPEATED_WHITESPACE, ' ')
    .trim()
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

function firstNumber(...values) {
  for (const value of values) {
    const number = toNumber(value)
    if (number !== null) return number
  }
  return null
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
