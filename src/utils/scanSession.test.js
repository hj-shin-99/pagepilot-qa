import test from 'node:test'
import assert from 'node:assert/strict'
import { WEB_URL_AUTO_CONFIRM_DELAY_MS, confirmWebUrlInput, createDebouncedWebUrlConfirmScheduler, createPublicWebUrlState, createWebUrlInputState, isValidFigmaUrl, isValidHttpUrl, isValidWebUrl, normalizeWebUrlInput, runScanSession } from './scanSession.js'

const REQUIRED_INVALID_WEB_URLS = Object.freeze([
  'www.n',
  'https://www.bm',
  'google',
  'test',
  'abc.',
  'https://',
  'www.',
  'naver',
  'example..com',
  '-example.com',
  'example-.com',
])

const REQUIRED_VALID_WEB_URLS = Object.freeze([
  ['www.naver.com', 'https://www.naver.com'],
  ['naver.com', 'https://naver.com'],
  ['https://www.naver.com', 'https://www.naver.com'],
  ['http://example.co.kr', 'http://example.co.kr'],
  ['sub.example.com/path', 'https://sub.example.com/path'],
  ['https://example.com/path?x=1', 'https://example.com/path?x=1'],
])

test('normalizes common hostnames to https URLs without weakening invalid input', () => {
  assert.equal(normalizeWebUrlInput('www.naver.com'), 'https://www.naver.com')
  assert.equal(normalizeWebUrlInput('naver.com'), 'https://naver.com')
  assert.equal(normalizeWebUrlInput('https://naver.com'), 'https://naver.com')
  assert.equal(normalizeWebUrlInput('http://naver.com'), 'http://naver.com')
  assert.equal(normalizeWebUrlInput('sub.example.co.kr'), 'https://sub.example.co.kr')
  assert.equal(normalizeWebUrlInput('example.com/path?x=1#top'), 'https://example.com/path?x=1#top')
  assert.equal(normalizeWebUrlInput('  www.bmwfs.co.kr  '), 'https://www.bmwfs.co.kr')
  assert.equal(normalizeWebUrlInput('https://https://naver.com'), 'https://https://naver.com')
  assert.equal(normalizeWebUrlInput('www.n'), 'www.n')
  assert.equal(normalizeWebUrlInput('https://www.bm'), 'https://www.bm')
  assert.equal(normalizeWebUrlInput('naver'), 'naver')
  assert.equal(normalizeWebUrlInput('abc.'), 'abc.')
  assert.equal(normalizeWebUrlInput('.com'), '.com')
  assert.equal(normalizeWebUrlInput('www..com'), 'www..com')
  assert.equal(normalizeWebUrlInput('notaurl'), 'notaurl')
  assert.equal(normalizeWebUrlInput('javascript:alert(1)'), 'javascript:alert(1)')
  assert.equal(normalizeWebUrlInput('mailto:test@example.com'), 'mailto:test@example.com')
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('www.naver.com')), true)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('naver.com')), true)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('https://naver.com')), true)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('http://naver.com')), true)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('sub.example.co.kr')), true)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('https://example.com/path?x=1')), true)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('www.n')), false)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('https://www.n')), false)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('https://www.bm')), false)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('naver')), false)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('abc.')), false)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('.com')), false)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('www..com')), false)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('http://')), false)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('www.na ver.com')), false)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('https://https://naver.com')), false)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('notaurl')), false)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('javascript:alert(1)')), false)
  assert.equal(isValidHttpUrl(normalizeWebUrlInput('data:text/html,test')), false)
})

test('rejects incomplete public hostnames', () => {
  for (const value of REQUIRED_INVALID_WEB_URLS) {
    const state = createPublicWebUrlState(value)
    assert.equal(state.isValid, false)
    assert.equal(state.normalizedUrl, '')
    assert.equal(isValidWebUrl(value), false)
  }
})

test('accepts complete public hostnames', () => {
  for (const [value, expectedNormalizedUrl] of REQUIRED_VALID_WEB_URLS) {
    const state = createPublicWebUrlState(value)
    assert.equal(state.isValid, true)
    assert.equal(state.normalizedUrl, expectedNormalizedUrl)
    assert.equal(isValidWebUrl(value), true)
  }
})

