const CSS = `
.dsq_toolbar {
  position: fixed;
  z-index: 10060;
  transform: translate(-50%, -100%);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  /* 无边框：--dsw-elevation-soft 自带 0 0 0 .5px 的描边环，由它勾勒轮廓，
     所以这里不要再画 border，否则描边会和环叠成两条线。 */
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: var(--dsw-elevation-soft, 0 1px 2px rgba(0, 0, 0, 0.03), 0 6px 20px rgba(0, 0, 0, 0.06));
  pointer-events: auto;
  /* Mounts once per selection, after the drag ends: soft rise + fade. */
  animation: dsq-toolbar-in 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
}

@keyframes dsq-toolbar-in {
  from {
    opacity: 0;
    transform: translate(-50%, -100%) translateY(4px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -100%);
  }
}

.dsq_button {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
  border-radius: 999px;
  padding: 4px 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.dsq_button:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}

.dsq_button:focus-visible {
  outline: 2px solid var(--dsw-alias-button-primary-fill, #1677ff);
  outline-offset: 1px;
}

.dsq_button svg {
  flex: none;
}

.dsq_divider {
  width: 1px;
  height: 14px;
  background: var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.12));
  margin: 0 2px;
}

.dsq_status {
  position: fixed;
  z-index: 10061;
  transform: translate(-50%, 8px);
  padding: 4px 10px;
  border-radius: 999px;
  /* 必须用 toast 语义 token，不能用 bg-layer-3 + label-primary-inverted 这对：
     在 DSH 真实主题里两者恰好同值（亮色都是 #fff、暗色都是 #353638），文字与
     底色完全同色 = 只剩下一个看不见的空白圆角块。官方 toast 表面在两种主题下
     都是深色（亮 bluish-800 / 暗 bluish-750）、标签固定白色，故对比度充足。
     备选值保持「深底白字」，即使 token 未定义也不影响可读。 */
  background: var(--dsw-alias-toast-bg, rgba(0, 0, 0, 0.78));
  color: var(--dsw-alias-toast-label, #fff);
  font-size: 12px;
  line-height: 18px;
  pointer-events: none;
  white-space: nowrap;
}

/* 「笔记」会话视图（conversation.view 槽位条目）。
   该槽位是 full-bleed 视图区：自带滚动容器，不要依赖外层 padding。 */
.dsq_notesView {
  height: 100%;
  overflow-y: auto;
  padding: 16px 20px 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
}

.dsq_notesHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dsq_notesCount {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.6));
}

.dsq_notesEmpty {
  margin-top: 24px;
  padding: 24px 16px;
  border-radius: 10px;
  text-align: center;
  color: var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.6));
  background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.02));
}

.dsq_notesEmptyTitle {
  margin-bottom: 6px;
  font-size: 14px;
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
}

.dsq_notesEmptyHint {
  font-size: 12px;
  line-height: 18px;
}

.dsq_notesList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsq_noteRow {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.02));
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.06));
}

.dsq_noteRow:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}

/* 主体是可点击定位区：整块命中比只点文字舒服。 */
.dsq_noteMain {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0;
  border-radius: 6px;
}

.dsq_noteMain:focus-visible {
  outline: 2px solid var(--dsw-alias-button-primary-fill, #1677ff);
  outline-offset: 2px;
}

.dsq_noteText {
  font-size: 13px;
  line-height: 20px;
  /* 长选区原文可能很长：限制行数，保持列表可扫读。 */
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
}

.dsq_noteMeta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.55));
}

.dsq_noteDelete {
  flex: none;
  appearance: none;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.6));
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  border-radius: 999px;
  padding: 4px 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dsq_noteDelete:hover {
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}

.dsq_noteDelete:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 视图级提示（定位失败、删除失败等）。 */
.dsq_notesNotice {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 18px;
  background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.04));
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
}

.dsq_notesError {
  color: var(--dsw-alias-label-error, #d4380d);
  background: var(--dsw-alias-bg-error, rgba(212, 56, 13, 0.08));
}

/* 定位结果浮层：跳转可能已经把笔记视图卸载掉，提示必须挂在 body 上才可靠。 */
.dsq_notesToast {
  position: fixed;
  z-index: 10062;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  max-width: min(560px, calc(100vw - 48px));
  padding: 8px 14px;
  border-radius: 999px;
  /* 与 .dsq_status 同一对 toast 语义 token：理由见该规则处的注释
     （bg-layer-3 与 label-primary-inverted 在真实主题下同值，会白底白字）。 */
  background: var(--dsw-alias-toast-bg, rgba(0, 0, 0, 0.78));
  color: var(--dsw-alias-toast-label, #fff);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  pointer-events: none;
}

/* 设置面板的全局「笔记」页（settings.section 槽位条目）。
   宿主把该槽位渲染进 .options（已自带 padding 与滚动），所以这里不再嵌套第二层滚动容器。 */
.dsq_settingsNotes {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
}

.dsq_settingsScope {
  flex: none;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.6));
}

.dsq_settingsSearch {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dsq_settingsInput {
  flex: 1 1 auto;
  min-width: 0;
  box-sizing: border-box;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.04));
  color: inherit;
  font: inherit;
  font-size: 13px;
}

.dsq_settingsInput:focus-visible {
  outline: 2px solid var(--dsw-alias-button-primary-fill, #1677ff);
  outline-offset: 1px;
}

.dsq_settingsClear {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.6));
  cursor: pointer;
}

.dsq_settingsClear:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}

/* 跨会话列表里必须能一眼看出这条笔记来自哪个会话，否则整列无法解读。 */
.dsq_settingsSession {
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
  font-weight: 500;
  overflow-wrap: anywhere;
}

.dsq_settingsMissing {
  color: var(--dsw-alias-label-error, #d4380d);
}

/* Annotation stack — inside the composer card (input.overlay), ~1/5 width. */
.dsq_cardStack {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 40;
  width: 20%;
  min-width: 148px;
  max-width: 220px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  pointer-events: auto;
}

/* One quote card. Geometry mirrors the product's own file card
   (.nyYjTG_file in ui-deliverables): hairline border, neutral fill,
   18px radius, fixed 72px row, centered content, background transition. */
.dsq_card {
  --dsq-card-fill: var(--dsw-static-neutral-50, #fafafa);
  --dsq-card-hover: var(--dsw-static-neutral-100, #f5f5f5);
  box-sizing: border-box;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  max-width: calc(25% - 5px);
  min-width: 0;
  height: 64px;
  margin: 0;
  padding: 10px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 18px;
  background: var(--dsq-card-fill);
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
  transition: background-color 0.12s;
  position: relative;
  overflow: hidden;
  user-select: none;
  pointer-events: auto;
}

.dsq_card:hover {
  background: var(--dsq-card-hover);
}

/* Scaled down from the reference 48px: the composer card is width-capped at a
   quarter of the input, so 48px would leave no room for the quote text. */
.dsq_cardIcon {
  z-index: 2;
  flex: none;
  width: 36px;
  height: 36px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--dsq-card-fill);
  color: var(--dsw-alias-link, rgba(0, 0, 0, 0.65));
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.dsq_cardBody {
  z-index: 2;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  /* Keeps the ellipsised title clear of the corner remove button. */
  padding-right: 14px;
}

.dsq_cardTitle {
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsq_cardSubtitle {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Corner remove button: hidden until the card is hovered or focused. */
.dsq_cardClose {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 3;
  appearance: none;
  border: none;
  background: transparent;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45));
  display: grid;
  place-items: center;
  font-size: 14px;
  line-height: 1;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s, background-color 0.12s;
}

.dsq_card:hover .dsq_cardClose,
.dsq_card:focus-within .dsq_cardClose,
.dsq_summary:hover .dsq_cardClose,
.dsq_summary:focus-within .dsq_cardClose {
  opacity: 1;
  pointer-events: auto;
}

.dsq_cardClose:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
}

/* Secondary corner action (edit comment). */
.dsq_cardAction {
  position: absolute;
  top: 4px;
  right: 28px;
  z-index: 3;
  appearance: none;
  border: none;
  background: transparent;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45));
  display: grid;
  place-items: center;
  font-size: 12px;
  line-height: 1;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s, background-color 0.12s;
}

.dsq_card:hover .dsq_cardAction,
.dsq_card:focus-within .dsq_cardAction {
  opacity: 1;
  pointer-events: auto;
}

.dsq_cardAction:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}

/* Qoder-style annotation summary (“N 条批注”) inside the composer. */
.dsq_summary {
  position: relative;
  z-index: 10040;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 100%;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 18px;
  background: var(--dsw-static-neutral-50, #fafafa);
  pointer-events: auto;
  user-select: none;
}

.dsq_summaryIcon {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-link, rgba(0, 0, 0, 0.65));
  font-size: 13px;
  font-weight: 600;
}

.dsq_summaryBody {
  flex: 1;
  min-width: 0;
  position: relative;
}

.dsq_summaryTitle {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
}

.dsq_summaryHint {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45));
}

.dsq_summaryHover {
  display: none;
  position: fixed;
  z-index: 10050;
  width: min(320px, calc(100vw - 16px));
  flex-direction: column;
  padding: 12px;
  /* Facing-side pad is set in JS from placement side; this is the base. */
  padding-top: 12px;
  padding-bottom: 12px;
  background: transparent;
  pointer-events: auto;
  opacity: 0;
}

/* Must come after .dsq_summaryHover (same class weight otherwise loses to display:none). */
.dsq_summaryHover.dsq_summaryHoverOpen {
  display: flex;
  transition: opacity 0.12s ease;
  animation: dsq-panel-in 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.dsq_summaryHover[data-side='bottom'] {
  transform-origin: top center;
}

.dsq_summaryHover[data-side='top'] {
  transform-origin: bottom center;
}

@keyframes dsq-panel-in {
  from {
    transform: scale(0.96);
  }
  to {
    transform: scale(1);
  }
}

.dsq_summaryHoverInner {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: min(420px, calc(100vh - 120px));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  border-radius: 14px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  /* Frosted panel: the menu token at partial alpha over a blur. */
  background: color-mix(in srgb, var(--dsw-specific-menu, #fff) 82%, transparent);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  box-shadow: var(--dsw-elevation-prominent, 0 3px 8px rgba(0, 0, 0, 0.04), 0 0 20px rgba(0, 0, 0, 0.05));
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .dsq_summaryHoverInner {
    background: var(--dsw-specific-menu, #fff);
  }
}

.dsq_summaryItem {
  display: block;
  padding: 8px 10px;
  border-radius: 10px;
  transition: background-color 0.12s;
}

.dsq_summaryItem:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}

.dsq_summaryItemHead {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dsq_summaryItemBadge {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--dsw-static-blue-500, #3b82f6);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.dsq_summaryItemActions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  opacity: 0.5;
  transition: opacity 0.12s;
}

.dsq_summaryItem:hover .dsq_summaryItemActions,
.dsq_summaryItem:focus-within .dsq_summaryItemActions {
  opacity: 1;
}

.dsq_summaryItemAction {
  appearance: none;
  border: none;
  background: transparent;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45));
  display: grid;
  place-items: center;
}

.dsq_summaryItemAction:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
}

.dsq_summaryItemMain {
  min-width: 0;
}

.dsq_summaryItemButton {
  appearance: none;
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 8px;
  padding: 2px 0 0;
}

.dsq_annAnchor {
  display: block;
  width: 100%;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

.dsq_summaryItemLabel {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45));
}

.dsq_summaryItemText {
  font-size: 13px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dsq_summaryItemTextEmpty {
  color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45));
}

/* Inline edit form rendered inside the hover panel item (no extra layer). */
.dsq_annEditText {
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 132px;
  overflow-y: auto;
  margin: 2px 0 6px;
}

.dsq_annEditInput {
  box-sizing: border-box;
  width: 100%;
  min-height: 72px;
  resize: vertical;
  border: none;
  border-radius: 10px;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04));
  outline: none;
}

.dsq_annEditInput::placeholder {
  color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45));
}

.dsq_annEditActions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

.dsq_annEditCancel {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.65));
  font: inherit;
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 999px;
  cursor: pointer;
}

.dsq_annEditCancel:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}

.dsq_annEditSave {
  appearance: none;
  border: none;
  background: var(--dsw-static-blue-500, #3b82f6);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 16px;
  border-radius: 999px;
  cursor: pointer;
  transition: filter 0.12s;
}

.dsq_annEditSave:hover {
  filter: brightness(1.06);
}

.dsq_annEditSave:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Inline comment composer under the floating selection toolbar. */
.dsq_commentPop {
  position: fixed;
  z-index: 10050;
  transform: translate(-50%, 4px);
  width: min(320px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 14px;
  background: color-mix(in srgb, var(--dsw-specific-menu, #fff) 88%, transparent);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  box-shadow: var(--dsw-elevation-prominent, 0 3px 8px rgba(0, 0, 0, 0.04), 0 0 20px rgba(0, 0, 0, 0.05));
}

.dsq_commentInput {
  box-sizing: border-box;
  width: 100%;
  min-height: 64px;
  resize: none;
  border: none;
  border-radius: 10px;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04));
  outline: none;
}

.dsq_commentInput::placeholder {
  color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45));
}

.dsq_commentActions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

/* Transcript cards — in-flow Chat node (conversation history), stacked. */
.dsq_tCardStack {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  margin: 4px 0 8px;
  /* Match composer summary width; sit on the user-bubble side (right). */
  width: 20%;
  min-width: 148px;
  max-width: 220px;
  margin-left: auto;
  margin-right: 0;
}

.dsq_tCard {
  --dsq-card-fill: var(--dsw-static-neutral-50, #fafafa);
  --dsq-card-hover: var(--dsw-static-neutral-100, #f5f5f5);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  max-width: min(calc(var(--dsh-chat-content-width, 748px) * 0.72), 520px);
  min-width: 0;
  height: 64px;
  margin: 0 0 0 auto;
  padding: 10px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 18px;
  background: var(--dsq-card-fill);
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
  transition: background-color 0.12s;
  position: relative;
  overflow: hidden;
  user-select: none;
}

.dsq_tCard:hover {
  background: var(--dsq-card-hover);
}

.dsq_tCardIcon {
  z-index: 2;
  flex: none;
  width: 40px;
  height: 40px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--dsq-card-fill);
  color: var(--dsw-alias-link, rgba(0, 0, 0, 0.65));
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.dsq_tCardBody {
  z-index: 2;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.dsq_tCardTitle {
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsq_tCardSubtitle {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Replacement user bubble (quote block stripped from display). */
.dsq_userRow {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.dsq_userStack {
  min-width: 0;
  max-width: min(calc(var(--dsh-chat-content-width, 748px) * 0.702), 82%);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.dsq_userBubble {
  max-width: 100%;
  padding: 10px 16px;
  border-radius: 22px;
  background: var(--dsw-specific-bubble, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, rgba(0, 0, 0, 0.88));
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(22px + var(--dsh-content-font-delta, 0px));
  white-space: pre-wrap;
  word-break: break-word;
}

/* Reserve room for the floating quote cards inside the composer card, so the
   attachment rail and the editor flow below them instead of being covered. */
.dsq_cardPad {
  padding-top: var(--dsq-quote-pad, 88px) !important;
}

/* Durable message images of a replacement user bubble. */
.dsq_userImages {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  max-width: 100%;
}

/* Dark theme: the product flips its palette on body[data-ds-dark-theme], and
   every --dsw-alias-* token follows it. Only the card fill is ours. */
body[data-ds-dark-theme] .dsq_card,
body[data-ds-dark-theme] .dsq_tCard {
  --dsq-card-fill: var(--dsw-static-neutral-850, #212123);
  --dsq-card-hover: var(--dsw-static-neutral-800, #292929);
}

/* Model-written :dsh-annotation{index="N"} chips. */
.dsq_annDirective {
  appearance: none;
  display: inline-flex;
  align-items: center;
  margin: 0 2px;
  padding: 0 6px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 6px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-link, #1677ff);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  vertical-align: baseline;
}

.dsq_annDirective:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.08));
}

/* Inline annotation mark in message bodies: highlight underline + ordinal badge. */
.dsq_annMark {
  --dsq-mark-color: var(--dsw-static-blue-500, #3b82f6);
  --dsq-mark-tint: var(--dsw-static-blue-50p, #eaf3ff);
  background: var(--dsq-mark-tint);
  text-decoration: underline;
  text-decoration-style: dashed;
  text-decoration-color: var(--dsq-mark-color);
  text-decoration-thickness: 2px;
  text-underline-offset: 2px;
  border-radius: 2px;
  scroll-margin-block: 96px;
  transition: background-color 0.12s;
}

/* Ordinal as a superscript corner badge at the END of the marked text, so it
   never sits between the reader and the sentence. Only the last fragment of a
   multi-fragment mark carries the index, so the number appears exactly once. */
.dsq_annMark[data-dsq-ann-index]::after {
  content: attr(data-dsq-ann-index);
  display: inline-grid;
  place-items: center;
  min-width: 15px;
  height: 15px;
  margin-left: 2px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--dsq-mark-color);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  vertical-align: super;
}

.dsq_annMark:hover {
  background: var(--dsw-static-blue-75, #e5f0ff);
}

.dsq_annMarkFlash {
  animation: dsq-ann-flash 1.4s ease-out;
}

@keyframes dsq-ann-flash {
  0% {
    background: var(--dsq-mark-color);
    color: #fff;
  }
  100% {
    background: var(--dsq-mark-tint);
    color: inherit;
  }
}

body[data-ds-dark-theme] .dsq_annMark {
  --dsq-mark-tint: var(--dsw-static-blue-950, #172554);
}
`

