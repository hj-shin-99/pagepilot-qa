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
  assert.deepEqual(plan.unitKeys, ['web_collect', 'page_structure', 'tech_click', 'result_prepare'])
})

test('qa progress plan includes visual units only when figma url is present', () => {
  const plan = createQaProgressPlan({ figmaUrl: 'https://www.figma.com/design/a?node-id=1-2', scanOptions: ONLY_CLICK_SCAN_OPTIONS })

  assert.deepEqual(plan.unitKeys, [
    'web_collect',
    'page_structure',
    'tech_click',
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

  assert.deepEqual(plan.unitKeys, ['web_collect', 'page_structure', 'tech_markup', 'tech_click', 'tech_url', 'result_prepare'])
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