test('normalizes required valid inputs and preserves required invalid inputs', () => {
  for (const [value, expectedNormalizedUrl] of REQUIRED_VALID_WEB_URLS) {
    assert.equal(normalizeWebUrlInput(value), expectedNormalizedUrl, value)
  }
  for (const value of REQUIRED_INVALID_WEB_URLS) {
    assert.equal(normalizeWebUrlInput(value), value, value)
  }
})

test('normalizes protocols exactly once for public web URLs', () => {
  assert.equal(normalizeWebUrlInput('naver.com'), 'https://naver.com')
  assert.equal(normalizeWebUrlInput('https://naver.com'), 'https://naver.com')
  assert.equal(normalizeWebUrlInput('http://naver.com'), 'http://naver.com')
  assert.equal(createPublicWebUrlState('naver.com').normalizedCandidate, 'https://naver.com')
  assert.equal(createPublicWebUrlState('https://naver.com').normalizedCandidate, 'https://naver.com')
  assert.equal(createPublicWebUrlState('http://naver.com').normalizedCandidate, 'http://naver.com')
})

test('separates syntactically valid web URL input from confirmed readiness', () => {
  const editingState = createWebUrlInputState('naver.com')
  assert.equal(editingState.isValid, true)
  assert.equal(editingState.isSyntacticallyValid, true)
  assert.equal(editingState.isConfirmed, false)
  assert.equal(editingState.normalizedUrl, 'https://naver.com')

  const confirmedState = createWebUrlInputState('naver.com', { isConfirmed: true })
  assert.equal(confirmedState.isSyntacticallyValid, true)
  assert.equal(confirmedState.isConfirmed, true)

  const invalidConfirmedState = createWebUrlInputState('www.n', { isConfirmed: true })
  assert.equal(invalidConfirmedState.isSyntacticallyValid, false)
  assert.equal(invalidConfirmedState.isConfirmed, false)
})

test('confirms web URL input only when it can normalize to a public URL', () => {
  const confirmedState = confirmWebUrlInput('  www.naver.com  ')
  assert.equal(confirmedState.isValid, true)
  assert.equal(confirmedState.isConfirmed, true)
  assert.equal(confirmedState.normalizedUrl, 'https://www.naver.com')
  assert.equal(confirmedState.inputValue, 'https://www.naver.com')

  const invalidState = confirmWebUrlInput('  www.n  ')
  assert.equal(invalidState.isValid, false)
  assert.equal(invalidState.isConfirmed, false)
  assert.equal(invalidState.normalizedUrl, '')
  assert.equal(invalidState.inputValue, 'www.n')
})

test('auto-confirm scheduler confirms valid URL after debounce with normalized value', () => {
  const timer = createFakeTimer()
  const confirmations = []
  const scheduler = createDebouncedWebUrlConfirmScheduler({
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
    onConfirm: (state) => confirmations.push(state),
  })

  scheduler.schedule('naver.com')
  timer.tick(WEB_URL_AUTO_CONFIRM_DELAY_MS - 1)
  assert.equal(confirmations.length, 0)
  assert.equal(scheduler.hasPending, true)

  timer.tick(1)
  assert.equal(confirmations.length, 1)
  assert.equal(confirmations[0].isConfirmed, true)
  assert.equal(confirmations[0].inputValue, 'https://naver.com')
  assert.equal(scheduler.hasPending, false)
})

test('auto-confirm scheduler keeps the web URL debounce at 800ms', () => {
  const scheduledDelays = []
  const scheduler = createDebouncedWebUrlConfirmScheduler({
    setTimeoutFn: (callback, delay) => {
      scheduledDelays.push(delay)
      return callback
    },
    clearTimeoutFn: () => {},
    onConfirm: () => {},
  })

  assert.equal(WEB_URL_AUTO_CONFIRM_DELAY_MS, 800)
  scheduler.schedule('example.com')
  assert.deepEqual(scheduledDelays, [800])
})

