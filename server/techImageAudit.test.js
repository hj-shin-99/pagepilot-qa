import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { assertImageAuditSourceSafety, IMAGE_AUDIT_TEST_ONLY, normalizeImageResults } from './techImageAudit.js'

test('image audit keeps healthy loaded image as ok', () => {
  const [item] = normalizeImageResults([candidate()], responseMap({ 'https://example.com/hero.webp': { statusCode: 200, contentType: 'image/webp', contentLength: 120000 } }))

  assert.equal(item.status, 'ok')
})

test('image audit errors on visible image with natural size zero', () => {
  const [item] = normalizeImageResults([candidate({ naturalWidth: 0, naturalHeight: 0, complete: false })], responseMap())

  assert.equal(item.status, 'error')
})

test('image audit errors on 404 and 5xx image responses', () => {
  const [notFound] = normalizeImageResults([candidate({ currentSrc: 'https://example.com/404.webp' })], responseMap({ 'https://example.com/404.webp': { statusCode: 404, contentType: 'image/webp', contentLength: 1 } }))
  const [serverError] = normalizeImageResults([candidate({ currentSrc: 'https://example.com/500.webp' })], responseMap({ 'https://example.com/500.webp': { statusCode: 503, contentType: 'image/webp', contentLength: 1 } }))

  assert.equal(notFound.status, 'error')
  assert.equal(serverError.status, 'error')
})

test('image audit errors when image request returns html mime', () => {
  const [item] = normalizeImageResults([candidate()], responseMap({ 'https://example.com/hero.webp': { statusCode: 200, contentType: 'text/html', contentLength: 1024 } }))

  assert.equal(item.status, 'error')
})

test('image audit excludes offscreen lazy image that is not yet loaded', () => {
  const items = normalizeImageResults([candidate({ loading: 'lazy', visible: false, offscreen: true, naturalWidth: 0, naturalHeight: 0, complete: false })], responseMap())

  assert.equal(items.length, 0)
})

test('phase 3A image fixtures separate broken visible images from decorative and unsupported sizing cases', () => {
  const problem = normalizeImageResults([candidate({ currentSrc: 'https://example.com/broken.webp' })], responseMap({ 'https://example.com/broken.webp': { statusCode: 500, contentType: 'image/webp' } }))[0]
  const review = normalizeImageResults([candidate({ renderedWidth: 320, renderedHeight: 100, naturalWidth: 1200, naturalHeight: 800, objectFit: 'fill' })], responseMap({ 'https://example.com/hero.webp': { statusCode: 200, contentType: 'image/webp' } }))[0]
  const normal = normalizeImageResults([candidate()], responseMap({ 'https://example.com/hero.webp': { statusCode: 200, contentType: 'image/webp' } }))[0]
  const excluded = normalizeImageResults([candidate({ role: 'presentation' })], responseMap())
  const falsePositive = normalizeImageResults([candidate({ sourceType: 'svg-image', currentSrc: 'https://example.com/icon.svg', src: 'https://example.com/icon.svg', naturalWidth: 0, naturalHeight: 0, renderedWidth: 160, renderedHeight: 40, objectFit: 'fill' })], responseMap({ 'https://example.com/icon.svg': { statusCode: 200, contentType: 'image/svg+xml' } }))[0]

  assert.equal(problem.status, 'error')
  assert.equal(review.status, 'warn')
  assert.equal(normal.status, 'ok')
  assert.equal(excluded.length, 0)
  assert.equal(falsePositive.status, 'ok')
})

test('image audit does not overflag aspect ratio under object-fit cover', () => {
  const [item] = normalizeImageResults([candidate({ renderedWidth: 300, renderedHeight: 180, naturalWidth: 1200, naturalHeight: 1200, objectFit: 'cover' })], responseMap({ 'https://example.com/hero.webp': { statusCode: 200, contentType: 'image/webp' } }))

  assert.equal(item.status, 'ok')
})

test('image audit warns on clear aspect distortion', () => {
  const [item] = normalizeImageResults([candidate({ renderedWidth: 320, renderedHeight: 100, naturalWidth: 1200, naturalHeight: 800, objectFit: 'fill' })], responseMap({ 'https://example.com/hero.webp': { statusCode: 200, contentType: 'image/webp' } }))

  assert.equal(item.status, 'warn')
  assert.equal(item.note.includes('비율'), true)
})

