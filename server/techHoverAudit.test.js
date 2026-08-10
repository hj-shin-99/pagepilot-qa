import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { classifyHoverObservation, dedupeHoverCandidates, HOVER_AUDIT_TEST_ONLY } from './techHoverAudit.js'

let browser

before(async () => {
  browser = await chromium.launch({ headless: true })
})

after(async () => {
  await browser?.close().catch(() => {})
})

test('hover audit classifies submenu or dropdown reveal as ok', () => {
  const item = classifyHoverObservation(candidate({ kindHint: 'dropdown' }), { changed: true, restored: true, kind: 'dropdown' })

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'dropdown')
})

test('hover audit treats reset matching original state as restored', () => {
  const observation = HOVER_AUDIT_TEST_ONLY.createHoverObservationFromStates(
    { panelVisible: false, tooltipVisible: false, menuVisible: false, ariaExpanded: 'false' },
    { panelVisible: true, tooltipVisible: false, menuVisible: true, ariaExpanded: 'true' },
    { panelVisible: false, tooltipVisible: false, menuVisible: false, ariaExpanded: 'false' },
  )

  assert.equal(observation.changed, true)
  assert.equal(observation.restored, true)
})

test('hover audit classifies tooltip reveal as ok', () => {
  const item = classifyHoverObservation(candidate({ kindHint: 'tooltip' }), { changed: true, restored: true, kind: 'tooltip' })

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'tooltip')
})

test('hover audit warns when there is no visible hover change', () => {
  const item = classifyHoverObservation(candidate(), { changed: false, restored: true })

  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'no-change')
})

test('hover audit warns when panel is clipped outside the viewport', () => {
  const item = classifyHoverObservation(candidate(), { changed: true, clipped: true, restored: true })

  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'clipped')
})

test('hover audit does not promote blocked pointer targets or automation failures to errors', () => {
  const blocked = classifyHoverObservation(candidate(), { blocked: true, hitTargetSelector: '#overlay' })
  const automation = classifyHoverObservation(candidate(), { automationError: 'locator.hover: Timeout 5000ms exceeded', actionFailureReason: 'timeout' })
  const errored = classifyHoverObservation(candidate(), { changed: true, restored: true, consoleErrorCount: 1 })

  assert.equal(blocked.status, 'warn')
  assert.equal(blocked.category, 'blocked')
  assert.equal(automation.status, 'warn')
  assert.equal(automation.category, 'automation-runtime')
  assert.equal(automation.automationError.includes('Timeout 5000ms exceeded'), true)
  assert.equal(automation.actionFailureReason, 'timeout')
  assert.equal(errored.status, 'error')
})

test('hover audit dedupes repeated candidate selectors', () => {
  const deduped = dedupeHoverCandidates([
    candidate({ selector: '#menu', panelSelector: '#submenu' }),
    candidate({ selector: '#menu', panelSelector: '#submenu' }),
    candidate({ selector: '#tooltip', panelSelector: '', kindHint: 'tooltip' }),
  ])

  assert.equal(deduped.length, 2)
})

test('hover audit meta reports no target safely', () => {
  const meta = HOVER_AUDIT_TEST_ONLY.createHoverAuditMeta([], { candidateCount: 0, noTarget: true })

  assert.equal(meta.noTarget, true)
  assert.equal(meta.candidateCount, 0)
})

test('hover audit phase 3-b fixtures cover status boundaries and native tooltip false positive', () => {
  const problem = classifyHoverObservation(candidate(), { changed: true, restored: true, consoleErrorCount: 1 })
  const review = classifyHoverObservation(candidate(), { changed: false, restored: true })
  const normal = classifyHoverObservation(candidate({ kindHint: 'dropdown' }), { changed: true, restored: true, kind: 'dropdown' })
  const notApplicable = HOVER_AUDIT_TEST_ONLY.createHoverAuditMeta([], { candidateCount: 0, noTarget: true })
  const previousFalsePositive = classifyHoverObservation(candidate({ kindHint: 'tooltip', panelSelector: '', titleAttr: 'More information' }), { changed: false, restored: true, kind: 'tooltip' })

  assert.equal(problem.status, 'error')
  assert.equal(review.status, 'warn')
  assert.equal(normal.status, 'ok')
  assert.equal(notApplicable.noTarget, true)
  assert.equal(previousFalsePositive.status, 'info')
  assert.equal(previousFalsePositive.category, 'native-tooltip')
})

test('hover audit uses semantically related hit target fallback instead of immediate error', async () => {
  const item = await inspectHtml(`
    <style>
      li { position: relative; width: 140px; height: 44px; list-style: none; }
      #candidate, #hit { position: absolute; inset: 0; display: block; }
      #candidate { z-index: 1; }
      #hit { z-index: 2; }
      #panel[hidden] { display: none; }
    </style>
    <nav>
      <ul>
        <li>
          <button id="candidate" aria-label="Products menu" aria-expanded="false" aria-controls="panel">Products menu</button>
          <a id="hit" href="#" aria-label="Products">Products</a>
        </li>
      </ul>
    </nav>
    <div id="panel" hidden>Panel</div>
    <script>
      document.querySelector('#hit').addEventListener('mouseenter', () => {
        document.querySelector('#candidate').setAttribute('aria-expanded', 'true')
        document.querySelector('#panel').hidden = false
      })
      document.querySelector('#hit').addEventListener('mouseleave', () => {
        document.querySelector('#candidate').setAttribute('aria-expanded', 'false')
        document.querySelector('#panel').hidden = true
      })
    </script>
  `)

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'dropdown')
  assert.equal(item.hoverSelector, '#hit')
  assert.equal(item.hitTargetSelector, '#hit')
  assert.equal(item.hitTargetRelation, 'semantic-fallback')
})

