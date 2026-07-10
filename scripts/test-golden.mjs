import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFile = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(currentFile), '..')
const casesRoot = path.join(repoRoot, 'test-assets', 'cases')
const productionFiles = [path.join(repoRoot, 'server', 'index.js')]
const forbiddenProductionPatterns = [
  '사전예약하기',
  '프로모션 바로가기',
  '온라인 구매 상담',
  '47만원',
  '50만원',
  '도움이 필요하신가요',
  'BMW iX',
  'BMWFS Golden',
  '메인 KV 문구',
]

function main() {
  const cases = loadCases(casesRoot)
  if (cases.length === 0) throw new Error('Golden case를 찾지 못했습니다.')

  cases.forEach(validateCaseAssets)
  assertForbiddenPatternsAreNotInProduction()
  console.log(`Golden fixture check passed: ${cases.length} case(s)`)
  console.log('AI 통합 회귀 검사는 비용이 발생할 수 있으므로 UI에서 명시적으로 실행해 의미 단위 결과를 확인하세요.')
}

function loadCases(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'case.json'))
    .filter((casePath) => fs.existsSync(casePath))
    .map((casePath) => ({ casePath, data: JSON.parse(fs.readFileSync(casePath, 'utf8')) }))
}

function validateCaseAssets(testCase) {
  const caseDir = path.dirname(testCase.casePath)
  const data = testCase.data
  if (!data.name || !data.url) throw new Error(`${testCase.casePath}: name/url이 필요합니다.`)
  ;['figmaImage', 'figmaJson'].forEach((field) => {
    const assetPath = path.resolve(caseDir, data[field] || '')
    if (!fs.existsSync(assetPath)) throw new Error(`${testCase.casePath}: ${field} 자산을 찾지 못했습니다: ${data[field]}`)
  })
}

function assertForbiddenPatternsAreNotInProduction() {
  const violations = []
  productionFiles.forEach((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8')
    forbiddenProductionPatterns.forEach((pattern) => {
      if (content.includes(pattern)) violations.push(`${path.relative(repoRoot, filePath)}: ${pattern}`)
    })
  })
  if (violations.length > 0) {
    throw new Error(`Production 코드에 Golden/BMWFS 정답 문구가 남아 있습니다.\n${violations.join('\n')}`)
  }
}

main()