test('image audit warns on excessive upscale and oversized source while allowing retina', () => {
  const [upscaled] = normalizeImageResults([candidate({ naturalWidth: 120, naturalHeight: 120, renderedWidth: 300, renderedHeight: 300, clientWidth: 300, clientHeight: 300, devicePixelRatio: 1 })], responseMap({ 'https://example.com/hero.webp': { statusCode: 200, contentType: 'image/webp' } }))
  const [oversized] = normalizeImageResults([candidate({ naturalWidth: 4000, naturalHeight: 3000, renderedWidth: 200, renderedHeight: 150, clientWidth: 200, clientHeight: 150 })], responseMap({ 'https://example.com/hero.webp': { statusCode: 200, contentType: 'image/webp', contentLength: 900000 } }))
  const [retina] = normalizeImageResults([candidate({ naturalWidth: 400, naturalHeight: 400, renderedWidth: 200, renderedHeight: 200, clientWidth: 200, clientHeight: 200, devicePixelRatio: 2 })], responseMap({ 'https://example.com/hero.webp': { statusCode: 200, contentType: 'image/webp' } }))

  assert.equal(upscaled.status, 'warn')
  assert.equal(oversized.status, 'warn')
  assert.equal(retina.status, 'ok')
})

test('image audit skips raster sizing rules for svg data and blob images', () => {
  const [svg] = normalizeImageResults([candidate({ sourceType: 'svg-image', currentSrc: 'https://example.com/logo.svg', src: 'https://example.com/logo.svg', naturalWidth: 0, naturalHeight: 0, renderedWidth: 160, renderedHeight: 40, clientWidth: 160, clientHeight: 40 })], responseMap({ 'https://example.com/logo.svg': { statusCode: 200, contentType: 'image/svg+xml' } }))
  const [dataItem] = normalizeImageResults([candidate({ currentSrc: 'data:image/png;base64,AAAA', src: 'data:image/png;base64,AAAA' })], responseMap())
  const [blobItem] = normalizeImageResults([candidate({ currentSrc: 'blob:https://example.com/123', src: 'blob:https://example.com/123' })], responseMap())

  assert.equal(svg.status, 'ok')
  assert.equal(['ok', 'info'].includes(dataItem.status), true)
  assert.equal(blobItem.status, 'info')
})

test('image audit excludes duplicate carousel items and dedupes identical urls with source count', () => {
  const duplicateItems = normalizeImageResults([
    candidate({ className: 'swiper-slide-duplicate', ancestorClassText: 'swiper swiper-slide-duplicate' }),
  ], responseMap())
  const deduped = normalizeImageResults([
    candidate({ selector: '#hero-a' }),
    candidate({ selector: '#hero-b' }),
  ], responseMap({ 'https://example.com/hero.webp': { statusCode: 200, contentType: 'image/webp' } }))

  assert.equal(duplicateItems.length, 0)
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].sourceCount, 2)
  assert.equal(deduped[0].visibleCount, 2)
})

test('image audit does not create alt-related findings and source stays free of visual imports', () => {
  const [item] = normalizeImageResults([candidate()], responseMap({ 'https://example.com/hero.webp': { statusCode: 200, contentType: 'image/webp' } }))
  const source = fs.readFileSync(new URL('./techImageAudit.js', import.meta.url), 'utf8')

  assert.equal(item.note.includes('alt'), false)
  assert.equal(assertImageAuditSourceSafety(), true)
  assert.equal(/from '\.\/visual|from "\.\/visual|Visual QA|OpenAI Vision/i.test(source), false)
})

test('image audit helper meta reports no target safely', () => {
  const meta = IMAGE_AUDIT_TEST_ONLY.createImageAuditMeta([], { candidateCount: 0, noTarget: true })

  assert.equal(meta.noTarget, true)
  assert.equal(meta.candidateCount, 0)
})

function candidate(overrides = {}) {
  return {
    label: 'hero.webp',
    sourceType: 'img',
    src: 'https://example.com/hero.webp',
    currentSrc: 'https://example.com/hero.webp',
    srcset: '',
    loading: 'eager',
    complete: true,
    naturalWidth: 1200,
    naturalHeight: 800,
    clientWidth: 300,
    clientHeight: 200,
    renderedWidth: 300,
    renderedHeight: 200,
    objectFit: 'fill',
    visibility: 'visible',
    display: 'block',
    visible: true,
    offscreen: false,
    hidden: false,
    ariaHidden: false,
    insideClosedDialog: false,
    altCategory: 'meaningful-image',
    className: 'hero-image',
    ancestorClassText: 'hero banner',
    selector: '#hero-image',
    section: 'top',
    devicePixelRatio: 1,
    ...overrides,
  }
}

function responseMap(entries = {}) {
  return new Map(Object.entries(entries))
}
