/**
 * 前景/背景同色护栏。
 *
 * 为什么需要它：插件样式大量依赖宿主设计 token（`--dsw-alias-*`），而这些 token
 * 的取值只有在**真实主题 CSS** 下才成立。历史事故：`.dsq_status` 与
 * `.dsq_notesToast` 用了 `bg-layer-3` + `label-primary-inverted`，在 DSH 真实主题里
 * 两者恰好同值（亮色都是 #fff、暗色都是 #353638）→ 白底白字，用户只看到「空白一块」。
 * 夹具页面没有加载主题 CSS，`var()` 全部回落到插件自己写的备选值（深底白字），
 * 于是五轮共 384 条真实浏览器断言都漏过了它。**只有解析真实主题才能防住这类盲区。**
 *
 * 做法：解析 `src/client/styles.ts` 的全部规则，取出 `background`/`background-color`
 * 与 `color` 组成的对，按主题把 `var()` 递归解析为字面颜色，亮色与暗色两套主题
 * 各自比对，出现「前景 == 背景」即失败并打印规则名与两个颜色值。
 *
 * 主题文件探测不到时**明确跳过并打印原因**（退出码仍为 0），绝不静默通过 ——
 * 静默通过会让护栏在换机器/换部署后失效而无人察觉。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 主题定义文件候选：官方包优先，其次本仓库可能存在的副本。 */
const THEME_CANDIDATES = [
  'F:/soft/DSH Desktop/resources/app/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js',
  'C:/Program Files/DSH Desktop/resources/app/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js',
  resolve(root, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'),
]

/** 主题里的两套取值来源：亮色 `body`、暗色 `body[data-ds-dark-theme]`。 */
const THEMES = [
  { name: '亮色', selector: 'body' },
  { name: '暗色', selector: 'body[data-ds-dark-theme]' },
]

/**
 * 必须落在「背景 + 前景」对里的规则。
 *
 * 这曾是一个真实缺陷：这两个规则的声明块里写了中文注释，而解析器先按 `;` 切分，
 * 注释文字于是被粘到属性名上（`/* … *​/ background`），`background` 认不出来，
 * 规则被整条丢弃 —— 护栏对**它诞生要防的那两条规则彻底失明**，却报告 ok。
 * 因此这里钉死必须命中，解析逻辑一旦退化就立刻失败，而不是安静地空转。
 */
const REQUIRED_PAIRS = ['.dsq_status', '.dsq_notesToast']

function fail(message) {
  console.error(`verify-contrast: ${message}`)
  process.exit(1)
}

/** 去掉 CSS 注释：注释里可能含 `:` `;` `{` `}`，必须先剔除再解析。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 从 `open` 处的 `{` 找到与之配对的 `}`；找不到返回 -1。 */
function matchBrace(css, open) {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * 解析出所有 `选择器 { 声明 }` 规则。
 *
 * 递归展开 `@media`/`@supports` 这类条件组 —— 里面的规则同样要检查；
 * `@keyframes` 整块跳过（内部是 `0% {}` 之类的步骤，不是可读性规则）。
 * 手写花括号配对而不是用单个正则，是因为正则无法正确嵌套，
 * 会把 `@media X { .a { … } }` 的规则体切错、从而漏检。
 */
function parseRules(css, out = []) {
  let start = 0
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch === '{') {
      const prelude = css.slice(start, i).trim().replace(/\s+/g, ' ')
      const end = matchBrace(css, i)
      if (end < 0) break
      const body = css.slice(i + 1, end)
      if (prelude.startsWith('@')) {
        if (!/^@(?:-\w+-)?keyframes\b/i.test(prelude)) parseRules(body, out)
      } else if (prelude !== '') {
        out.push({ selector: prelude, body })
      }
      i = end + 1
      start = i
      continue
    }
    i++
  }
  return out
}

/** 把声明块切成属性表；同一属性后出现者覆盖先出现者（与 CSS 一致）。 */
function parseDeclarations(body) {
  const declarations = new Map()
  for (const decl of body.split(';')) {
    const at = decl.indexOf(':')
    if (at < 0) continue
    const name = decl.slice(0, at).trim().toLowerCase()
    if (name === '') continue
    declarations.set(name, decl.slice(at + 1).trim())
  }
  return declarations
}

