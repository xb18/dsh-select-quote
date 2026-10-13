/**
 * Headless bundle check.
 *
 * `tsdown` does not typecheck, so a bundle can build "successfully" while being
 * broken at runtime (for example a stray backtick inside the CSS template
 * literal terminates the string and produces invalid JS). This script runs the
 * built `lib/client.js` the way the browser does — a fake
 * `window.__ModuleLoader__` plus a `require` shim — then calls `apply()` with a
 * mock Cordis context and asserts every registration landed.
 *
 * Usage: npm run verify   (after npm run build)
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'package.json'))

/** Everything this plugin is expected to contribute when it is mounted. */
const EXPECTED = [
  { kind: 'events.register', label: 'conversation Definition "select-quote"' },
  { kind: 'slots.register', label: 'shell.overlay / select-quote-toolbar' },
  { kind: 'slots.register', label: 'conversation.input.overlay / select-quote-card' },
  { kind: 'slots.register', label: 'conversation.input.overlay / select-quote-session-bridge' },
  { kind: 'slots.register', label: 'conversation.chat.node / select-quote' },
  { kind: 'slots.register', label: 'conversation.chat.node / user' },
  { kind: 'slots.register', label: 'conversation.view / notes' },
  { kind: 'slots.register', label: 'settings.section / select-quote-notes' },
]

const SEEDS = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'])

function loadFactory(code) {
  let definition
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          definition = value
        },
      },
    },
    console,
    setTimeout,
    clearTimeout,
    Symbol,
    Object,
    Array,
    Math,
    Date,
    JSON,
    Map,
    Set,
    Promise,
    Error,
    RegExp,
    String,
    Number,
    Boolean,
    isNaN,
    parseInt,
    parseFloat,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: 'lib/client.js' })
  if (definition === undefined) throw new Error('the bundle never called window.__ModuleLoader__.load()')
  return definition
}

function mockContext(record) {
  const ctx = {
    effect(callback, label) {
      record.push({ kind: 'effect', label: String(label) })
      return typeof callback() === 'function' ? () => {} : () => {}
    },
    get() {
      return undefined
    },
  }
  ctx.slots = {
    inject(key, callback) {
      record.push({ kind: 'slots.inject', label: key })
      return callback()
    },
    register(options, component) {
      const cell = options.key ?? options.id
      record.push({ kind: 'slots.register', label: `${options.name} / ${cell}`, component, options })
      return () => {}
    },
  }
  ctx.sessions = { scope: () => undefined }
  ctx.uiConversation = {
    events: {
      register(definition) {
        record.push({ kind: 'events.register', label: `conversation Definition "${definition.kind}"` })
        return () => {}
      },
    },
  }
  return ctx
}

const code = readFileSync(resolve(root, 'lib/client.js'), 'utf8')
const bundle = loadFactory(code)
console.log(`bundle id: ${bundle.id}`)

const module = bundle.factory((name) => {
  if (!SEEDS.has(name)) throw new Error(`require("${name}") is not a platform seed word`)
  return require(name)
})

const record = []
const ctx = mockContext(record)
const outcome = module.apply(ctx)
if (outcome !== undefined) throw new Error('apply() must not return a value')

const missing = EXPECTED.filter(
  (expected) => !record.some((entry) => entry.kind === expected.kind && entry.label === expected.label),
)
const broken = record.filter((entry) => entry.kind === 'slots.register' && typeof entry.component !== 'function')

// The notes tab must be a NEW view id: reusing `chat` (or `trajectory`) would
// replace a built-in view instead of adding a tab, and `showTabs` only turns the
// ring on when two views exist. Order and label are what the tab bar reads.
const notesView = record.find((entry) => entry.kind === 'slots.register' && entry.label === 'conversation.view / notes')
const notesProblems = []
if (notesView !== undefined) {
  const options = notesView.options ?? {}
  if (options.id !== 'notes') notesProblems.push(`expected id "notes", got ${JSON.stringify(options.id)}`)
  if (options.key !== undefined) notesProblems.push('a list entry must use `id`, not `key`')
  if (typeof options.order !== 'number') notesProblems.push('missing numeric order')
  if (typeof options.label !== 'function') notesProblems.push('label must be a thunk (resolveSlotLabel calls it per read)')
  else if (typeof options.label() !== 'string' || options.label() === '') notesProblems.push('label thunk must return a non-empty string')
}

for (const entry of record) console.log(`  ${entry.kind.padEnd(16)} ${entry.label}`)

// The settings page must be a NEW section id. `settings.section` is a list slot
// in the settings shell, so reusing a built-in placeholder (general / models /
// plugins / account / agent-presets) or an installed third-party id (memory /
// market / token-usage / config-manager / better-sidebar) would shadow that
// section's page instead of adding one. Order decides the nav position.
const settingsSection = record.find(
  (entry) => entry.kind === 'slots.register' && entry.label === 'settings.section / select-quote-notes',
)
const settingsProblems = []
if (settingsSection !== undefined) {
  const options = settingsSection.options ?? {}
  if (options.id !== 'select-quote-notes') {
    settingsProblems.push(`expected id "select-quote-notes", got ${JSON.stringify(options.id)}`)
  }
  if (options.key !== undefined) settingsProblems.push('a list entry must use `id`, not `key`')
  if (typeof options.order !== 'number') settingsProblems.push('missing numeric order')
  if (typeof options.label !== 'function') settingsProblems.push('label must be a thunk (resolveSlotLabel calls it per read)')
  else if (typeof options.label() !== 'string' || options.label() === '') settingsProblems.push('label thunk must return a non-empty string')
}

if (missing.length > 0 || broken.length > 0 || notesProblems.length > 0 || settingsProblems.length > 0) {
  for (const entry of missing) console.error(`MISSING: ${entry.kind} ${entry.label}`)
  for (const entry of broken) console.error(`NOT A COMPONENT: ${entry.label}`)
  for (const problem of notesProblems) console.error(`NOTES VIEW: ${problem}`)
  for (const problem of settingsProblems) console.error(`SETTINGS SECTION: ${problem}`)
  process.exit(1)
}
console.log(`ok: ${EXPECTED.length} contributions registered, ${module.inject.join(', ')} injected`)
