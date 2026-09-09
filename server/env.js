import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

export const DEFAULT_SERVER_ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url))

export function loadServerEnv(options = {}) {
  const config = {
    override: false,
    quiet: true,
    path: typeof options.path === 'string' && options.path.trim() ? options.path : DEFAULT_SERVER_ENV_PATH,
  }
  return dotenv.config(config)
}
