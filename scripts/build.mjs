import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const libDir = resolve(root, 'lib')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

mkdirSync(libDir, { recursive: true })

const buildDir = resolve(libDir, '.client-build')
const hostBuildDir = resolve(libDir, '.host-build')

// Resolve tsdown's JS entry and run it with the current Node binary.
//
// Spawning the bare command `tsdown` only works on POSIX: there the bin is a
// symlink to a `#!/usr/bin/env node` script. On Windows the bin is a `.cmd`
// shim, and Node refuses to spawn `.cmd` without `shell: true` (a deliberate
// security measure since CVE-2024-27980) — the call fails with EINVAL and,
// because stdio was inherited, exits 1 without printing anything. Going through
// `process.execPath` + the package entry works identically on every platform
// and keeps the child's stdio piped straight through.
function resolveTsdownEntry() {
  // `exports` does not necessarily expose the bin, so read it from the manifest.
  const pkgPath = resolve(root, 'node_modules', 'tsdown', 'package.json')
  if (!existsSync(pkgPath)) {
    console.error(
      '[dsh-select-quote] tsdown is not installed. Run `npm install` first.',
    )
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const bin = manifest.bin
  const relative = typeof bin === 'string' ? bin : bin?.tsdown
  if (!relative) {
    console.error('[dsh-select-quote] tsdown declares no "tsdown" bin entry.')
    process.exit(1)
  }
  const entry = resolve(root, 'node_modules', 'tsdown', relative)
  if (!existsSync(entry)) {
    console.error('[dsh-select-quote] tsdown bin entry not found at', entry)
    process.exit(1)
  }
  return entry
}

/**
 * Run tsdown with the current Node binary and fail loudly on any non-zero exit.
 *
 * `stdio: 'inherit'` keeps the child's output visible, which also means a failed
 * child prints its own diagnostics; the explicit exit-code check is what makes
 * the failure propagate to this script's caller.
 */
function runTsdown(args) {
  const result = spawnSync(process.execPath, [resolveTsdownEntry(), ...args], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) {
    console.error('[dsh-select-quote] failed to start tsdown:', result.error)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

runTsdown([
  resolve(root, 'src/client/index.tsx'),
  '--config',
  resolve(root, 'tsdown.config.ts'),
  '--out-dir',
  buildDir,
])

const rawCandidates = ['index.js', 'index.cjs']
let rawPath = null
for (const name of rawCandidates) {
  const candidate = resolve(buildDir, name)
  try {
    readFileSync(candidate)
    rawPath = candidate
    break
  } catch {
    // try next
  }
}
if (!rawPath) {
  console.error('[dsh-select-quote] tsdown output not found in', buildDir)
  process.exit(1)
}

// Strip any pre-existing module preamble tsdown may have emitted.
const raw = readFileSync(rawPath, 'utf8')
  .replace(/^Object\.defineProperty\(exports, Symbol\.toStringTag, \{ value: "Module" \}\);\s*/m, '')
const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${raw}
\t\treturn module.exports;
\t}
});
`

writeFileSync(resolve(libDir, 'client.js'), wrapped)
rmSync(buildDir, { recursive: true, force: true })
console.log(`[dsh-select-quote] wrote ${resolve(libDir, 'client.js')}`)

// Host half. Compiled, not hand-written: the Node side owns the notes store, so
// it has real code to bundle. Emitted as plain ESM (`"type": "module"`), which is
// what the loader imports.
runTsdown([
  '--config',
  resolve(root, 'scripts/tsdown.host.config.mjs'),
  '--out-dir',
  hostBuildDir,
])

const hostCandidates = ['index.js', 'index.mjs']
let hostPath = null
for (const name of hostCandidates) {
  const candidate = resolve(hostBuildDir, name)
  try {
    readFileSync(candidate)
    hostPath = candidate
    break
  } catch {
    // try next
  }
}
if (!hostPath) {
  console.error('[dsh-select-quote] host output not found in', hostBuildDir)
  process.exit(1)
}

const hostCode = readFileSync(hostPath, 'utf8')

// The loader mounts the host half by the name it exports, so a rename that
// misses one of package.json / the source / cordis.patch.yml would silently
// mount the plugin under a name the profile does not know. Import the artifact
// and inspect it rather than pattern-matching the text: the bundler is free to
// emit `export const name = ...` or a hoisted `export { apply, name }`, and only
// the imported value is the real contract.
const hostModule = await import(pathToFileURL(hostPath).href)
if (hostModule.name !== pkg.name) {
  console.error(
    `[dsh-select-quote] host half exports the wrong name.\n` +
      `  expected: ${JSON.stringify(pkg.name)}\n` +
      `  actual:   ${JSON.stringify(hostModule.name)}`,
  )
  process.exit(1)
}
if (typeof hostModule.apply !== 'function') {
  console.error(
    `[dsh-select-quote] host half does not export apply().\n` +
      `  got: ${typeof hostModule.apply}`,
  )
  process.exit(1)
}

writeFileSync(resolve(libDir, 'index.js'), hostCode)
rmSync(hostBuildDir, { recursive: true, force: true })
console.log(`[dsh-select-quote] wrote ${resolve(libDir, 'index.js')}`)