test('hover audit does not fallback to an unrelated overlay hit target', async () => {
  const item = await inspectHtml(`
    <style>
      li { position: relative; width: 140px; height: 44px; list-style: none; }
      #candidate, #overlay { position: absolute; inset: 0; display: block; }
      #candidate { z-index: 1; }
      #overlay { z-index: 2; }
      #panel[hidden] { display: none; }
    </style>
    <nav>
      <ul>
        <li>
          <button id="candidate" aria-label="Products menu" aria-expanded="false" aria-controls="panel">Products menu</button>
          <a id="overlay" href="#" aria-label="Unrelated">Unrelated</a>
        </li>
      </ul>
    </nav>
    <div id="panel" hidden>Panel</div>
    <script>
      document.querySelector('#overlay').addEventListener('mouseenter', () => {
        document.querySelector('#panel').hidden = false
      })
    </script>
  `)

  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'blocked')
  assert.equal(item.hitTargetSelector, '#overlay')
  assert.equal(item.hoverSelector, undefined)
})

test('hover audit preserves raw automation reason when hover action throws', () => {
  const item = classifyHoverObservation(candidate(), {
    automationError: 'locator.hover: Timeout 5000ms exceeded\nCall log:\n  - retrying hover action',
    actionFailureReason: 'timeout',
  })

  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'automation-runtime')
  assert.equal(item.automationError.includes('locator.hover: Timeout 5000ms exceeded'), true)
  assert.equal(item.actionFailureReason, 'timeout')
})

test('hover audit keeps successful aria-expanded or panel visibility change as ok', async () => {
  const item = await inspectHtml(`
    <button id="candidate" aria-expanded="false" aria-controls="panel">Open</button>
    <div id="panel" hidden>Panel</div>
    <script>
      document.querySelector('#candidate').addEventListener('mouseenter', () => {
        document.querySelector('#candidate').setAttribute('aria-expanded', 'true')
        document.querySelector('#panel').hidden = false
      })
      document.querySelector('#candidate').addEventListener('mouseleave', () => {
        document.querySelector('#candidate').setAttribute('aria-expanded', 'false')
        document.querySelector('#panel').hidden = true
      })
    </script>
  `)

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'dropdown')
})

test('hover audit keeps successful hover with no state change as review', async () => {
  const item = await inspectHtml(`
    <button id="candidate" aria-expanded="false" aria-controls="panel">Open</button>
    <div id="panel" hidden>Panel</div>
  `)

  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'no-change')
})

test('hover audit waits bounded time for delayed hover state changes', async () => {
  const item = await inspectHtml(`
    <button id="candidate" aria-expanded="false" aria-controls="panel">Open</button>
    <div id="panel" hidden>Panel</div>
    <script>
      document.querySelector('#candidate').addEventListener('mouseenter', () => {
        window.setTimeout(() => {
          document.querySelector('#candidate').setAttribute('aria-expanded', 'true')
          document.querySelector('#panel').hidden = false
        }, 420)
      })
      document.querySelector('#candidate').addEventListener('mouseleave', () => {
        document.querySelector('#candidate').setAttribute('aria-expanded', 'false')
        document.querySelector('#panel').hidden = true
      })
    </script>
  `)

  assert.equal(item.status, 'ok')
  assert.equal(item.category, 'dropdown')
})

test('hover audit does not use proximity-only fallback for unrelated link in the same ancestor', async () => {
  const item = await inspectHtml(`
    <style>
      li { position: relative; width: 140px; height: 44px; list-style: none; }
      #candidate, #nearby { position: absolute; inset: 0; display: block; }
      #candidate { z-index: 1; }
      #nearby { z-index: 2; }
      #panel[hidden] { display: none; }
    </style>
    <nav>
      <ul>
        <li>
          <button id="candidate" aria-label="Products menu" aria-expanded="false" aria-controls="panel">Products menu</button>
          <a id="nearby" href="#" aria-label="Account">Account</a>
        </li>
      </ul>
    </nav>
    <div id="panel" hidden>Panel</div>
    <script>
      document.querySelector('#nearby').addEventListener('mouseenter', () => {
        document.querySelector('#candidate').setAttribute('aria-expanded', 'true')
        document.querySelector('#panel').hidden = false
      })
    </script>
  `)

  assert.equal(item.status, 'warn')
  assert.equal(item.category, 'blocked')
  assert.equal(item.hitTargetSelector, '#nearby')
  assert.equal(item.hoverSelector, undefined)
})

async function inspectHtml(html, overrides = {}) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  try {
    const targetUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    return await HOVER_AUDIT_TEST_ONLY.inspectHoverCandidate(page, targetUrl, candidate({ selector: '#candidate', panelSelector: '#panel', ...overrides }))
  } finally {
    await page.close().catch(() => {})
  }
}

function candidate(overrides = {}) {
  return {
    auditId: 'hover-1',
    selector: '#menu',
    panelSelector: '#submenu',
    label: 'Menu',
    kindHint: 'menu',
    ...overrides,
  }
}
