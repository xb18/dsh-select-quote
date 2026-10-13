/**
 * Ambient faces for the client services this plugin injects.
 *
 * `ctx.slots`, `ctx.sessions`, `ctx.uiWorkspace` and `ctx.uiConversation` are
 * owned by the running dsh deployment (the `@deepseek-ai/dsh-client-*` web
 * packages), which are not dependencies of this repository. Their `Context`
 * augmentation is restated here so `npm run typecheck` works without the full
 * client install.
 *
 * Everything is declared optional-ish/loosely on purpose: the shapes below are
 * the subset this plugin actually reads, and a deployment that omits one of
 * them must degrade at runtime (visible Chinese notice) instead of failing to
 * compile or throwing during render.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Options accepted by `ctx.slots.register` for the slots this plugin uses. */
export interface SlotRegistration {
  name: string
  /** Cell key of a `list` slot entry. */
  id?: string
  /** Cell key of a `keyed` slot entry. */
  key?: string
  order?: number
  priority?: number
  locale?: string
  /**
   * Label of a `list` slot entry. `resolveSlotLabel` calls a function each read
   * (so a thunk can follow locale switches) and passes a string through as-is.
   */
  label?: string | (() => string)
  /** Declared child slots of the entry being registered. */
  children?: Record<string, { kind: string; scope: string }>
  /** Extra props injected into the entry's component. */
  inject?: unknown
  /** Entry store handle. */
  store?: unknown
}

/** Minimal mirror of the session list snapshot this plugin reads for jumps. */
export interface SessionListSnapshot {
  readonly byId?: Record<string, unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: {
      inject(key: string, callback: () => unknown): () => void
      register(options: SlotRegistration, component: unknown): () => void
      entries?(key: string): readonly { options: SlotRegistration }[]
    }
    sessions: {
      scope(id: string): Context | undefined
      /** Session mirror; `list` is not in every declared face, so it is optional. */
      list?: { getSnapshot(): SessionListSnapshot }
    }
    uiWorkspace?: {
      /** Cross-session navigation: the only public entry point for a jump. */
      openSession(target: string): void
    }
    uiConversation: {
      events: { register(definition: unknown): () => void }
      views: { register(definition: unknown): () => void }
    }
  }
}
