const INTERACTIVE_SELECTOR = 'a, button, [role="button"], input[type="button"], input[type="submit"]'

export async function extractVisibleWebTextElements(page) {
  const payload = await page.evaluate(({ interactiveSelector }) => {
    const pageBounds = getPageBounds()
    const elementsByKey = new Map()

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT

        const parent = node.parentElement
        if (!parent || isIgnoredTag(parent.tagName)) return NodeFilter.FILTER_REJECT
        if (!isVisibleElement(parent)) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })

    while (walker.nextNode()) {
      const node = walker.currentNode
      const anchor = getTextAnchor(node.parentElement)
      if (!anchor || !isVisibleElement(anchor)) continue
      addCandidateElement(elementsByKey, anchor)
    }

    document.querySelectorAll(`${interactiveSelector}, input:not([type="hidden"]), textarea, select, label`).forEach((element) => {
      if (!isVisibleElement(element)) return
      if (!hasRenderableControlText(element)) return
      addCandidateElement(elementsByKey, element)
    })

    const sortedElements = Array.from(elementsByKey.values())
      .map((element) => createRawWebTextElement(element, pageBounds))
      .filter(Boolean)
      .sort((first, second) => {
        if (first.absoluteBoundingBox.y !== second.absoluteBoundingBox.y) {
          return first.absoluteBoundingBox.y - second.absoluteBoundingBox.y
        }
        if (first.absoluteBoundingBox.x !== second.absoluteBoundingBox.x) {
          return first.absoluteBoundingBox.x - second.absoluteBoundingBox.x
        }
        return first.depth - second.depth
      })
      .map((entry, index) => ({
        id: `web-text-${index + 1}`,
        ...entry,
      }))

    return {
      pageBounds,
      textElements: sortedElements,
    }

    function addCandidateElement(elementsMap, element) {
      const key = getElementKey(element)
      if (!key || elementsMap.has(key)) return
      elementsMap.set(key, element)
    }

    function createRawWebTextElement(element, bounds) {
      const absoluteBoundingBox = getPageRect(element)
      if (!absoluteBoundingBox) return null

      const rawText = getRawElementText(element)
      const text = collapseWhitespace(rawText)
      if (!text) return null

      const styles = window.getComputedStyle(element)
      const tagName = element.tagName.toLowerCase()
      const parent = element.parentElement
      const relativeBoundingBox = {
        x: absoluteBoundingBox.x,
        y: absoluteBoundingBox.y,
        width: absoluteBoundingBox.width,
        height: absoluteBoundingBox.height,
      }

      return {
        text,
        rawText,
        normalizedText: normalizeTextForSnapshot(text),
        tagName,
        ariaRole: collapseWhitespace(element.getAttribute('role') || '') || null,
        href: getElementHref(element),
        visible: true,
        selector: getCssSelector(element),
        domPath: getElementPath(element),
        parentSelector: parent ? getCssSelector(parent) : null,
        parentTagName: parent?.tagName ? parent.tagName.toLowerCase() : null,
        sectionHint: inferSectionHint(element, absoluteBoundingBox, bounds),
        absoluteBoundingBox,
        relativeBoundingBox,
        xRatio: getRatio(relativeBoundingBox.x, bounds.width),
        yRatio: getRatio(relativeBoundingBox.y, bounds.height),
        widthRatio: getRatio(relativeBoundingBox.width, bounds.width),
        heightRatio: getRatio(relativeBoundingBox.height, bounds.height),
        fontSize: normalizePixelValue(styles.fontSize),
        fontWeight: normalizeNumericValue(styles.fontWeight),
        textAlign: collapseWhitespace(styles.textAlign) || null,
        depth: getElementDepth(element),
        siblingIndex: getSiblingIndex(element),
      }
    }

    function hasRenderableControlText(element) {
      return Boolean(collapseWhitespace(getRawElementText(element)))
    }

    function getRawElementText(element) {
      const tagName = element.tagName?.toLowerCase() || ''
      if (tagName === 'input') {
        return element.value || element.getAttribute('value') || element.getAttribute('placeholder') || element.getAttribute('aria-label') || ''
      }
      if (tagName === 'textarea') {
        return element.value || element.getAttribute('placeholder') || element.textContent || ''
      }
      if (tagName === 'select') {
        return element.selectedOptions?.[0]?.textContent || element.value || ''
      }

      return element.innerText || element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || ''
    }

    function getTextAnchor(element) {
      if (!element) return null

      const primaryAnchor = element.closest('a, button, [role="button"], input, textarea, select, h1, h2, h3, h4, h5, h6, p, li, td, th, label, dt, dd, blockquote, figcaption')
      if (primaryAnchor && isVisibleElement(primaryAnchor)) return primaryAnchor

      const secondaryAnchor = element.closest('span, strong, em, small, b, i')
      if (secondaryAnchor && isVisibleElement(secondaryAnchor)) return secondaryAnchor

      return element
    }

    function isVisibleElement(element) {
      if (!element) return false
      if (element.closest('[hidden], [aria-hidden="true"], script, style, noscript, template')) return false

      const styles = window.getComputedStyle(element)
      if (styles.display === 'none' || styles.visibility === 'hidden') return false
      if (Number.parseFloat(styles.opacity || '1') === 0) return false

      return hasVisibleRect(element.getBoundingClientRect())
    }

    function hasVisibleRect(rect) {
      return Boolean(rect && rect.width > 0 && rect.height > 0)
    }

    function isIgnoredTag(tagName) {
      return ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(String(tagName || '').toUpperCase())
    }

    function getPageBounds() {
      return {
        width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0, window.innerWidth, 1),
        height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, window.innerHeight, 1),
      }
    }

    function getPageRect(element) {
      const rect = element?.getBoundingClientRect()
      if (!hasVisibleRect(rect)) return null

      return {
        x: roundNumber(rect.x + window.scrollX),
        y: roundNumber(rect.y + window.scrollY),
        width: roundNumber(rect.width),
        height: roundNumber(rect.height),
      }
    }

    function inferSectionHint(element, rect, bounds) {
      const searchable = getSearchableContext(element)
      if (/nav|navigation|gnb|menu|header/.test(searchable)) return 'navigation'
      if (/footer/.test(searchable)) return 'footer'
      if (/legal|copyright|terms|privacy|cookie|disclaimer|약관|개인정보|유의사항/.test(searchable)) return 'legal'
      if (/hero|kv|banner/.test(searchable)) return 'hero'
      if (/dialog|modal|popup/.test(searchable)) return 'overlay'
      if (/table|thead|tbody|tr|td|th/.test(searchable)) return 'table'

      const ratio = getRatio(rect?.y ?? 0, bounds.height)
      if (ratio === null) return 'unknown'
      if (ratio < 0.33) return 'top'
      if (ratio < 0.66) return 'middle'
      return 'bottom'
    }

    function getSearchableContext(element) {
      const tagPath = []
      let current = element
      let depth = 0

      while (current && current !== document.body && depth < 6) {
        const tagName = current.tagName?.toLowerCase() || ''
        const id = current.id ? `#${current.id}` : ''
        const classNames = current.classList?.length ? `.${Array.from(current.classList).slice(0, 3).join('.')}` : ''
        const role = current.getAttribute?.('role') || ''
        tagPath.unshift(`${tagName}${id}${classNames} ${role}`.trim())
        current = current.parentElement
        depth += 1
      }

      return tagPath.join(' ').toLowerCase()
    }

    function getElementHref(element) {
      const tagName = element.tagName?.toLowerCase() || ''
      if (tagName === 'a') return element.href || element.getAttribute('href') || null
      if (tagName === 'button' || element.getAttribute('role') === 'button') {
        return element.getAttribute('href') || element.getAttribute('data-href') || element.getAttribute('data-url') || element.getAttribute('formaction') || null
      }
      return null
    }

    function getCssSelector(element) {
      if (!element || !element.tagName) return ''
      if (element.id) return `#${cssEscape(element.id)}`

      const parts = []
      let current = element
      let depth = 0
      while (current && current !== document.body && depth < 6) {
        const tagName = current.tagName.toLowerCase()
        const classNames = Array.from(current.classList || [])
          .slice(0, 2)
          .map((className) => `.${cssEscape(className)}`)
          .join('')
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName)
          : []
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''
        parts.unshift(`${tagName}${classNames}${nth}`)
        current = current.parentElement
        depth += 1
      }
      return parts.join(' > ')
    }

    function getElementPath(element) {
      if (!element) return ''

      const parts = []
      let current = element
      let depth = 0
      while (current && current !== document.body && depth < 6) {
        const tagName = current.tagName.toLowerCase()
        const idPart = current.id ? `#${current.id}` : ''
        const classPart = current.classList.length > 0
          ? `.${Array.from(current.classList).slice(0, 2).join('.')}`
          : ''
        parts.unshift(`${tagName}${idPart}${classPart}`)
        current = current.parentElement
        depth += 1
      }
      return parts.join(' > ')
    }

    function getElementDepth(element) {
      let depth = 0
      let current = element
      while (current && current !== document.body) {
        depth += 1
        current = current.parentElement
      }
      return depth
    }

    function getSiblingIndex(element) {
      if (!element?.parentElement) return 0
      return Array.from(element.parentElement.children).indexOf(element)
    }

    function getElementKey(element) {
      if (!element) return ''
      if (element.dataset.pagepilotWebTextKey) return element.dataset.pagepilotWebTextKey

      const selector = getCssSelector(element)
      const key = selector || `${element.tagName.toLowerCase()}-${Math.random().toString(36).slice(2, 10)}`
      element.dataset.pagepilotWebTextKey = key
      return key
    }

    function normalizeTextForSnapshot(value) {
      return collapseWhitespace(value)
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[\u00a0\s]+/g, ' ')
        .trim()
    }

    function collapseWhitespace(value) {
      return String(value || '').replace(/\s+/g, ' ').trim()
    }

    function getRatio(value, total) {
      if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null
      return roundNumber(value / total)
    }

    function normalizePixelValue(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return roundNumber(value)
      const match = String(value || '').trim().match(/^(-?\d+(?:\.\d+)?)px$/i)
      return match ? roundNumber(Number(match[1])) : null
    }

    function normalizeNumericValue(value) {
      const numeric = Number(value)
      return Number.isFinite(numeric) ? roundNumber(numeric) : null
    }

    function roundNumber(value) {
      return Math.round(value * 1000000) / 1000000
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    }
  }, { interactiveSelector: INTERACTIVE_SELECTOR })

  return {
    pageBounds: payload.pageBounds,
    textElements: payload.textElements.map(normalizeWebTextElement),
  }
}

