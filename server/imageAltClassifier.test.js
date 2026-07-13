import test from 'node:test'
import assert from 'node:assert/strict'
import { applyImageAltClassifications, classifyImageAlt } from './imageAltClassifier.js'

const VIEWPORT = { width: 1920, height: 1080 }

test('duplicate carousel image is excluded from alt warning', () => {
  const result = classifyImageAlt(createImage({ ancestorClassText: 'swiper-slide swiper-slide-duplicate' }))
  assert.equal(result.category, 'excluded-image')
})

test('fully offscreen inactive carousel image is excluded from alt warning', () => {
  const result = classifyImageAlt(createImage({ boundingBox: { x: 2919, y: 0, width: 800, height: 400 }, ancestorClassText: 'swiper-slide carousel-item' }))
  assert.equal(result.category, 'excluded-image')
  assert.equal(result.reason, 'offscreen-inactive-carousel-slide')
})

test('active slide image with missing alt remains meaningful warning candidate', () => {
  const result = classifyImageAlt(createImage({ ancestorClassText: 'swiper-slide swiper-slide-active' }))
  assert.equal(result.category, 'meaningful-image')
})

test('partly visible next slide remains meaningful when user can see it', () => {
  const result = classifyImageAlt(createImage({ boundingBox: { x: 1800, y: 0, width: 500, height: 400 }, ancestorClassText: 'swiper-slide swiper-slide-next' }))
  assert.equal(result.category, 'meaningful-image')
  assert.equal(result.reason, 'visible-adjacent-carousel-slide')
})

test('non-carousel content image without alt remains meaningful warning candidate', () => {
  const result = classifyImageAlt(createImage({ ancestorClassText: 'content-card image-wrapper' }))
  assert.equal(result.category, 'meaningful-image')
})

test('decorative icon is not an alt warning candidate', () => {
  const result = classifyImageAlt(createImage({ src: 'https://example.com/assets/icon-search.svg', boundingBox: { x: 10, y: 10, width: 18, height: 18 } }))
  assert.equal(result.category, 'decorative-image')
})

test('missingAltImages contains only meaningful images without alt', () => {
  const snapshot = applyImageAltClassifications({
    images: [
      createImage({ index: 1, ancestorClassText: 'swiper-slide swiper-slide-duplicate' }),
      createImage({ index: 2, ancestorClassText: 'swiper-slide swiper-slide-active' }),
      createImage({ index: 3, src: '/icon.png', boundingBox: { x: 1, y: 1, width: 16, height: 16 } }),
      createImage({ index: 4, alt: 'Hero', ancestorClassText: 'content-card' }),
    ],
  })

  assert.deepEqual(snapshot.missingAltImages.map((image) => image.index), [2])
})

function createImage(overrides = {}) {
  return {
    index: 1,
    src: 'https://example.com/image.png',
    alt: '',
    role: '',
    className: '',
    ancestorClassText: '',
    hasAriaHiddenAncestor: false,
    visible: true,
    viewport: VIEWPORT,
    naturalWidth: 1200,
    naturalHeight: 800,
    boundingBox: { x: 100, y: 100, width: 800, height: 400 },
    ...overrides,
  }
}
