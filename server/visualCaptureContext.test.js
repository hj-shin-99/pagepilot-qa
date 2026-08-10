import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createBrowserContextOptions } from '../shared/deviceProfiles.js'

test('Visual capture scan keeps design viewport and screenshot scale separate from device profiles', () => {
  const source = fs.readFileSync('server/index.js', 'utf8')
  const helperStart = source.indexOf('function createScanBrowserContextOptions')
  const helperEnd = source.indexOf('function incrementPlaywrightRunCount', helperStart)
  const helperSource = source.slice(helperStart, helperEnd)
  const screenshotStart = source.indexOf('async function safeWebScreenshot')
  const screenshotEnd = source.indexOf('async function safeVisualPayloadData', screenshotStart)
  const screenshotSource = source.slice(screenshotStart, screenshotEnd)

  assert.notEqual(helperStart, -1)
  assert.notEqual(helperEnd, -1)
  assert.equal(source.includes('const DESKTOP_DESIGN_VIEWPORT = { width: 1920, height: 1080 }'), true)
  assert.equal(source.includes('const DESKTOP_SCREENSHOT_SCALE = 2'), true)
  assert.equal(source.includes('browser.newContext(createScanBrowserContextOptions(scanOptions))'), true)
  assert.match(helperSource, /includeVisualPayloadData !== true\) return contextOptions/)
  assert.match(helperSource, /viewport:\s*\{\s*\.\.\.DESKTOP_DESIGN_VIEWPORT\s*\}/)
  assert.match(helperSource, /deviceScaleFactor:\s*DESKTOP_SCREENSHOT_SCALE/)
  assert.match(screenshotSource, /page\.screenshot\(\{\s*fullPage:\s*true,\s*type:\s*'png'\s*\}\)/)
  assert.match(screenshotSource, /width:\s*viewport\.width/)
  assert.match(screenshotSource, /viewport,/)
  assert.match(screenshotSource, /deviceScaleFactor:\s*pageSize\.deviceScaleFactor/)
})

test('Tech QA desktop scan keeps shared Desktop device profile unchanged', () => {
  const desktopContext = createBrowserContextOptions('desktop')

  assert.deepEqual(desktopContext.viewport, { width: 1440, height: 900 })
  assert.equal(desktopContext.deviceScaleFactor, 1)
  assert.equal(desktopContext.isMobile, false)
  assert.equal(desktopContext.hasTouch, false)
})