/** 把主题 client.js 里被转义的 CSS 大字符串还原成真正的 CSS 文本。 */
function decodeThemeCss(source) {
  const raw = source.match(/var\s+design_platform_css_default\s*=\s*"([\s\S]*?)";/)
  if (raw === null) return null
  return raw[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

/**
 * 收集某个选择器下的全部自定义属性。
 *
 * 用 `(?:^|[},])` 锚定选择器起始，避免 `body` 误匹配到 `body[data-ds-dark-theme]`
 * 这类更长的选择器（否则暗色值会被当成亮色值，两套主题同值，护栏直接失效）。
 */
function collectVars(themeCss, selector) {
  const vars = new Map()
  const escaped = selector.replace(/[[\]()*+?.\\^$|]/g, '\\$&')
  const re = new RegExp(`(?:^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g')
  let match
  while ((match = re.exec(themeCss)) !== null) {
    for (const [name, value] of parseDeclarations(match[1])) {
      if (name.startsWith('--')) vars.set(name, value)
    }
  }
  return vars
}

/** 递归把 `var(--x, fallback)` 解析到字面值；未定义的 token 标记出来。 */
function resolveValue(value, vars, depth = 0) {
  const trimmed = value.trim()
  if (depth > 16) return trimmed
  const match = trimmed.match(/^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([\s\S]+))?\)$/)
  if (match === null) return trimmed
  const [, name, fallback] = match
  const hit = vars.get(name)
  if (hit !== undefined) return resolveValue(hit, vars, depth + 1)
  if (fallback !== undefined) return resolveValue(fallback, vars, depth + 1)
  return `«未定义:${name}»`
}

/**
 * 颜色归一化。
 *
 * 只做「同色判断」需要的等价化：小写、去空白、把 `#rgb` 补成 6 位，
 * 并把 `rgb(255, 255, 255)` 与 `#fff` 视作同一颜色 —— 否则同一个白色写成两种语法
 * 就会被判为「不同色」而漏报。
 *
 * **alpha 必须参与比较**：`rgba(212, 56, 13, 0.08)` 是 8% 透明度的浅红底，
 * 与不透明的 `#d4380d` 前景区完全不是一回事（文字照样看得见）。若把 alpha 丢掉，
 * 就会把这种正常写法误报成「同色」。alpha 为 1 时省略，保证 `#fff` == `rgb(255,255,255)`。
 */
function normalizeColor(value) {
  const lower = value.trim().toLowerCase().replace(/\s+/g, ' ')
  const withAlpha = (hex, alpha) => (alpha === undefined || alpha === 1 ? hex : `${hex}@${alpha}`)

  const hex = lower.match(/^#([0-9a-f]{3,8})$/)
  if (hex !== null) {
    let digits = hex[1]
    if (digits.length === 3) digits = digits.split('').map((c) => c + c).join('')
    if (digits.length === 8) {
      const alpha = Number.parseInt(digits.slice(6, 8), 16) / 255
      return withAlpha(`#${digits.slice(0, 6)}`, Number(alpha.toFixed(3)))
    }
    if (digits.length === 4) {
      const alpha = Number.parseInt(digits[3] + digits[3], 16) / 255
      const expanded = digits.slice(0, 3).split('').map((c) => c + c).join('')
      return withAlpha(`#${expanded}`, Number(alpha.toFixed(3)))
    }
    return `#${digits}`
  }

  const rgb = lower.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/)
  if (rgb !== null) {
    const channel = (n) => Math.round(Number(n)).toString(16).padStart(2, '0')
    const alpha = rgb[4] === undefined ? undefined : Number(Number(rgb[4]).toFixed(3))
    return withAlpha(`#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`, alpha)
  }
  return lower
}

/**
 * 是否可用于同色比较。
 *
 * 渐变、`none`、`transparent`、`currentColor` 以及解析失败的 `«未定义»` 都不能
 * 直接与前景做相等判断 —— 擅自比较只会产生误报。这些情况按「无法判定」跳过。
 */
function isComparableColor(value) {
  const lower = value.trim().toLowerCase()
  if (lower === '' || lower.startsWith('«')) return false
  return !/^(none|transparent|inherit|initial|unset|revert|currentcolor|linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient|image|url|color-mix|light-dark)/
    .test(lower)
}

// ---- 1) 主题 CSS ----
const themePath = THEME_CANDIDATES.find((candidate) => existsSync(candidate))
let themeCss = null
if (themePath !== undefined) {
  const decoded = decodeThemeCss(readFileSync(themePath, 'utf8'))
  if (decoded === null) {
    console.warn(
      `verify-contrast: 找到主题文件但未解析出 design_platform_css_default，跳过同色比对。\n  文件: ${themePath}`,
    )
  } else {
    themeCss = decoded
  }
} else {
  console.warn(
    'verify-contrast: 未找到 DSH 主题定义文件，跳过同色比对（护栏本轮未生效）。\n' +
      '  候选路径:\n' +
      THEME_CANDIDATES.map((candidate) => `    ${candidate}`).join('\n') +
      '\n  这是「明确跳过」，不是通过：请在有 DSH 安装的机器上运行以真正校验。',
  )
}

// ---- 2) 插件 CSS ----
const stylesPath = resolve(root, 'src/client/styles.ts')
if (!existsSync(stylesPath)) fail(`缺少待检查的样式文件: ${stylesPath}`)
const stylesSource = readFileSync(stylesPath, 'utf8')
const cssBlock = stylesSource.match(/const CSS = `([\s\S]*?)`/)
if (cssBlock === null) fail('无法从 src/client/styles.ts 中提取 `const CSS = \\`...\\`` 模板')
const pluginCss = stripComments(cssBlock[1])

const rules = parseRules(pluginCss)
  .map(({ selector, body }) => ({ selector, declarations: parseDeclarations(body) }))
  .filter((rule) => rule.declarations.size > 0)

const pairs = rules
  .map((rule) => ({
    selector: rule.selector,
    background: rule.declarations.get('background') ?? rule.declarations.get('background-color'),
    color: rule.declarations.get('color'),
  }))
  .filter((pair) => pair.background !== undefined && pair.color !== undefined)

if (rules.length === 0) fail('未从插件 CSS 中解析出任何规则（解析逻辑可能已与文件结构脱节）')
if (pairs.length === 0) fail('未解析出任何「背景 + 前景」规则对（护栏会空转，需检查解析逻辑）')

const missingRequired = REQUIRED_PAIRS.filter(
  (required) => !pairs.some((pair) => pair.selector === required),
)
if (missingRequired.length > 0) {
  fail(
    `护栏对必须检查的规则失明：${missingRequired.join('、')} 未出现在解析结果里。\n` +
      '  这两条规则是本护栏的诞生原因，漏掉它们等于护栏空转。请检查 parseRules/parseDeclarations。',
  )
}

// ---- 3) 比对 ----
console.log(`verify-contrast: 解析到 ${rules.length} 条规则，其中 ${pairs.length} 条含前景/背景对`)
console.log(`  样式: ${stylesPath}`)
console.log(`  主题: ${themePath ?? '(未找到，已跳过比对)'}`)

const problems = []
if (themeCss !== null) {
  for (const theme of THEMES) {
    const vars = collectVars(themeCss, theme.selector)
    if (vars.size === 0) {
      console.warn(`verify-contrast: 主题「${theme.name}」(${theme.selector}) 未解析出任何变量，跳过该主题`)
      continue
    }
    for (const pair of pairs) {
      const fg = resolveValue(pair.color, vars)
      const bg = resolveValue(pair.background, vars)
      if (!isComparableColor(fg) || !isComparableColor(bg)) continue
      if (normalizeColor(fg) === normalizeColor(bg)) {
        problems.push({ theme: theme.name, selector: pair.selector, fgRaw: pair.color, fg, bgRaw: pair.background, bg })
      }
    }
  }
}

if (problems.length > 0) {
  console.error('\nverify-contrast: 发现前景与背景同色的规则（文字将不可见）:')
  for (const problem of problems) {
    console.error(`  ✗ [${problem.theme}] ${problem.selector}`)
    console.error(`      color:      ${problem.fgRaw}  → ${problem.fg}`)
    console.error(`      background: ${problem.bgRaw}  → ${problem.bg}`)
  }
  console.error('\n请改用语义正确的 token 对（例如 toast 表面用 --dsw-alias-toast-bg / --dsw-alias-toast-label），')
  console.error('不要用 --dsw-alias-bg-layer-3 配 --dsw-alias-label-primary-inverted（真实主题下同值）。')
  process.exit(1)
}

if (themeCss === null) {
  console.log('\nverify-contrast: 跳过（无主题文件）—— 护栏本轮未实际校验，见上方原因。')
  process.exit(0)
}

console.log(`\nverify-contrast: ok，${pairs.length} 条规则对在亮/暗两套主题下均无同色`)
process.exit(0)
