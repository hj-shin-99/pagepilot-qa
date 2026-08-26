import path from 'node:path'
import multer from 'multer'
import { extractReferenceWorkbook, REFERENCE_WORKBOOK_LIMITS } from './referenceWorkbookExtractor.js'

export const REFERENCE_UPLOAD_LIMITS = Object.freeze({
  maxFileBytes: 5 * 1024 * 1024,
})

const REFERENCE_FILE_FIELD_NAME = 'referenceFile'
const ALLOWED_XLSX_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export function createReferenceFileUploadRoute(options = {}) {
  const limits = { ...REFERENCE_UPLOAD_LIMITS, ...(options.limits || {}) }
  const extractor = options.extractor || extractReferenceWorkbook
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: limits.maxFileBytes,
      files: 1,
    },
    fileFilter(req, file, callback) {
      const validationError = validateReferenceFile(file)
      callback(validationError, !validationError)
    },
  }).single(REFERENCE_FILE_FIELD_NAME)

  return function referenceFileUploadRoute(req, res) {
    upload(req, res, async (uploadError) => {
      if (uploadError) {
        const mappedError = mapUploadError(uploadError, limits)
        res.status(mappedError.status).json(mappedError.body)
        return
      }

      if (!req.file) {
        res.status(400).json({ ok: false, code: 'reference_file_missing', message: 'referenceFile Excel 파일이 필요합니다.' })
        return
      }

      try {
        const extracted = await extractor(req.file.buffer, { limits: options.workbookLimits || REFERENCE_WORKBOOK_LIMITS })
        res.json({
          ok: true,
          reference: {
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
            ...extracted,
          },
        })
      } catch (error) {
        res.status(422).json({
          ok: false,
          code: 'reference_parse_failed',
          message: 'Reference Excel 파일을 읽지 못했습니다.',
          detail: error instanceof Error ? error.message : 'Unknown workbook parse error',
        })
      }
    })
  }
}

function validateReferenceFile(file) {
  const extension = path.extname(file.originalname || '').toLowerCase()
  if (extension !== '.xlsx' || !ALLOWED_XLSX_MIME_TYPES.has(file.mimetype)) {
    return new ReferenceUploadError(400, 'reference_file_type_not_allowed', 'xlsx Excel 파일만 업로드할 수 있습니다.')
  }

  return null
}

function mapUploadError(error, limits) {
  if (error instanceof ReferenceUploadError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message } }
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return {
        status: 413,
        body: {
          ok: false,
          code: 'reference_file_too_large',
          message: `Reference Excel 파일은 ${limits.maxFileBytes} bytes 이하만 업로드할 수 있습니다.`,
        },
      }
    }

    return {
      status: 400,
      body: { ok: false, code: 'reference_upload_invalid', message: 'referenceFile 1개만 업로드할 수 있습니다.' },
    }
  }

  return {
    status: 400,
    body: { ok: false, code: 'reference_upload_failed', message: 'Reference Excel 업로드에 실패했습니다.' },
  }
}

class ReferenceUploadError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'ReferenceUploadError'
    this.status = status
    this.code = code
  }
}
