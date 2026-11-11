# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A vanilla HTML/CSS/JavaScript todo app ("My Tasks"). There is no build step, package manager, framework, linter, or test suite. To run it, open `index.html` directly in a browser. The UI text and code comments are in Korean. `script.js` is split into numbered sections (1. 상수 … 15. 초기화), and its header comment summarizes the data flow.

## Responsive layout

There is a single responsive layout. An earlier mobile-only card layout and a separate `web_version/` folder were merged into it.
- At 1280 px and up it's three columns: sidebar (`.sidebar`: brand, category nav, data actions, shortcuts) | `.main` | `.insights` (`.theme-row` with the dark-mode switch at the top right, then quote and stats).
- From 900 to 1279 px it's two columns, with `.insights` moved above `.main`. From 900 to 1099 px the sidebar narrows to 220 px. The 900 px threshold is chosen so that a 1366 px laptop at 150% scaling (about 910 CSS px) still gets two columns.
- At 899 px and below it's one column. `.sidebar` and `.insights` become `display: contents`, each block gets an `order` (brand → quote → stats → filters → main → data actions), and `.theme-row` is absolutely positioned at the top right of `.app-shell`. At 480 px and below, touch targets grow to at least 44 px and the add form wraps.
- Content in `.main` is capped at `--content-max` (1040 px) and centered by `.app-shell > .main > *`. That selector is intentionally more specific than `.todo-list { margin: 0 }`, which used to override the centering. Inside a todo row, the category tag and time follow the text directly (`.todo-meta { margin-right: auto }`); they are not pushed to the far right.
- Short screens (`min-width: 900px and max-height: 820px`) get a compact sidebar. The shortcut list is a `<details>` that an inline script opens only when `innerHeight >= 900`, so the sidebar doesn't overflow on 768 px laptops.
- Keep the theme switch out of the sidebar's brand row. With a two-digit badge and a sidebar scrollbar on short screens, title + badge + switch overflowed and the switch covered the badge.
- Headless screenshots near a breakpoint can mix styles from both layouts. The window starts about 30 px narrower than `--window-size`, and the transitions that follow are frozen by virtual time. Check `getComputedStyle` before treating a mixed screenshot as a CSS bug.
- The side panels are `position: sticky`, and the list scrolls with the window. Don't give the list its own scroll container: drag auto-scroll uses `window.scrollBy`.

## Verifying changes

There is no test runner. To check behavior without a browser extension, copy the three files into a scratch directory, add a `<script>` after `script.js` that drives the UI and appends PASS/FAIL lines to the page, and run headless Edge:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --user-data-dir=<fresh temp dir> --virtual-time-budget=30000 --dump-dom file:///<path>/index.html
```

- Top-level `let`/`function` bindings in `script.js` (`todos`, `render`, `importFromFile`, `elementCache`, …) are visible to the test script.
- Stub `downloadJSON = (data, name) => …` to capture exports.
- Drive imports with `importFromFile(new File([json], 'x.json', { type: 'application/json' }))`.
- Answer dialogs by clicking `#dialog-actions button[value="…"]`, then wait a tick. First poll until `#app-dialog` is `open`: `File.text()` can be slower than a fixed delay, and the old buttons stay in the DOM.
- Drag tests can dispatch synthetic `PointerEvent`s on a `.drag-handle` (down) and on `document.body` (move/up).
- Synthetic `.click()` doesn't move focus. Call `.focus()` first when the test depends on `focusout`, as inline editing does.
- `--virtual-time-budget` freezes `performance.now()`, so measure performance with a synchronous script and no virtual-time flag.
- CSS transitions don't finish under virtual time, so check colors on a fresh page load instead. To start in a given state, write to localStorage from a page in the same directory, then `location.replace` to the app.
- Use `--screenshot=<file>.png --window-size=800,900` for a visual check. Headless Edge won't render narrower than about 500 px, so the `max-width: 480px` layout can't be checked this way.
- Use a fresh user-data dir per run, because localStorage persists in it.
- In PowerShell, variable names are case-insensitive. A loop variable `$s` overwrites `$S`.

## Architecture