const TAG_ID = '@xb18/dsh-select-quote/toolbar.css'
export function ensureToolbarStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${TAG_ID}"]`)) return
  const tag = document.createElement('style')
  // data-plugin 是 DSH 的样式归属键：client-modules 以 bundle id（= 包名）认领并回收
  // 本插件注入的 <style>（HMR 记账），因此这里必须与 package.json 的 name 逐字符一致。
  tag.dataset.plugin = '@xb18/dsh-select-quote'
  tag.dataset.pluginCss = TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

export const styles = {
  toolbar: 'dsq_toolbar',
  button: 'dsq_button',
  divider: 'dsq_divider',
  status: 'dsq_status',
  cardStack: 'dsq_cardStack',
  card: 'dsq_card',
  cardIcon: 'dsq_cardIcon',
  cardBody: 'dsq_cardBody',
  cardTitle: 'dsq_cardTitle',
  cardSubtitle: 'dsq_cardSubtitle',
  cardClose: 'dsq_cardClose',
  cardPad: 'dsq_cardPad',
  cardAction: 'dsq_cardAction',
  summary: 'dsq_summary',
  summaryIcon: 'dsq_summaryIcon',
  summaryBody: 'dsq_summaryBody',
  summaryTitle: 'dsq_summaryTitle',
  summaryHint: 'dsq_summaryHint',
  summaryHover: 'dsq_summaryHover',
  summaryItem: 'dsq_summaryItem',
  summaryItemLabel: 'dsq_summaryItemLabel',
  summaryItemText: 'dsq_summaryItemText',
  summaryItemBadge: 'dsq_summaryItemBadge',
  summaryItemMain: 'dsq_summaryItemMain',
  summaryItemHead: 'dsq_summaryItemHead',
  summaryItemTextEmpty: 'dsq_summaryItemTextEmpty',
  annEditText: 'dsq_annEditText',
  annEditInput: 'dsq_annEditInput',
  annEditActions: 'dsq_annEditActions',
  annEditCancel: 'dsq_annEditCancel',
  annEditSave: 'dsq_annEditSave',
  summaryHoverInner: 'dsq_summaryHoverInner',
  summaryItemButton: 'dsq_summaryItemButton',
  summaryHoverOpen: 'dsq_summaryHoverOpen',
  summaryItemActions: 'dsq_summaryItemActions',
  summaryItemAction: 'dsq_summaryItemAction',
  annDirective: 'dsq_annDirective',
  annAnchor: 'dsq_annAnchor',
  annMark: 'dsq_annMark',
  annMarkFlash: 'dsq_annMarkFlash',
  notesView: 'dsq_notesView',
  notesHead: 'dsq_notesHead',
  notesCount: 'dsq_notesCount',
  notesEmpty: 'dsq_notesEmpty',
  notesEmptyTitle: 'dsq_notesEmptyTitle',
  notesEmptyHint: 'dsq_notesEmptyHint',
  notesList: 'dsq_notesList',
  noteRow: 'dsq_noteRow',
  noteMain: 'dsq_noteMain',
  noteText: 'dsq_noteText',
  noteMeta: 'dsq_noteMeta',
  noteDelete: 'dsq_noteDelete',
  notesNotice: 'dsq_notesNotice',
  notesError: 'dsq_notesError',
  notesToast: 'dsq_notesToast',
  settingsNotes: 'dsq_settingsNotes',
  settingsScope: 'dsq_settingsScope',
  settingsSearch: 'dsq_settingsSearch',
  settingsInput: 'dsq_settingsInput',
  settingsClear: 'dsq_settingsClear',
  settingsSession: 'dsq_settingsSession',
  settingsMissing: 'dsq_settingsMissing',
  commentPop: 'dsq_commentPop',
  commentInput: 'dsq_commentInput',
  commentActions: 'dsq_commentActions',
  tCardStack: 'dsq_tCardStack',
  tCard: 'dsq_tCard',
  tCardIcon: 'dsq_tCardIcon',
  tCardBody: 'dsq_tCardBody',
  tCardTitle: 'dsq_tCardTitle',
  tCardSubtitle: 'dsq_tCardSubtitle',
  userRow: 'dsq_userRow',
  userStack: 'dsq_userStack',
  userImages: 'dsq_userImages',
  userBubble: 'dsq_userBubble',
} as const