export function normalizeWebTextElement(element) {
  return {
    ...element,
    role: inferWebTextRole(element),
  }
}

export function inferWebTextRole(element) {
  const text = String(element?.text || element?.rawText || '')
  const tagName = String(element?.tagName || '').toLowerCase()
  const ariaRole = String(element?.ariaRole || '').toLowerCase()
  const selector = `${element?.selector || ''} ${element?.domPath || ''} ${element?.sectionHint || ''}`.toLowerCase()

  if (ariaRole === 'heading' || /^h[1-6]$/.test(tagName)) return 'heading'
  if (tagName === 'label' || ariaRole === 'label') return 'label'
  if (tagName === 'td' || tagName === 'th' || /table/.test(selector)) return 'table'
  if (tagName === 'a' || tagName === 'button' || ariaRole === 'button' || looksLikeCtaText(text)) return 'cta'
  if (/navigation|nav|gnb|menu|header/.test(selector)) return 'navigation'
  if (looksLikePriceText(text)) return 'price'
  if (looksLikeDateText(text)) return 'date'
  if (/legal|copyright|terms|privacy|cookie|disclaimer|footer|약관|개인정보|유의사항|대표자|사업자/.test(selector) || looksLikeLegalText(text)) return 'legal'
  if (text.length > 0 && text.length <= 24 && /:$/.test(text)) return 'label'
  if (text.length > 0) return tagName === 'span' && Number(element?.fontWeight || 0) >= 600 ? 'heading' : 'body'
  return 'unknown'
}

function looksLikeCtaText(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!value || value.length > 24) return false
  return /신청|예약|상담|자세히|더\s*보기|구매|시작|문의|바로가기|확인|submit|apply|learn more|start/i.test(value)
}

function looksLikePriceText(text) {
  return /(?:₩|\$|€|¥|원|만원|krw|usd|eur|jpy|%|연\s*\d)/i.test(String(text || '')) && /\d/.test(String(text || ''))
}

function looksLikeDateText(text) {
  return /(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}|\d+\s*(일|개월|년|월))/i.test(String(text || ''))
}

function looksLikeLegalText(text) {
  const value = String(text || '')
  return value.length >= 40 && /약관|유의사항|개인정보|법적|고지|면책|동의|copyright|all rights reserved/i.test(value)
}
