import { resolve } from 'node:path'
import { defineConfig } from 'vite-plus'

const HERE = import.meta.dirname
const at = (p: string) => resolve(HERE, p)

/** 文档与产物不参与格式化：避免与规则夹具、生成内容产生无意义 diff。 */
const ignore = ['**/node_modules/**', '**/dist/**', '**/*.md', 'tests/fixtures/**']

export default defineConfig({
  root: HERE,
  staged: { '*': 'vp check --fix' },
  fmt: {
    ignorePatterns: ignore,
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 120,
  },
  lint: {
    ignorePatterns: ignore,
    plugins: ['typescript'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
  },
  pack: {
    entry: {
      index: at('src/index.ts'),
      cli: at('src/cli.ts'),
    },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: true,
    // 发布产物默认压缩：注释与说明留在源码与文档，不随 dist 发布。
    minify: true,
    sourcemap: false,
    clean: true,
    publint: true,
    attw: {
      level: 'error',
      entrypoints: ['.'],
    },
    unused: true,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
})
