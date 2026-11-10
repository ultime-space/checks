# checks/imports

> 定位：imports 规则的判据、选项与修法。
> 适用版本：0.1.x

检查相对路径边界、禁止的说明符，以及内部包是否在 `package.json` 里声明。

## 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `packageRoots` | `[]` | 包根目录（相对 workspaceRoot）；相对引用不得跨出所属包 |
| `packages` | `[]` | 内部包前缀，如 `['@ultime/']` |
| `forbid` | `[]` | 禁止的说明符；字符串按正则处理，或 `{ pattern, scope?, message? }` |
| `internalSrc` | `packages` 非空时为 `true` | 禁止引用 `<prefix>/<pkg>/src/**` |
| `requireDeclared` | `packages` 非空时为 `true` | 内部包必须出现在所属 `package.json` 依赖中 |

## 扫描面

- JS / TS：静态 import / export、re-export、动态 `import()`、`require()`
- CSS / SCSS：`@import`、`url()`
- HTML / Vue：`src` / `href`
- Markdown：相对链接

## 示例

```js
{
  use: 'imports',
  options: {
    packageRoots: ['packages/core', 'packages/kit'],
    packages: ['@ultime/'],
    forbid: [{ pattern: '(^|/)packages/', scope: ['apps/**'], message: '应用里改用包名入口' }],
  },
}
```

## 解析规则

- 只解析相对引用；裸包名、`node:`、`http(s):`、`#` 跳过；
- 支持 `.js` → `.ts` 映射、补扩展名、`index.*`；
- 不读 tsconfig paths；需要别名时由宿主的 `resolver` 或 `forbid` 处理；
- 无法解析的相对引用交给 `checks/unresolved`，`imports` 不重复报。

## 修法

改用包名入口、补 `package.json` 声明，或把共享代码下沉到允许的位置。
