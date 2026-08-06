import test from 'node:test'
import assert from 'node:assert/strict'
import { createQaProgressPlan, createQaProgressReporter } from './qaProgress.js'

const ONLY_CLICK_SCAN_OPTIONS = Object.freeze({
  url: false,
  click: true,
  landing: false,
  form: false,
  hover: false,
  modal: false,
  scroll: false,
  responsive: false,
  download: false,
  cookie: false,
  image: false,
  performance: false,
  seo: false,
  markup: false,
})

test('qa progress plan counts only selected tech audit units plus actual base and final units', () => {
  const plan = createQaProgressPlan({ scanOptions: ONLY_CLICK_SCAN_OPTIONS })

  assert.equal(plan.totalUnits, 4)
  assert.deepEqual(plan.unitKeys, ['desktop:web_collect', 'desktop:page_structure', 'desktop:tech_click', 'result_prepare'])
})

test('qa progress plan includes visual units only when figma url is present', () => {
  const plan = createQaProgressPlan({ figmaUrl: 'https://www.figma.com/design/a?node-id=1-2', scanOptions: ONLY_CLICK_SCAN_OPTIONS })

  assert.deepEqual(plan.unitKeys, [
    'desktop:web_collect',
    'desktop:page_structure',
    'desktop:tech_click',
    'visual_figma_node',
    'visual_figma_render',
    'visual_compare',
    'visual_payload',
    'result_prepare',
  ])
})

test('qa progress plan orders tech units by actual scan completion order', () => {
  const plan = createQaProgressPlan({
    scanOptions: {
      url: true,
      click: true,
      landing: false,
      form: false,
      hover: false,
      modal: false,
      scroll: false,
      responsive: false,
      download: false,
      cookie: false,
      image: false,
      performance: false,
      seo: false,
      markup: true,
    },
  })

  assert.deepEqual(plan.unitKeys, ['desktop:web_collect', 'desktop:page_structure', 'desktop:tech_markup', 'desktop:tech_click', 'desktop:tech_url', 'result_prepare'])
})

test('qa progress plan multiplies tech units by selected devices only', () => {
  const plan = createQaProgressPlan({ devices: ['mobile', 'desktop'], scanOptions: ONLY_CLICK_SCAN_OPTIONS })

  assert.deepEqual(plan.unitKeys, [
    'desktop:web_collect',
    'desktop:page_structure',
    'desktop:tech_click',
    'mobile:web_collect',
    'mobile:page_structure',
    'mobile:tech_click',
    'result_prepare',
  ])
  assert.equal(plan.totalUnits, 7)
})

test('qa progress reporter emits monotonic progress and ignores duplicate unit completions', () => {
  const events = []
  const reporter = createQaProgressReporter({ scanOptions: ONLY_CLICK_SCAN_OPTIONS, onProgress: (event) => events.push(event) })

  reporter.emitStart()
  reporter.complete('web_collect')
  reporter.complete('web_collect')
  reporter.complete('page_structure')
  reporter.complete('tech_click')
  reporter.complete('result_prepare')

  assert.deepEqual(events.map((event) => event.completedUnits), [0, 1, 2, 3, 4])
  assert.equal(events.at(-1).stage, 'result_prepare')
})

test('qa progress reporter keeps stage monotonic for interleaved device events', () => {
  const events = []
  const reporter = createQaProgressReporter({ devices: ['desktop', 'mobile'], scanOptions: ONLY_CLICK_SCAN_OPTIONS, onProgress: (event) => events.push(event) })

  reporter.emitStart()
  reporter.complete('desktop:web_collect')
  reporter.complete('desktop:page_structure')
  reporter.complete('desktop:tech_click')
  reporter.complete('mobile:web_collect')
  reporter.complete('mobile:web_collect')
  reporter.complete('mobile:page_structure')
  reporter.complete('mobile:tech_click')
  reporter.complete('result_prepare')

  assert.deepEqual(events.map((event) => event.completedUnits), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(events.map((event) => event.stage), [
    'web_collect',
    'web_collect',
    'page_structure',
    'tech_audit',
    'tech_audit',
    'tech_audit',
    'tech_audit',
    'result_prepare',
  ])
  assert.equal(events.at(-1).completedUnits, events.at(-1).totalUnits)
})