test('auto-confirm scheduler cancels previous debounce when typing continues', () => {
  const timer = createFakeTimer()
  const confirmations = []
  const scheduler = createDebouncedWebUrlConfirmScheduler({
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
    onConfirm: (state) => confirmations.push(state),
  })

  scheduler.schedule('www.na')
  timer.tick(400)
  scheduler.schedule('www.naver.com')
  timer.tick(WEB_URL_AUTO_CONFIRM_DELAY_MS - 1)
  assert.equal(confirmations.length, 0)

  timer.tick(1)
  assert.equal(confirmations.length, 1)
  assert.equal(confirmations[0].isConfirmed, true)
  assert.equal(confirmations[0].inputValue, 'https://www.naver.com')
})

test('auto-confirm scheduler does not confirm incomplete URLs after debounce', () => {
  const timer = createFakeTimer()
  const confirmations = []
  const scheduler = createDebouncedWebUrlConfirmScheduler({
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
    onConfirm: (state) => confirmations.push(state),
  })

  for (const value of ['www.n', 'https://www.bm', 'naver', 'example.']) {
    scheduler.schedule(value)
    timer.tick(WEB_URL_AUTO_CONFIRM_DELAY_MS)
    const state = confirmations.at(-1)
    assert.equal(state.isConfirmed, false, value)
    assert.equal(state.inputValue, value, value)
  }
})

test('auto-confirm scheduler cancel prevents pending confirmation', () => {
  const timer = createFakeTimer()
  const confirmations = []
  const scheduler = createDebouncedWebUrlConfirmScheduler({
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
    onConfirm: (state) => confirmations.push(state),
  })

  scheduler.schedule('example.com')
  assert.equal(scheduler.hasPending, true)
  scheduler.cancel()
  assert.equal(scheduler.hasPending, false)
  timer.tick(WEB_URL_AUTO_CONFIRM_DELAY_MS)
  assert.equal(confirmations.length, 0)
})

test('validates figma URLs by exact figma.com host only', () => {
  assert.equal(isValidFigmaUrl('https://www.figma.com/design/file/page?node-id=1-2'), true)
  assert.equal(isValidFigmaUrl('https://figma.com/file/abc'), true)
  assert.equal(isValidFigmaUrl('http://www.figma.com/design/file/page'), true)
  assert.equal(isValidFigmaUrl('https://evilfigma.com/design/file/page'), false)
  assert.equal(isValidFigmaUrl('https://figma.com.evil.test/design/file/page'), false)
  assert.equal(isValidFigmaUrl('https://example.com/not-figma'), false)
  assert.equal(isValidFigmaUrl('figma.com/design/file/page'), false)
})

test('rejects unsafe protocols, credentials, invalid ports, IP, and localhost', () => {
  for (const value of [
    'https://user:pass@example.com',
    'https://example.com:70000',
    'https://127.0.0.1',
    'http://localhost:3000',
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///tmp/index.html',
    'mailto:test@example.com',
    'tel:01012345678',
    'example .com',
    'example.12',
    'example.c',
    '-example.com',
    'example-.com',
    'https://https://example.com',
  ]) {
    assert.equal(createPublicWebUrlState(value).isValid, false, value)
  }
})

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

function createFakeTimer() {
  let now = 0
  let nextId = 1
  const timers = new Map()

  const setTimeoutFn = (callback, delay) => {
    const id = nextId
    nextId += 1
    timers.set(id, { callback, runAt: now + delay })
    return id
  }

  const clearTimeoutFn = (id) => {
    timers.delete(id)
  }

  const tick = (duration) => {
    now += duration
    while (true) {
      const dueTimer = Array.from(timers.entries())
        .filter(([, timer]) => timer.runAt <= now)
        .sort(([, left], [, right]) => left.runAt - right.runAt)[0]
      if (!dueTimer) return
      const [id, timer] = dueTimer
      timers.delete(id)
      timer.callback()
    }
  }

  return { clearTimeoutFn, setTimeoutFn, tick }
}

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
