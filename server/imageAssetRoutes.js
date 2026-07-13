import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SAFE_RENDER_ID_PATTERN = /^[0-9a-zA-Z._-]+$/
const SAFE_SCREENSHOT_FILE_PATTERN = /^[a-f0-9]{24}\.png$/i

export function createProjectCachePaths(metaUrl = import.meta.url) {
  const serverDir = path.dirname(fileURLToPath(metaUrl))
  const projectRoot = path.resolve(serverDir, '..')

  return {
    serverDir,
    projectRoot,
    figmaRenderDir: path.resolve(projectRoot, '.cache', 'figma', 'renders'),
    visualScreenshotDir: path.resolve(projectRoot, '.cache', 'visual', 'screenshots'),
  }
}

export function createImageAssetHandlers(options = {}) {
  const paths = options.paths || createProjectCachePaths(options.metaUrl)
  const getCacheControl = typeof options.getCacheControl === 'function' ? options.getCacheControl : () => 'public, max-age=3600'

  return {
    paths,
    figmaRenderHandler(req, res) {
      const renderId = typeof req.params?.renderId === 'string' ? req.params.renderId.trim() : ''
      const file = resolveFigmaRenderFile(paths, renderId)
      if (!file) {
        sendJsonNotFound(res, '렌더 이미지를 찾을 수 없습니다.')
        return
      }

      sendPngFile(res, file.absolutePath, file.sizeBytes, getCacheControl(), '렌더 이미지를 찾을 수 없습니다.')
    },
    visualScreenshotHandler(req, res) {
      const fileName = typeof req.params?.fileName === 'string' ? req.params.fileName.trim() : ''
      const file = resolveVisualScreenshotFile(paths, fileName)
      if (!file) {
        sendJsonNotFound(res, '스크린샷 이미지를 찾을 수 없습니다.')
        return
      }

      sendPngFile(res, file.absolutePath, file.sizeBytes, getCacheControl(), '스크린샷 이미지를 찾을 수 없습니다.')
    },
  }
}

export function resolveFigmaRenderFile(paths, renderId) {
  if (!SAFE_RENDER_ID_PATTERN.test(String(renderId || ''))) return null
  return getExistingPngFile(paths.figmaRenderDir, `${renderId}.png`)
}

export function resolveVisualScreenshotFile(paths, fileName) {
  if (!SAFE_SCREENSHOT_FILE_PATTERN.test(String(fileName || ''))) return null
  return getExistingPngFile(paths.visualScreenshotDir, fileName)
}

function getExistingPngFile(directoryPath, fileName) {
  const absolutePath = path.resolve(directoryPath, fileName)
  if (!isInsideDirectory(directoryPath, absolutePath)) return null
  if (!fs.existsSync(absolutePath)) return null

  const stats = fs.statSync(absolutePath)
  if (!stats.isFile() || stats.size <= 0) return null

  return { absolutePath, sizeBytes: stats.size }
}

function isInsideDirectory(directoryPath, absolutePath) {
  const relativePath = path.relative(directoryPath, absolutePath)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function sendPngFile(res, absolutePath, sizeBytes, cacheControl, notFoundMessage) {
  res.type('png')
  res.setHeader('Content-Length', String(sizeBytes))
  res.setHeader('Cache-Control', cacheControl)
  res.sendFile(absolutePath, { dotfiles: 'allow' }, (error) => {
    if (!error || res.headersSent) return
    sendJsonNotFound(res, notFoundMessage)
  })
}

function sendJsonNotFound(res, message) {
  res.status(404).json({ message })
}
