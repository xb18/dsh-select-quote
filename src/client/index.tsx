import type { Context } from '@deepseek-ai/cordis'
import { QuoteCard } from './composer/AnnotationPanel.tsx'
import { SelectionToolbar } from './SelectionToolbar.tsx'
import { setRuntimeSession } from './runtime.ts'
import { watchAnnotationDirectives } from './dom/decorateAnnotationDirectives.ts'
import {
  syncPendingAnnotationJobs,
  watchAnnotationMarks,
} from './dom/annotate-text.ts'
import { ensureToolbarStyles } from './styles.ts'
import { TranscriptQuoteCard } from './transcript/TranscriptQuoteCard.tsx'
import { UserMessageDisplay } from './transcript/UserMessageDisplay.tsx'
import { registerSelectQuoteNode } from './transcript/transcript-node.ts'
import { NotesView } from './notes/NotesView.tsx'
import { NotesSettings } from './settings/NotesSettings.tsx'
import { setClientContext } from './services.ts'
import { getAnnotations, subscribeAnnotations } from './state/annotation-store.ts'

/**
 * Browser half of dsh-select-quote.
 *
 * Selection toolbar is root-scoped (`shell.overlay`) so transcript selections
 * are always observed. Annotation summary stays on the session composer.
 * The notes panel is a session-scoped `conversation.view` tab.
 */
export const inject = ['slots', 'sessions', 'uiConversation']

export function apply(ctx: Context): void {
  ensureToolbarStyles()
  // Slot components receive no ctx; the notes panel needs it for cross-session jumps.
  setClientContext(ctx)
  registerSelectQuoteNode(ctx)
  // Assistant replies may echo :dsh-annotation{index="N"}; decorate them as chips.
  ctx.effect(() => watchAnnotationDirectives(), 'dsh-select-quote: annotation directives')
  // Underline + ordinal badges on annotated text; survive transcript re-renders.
  ctx.effect(() => watchAnnotationMarks(), 'dsh-select-quote: annotation marks')
  // Pending annotations mark their source text the moment they are added.
  ctx.effect(() => {
    syncPendingAnnotationJobs(getAnnotations())
    return subscribeAnnotations(() => syncPendingAnnotationJobs(getAnnotations()))
  }, 'dsh-select-quote: pending annotation marks')

  // Root: always mounted selection toolbar + comment popover.
  ctx.slots.inject('shell.overlay', () => {
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'select-quote-toolbar',
        order: 100,
      },
      SelectionToolbar,
    )
  })

  // Session: pending annotation summary inside the composer (~1/5 width).
  ctx.slots.inject('conversation.input.overlay', () => {
    ctx.slots.register(
      {
        name: 'conversation.input.overlay',
        id: 'select-quote-card',
        order: 20,
      },
      QuoteCard,
    )
  })

  // Track the active session for the root toolbar (AnnotationPanel also syncs).
  ctx.slots.inject('conversation.input.overlay', () => {
    ctx.slots.register(
      {
        name: 'conversation.input.overlay',
        id: 'select-quote-session-bridge',
        order: 1,
      },
      SessionBridge,
    )
  })

  // Session: the "笔记" tab in the conversation view ring.
  //
  // The view ring only renders its tab bar when at least two views exist
  // (`showTabs = tabs.length > 1` in dsh-client-ui-conversation); today the
  // built-ins are `chat` (always) and `trajectory` (developer tools only), so
  // this second entry is what makes the tab bar appear. The id must stay fresh
  // — reusing `chat` would replace the built-in transcript view.
  ctx.slots.inject('conversation.view', () => {
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'notes',
        order: 30,
        label: () => '笔记',
      },
      NotesView,
    )
  })

  // Settings panel: the global "笔记" page (lists notes across every session).
  //
  // `settings.section` is a root-scoped list slot declared by
  // dsh-client-ui-settings-general. The id must stay fresh — reusing a built-in
  // placeholder (`general`/`models`/`plugins`/`account`/`agent-presets`) or an
  // installed third-party id (memory 30 / market 40 / token-usage 50 /
  // config-manager 60 / better-sidebar 100) would collide. order 55 puts this
  // page right after the token-usage dashboard and before config-manager.
  ctx.slots.inject('settings.section', () => {
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'select-quote-notes',
        order: 55,
        label: () => '笔记',
      },
      NotesSettings,
    )
  })

  // History: annotation cards + protocol-stripped user bubbles.
  ctx.slots.inject('conversation.chat.node', () => {
    ctx.slots.register(
      {
        name: 'conversation.chat.node',
        key: 'select-quote',
      },
      TranscriptQuoteCard,
    )
    ctx.slots.register(
      {
        name: 'conversation.chat.node',
        key: 'user',
        priority: -10,
      },
      UserMessageDisplay,
    )
  })
}

/** Invisible session-scoped bridge that publishes sessionId for the root toolbar. */
function SessionBridge({ sessionId }: { sessionId?: string }): null {
  setRuntimeSession(sessionId)
  return null
}
