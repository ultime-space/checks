/** 本仓自检：规则与词表按 checks 自己的边界维护；改动后跑 `pnpm check`。 */
export default {
  roots: ['.'],
  ignore: ['node_modules', 'dist', 'coverage', '.vite-hooks', '.tmp', 'checks.config.mjs', 'tests'],
  rules: [
    { use: 'imports', severity: 'error', options: { packageRoots: ['.'], packages: ['@ultime/'] } },
    { use: 'unresolved', severity: 'warn', options: { scope: ['src/**'] } },
    {
      use: 'text',
      severity: 'error',
      options: {
        scope: ['src/**', 'tests/**', 'README.md', 'USAGE.md', 'docs/**'],
        include: 'all',
        deny: ['小巨蛋', 'xiaojudan', '归序札记'],
      },
    },
    {
      use: 'doc-set',
      severity: 'error',
      options: {
        packages: ['.'],
        allowRootDocs: [
          'README.md',
          'USAGE.md',
          'AGENTS.md',
          'SKILLS.md',
          'CHANGELOG.md',
          'CONTRIBUTING.md',
          'SECURITY.md',
        ],
      },
    },
  ],
}
