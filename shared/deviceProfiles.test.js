import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserContextOptions, createDeviceDescriptor, getDeviceProfiles, normalizeDeviceIds } from './deviceProfiles.js'

test('device model defaults to desktop', () => {
  assert.deepEqual(normalizeDeviceIds(), ['desktop'])
  assert.deepEqual(normalizeDeviceIds([]), ['desktop'])
})

test('device model removes duplicates and invalid ids in canonical order', () => {
  assert.deepEqual(normalizeDeviceIds(['mobile', 'mobile', 'invalid']), ['mobile'])
  assert.deepEqual(normalizeDeviceIds(['mobile', 'desktop', 'tablet']), ['desktop', 'tablet', 'mobile'])
})

test('device model exposes centralized profiles', () => {
  const [desktop, tablet, mobile] = getDeviceProfiles(['desktop', 'tablet', 'mobile'])

  assert.deepEqual(desktop.viewport, { width: 1440, height: 900 })
  assert.equal(desktop.hasTouch, false)
  assert.deepEqual(tablet.viewport, { width: 768, height: 1024 })
  assert.equal(tablet.hasTouch, true)
  assert.deepEqual(mobile.viewport, { width: 390, height: 844 })
  assert.equal(mobile.hasTouch, true)
  assert.equal(mobile.isMobile, true)
})

test('browser context options are derived from the same device profiles', () => {
  assert.deepEqual(createBrowserContextOptions('desktop').viewport, { width: 1440, height: 900 })
  assert.equal(createBrowserContextOptions('tablet').hasTouch, true)
  assert.equal(createBrowserContextOptions('mobile').isMobile, true)
  assert.equal(createDeviceDescriptor('mobile').deviceLabel, 'Mobile')
})
