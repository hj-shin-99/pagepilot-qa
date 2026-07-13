const DECORATIVE_SOURCE_PATTERN = /sprite|icon|spacer|blank|transparent|pixel|logo-[0-9]+x[0-9]+/i
const CAROUSEL_PATTERN = /swiper|carousel|slider|slide|splide|slick|flickity|glide/i
const DUPLICATE_PATTERN = /swiper-slide-duplicate|duplicate-prev|duplicate-next|\bduplicate\b|cloned|clone/i
const ACTIVE_PATTERN = /\bactive\b|\bcurrent\b|\bselected\b|is-active|is-current|slick-current|swiper-slide-active/i
const ADJACENT_PATTERN = /\bnext\b|\bprev\b|slick-active|swiper-slide-next|swiper-slide-prev/i

export function classifyImageAlt(image = {}) {
  const box = image.boundingBox || {}
  const viewport = image.viewport || {}
  const text = createSearchText(image)
  const role = normalizeString(image.role).toLowerCase()

  if (image.visible === false || !hasVisibleBox(box)) {
    return { category: 'excluded-image', reason: 'hidden-or-zero-size' }
  }

  if (image.hasAriaHiddenAncestor === true || image.ariaHidden === true) {
    return { category: 'excluded-image', reason: 'aria-hidden' }
  }

  if (DUPLICATE_PATTERN.test(text)) {
    return { category: 'excluded-image', reason: 'duplicate-carousel-slide' }
  }

  if (role === 'presentation' || role === 'none') {
    return { category: 'decorative-image', reason: 'presentational-role' }
  }

  const hasCarouselAncestor = CAROUSEL_PATTERN.test(text)
  const isActiveOrCurrent = ACTIVE_PATTERN.test(text) || image.isActiveSlide === true
  const isAdjacentSlide = ADJACENT_PATTERN.test(text)
  const intersectsViewport = intersectsHorizontalViewport(box, viewport)

  if (hasCarouselAncestor && !isActiveOrCurrent && !intersectsViewport) {
    return { category: 'excluded-image', reason: 'offscreen-inactive-carousel-slide' }
  }

  if (hasCarouselAncestor && isAdjacentSlide && intersectsViewport) {
    return { category: 'meaningful-image', reason: 'visible-adjacent-carousel-slide' }
  }

  const alt = normalizeString(image.alt)
  if (alt) return { category: 'meaningful-image', reason: 'has-alt' }

  if (normalizeString(image.interactiveAncestorLabel)) {
    return { category: 'decorative-image', reason: 'labeled-interactive-icon' }
  }

  if (normalizeString(image.figureCaption)) {
    return { category: 'meaningful-image', reason: 'figure-caption' }
  }

  const width = Number(box.width || image.naturalWidth || 0)
  const height = Number(box.height || image.naturalHeight || 0)
  if (width <= 24 && height <= 24) {
    return { category: 'decorative-image', reason: 'small-icon' }
  }

  if (DECORATIVE_SOURCE_PATTERN.test(normalizeString(image.src))) {
    return { category: 'decorative-image', reason: 'decorative-source-name' }
  }

  return { category: 'meaningful-image', reason: isActiveOrCurrent ? 'active-carousel-content-image' : 'visible-content-image' }
}

export function applyImageAltClassifications(snapshot = {}) {
  const images = Array.isArray(snapshot.images)
    ? snapshot.images.map((image) => {
        const classification = classifyImageAlt(image)
        return {
          ...image,
          altCategory: classification.category,
          altReason: classification.reason,
        }
      })
    : []

  return {
    ...snapshot,
    images,
    missingAltImages: images
      .filter((image) => image.altCategory === 'meaningful-image' && !normalizeString(image.alt))
      .slice(0, 30),
  }
}

function createSearchText(image) {
  return [
    image.className,
    image.ancestorClassText,
    image.selector,
    image.domPath,
    image.carouselState,
  ].map(normalizeString).join(' ')
}

function intersectsHorizontalViewport(box = {}, viewport = {}) {
  const viewportWidth = Number(viewport.width || viewport.viewportWidth || 0)
  if (!viewportWidth) return true

  const x = Number(box.x || 0)
  const width = Number(box.width || 0)
  return x < viewportWidth && x + width > 0
}

function hasVisibleBox(box = {}) {
  return Number(box.width) > 0 && Number(box.height) > 0
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}
