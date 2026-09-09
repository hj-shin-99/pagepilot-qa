import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SERVER_ENV_PATH, loadServerEnv } from './env.js'
import { getReferenceQaModel } from './referenceModelConfig.js'

test('loadServerEnv reads a local env file without exposing secret values', () => {
  const envPath = createTempEnvFile('OPENAI_API_KEY=local-secret\nREFERENCE_QA_MODEL=reference-test\n')
  const restore = preserveEnv(['OPENAI_API_KEY', 'REFERENCE_QA_MODEL'])

  try {
    delete process.env.OPENAI_API_KEY
    delete process.env.REFERENCE_QA_MODEL

    const result = loadServerEnv({ path: envPath })

    assert.equal(result.parsed.OPENAI_API_KEY, 'local-secret')
    assert.equal(process.env.OPENAI_API_KEY, 'local-secret')
    assert.equal(process.env.REFERENCE_QA_MODEL, 'reference-test')
    assert.equal(JSON.stringify(result).includes('sk-'), false)
  } finally {
    restore()
  }
})

test('loadServerEnv keeps existing runtime environment values first', () => {
  const envPath = createTempEnvFile('OPENAI_API_KEY=local-secret\nAI_QA_MODEL=local-model\n')
  const restore = preserveEnv(['OPENAI_API_KEY', 'AI_QA_MODEL'])

  try {
    process.env.OPENAI_API_KEY = 'runtime-secret'
    process.env.AI_QA_MODEL = 'runtime-model'

    loadServerEnv({ path: envPath })

    assert.equal(process.env.OPENAI_API_KEY, 'runtime-secret')
    assert.equal(process.env.AI_QA_MODEL, 'runtime-model')
  } finally {
    restore()
  }
})

test('loadServerEnv is safe when the env file is missing', () => {
  const missingPath = path.join(os.tmpdir(), `pagepilot-missing-${Date.now()}`, '.env')

  assert.doesNotThrow(() => loadServerEnv({ path: missingPath }))
})

test('default server env path is stable outside the process working directory', () => {
  assert.equal(DEFAULT_SERVER_ENV_PATH, fileURLToPath(new URL('../.env', import.meta.url)))
})

test('production runtime env only resolves reference model without local env file', () => {
  assert.equal(getReferenceQaModel({ OPENAI_API_KEY: 'runtime-secret', AI_QA_MODEL: 'runtime-model' }), 'runtime-model')
})

test('.env remains gitignored while example env is committable', () => {
  const ignoreText = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')

  assert.equal(/^\.env$/m.test(ignoreText), true)
  assert.equal(fs.existsSync(new URL('../.env.example', import.meta.url)), true)
})

function createTempEnvFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagepilot-env-'))
  const envPath = path.join(dir, '.env')
  fs.writeFileSync(envPath, contents, 'utf8')
  return envPath
}

function preserveEnv(keys) {
  const snapshot = new Map(keys.map((key) => [key, process.env[key]]))
  return () => {
    for (const [key, value] of snapshot) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
