import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createImageAssetHandlers,
  createProjectCachePaths,
  resolveFigmaRenderFile,
  resolveVisualScreenshotFile,
} from './imageAssetRoutes.js'

const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64')

test('project cache paths are calculated from server file project root', () => {
  const workspace = createTempProject()
  const paths = createProjectCachePaths(pathToFileURL(path.join(workspace.projectRoot, 'server', 'index.js')).href)

  assert.equal(paths.serverDir, path.join(workspace.projectRoot, 'server'))
  assert.equal(paths.projectRoot, workspace.projectRoot)
  assert.equal(paths.figmaRenderDir, path.join(workspace.projectRoot, '.cache', 'figma', 'renders'))
  assert.equal(paths.visualScreenshotDir, path.join(workspace.projectRoot, '.cache', 'visual', 'screenshots'))
  assert.notEqual(paths.visualScreenshotDir, path.join(workspace.projectRoot, 'server', '.cache', 'visual', 'screenshots'))
})

test('existing Figma PNG resolves from projectRoot cache without metadata', () => {
  const workspace = createTempProject()
  const renderId = 'JMpWLy2miqIFkzb1EEB4eY__2547_3664__png__2x'
  const expectedPath = path.join(workspace.paths.figmaRenderDir, `${renderId}.png`)
  writePng(expectedPath)

  const file = resolveFigmaRenderFile(workspace.paths, renderId)

  assert.equal(file.absolutePath, expectedPath)
  assert.equal(file.sizeBytes, PNG_BYTES.length)
})

test('existing Web screenshot PNG resolves from projectRoot cache', () => {
  const workspace = createTempProject()
  const fileName = '1b0b5c57fe7d04f8bbcc0b16.png'
  const expectedPath = path.join(workspace.paths.visualScreenshotDir, fileName)
  writePng(expectedPath)

  const file = resolveVisualScreenshotFile(workspace.paths, fileName)

  assert.equal(file.absolutePath, expectedPath)
  assert.equal(file.sizeBytes, PNG_BYTES.length)
})

test('Figma render endpoint returns PNG with content headers', () => {
  const workspace = createTempProject()
  const renderId = 'render_1__png__2x'
  const expectedPath = path.join(workspace.paths.figmaRenderDir, `${renderId}.png`)
  writePng(expectedPath)
  const response = createMockResponse()

  workspace.handlers.figmaRenderHandler({ params: { renderId } }, response)

  assert.equal(response.statusCode, 200)
  assert.equal(response.typeValue, 'png')
  assert.equal(response.headers['Content-Length'], String(PNG_BYTES.length))
  assert.equal(response.headers['Cache-Control'], 'test-cache')
  assert.equal(response.sentFile, expectedPath)
  assert.deepEqual(response.sendFileOptions, { dotfiles: 'allow' })
})

test('Web screenshot endpoint returns PNG with content headers', () => {
  const workspace = createTempProject()
  const fileName = '1b0b5c57fe7d04f8bbcc0b16.png'
  const expectedPath = path.join(workspace.paths.visualScreenshotDir, fileName)
  writePng(expectedPath)
  const response = createMockResponse()

  workspace.handlers.visualScreenshotHandler({ params: { fileName } }, response)

  assert.equal(response.statusCode, 200)
  assert.equal(response.typeValue, 'png')
  assert.equal(response.headers['Content-Length'], String(PNG_BYTES.length))
  assert.equal(response.sentFile, expectedPath)
  assert.deepEqual(response.sendFileOptions, { dotfiles: 'allow' })
})

test('missing image endpoints return JSON 404', () => {
  const workspace = createTempProject()
  const figmaResponse = createMockResponse()
  const webResponse = createMockResponse()

  workspace.handlers.figmaRenderHandler({ params: { renderId: 'missing-render' } }, figmaResponse)
  workspace.handlers.visualScreenshotHandler({ params: { fileName: '1b0b5c57fe7d04f8bbcc0b16.png' } }, webResponse)

  assert.equal(figmaResponse.statusCode, 404)
  assert.deepEqual(figmaResponse.body, { message: '렌더 이미지를 찾을 수 없습니다.' })
  assert.equal(webResponse.statusCode, 404)
  assert.deepEqual(webResponse.body, { message: '스크린샷 이미지를 찾을 수 없습니다.' })
})

test('path traversal and unsafe names are blocked', () => {
  const workspace = createTempProject()

  assert.equal(resolveFigmaRenderFile(workspace.paths, '../render'), null)
  assert.equal(resolveFigmaRenderFile(workspace.paths, 'nested/render'), null)
  assert.equal(resolveVisualScreenshotFile(workspace.paths, '../1b0b5c57fe7d04f8bbcc0b16.png'), null)
  assert.equal(resolveVisualScreenshotFile(workspace.paths, 'not-a-cache-file.png'), null)
})

test('Windows-style project root paths resolve cache files safely', () => {
  const workspace = createTempProject()
  const fileName = 'aaaaaaaaaaaaaaaaaaaaaaaa.png'
  const expectedPath = path.join(workspace.paths.visualScreenshotDir, fileName)
  writePng(expectedPath)

  const windowsLikePaths = {
    ...workspace.paths,
    visualScreenshotDir: workspace.paths.visualScreenshotDir.replace(/\//g, '\\'),
  }
  const file = resolveVisualScreenshotFile(windowsLikePaths, fileName)

  assert.equal(path.normalize(file.absolutePath), path.normalize(expectedPath))
})

function createTempProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pagepilot-image-assets-'))
  const serverDir = path.join(projectRoot, 'server')
  fs.mkdirSync(serverDir, { recursive: true })
  const paths = createProjectCachePaths(pathToFileURL(path.join(serverDir, 'index.js')).href)
  const handlers = createImageAssetHandlers({ paths, getCacheControl: () => 'test-cache' })
  return { projectRoot, serverDir, paths, handlers }
}

function writePng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, PNG_BYTES)
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    typeValue: '',
    sentFile: '',
    sendFileOptions: null,
    body: null,
    headersSent: false,
    type(value) {
      this.typeValue = value
      this.headers['Content-Type'] = value === 'png' ? 'image/png' : value
      return this
    },
    setHeader(name, value) {
      this.headers[name] = value
      return this
    },
    sendFile(filePath, options, callback) {
      this.sentFile = filePath
      this.sendFileOptions = options
      if (callback) callback(null)
      return this
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
}