### State and rendering
- The source of truth is `todos`, `trash`, `currentFilter`, `currentSort` and `searchQuery`. The order of the `todos` array is the "직접 정렬" (manual) order.
- Every mutation follows the same pattern: update state, call `saveTodos()`, then call `render()`.
- `saveTodos()` is debounced (300 ms). `flushSave()` writes immediately; it runs on `pagehide`, `visibilitychange` and before exports.
- `render()` uses keyed reconciliation, not a full rebuild:
  - `elementCache` maps each todo id to `{ el, signature }`. The signature is text + category + search query. A cached `<li>` is reused when the signature matches.
  - `completed` is synced in place by `syncCompletedState()`.
  - `reconcileList()` moves only out-of-place nodes.
  - Reusing nodes is what keeps focus and an open inline editor alive across renders. If you change how an item looks, add the relevant field to the signature, or delete the item's cache entry before rendering.
- `render()` also handles:
  - **Focus**: `captureFocus()` and `restoreFocus()` put focus back on the same control, or the neighbor's control if the item was deleted, or the add input if the list is empty.
  - **Reorder animation (FLIP)**: positions are read in one batch, then written; only items near the viewport animate.
  - **One-shot animations** from `pendingAnimation`. The animation classes are removed again on `animationend`, so reused nodes can replay them.
- `render()` is a no-op while a pointer drag is in progress. It sets `renderAfterDrag`, and `endDrag()` renders afterwards.
- `getVisibleTodos()` filters by category and search (case-insensitive substring), then calls `sortTodos()`. `status` and `category` sorts are stable sorts over array order, `created` is newest first, and `manual` is array order. Never sort `todos` in place, except where `commitMove()` deliberately bakes the `created` order into the array before switching to `manual`.
- `renderStats()` makes a single pass over all todos, regardless of filter or search. It updates the dashboard, the cheer message, the remaining badge, and the disabled state of the clear and export buttons. The dashboard is static markup; don't rebuild it, or the progress-bar transitions stop animating.

### Features spanning several functions
- **Drag reorder** (section 8) uses Pointer Events, not HTML5 DnD, so that touch works.
  - The dragged `<li>` is never moved in the DOM, which keeps pointer capture and focus. Its siblings are moved around it.
  - On drop, `commitMove(id, { targetId, position })` applies the move relative to the visible neighbor.
  - Keyboard alternative: ArrowUp/ArrowDown on a focused `.drag-handle`. Escape cancels a drag.
  - In `status` and `category` sorts, a move across groups snaps back with a warning toast. In `created` sort, the first move switches to `manual`.
- **Deletion and undo**: `removeWithAnimation()` → `removeTodos()` moves items into `trash` as `{ todo, index, deletedAt, batchId }`.
  - `trash` is persisted under `todosTrash`, with a cap of 50 entries and 7 days. `trimTrash()` never splits the newest batch.
  - Undo goes through `restoreEntries()`, which re-inserts items at their original indexes. It's reached from the toast's "실행 취소" button, from Ctrl+Z outside text fields (newest batch), and from the trash dialog (single entry).
- **Dialogs**: `showDialog({ title, message, body, buttons })` returns a Promise of the clicked button's `value`, or `null`.
  - The result is delivered through `settleDialog`, from the form's `submit` event (`e.submitter.value`), the `cancel` event (Escape) or a backdrop click. Don't rely on the asynchronous `close` event. It can arrive after the next dialog has opened, so the `close` fallback ignores it while `dialog.open` is true.
  - It falls back to `window.confirm` when `<dialog>` isn't supported.
  - The duplicate-add warning, clear-completed, import and trash all use it.
- **Import/export**:
  - Export writes `{ format: 'my-tasks', version: 1, exportedAt, count, todos }`.
  - `readImportFile()` validates the file and throws `ImportError` with a user-facing message. Checks are size ≤ 5 MB, `.json`, a stripped BOM, and either an export object or a bare array.
  - `applyImport()` either replaces or merges, skipping duplicates by id and normalized text + category. It keeps a snapshot for the toast's undo, and can first download a backup through `exportTodos({ backup: true })`.
- **Validation**: `sanitizeTodo()`/`sanitizeTodos()` is the single validation path for localStorage loads, imports and trash entries.
  - It normalizes text with `cleanText()`: NFC, control characters stripped, 200-character limit.
  - It regenerates ids that don't match `ID_PATTERN` or are duplicated; ids end up in DOM `id` attributes and `CSS.escape`d selectors.
  - It coerces `completed`, `createdAt` and `category`. Use `hasOwn`, not `in`, when checking categories, because of prototype keys.
  - If the stored `todos` can't be parsed, `loadTodos()` copies the raw string to `todos_corrupt_<timestamp>` and starts with an empty list.
