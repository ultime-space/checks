#!/usr/bin/env node
/** 薄入口：产物在 dist/cli.js，构建由 prepublishOnly / build 负责。 */
import('../dist/cli.js').catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
