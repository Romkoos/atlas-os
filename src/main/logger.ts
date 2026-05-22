import type { LogLevel } from '@shared/settings'
import log from 'electron-log/main'

export const logger = log

const isDev = !!process.env.ELECTRON_RENDERER_URL

export function initLogger(level: LogLevel): void {
  log.transports.file.level = level
  log.transports.file.maxSize = 5 * 1024 * 1024 // 5 MB → rotates to .old.log
  log.transports.console.level = isDev ? level : false

  // Defence in depth: never let an Anthropic key reach the logs verbatim.
  log.hooks.push((message) => {
    message.data = message.data.map((part) =>
      typeof part === 'string' ? part.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***') : part,
    )
    return message
  })

  log.initialize()
}

export function setLogLevel(level: LogLevel): void {
  log.transports.file.level = level
  if (log.transports.console.level !== false) log.transports.console.level = level
}
