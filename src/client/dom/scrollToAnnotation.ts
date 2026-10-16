/**
 * Scroll the conversation to one annotation: its inline mark in the message
 * body first, then a DOM node that still contains the selected text.
 */

import { findAnnotationMark, flashAnnotationMark } from './annotate-text.ts'

export function scrollToAnnotation(index: number, text: string, markId?: string): void {
  const mark = findAnnotationMark(index, text, markId)
  if (mark) {
    flashAnnotationMark(mark)
    return
  }
  const byText = findElementByText(text)
  if (byText) {
    byText.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

/**
 * Containers whose text is never a legitimate locate target.
 *
 * `script`/`style`/`noscript`/`template` contents are text nodes in the
 * document but are not rendered: a hit there scrolls nowhere useful and, worse,
 * reports success. A page that inlines code containing the searched string
 * (the plugin bundle itself, a test harness) would otherwise always "match".
 */
const NON_RENDERED = 'script, style, noscript, template'

/**
 * DOM node holding `text`: a TreeWalker over text nodes, scoring the deepest
 * reasonably small block highest. Exported so other locators (notes) share one
 * implementation instead of keeping near-identical private copies in sync.
 *
 * `extraSkip` lets a caller exclude its own chrome (a list of nodes that also
 * render the note text) from being mistaken for the conversation body.
 *
 * `root` narrows the scan. Whole-document scans are the wrong default for a
 * conversation anchor: the sidebar, older messages, and the plugin's own lists
 * all render text, so a document-wide hit can scroll somewhere unrelated and
 * still look like success. Callers that must be precise pass the transcript row.
 */
export function findElementByText(text: string, extraSkip?: string, root?: Element): HTMLElement | null {
  const needle = text.trim().slice(0, 32)
  if (needle.length < 2) return null
  const skip = `[data-dsq-toolbar], [data-selection-annotation-summary], ${NON_RENDERED}${
    extraSkip ? `, ${extraSkip}` : ''
  }`
  const walker = document.createTreeWalker(root ?? document.body, NodeFilter.SHOW_TEXT)
  let best: HTMLElement | null = null
  let bestScore = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    const value = node.textContent ?? ''
    if (!value.includes(needle)) continue
    const el = node.parentElement
    if (!el || el.closest(skip)) continue
    // Prefer the deepest reasonably sized block.
    const score = value.length < 500 ? 2 : 1
    if (score > bestScore) {
      best = el
      bestScore = score
      if (score === 2) break
    }
  }
  return best
}