- **Storage**: every localStorage call goes through the `storage` object. It detects when storage is unavailable, catches errors, and shows a throttled toast on `QuotaExceededError`.
  - Keys: `todos`, `todoFilter`, `todoSort`, `todoTheme`, `todosTrash`. Keep them and the todo schema `{ id, text, completed, createdAt, category }` backward compatible.
  - The cross-tab `storage` listener ignores incoming `todos` changes while this tab has an unsaved debounced write.
- **Keyword auto-categorization**: the rules live in `CATEGORY_KEYWORDS`, which `KEYWORD_MATCHERS` precompiles. Edit only the keyword lists.
  - Korean keywords match as substrings; avoid one-syllable keywords. ASCII keywords match on word boundaries only.
  - `classifyText(text)` scores each category by the number of matched keywords; a tie goes to the longest matched keyword. If it's still tied, it returns `null` (no guess).
  - Add form: `applyAutoCategory()` runs from the debounced `updateFormHints` and again synchronously on submit. It uses the `autoCategory` state `{ touched, applied, baseline }`.
    - Auto-picking a category records `baseline`; clearing the keyword restores it.
    - Choosing a category by hand (`change`) sets `touched`. From then on the app only shows a suggestion in `#category-hint` until the todo is added; `resetAutoCategory()` clears this.
    - `syncCategorySelect()` (filter default) respects this state.
  - Imports call `sanitizeTodos(..., { classifyMissing: true })`, so items with a missing or invalid category are classified; the dialog reports how many. Loading from localStorage does not reclassify: legacy items without a category still become `personal`.
- **Inline editing** (`startEdit`) is DOM-only state, opened by the pencil `.edit-btn`.
  - Enter saves; Escape cancels and calls `stopPropagation`. A `focusout` outside the editor also saves.
  - Enter during IME composition (`isComposing`) is ignored, which matters for Korean input.
  - Saving empty text is treated as a cancel.
  - `finish()` deletes the item's cache entry so it's rebuilt.
- **Limits** live in `LIMITS`: 1000 todos max, enforced on add, import and restore.

### Accessibility conventions
- Checkboxes use `aria-labelledby` (the text span) and `aria-describedby` (the meta line).
- Icon buttons carry the todo text in `aria-label`.
- `announce()` writes to the visually hidden `#sr-announcer` for events that don't show a toast (search result counts, reorders, filter changes). `showToast()` is itself a `role="status"` live region, so don't announce the same thing twice.
- List keyboard navigation is one `keydown` listener on `#todo-list`. It ignores the inline editor and modifier keys.
  - On the drag handle, ArrowUp/ArrowDown reorder.
  - On other item controls, ArrowUp/ArrowDown move focus to the same control in the neighboring item. Home/End jump to the first/last item.
  - Enter on the checkbox opens the editor. Delete or Backspace deletes. Space stays native (it toggles the checkbox).
  - ArrowDown in the search box jumps to the first result.
- Keyboard shortcuts are one `document` keydown listener. It matches `e.code` so shortcuts work under the Korean IME, ignores input while a dialog is open, and only handles Ctrl+Z and `/` outside text fields (`isTextField`).

### Security
User text is only ever inserted with `textContent` or text nodes, including the search highlighting in `fillHighlightedText()`. `innerHTML` is used only for the constant `ICONS` markup.

### CSS
- All colors are tokens on `:root`, overridden under `:root[data-theme="dark"]` (which also sets `color-scheme`). Don't hardcode colors in rules.
- An inline script in `<head>` sets `data-theme` before CSS loads, to avoid a theme flash.
- `.theme-transition` is added to `<html>` for 400 ms during a theme switch.
- `.todo-item` uses `content-visibility: auto` for long lists.
- Responsive rules are at the end of the file; see "Responsive layout" above. Also there: `@media (hover: none)` keeps item buttons visible and hides the shortcut list on touch devices, and `prefers-reduced-motion` shortens durations to ~0 so `animationend` and `transitionend` handlers still fire.
