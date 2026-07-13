import test from 'node:test'
import assert from 'node:assert/strict'
import { runScanSession } from './scanSession.js'

test('web URL only calls tech scan once and skips visual', async () => {
  const calls = { tech: 0, visual: 0 }
  const session = await runScanSession({
    webUrl: 'https://example.com',
    figmaUrl: '',
    runTech: async () => {
      calls.tech += 1
      return { targetUrl: 'https://example.com' }
    },
    runVisual: async () => {
      calls.visual += 1
      return {}
    },
  })

  assert.equal(calls.tech, 1)
  assert.equal(calls.visual, 0)
  assert.equal(session.tech.status, 'success')
  assert.equal(session.visual.status, 'skipped')
  assert.equal(session.activeTab, 'tech')
})

test('web and figma URLs call both scans once independently', async () => {
  const calls = []
  let releaseTech
  const techPromise = new Promise((resolve) => { releaseTech = () => resolve({ targetUrl: 'https://example.com' }) })
  const sessionPromise = runScanSession({
    webUrl: 'https://example.com',
    figmaUrl: 'https://www.figma.com/design/file/page?node-id=1-2',
    runTech: () => {
      calls.push('tech')
      return techPromise
    },
    runVisual: async () => {
      calls.push('visual')
      return { meta: { webUrl: 'https://example.com' } }
    },
  })

  await Promise.resolve()
  assert.deepEqual(calls.sort(), ['tech', 'visual'])
  releaseTech()
  const session = await sessionPromise
  assert.equal(session.tech.status, 'success')
  assert.equal(session.visual.status, 'success')
  assert.equal(session.activeTab, 'visual')
  assert.equal(session.shouldSaveCombined, true)
})

test('visual failure keeps tech success', async () => {
  const session = await runScanSession({
    webUrl: 'https://example.com',
    figmaUrl: 'https://www.figma.com/design/file/page?node-id=1-2',
    runTech: async () => ({ targetUrl: 'https://example.com' }),
    runVisual: async () => { throw new Error('visual failed') },
  })

  assert.equal(session.tech.status, 'success')
  assert.equal(session.visual.status, 'error')
  assert.equal(session.visual.error, 'visual failed')
})

test('tech failure keeps visual success', async () => {
  const session = await runScanSession({
    webUrl: 'https://example.com',
    figmaUrl: 'https://www.figma.com/design/file/page?node-id=1-2',
    runTech: async () => { throw new Error('tech failed') },
    runVisual: async () => ({ meta: { webUrl: 'https://example.com' } }),
  })

  assert.equal(session.tech.status, 'error')
  assert.equal(session.tech.error, 'tech failed')
  assert.equal(session.visual.status, 'success')
})

test('invalid figma URL does not block tech scan', async () => {
  const calls = { tech: 0, visual: 0 }
  const session = await runScanSession({
    webUrl: 'https://example.com',
    figmaUrl: 'https://example.com/not-figma',
    runTech: async () => {
      calls.tech += 1
      return { targetUrl: 'https://example.com' }
    },
    runVisual: async () => {
      calls.visual += 1
      return {}
    },
  })

  assert.equal(calls.tech, 1)
  assert.equal(calls.visual, 0)
  assert.equal(session.tech.status, 'success')
  assert.equal(session.visual.status, 'error')
  assert.equal(session.figmaError, 'Figma Frame URL 형식을 확인해 주세요.')
})

test('invalid web URL calls no API', async () => {
  const calls = { tech: 0, visual: 0 }
  const session = await runScanSession({
    webUrl: 'notaurl',
    figmaUrl: 'https://www.figma.com/design/file/page?node-id=1-2',
    runTech: async () => { calls.tech += 1 },
    runVisual: async () => { calls.visual += 1 },
  })

  assert.equal(calls.tech, 0)
  assert.equal(calls.visual, 0)
  assert.equal(session.inputError, 'http:// 또는 https://로 시작하는 Web URL을 입력해 주세요.')
})
