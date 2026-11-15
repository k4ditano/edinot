// Edinot — main editor component
// Cross-platform Markdown editor with live render toggle.

import MarkdownIt from 'markdown-it';
import mdTaskLists from 'markdown-it-task-lists';
import { highlightCode, langSelectHtml, withFenceLang, setNthFenceLang } from './editor/blocks/highlight.js';
import mdFootnote from 'markdown-it-footnote';
import { mdMath } from './editor/blocks/math.js';
import { splitWikiTarget, findAnchorLine, normHeading, BLOCK_ID_RE, anchorText } from './editor/blocks/anchors.js';
import { extractTitle, uniqueName, linesToDbRows } from './editor/blocks/transform.js';
import { embedFor, embedHtml } from './editor/blocks/embeds.js';
import { imageFileToDataUrl } from './editor/blocks/cover.js';
import { makeAnchor, resolveAnchor, commentRange, setCommentMarks, commentMarksField } from './editor/blocks/commentAnchors.js';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import { EditorView, keymap, drawSelection, dropCursor, highlightActiveLine, lineNumbers, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { EditorState, StateField, StateEffect, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree, ensureSyntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { autocompletion, acceptCompletion, startCompletion } from '@codemirror/autocomplete';
import {
  search, searchKeymap, openSearchPanel, closeSearchPanel,
  SearchQuery, setSearchQuery, getSearchQuery,
  findNext, findPrevious, replaceNext, replaceAll,
} from '@codemirror/search';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
// Vim (Ajustes › Editor) se carga bajo demanda: ~120 KB que casi nadie usa.
let vimModulePromise = null;
const loadVim = () => (vimModulePromise ||= import('@replit/codemirror-vim'));
import {
  ydoc, yVaults, yFolders, yFiles, ySettings, yMeta,
  yCommentsV2, yCommentRepliesV2, yAgentTasksV2,
  getContent, getContentString, setContent, deleteContent, mirrorContentToVault,
  migrateFromLocalStorage, seedDefaultsIfEmpty, whenIndexedDbReady,
  getSyncConfig, setSyncConfig, connectSync, disconnectSync, reconnectSync, resetSyncForReconnect, onSyncStatus, onPresence, onMcpAction, onAiPointer, onAiPresence, onAiAgents,
  isPerVaultMode, ensureActiveVaultProvider, getActiveVaultDoc, getActiveVaultId, listVaultRegistryEntries, getVaultDoc,
  trashFile, listTrash, restoreTrashed, purgeTrashed, purgeOldTrash, trashContents,
  connectNoteProvider, getNoteAwareness, getNoteDoc, listNoteRegistryEntries, isNoteSynced,
  whenVaultLocalReady, whenNoteLocalReady,
  readCanvasSnapshot, applyCanvasSnapshot, seedCanvasFromJson, serializeCanvasDeterministic, isCanvasMigrated, getCanvasUndoManager,
  getAllFilesAcrossVaults, getAllFoldersAcrossVaults, locateFileAcrossVaults,
  getVaultEvents, addEvent, updateEvent, deleteEvent, snoozeEvent, dismissEvent, isPendingReminder, eventAlarmAt,
  expandOccurrences, nextOccurrence, normalizeRecurrence,
  syncGoogleEvents, listPushableEvents,
  seedNoteContent, moveNoteAcrossVaults, moveFolderAcrossVaults,
  apiLogin, apiRefresh, apiRegister, apiMe, apiListWorkspaces, apiCreateWorkspace,
  apiDeleteWorkspace, apiListMembers, apiInviteMember, apiRemoveMember, apiUpdateMemberRole,
  apiListSnapshots, apiTakeSnapshot, apiGetSnapshotState, apiRestoreSnapshot, apiDeleteSnapshot,
  apiListVaultMembers, apiInviteVaultMember, apiUpdateVaultMemberRole, apiRemoveVaultMember,
  apiListAuditEvents,
  apiListNotifications, apiUnreadNotifCount, apiMarkNotifRead, apiMarkAllNotifsRead,
  apiDeleteNotif, apiDispatchNotif,
  apiListShareLinks, apiCreateShareLink, apiRevokeShareLink, apiSetShareLinkSubmit, apiSetShareLinkIncludeLinked,
  apiListAclGrants, apiUpsertAclGrant, apiRemoveAclGrant, apiListMyGrants,
  apiListPendingInvitations, apiCancelPendingInvitation, apiResendPendingInvitation,
  apiUploadBlob, apiGetQuota, apiDeleteBlob, apiBlobTextBatch, apiBlobMetaBatch,
  deriveWsUrl, getProvider,
} from './store.js';
import { t, useI18n, setLang, getLang, supportedLangs } from './i18n.js';
import { canvasTemplateInfo, buildCanvasTemplate } from './shared/canvas-templates.js';
import { addOwnCanvas, withPageNode, pageText, ownCanvasRange } from './shared/page-canvas.js';
import { ReadFind } from './ui/find/ReadFind.jsx';
import { countLabel } from './ui/find/dom-find.js';
import { CanvasDock, CanvasActions, CanvasZoom, CvIcon } from './ui/canvas/CanvasChrome.jsx';
import { Icon as ShIcon } from './ui/shell/icons.jsx';
import { DEFAULT_AI_INSTRUCTIONS, defaultAiInstructions } from './shared/ai-defaults.js';
import {
  readCommentsMap, readNoteComments, readAgentTasks,
  putComment, patchComment, patchComments, deleteComments, addCommentReply,
  putAgentTasks, patchAgentTask,
} from './shared/comments-model.js';
import { perfMark, perfReportBoot, perfTime, perfCountRender } from './perf.js';
import { gsFold, gsFoldWithMap, searchableContent, gsQueryTerms } from './ui/search/core.js';
import { searchIndex } from './ui/search/client.js';
// Re-exported for the lazy canvas chunk (it imports them from editor.jsx).
export { gsFold, searchableContent };
import { EMOJI_FOLDER_SET, EMOJI_FILE_SET } from './ui/shared/emoji.js';
import { Sidebar } from './ui/shell/Sidebar.jsx';
import { Topbar } from './ui/shell/Topbar.jsx';
import { ContextPanel } from './ui/shell/ContextPanel.jsx';
import { FloatingOutline } from './ui/shell/FloatingOutline.jsx';
import { TrashModal } from './ui/modals/TrashModal.jsx';
import { CommandPalette } from './ui/palette/CommandPalette.jsx';
import { buildCommands } from './ui/palette/commands.js';
import { HomePage } from './ui/home/HomePage.jsx';
import { AllNotesPage } from './ui/allnotes/AllNotesPage.jsx';
import { dailyNoteName, findDailyNote, findDailyTemplate, defaultDailyBody } from './ui/shared/daily.js';
import { THEMES, SYSTEM_THEME, resolveThemeKey, usePrefersDark, usePrefersReducedMotion, themeBootPayload } from './ui/shared/themes.js';
import { effectiveBindings, matchShortcut, menuAccelerators, setActiveBindings, isBareTypingCombo, kbdHint } from './ui/shared/shortcuts.js';
import { lazyModule, withLazy, prefetchWhenIdle, PageSkeleton, BlockSkeleton } from './ui/shared/lazy.jsx';
// Páginas completas que no hacen falta para arrancar: cada una en su chunk.
const loadCalendarPage = lazyModule(() => import('./ui/calendar/CalendarPage.jsx'));
const loadSettingsPage = lazyModule(() => import('./ui/settings/SettingsPage.jsx'));
const CalendarPage = withLazy(loadCalendarPage, 'CalendarPage', { fallback: <PageSkeleton /> });
const SettingsPage = withLazy(loadSettingsPage, 'SettingsPage', { fallback: <PageSkeleton /> });
// Canvas (editor/canvas/CanvasView.jsx, ~4.000 líneas): sólo cuando se abre
// una nota canvas o una nota con un canvas/embed en línea.
const loadCanvasView = lazyModule(() => import('./editor/canvas/CanvasView.jsx'));
const CanvasView = withLazy(loadCanvasView, 'CanvasView', { fallback: <BlockSkeleton height={420} /> });
const CanvasEmbedPreview = withLazy(loadCanvasView, 'CanvasEmbedPreview', { fallback: <BlockSkeleton height={140} /> });
// Modales poco frecuentes (historial, compartir, auditoría, imagen, PDF) y
// los formularios en línea: un chunk cada grupo, montado sólo al abrirse.
const loadNoteModals = lazyModule(() => import('./ui/modals/NoteModals.jsx'));
const HistoryModalLazy = withLazy(loadNoteModals, 'HistoryModal');
const NoteShareModalLazy = withLazy(loadNoteModals, 'NoteShareModal');
const FolderShareModalLazy = withLazy(loadNoteModals, 'FolderShareModal');
const VaultShareModalLazy = withLazy(loadNoteModals, 'VaultShareModal');
const AuditModalLazy = withLazy(loadNoteModals, 'AuditModal');
const ImageModal = withLazy(loadNoteModals, 'ImageModal');
const PdfModal = withLazy(loadNoteModals, 'PdfModal');
const HistoryModal = (p) => (p.open ? <HistoryModalLazy {...p} /> : null);
const NoteShareModal = (p) => (p.open ? <NoteShareModalLazy {...p} /> : null);
const FolderShareModal = (p) => (p.folder ? <FolderShareModalLazy {...p} /> : null);
const VaultShareModal = (p) => (p.vault ? <VaultShareModalLazy {...p} /> : null);
const AuditModal = (p) => (p.workspaceId ? <AuditModalLazy {...p} /> : null);
const loadFormBlocks = lazyModule(() => import('./editor/forms/FormBlocks.jsx'));
const FormView = withLazy(loadFormBlocks, 'FormView', { fallback: <BlockSkeleton height={260} /> });
const FormBuilderModalLazy = withLazy(loadFormBlocks, 'FormBuilderModal');
const FormBuilderModal = (p) => (p.state ? <FormBuilderModalLazy {...p} /> : null);
import { matchFilter as dbMatchFilter, parseNameList as dbParseNameList, serializeNameList as dbSerializeNameList, parseNameClause as dbParseNameClause, parseJsonClause as dbParseJsonClause, serializeJsonClause as dbSerializeJsonClause, sanitizeOptColors as dbSanitizeOptColors, sanitizeViews as dbSanitizeViews, renameInExt as dbRenameInExt, parseWideClause as dbParseWideClause, serializeWideClause as dbSerializeWideClause } from './editor/db/model.js';
import { taskManagerTemplate, TASK_TEMPLATE_NAMES } from './editor/db/templates.js';
import { readMaxWidth } from './ui/shared/readWidth.js';
import { mountDbBlock, mountLinkedDb, sweepDbBlocks, loadDatabaseBlock } from './editor/db/mount.jsx';
import { LINKED_LANG, parseLinkedConfig, replaceLinkedFence, linkedFence, resolveLinkedTable, virtualSource } from './editor/db/linked.jsx';
import { NoteBacklinks } from './ui/shell/NoteBacklinks.jsx';
import { buildTableIndex, buildTagIndex } from './ui/shared/workspaceIndex.js';
import { blockEditorExtensions, blockPageMeta } from './editor/blocks/livePreview.js';
import { blocksMarkdownIt } from './editor/blocks/markdownIt.js';
import { BlockUI } from './editor/blocks/BlockUI.jsx';
import { injectPageHeader, parseProps, writeProps } from './editor/blocks/props.js';
import { blockBus } from './editor/blocks/bus.js';

const { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useDeferredValue } = React;

// Ejecuta `fn` cuando el hilo esté libre (o como tarde a los `timeout` ms).
// Para trabajo de arranque que no afecta al primer frame. Devuelve cancel.
function runWhenIdle(fn, timeout = 3000) {
  if (typeof requestIdleCallback === 'function') {
    const h = requestIdleCallback(fn, { timeout });
    return () => cancelIdleCallback(h);
  }
  const h = setTimeout(fn, Math.min(timeout, 1500));
  return () => clearTimeout(h);
}

// ── AI highlight helpers ──────────────────────────────────────────────
// Two surfaces, two paths. In markdown mode the CodeMirror selection
// gives us a native, accessible highlight tied to source offsets. In
// render mode markdown-it has already chewed the source into HTML and
// the offsets don't survive, so we walk text nodes inside the rendered
// container, build a Range over the matching substring, and use the
// CSS Custom Highlight API (CSS.highlights) to paint it without
// modifying the DOM tree — Chromium 105+ supports it, and Edinot's
// Electron 33 ships Chromium 130, so it's safe.

function highlightInCm(cmView, pointer) {
  if (!cmView) return;
  try {
    const docLen = cmView.state.doc.length;
    const from = Math.max(0, Math.min(docLen, Number(pointer.fromCh) || 0));
    const to = Math.max(0, Math.min(docLen, Number(pointer.toCh) || 0));
    if (from === to) return;
    // Centre the highlight in the viewport instead of CM's default
    // "minimum scroll" behaviour, which only scrolls enough to expose
    // the selection's edge — fine for typing, terrible for AI present-
    // mode where the callout bubble appears below the highlight and
    // pushes itself off-screen on long notes.
    cmView.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    });
    cmView.focus();
  } catch (err) {
    console.warn('[ai-pointer] CM highlight failed:', err);
  }
}

// Strip the markdown syntax most likely to appear inside a short
// passage so the literal substring search in the rendered DOM still
// matches when the AI gave us text with **bold** or [link](url).
function stripInlineMd(s) {
  return String(s || '')
    // Code spans first — content inside backticks is opaque, the other
    // rules must not touch it (otherwise an underscore inside `foo_bar`
    // gets eaten by the italic regex and the DOM text no longer matches).
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // Single * / _ italics: only strip when the delimiter sits at a word
    // boundary, so identifiers like journal_append stay intact.
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1$2')
    .replace(/(^|[^\w_])_([^_\n]+)_(?=[^\w_]|$)/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/^[-*+]\s+/gm, '');
}

// Build the candidate search strings derived from a single source passage.
// Order matters: most-specific first (raw text) → progressively looser
// fallbacks. The renderer flattens markdown (strips marks, collapses
// whitespace, unescapes table `\|`), so we mirror those transformations
// before searching the DOM textContent.
function buildSearchVariants(text) {
  if (!text) return [];
  const raw = String(text);
  const variants = [
    raw.trim(),
    stripInlineMd(raw).trim(),
    // Tables: source may carry `\|` for escaped pipes; rendered DOM shows `|`.
    raw.replace(/\\\|/g, '|').trim(),
    stripInlineMd(raw).replace(/\\\|/g, '|').trim(),
    // Whitespace normalization for either form (markdown often collapses
    // multiple spaces / newlines to a single space).
    raw.replace(/\s+/g, ' ').trim(),
    stripInlineMd(raw).replace(/\\\|/g, '|').replace(/\s+/g, ' ').trim(),
  ];
  return variants.filter((s, i, arr) => s && arr.indexOf(s) === i);
}

function findTextRangeInDom(container, text) {
  if (!container || !text) return null;
  const variants = buildSearchVariants(text);
  if (!variants.length) return null;
  // Collect text nodes with their offset into a single concatenated
  // textContent string. Same approach window.find() takes internally.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let flat = '';
  let n;
  while ((n = walker.nextNode())) {
    // Skip script/style/whitespace-only nodes; they confuse offsets and
    // can't visibly contain user-facing text.
    const parentTag = n.parentElement && n.parentElement.tagName;
    if (parentTag === 'SCRIPT' || parentTag === 'STYLE') continue;
    nodes.push({ node: n, start: flat.length });
    flat += n.textContent;
  }
  // Build a whitespace-normalized version of `flat` so the normalized
  // variant can match against text that came in with NBSPs / runs of
  // spaces. We keep both because the offsets differ; we always pick the
  // first match and convert back to original offsets via the node index.
  const flatNorm = flat.replace(/\s+/g, ' ');
  for (const v of variants) {
    let idx = flat.indexOf(v);
    let useLen = v.length;
    if (idx < 0) {
      // Try the normalized search. We can't trivially map normalized
      // offsets back to original-flat offsets, so use a character walker:
      // step through `flat` collapsing whitespace and stop when accumulated
      // normalized chars equal the matched offset.
      const idxNorm = flatNorm.indexOf(v);
      if (idxNorm < 0) continue;
      let origStart = -1, origEnd = -1;
      let normPos = 0;
      let prevWs = false;
      for (let i = 0; i <= flat.length; i++) {
        if (normPos === idxNorm && origStart < 0) origStart = i;
        if (normPos === idxNorm + v.length) { origEnd = i; break; }
        if (i === flat.length) break;
        const c = flat[i];
        const isWs = /\s/.test(c);
        if (isWs) {
          if (!prevWs) normPos++;
        } else {
          normPos++;
        }
        prevWs = isWs;
      }
      if (origStart < 0 || origEnd < 0) continue;
      idx = origStart;
      useLen = origEnd - origStart;
    }
    const endIdx = idx + useLen;
    let startNode = null, startOff = 0;
    let endNode = null, endOff = 0;
    for (const { node, start } of nodes) {
      const end = start + node.textContent.length;
      if (!startNode && idx >= start && idx <= end) {
        startNode = node;
        startOff = idx - start;
      }
      if (endIdx > start && endIdx <= end) {
        endNode = node;
        endOff = endIdx - start;
        break;
      }
    }
    if (startNode && endNode) {
      const range = document.createRange();
      try {
        range.setStart(startNode, startOff);
        range.setEnd(endNode, endOff);
        return range;
      } catch { /* try next variant */ }
    }
  }
  // Last-resort prefix fallback — locate the longest shared prefix of the
  // first non-empty variant against the flat text. Useful when the source
  // included trailing markdown that's gone from the DOM (e.g. a closing
  // backtick) or vice versa. Min 12 chars to avoid spurious matches.
  const seed = variants[0];
  for (let len = Math.min(seed.length, 200); len >= 12; len -= 4) {
    const prefix = seed.slice(0, len);
    const idx = flat.indexOf(prefix);
    if (idx < 0) continue;
    const endIdx = idx + len;
    let startNode = null, startOff = 0, endNode = null, endOff = 0;
    for (const { node, start } of nodes) {
      const end = start + node.textContent.length;
      if (!startNode && idx >= start && idx <= end) { startNode = node; startOff = idx - start; }
      if (endIdx > start && endIdx <= end) { endNode = node; endOff = endIdx - start; break; }
    }
    if (startNode && endNode) {
      const range = document.createRange();
      try { range.setStart(startNode, startOff); range.setEnd(endNode, endOff); return range; } catch {}
    }
  }
  return null;
}

// Walk up the DOM looking for an ancestor with an overflowing scroll area.
// We use this both for positioning highlights and for attaching scroll
// listeners that re-anchor the floating AI callout.
function findScrollableAncestor(el) {
  let node = el && el.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    const oy = style.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

// Scroll the render pane so the highlighted range sits ~28% from the pane
// top (leaving room below for the AI callout). Returns false when the range
// has no on-screen geometry — text hidden behind an alternate table view
// (kanban/cards/list), a collapsed wrapper, etc. — so callers can fall back
// to a corner callout instead of scrolling somewhere wrong (a 0×0 rect at
// (0,0) used to drag the pane to the top of the note).
//
// Two quirks this handles that a plain findScrollableAncestor(target)
// scroll did not:
// - Nested scrollers: a table body / code block wrapper with a couple px of
//   vertical overflow used to capture the whole scroll, so the PANE never
//   moved. scrollIntoView first (it walks every scrollable ancestor), then
//   a precise pass on the pane — resolved from `container`, not the target.
// - Late layout shifts: images/PDF frames finishing load after the scroll
//   push the passage further down. One corrective pass after ~220ms.
function scrollRenderRangeIntoView(container, range, opts = {}) {
  if (!container || !range) return false;
  const target = range.startContainer && (range.startContainer.parentElement || range.startContainer);
  if (!target || typeof target.getBoundingClientRect !== 'function') return false;
  let r;
  try { r = range.getBoundingClientRect(); } catch { return false; }
  if (!r || (!r.width && !r.height)) return false;
  try { target.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch {}
  const pane = findScrollableAncestor(container) || findScrollableAncestor(target) || container;
  const ratio = opts.anchorRatio != null ? opts.anchorRatio : 0.28;
  const place = () => {
    try {
      const rr = range.getBoundingClientRect();
      if (!rr || (!rr.width && !rr.height)) return;
      const pr = pane.getBoundingClientRect();
      const desiredTop = pr.top + pr.height * ratio;
      const delta = rr.top - desiredTop;
      const maxScroll = Math.max(0, pane.scrollHeight - pane.clientHeight);
      const nextTop = Math.max(0, Math.min(maxScroll, pane.scrollTop + delta));
      if (Math.abs(nextTop - pane.scrollTop) > 4) pane.scrollTo({ top: nextTop, behavior: 'auto' });
    } catch { /* pane detached mid-flight — nothing to do */ }
  };
  place();
  setTimeout(place, 220);
  return true;
}

function highlightInRenderDom(container, text) {
  if (!container) return false;
  // Old Chromium / non-electron environments — bail quietly.
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return false;
  const range = findTextRangeInDom(container, text);
  if (!range) return false;
  const hl = new Highlight(range);
  CSS.highlights.set('ai-highlight', hl);
  // Scroll the passage into view AND leave room below for the AI callout
  // (~160px). Target position: top of highlight at ~28% from the scroller
  // top. Clamp to scroll bounds so a near-bottom highlight scrolls as far
  // as possible (placeCallout then docks above if there's no room below).
  // Use 'auto' instead of 'smooth' so the recompute fires against the
  // final position immediately — smooth scroll left the callout glued
  // to the pre-scroll rect on long notes.
  scrollRenderRangeIntoView(container, range);
  // Auto-clear after 5s so we don't leave the highlight forever if the
  // user navigates somewhere else. A separate explicit clear on note
  // change would be marginally cleaner but this is good enough.
  setTimeout(() => {
    try { CSS.highlights.delete('ai-highlight'); } catch {}
  }, 5000);
  return true;
}

// Ephemeral "look here" flash — paints the passage with the `ai-pulse`
// Custom Highlight (CSS animates a glow that fades) and clears after
// ~2.2s. Unlike highlightInRenderDom this does NOT auto-scroll
// aggressively — we only scrollIntoView when the rect is off-screen.
function pulseInRenderDom(container, text) {
  if (!container) return false;
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return false;
  const range = findTextRangeInDom(container, text);
  if (!range) return false;
  const hl = new Highlight(range);
  CSS.highlights.set('ai-pulse', hl);
  const target = range.startContainer.parentElement;
  if (target && typeof target.getBoundingClientRect === 'function') {
    try {
      const r = range.getBoundingClientRect();
      const vh = window.innerHeight || 800;
      // Skip hidden passages (0×0 rect) — scrolling toward a degenerate
      // rect at (0,0) yanks the pane to the top of the note.
      if ((r.width || r.height) && (r.bottom < 0 || r.top > vh)) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } catch { /* ignore */ }
  }
  // Three-beat flash: strong → soft → strong → clear. CSS Highlight API
  // doesn't support @keyframes, so we swap between two registered
  // highlight names with distinct background intensities.
  setTimeout(() => {
    try { CSS.highlights.delete('ai-pulse'); CSS.highlights.set('ai-pulse-soft', hl); } catch {}
  }, 550);
  setTimeout(() => {
    try { CSS.highlights.delete('ai-pulse-soft'); CSS.highlights.set('ai-pulse', hl); } catch {}
  }, 1100);
  setTimeout(() => {
    try { CSS.highlights.delete('ai-pulse'); CSS.highlights.delete('ai-pulse-soft'); } catch {}
  }, 2200);
  return true;
}

// Like `pulseInRenderDom` but always scrolls the target into view
// (pulse only scrolls when off-screen). Used by the `reveal` aiPointer
// after AI edits — the whole point is for the user to see WHERE the
// change landed, so even a half-visible target deserves a recenter.
// Also retries briefly when the text isn't yet in the DOM (race with
// markdown-it re-render after the Y.Text changed).
function revealInRenderDom(container, text, opts = {}) {
  if (!container) return false;
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return false;
  const range = findTextRangeInDom(container, text);
  if (!range) {
    // Markdown-it may not have rebuilt the DOM yet — retry a few times
    // before giving up. Total retry budget ~1.2s.
    const retries = opts.retries != null ? opts.retries : 6;
    if (retries > 0) {
      setTimeout(() => revealInRenderDom(container, text, { ...opts, retries: retries - 1 }), 200);
    } else if (opts.scrollFallbackToEnd) {
      // Final fallback for auto-reveal-on-append: text not findable but
      // we know it was appended at the end, so scroll the scroller to
      // the bottom so at least the user lands in the right neighbourhood.
      try {
        const scroller = findScrollableAncestor(container) || container;
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
      } catch {}
    }
    return false;
  }
  const hl = new Highlight(range);
  CSS.highlights.set('ai-pulse', hl);
  const target = range.startContainer.parentElement || range.startContainer;
  // Belt-and-braces: also drop a CSS class on the target so a keyframe
  // animation flashes the background even if ::highlight(ai-pulse)
  // isn't visible for some reason (text inside a styled wrapper that
  // shadows the highlight pseudo, GPU compositing edge case, etc.).
  if (target && target.classList) {
    try {
      target.classList.add('reveal-flash');
      setTimeout(() => { try { target.classList.remove('reveal-flash'); } catch {} }, 2400);
    } catch {}
  }
  // Scroll via the shared pane-aware helper (nested-scroller and
  // hidden-passage safe). If the passage has no geometry (hidden behind an
  // alternate table view) and this was an append-reveal, land at the end
  // of the note — same neighbourhood the append went to.
  const scrolled = scrollRenderRangeIntoView(container, range);
  if (!scrolled && opts.scrollFallbackToEnd) {
    try {
      const scroller = findScrollableAncestor(container) || container;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    } catch {}
  }
  // Same three-beat flash as pulseInRenderDom.
  setTimeout(() => { try { CSS.highlights.delete('ai-pulse'); CSS.highlights.set('ai-pulse-soft', hl); } catch {} }, 550);
  setTimeout(() => { try { CSS.highlights.delete('ai-pulse-soft'); CSS.highlights.set('ai-pulse', hl); } catch {} }, 1100);
  setTimeout(() => { try { CSS.highlights.delete('ai-pulse'); CSS.highlights.delete('ai-pulse-soft'); } catch {} }, 2200);
  return true;
}

// Stronger scroll variant of pulseInCm: forces target to viewport
// centre (default scrollIntoView only scrolls the minimum). Selection
// still serves as the pulse — clears after 2.2s.
function revealInCm(cmView, fromCh, toCh) {
  if (!cmView) return false;
  try {
    const docLen = cmView.state.doc.length;
    const from = Math.max(0, Math.min(docLen, Number(fromCh) || 0));
    const to = Math.max(0, Math.min(docLen, Number(toCh) || 0));
    if (from === to) return false;
    cmView.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    });
    setTimeout(() => {
      try {
        if (cmView && cmView.state) {
          cmView.dispatch({ selection: { anchor: to, head: to } });
        }
      } catch {}
    }, 2200);
    return true;
  } catch { return false; }
}

function pulseInCm(cmView, fromCh, toCh) {
  if (!cmView) return false;
  try {
    const docLen = cmView.state.doc.length;
    const from = Math.max(0, Math.min(docLen, Number(fromCh) || 0));
    const to = Math.max(0, Math.min(docLen, Number(toCh) || 0));
    if (from === to) return false;
    cmView.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    setTimeout(() => {
      try {
        if (cmView && cmView.state) {
          cmView.dispatch({ selection: { anchor: to, head: to } });
        }
      } catch {}
    }, 2200);
    return true;
  } catch { return false; }
}

// Single-row entry in AiCommentsPanel. Lifted into its own component so
// question-kind comments can host an input + send button without forcing
// the parent panel to thread per-row state.
// Renders a comment's body with @mentions highlighted. Plain
// text otherwise — no markdown to keep the panel lightweight.
function CommentText({ text }) {
  const parts = String(text || '').split(/(@[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|@[a-zA-Z0-9][a-zA-Z0-9._-]{1,48})/g);
  return (
    <span className="ai-comment-text">
      {parts.map((p, i) => p.startsWith('@')
        ? <span key={i} className="ai-comment-mention" title={`Mención a ${p.slice(1)}`}>{p}</span>
        : p)}
    </span>
  );
}

// Canonical, device-agnostic agent tags (Claude-Tag style). Mirrors the
// backend `canonicalAgentTags()` in cli/lib.mjs: `@Claude` is one shared
// identity any online agent of the matching `kind` can pick up, vs the
// per-device aliases (`@claude-mac`). Defaults cover the built-in kinds;
// `taggedAgents` (yMeta) lets the workspace add/override tags.
function normalizeTag(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/^@+/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}
function canonicalAgentTags(taggedAgents = []) {
  const map = new Map();
  for (const d of [
    { tag: 'claude', kind: 'claude', label: 'Claude' },
    { tag: 'codex', kind: 'codex', label: 'Codex' },
    { tag: 'cursor', kind: 'cursor', label: 'Cursor' },
  ]) map.set(d.tag, d);
  for (const t of (Array.isArray(taggedAgents) ? taggedAgents : [])) {
    const tag = normalizeTag(t && t.tag);
    if (!tag) continue;
    map.set(tag, { tag, kind: normalizeTag(t && t.kind) || tag, label: (t && t.label) || tag });
  }
  return map;
}

// Per-vault agent access policy (Fase 3). Mirrors `isAgentAllowedInVault` in
// cli/lib.mjs. `policy` is the whole `yMeta.agentPolicy` map; no entry for a
// vault means allow everything (back-compat). Deny wins; a non-empty allow*
// list switches the vault to whitelist-mode.
function isAgentAllowedInVault(policy, vaultId, { kind, alias } = {}) {
  const p = (policy && typeof policy === 'object') ? policy[vaultId] : null;
  if (!p || typeof p !== 'object') return true;
  const norm = (s) => String(s || '').toLowerCase().replace(/^@+/, '');
  const arr = (x) => (Array.isArray(x) ? x.map(norm).filter(Boolean) : []);
  const k = norm(kind), a = norm(alias);
  if (a && arr(p.denyAliases).includes(a)) return false;
  if (k && arr(p.denyKinds).includes(k)) return false;
  const allowA = arr(p.allowAliases), allowK = arr(p.allowKinds);
  if (allowA.length || allowK.length) return (!!a && allowA.includes(a)) || (!!k && allowK.includes(k));
  return true;
}

function extractAgentMentions(text, agents = [], tags = null) {
  if (!text) return [];
  const aliases = new Set((Array.isArray(agents) ? agents : []).map(a => String(a.alias || '').toLowerCase()).filter(Boolean));
  const tagMap = tags instanceof Map ? tags : null;
  if (!aliases.size && !(tagMap && tagMap.size)) return [];
  const found = new Set();
  const re = /(^|[^\w@.-])@([a-zA-Z0-9][a-zA-Z0-9._-]{1,48})\b/g;
  let m;
  while ((m = re.exec(String(text))) !== null) {
    const alias = String(m[2] || '').toLowerCase();
    // Match a known per-device alias OR a canonical shared tag.
    if (aliases.has(alias) || (tagMap && tagMap.has(alias))) found.add(alias);
  }
  return Array.from(found);
}

function commentThreadRootId(comment, all = []) {
  if (!comment) return null;
  const byId = new Map((Array.isArray(all) ? all : []).map(c => [c.id, c]));
  let cur = comment;
  const seen = new Set();
  while (cur && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentId) || null;
  }
  return (cur && cur.id) || comment.id || null;
}

function collectCommentThread(all = [], rootId) {
  if (!rootId || !Array.isArray(all)) return [];
  const byParent = new Map();
  for (const c of all) {
    const p = c.parentId || null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(c);
  }
  const out = [];
  const walk = (id) => {
    const node = all.find(c => c.id === id);
    if (node) out.push(node);
    for (const child of byParent.get(id) || []) walk(child.id);
  };
  walk(rootId);
  return out.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
}

// Chat composer — multiline textarea, Cmd/Ctrl+Enter to send, auto-grow,
// lightweight @mention picker that appears while the current token starts
// with `@`. Used both for top-level note comments and for inline thread
// replies.
function ChatComposer({ placeholder, memberEmails = [], aiAgents = [], onSend, autoFocus = false, compact = false, onCancel }) {
  useI18n();
  const [draft, setDraft] = useState('');
  const taRef = useRef(null);
  const [pickIdx, setPickIdx] = useState(0);
  // Combined mention pool — workspace members (emails) + known AI
  // agents (aliases, local + remote). Type tag drives the popup icon
  // and the chosen prefix inserts as `@email` or `@alias`.
  const mentionPool = useMemo(() => {
    const out = [];
    for (const email of memberEmails || []) {
      if (!email) continue;
      out.push({ value: email, label: email, kind: 'user' });
    }
    // Canonical, device-agnostic tags (Claude-Tag style): one shared @Claude
    // per agent kind present, routed to ANY online agent of that kind. Mirrors
    // the backend `canonicalAgentTags()`. Listed before per-device aliases so
    // the shared identity is the easy default; the specific @claude-<device>
    // aliases still appear below for when you want one machine.
    const kinds = new Map();
    for (const a of aiAgents || []) {
      const kind = String(a && a.kind || '').trim().toLowerCase();
      if (!kind) continue;
      const online = a.online === true;
      const prev = kinds.get(kind);
      kinds.set(kind, { kind, online: online || !!(prev && prev.online) });
    }
    for (const { kind, online } of kinds.values()) {
      out.push({
        value: kind,
        label: kind.charAt(0).toUpperCase() + kind.slice(1),
        kind: online ? 'ai-online' : 'ai',
        sub: 'cualquier agente disponible',
      });
    }
    const seen = new Set();
    for (const a of aiAgents || []) {
      const alias = String(a && a.alias || '').trim();
      if (!alias || seen.has(alias.toLowerCase())) continue;
      seen.add(alias.toLowerCase());
      out.push({
        value: alias,
        label: alias,
        kind: a.localLauncher ? 'cli' : (a.online ? 'ai-online' : 'ai'),
        sub: a.device ? `device: ${a.device}` : (a.kind || ''),
      });
    }
    return out;
  }, [memberEmails, aiAgents]);

  // Recompute the autocomplete picker each keystroke. Triggered when the
  // current token (up to the caret) starts with `@` and matches at least
  // one entry. Returns null when no menu should show.
  const picker = useMemo(() => {
    if (!mentionPool.length) return null;
    const el = taRef.current;
    const caret = el ? el.selectionStart : draft.length;
    const head = draft.slice(0, caret);
    const m = head.match(/(^|\s)@([a-zA-Z0-9._%+\-]*)$/);
    if (!m) return null;
    const q = (m[2] || '').toLowerCase();
    const matches = mentionPool.filter(e => e.value.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) return null;
    return { matches, prefixStart: caret - m[2].length - 1, prefixEnd: caret };
  }, [draft, mentionPool]);
  useEffect(() => { setPickIdx(0); }, [picker && picker.matches.length]);

  const grow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  };
  useEffect(grow, [draft]);

  const insertMention = (entry) => {
    if (!picker) return;
    const value = typeof entry === 'string' ? entry : (entry && entry.value);
    if (!value) return;
    const before = draft.slice(0, picker.prefixStart);
    const after = draft.slice(picker.prefixEnd);
    const next = before + '@' + value + ' ' + after;
    setDraft(next);
    requestAnimationFrame(() => {
      const pos = (before + '@' + value + ' ').length;
      if (taRef.current) taRef.current.setSelectionRange(pos, pos);
      taRef.current && taRef.current.focus();
    });
  };

  const send = () => {
    const v = draft.trim();
    if (!v) return;
    onSend(v);
    setDraft('');
    requestAnimationFrame(grow);
  };

  return (
    <div className={`chat-composer${compact ? ' compact' : ''}`}>
      <textarea
        ref={taRef}
        rows={compact ? 2 : 3}
        value={draft}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (picker && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setPickIdx(i => {
              const n = picker.matches.length;
              return e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
            });
            return;
          }
          if (picker && e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            insertMention(picker.matches[pickIdx]);
            return;
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
            return;
          }
          if (e.key === 'Escape') {
            if (onCancel) { e.preventDefault(); onCancel(); }
          }
        }}
      />
      {picker && (
        <div className="chat-composer-mentions">
          {picker.matches.map((entry, i) => {
            const kindLabel = entry.kind === 'user' ? '👤'
              : entry.kind === 'cli' ? '⚡'
              : entry.kind === 'ai-online' ? '●'
              : '○';
            return (
              <button
                key={entry.kind + ':' + entry.value}
                type="button"
                className={`chat-composer-mention chat-composer-mention-${entry.kind}${i === pickIdx ? ' on' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); insertMention(entry); }}>
                <span className="chat-composer-mention-kind" title={entry.kind}>{kindLabel}</span>
                <span className="chat-composer-mention-value">@{entry.label}</span>
                {entry.sub && <span className="chat-composer-mention-sub">{entry.sub}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="chat-composer-foot">
        <span className="chat-composer-hint">{t('chat.sendHint')}</span>
        <button className="chat-composer-send" onClick={send} disabled={!draft.trim()}>
          {t('chat.send')}
        </button>
      </div>
    </div>
  );
}

// Modal used both from the comment-fab (markdown selection) and from
// the +/comment pill — ChatComposer with selection preview header so
// the user has mention autocomplete + multiline drafting instead of
// the legacy single-line prompt.
function CommentDraftModal({ anchorText, memberEmails, aiAgents, onCancel, onSubmit }) {
  useI18n();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <>
      <div className="view-spotlight-backdrop" onClick={onCancel} />
      <div className="comment-draft-modal" role="dialog" aria-modal="true">
        <div className="comment-draft-head">
          <span className="comment-draft-title">{anchorText ? t('cmt.draft.titleSel') : t('cmt.draft.titleNote')}</span>
          <button className="history-close" onClick={onCancel} title={t('btn.closeEsc')}>×</button>
        </div>
        {anchorText && (
          <blockquote className="comment-draft-anchor">
            {anchorText.length > 240 ? anchorText.slice(0, 240) + '…' : anchorText}
          </blockquote>
        )}
        <ChatComposer
          placeholder={t('cmt.composer.ph')}
          memberEmails={memberEmails}
          aiAgents={aiAgents}
          autoFocus
          onCancel={onCancel}
          onSend={onSubmit} />
      </div>
    </>
  );
}

// Inline popover anchored to a clicked <mark.comment-anchor> in the
// render pane. Shows the full thread + a reply composer + a quick
// Resolve action so reviewers can collaborate without crossing back
// to the side panel.
export function AnchorCommentPopover({ x, y, thread, memberEmails, aiAgents, onReply, onResolve, onClose }) {
  useI18n();
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    window.addEventListener('keydown', onKey);
    setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);
  // Clamp position so the popover doesn't bleed off the right edge.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const width = 360;
  const clampedX = Math.min(x, Math.max(8, vw - width - 8));
  return (
    <div ref={ref} className="anchor-popover" style={{ left: clampedX, top: y, width }}>
      <div className="anchor-popover-head">
        <span className="anchor-popover-title">{t('cmt.anchor.title')}</span>
        <button className="anchor-popover-btn" onClick={onResolve} title={t('cmt.anchor.resolveTip')}>✓</button>
        <button className="anchor-popover-btn" onClick={onClose} title={t('btn.closeEsc')}>×</button>
      </div>
      <div className="anchor-popover-body">
        {thread.map(c => (
          <div key={c.id} className={`anchor-popover-msg${c.parentId ? ' is-reply' : ''}`}>
            <div className="anchor-popover-author">
              {c.author || 'user'} · {(c.ts || '').slice(11, 16)}
            </div>
            <div className="anchor-popover-text">{c.text}</div>
          </div>
        ))}
      </div>
      <ChatComposer
        placeholder={t('cmt.anchor.replyPh')}
        memberEmails={memberEmails}
        aiAgents={aiAgents}
        compact
        onSend={onReply} />
    </div>
  );
}

function AiCommentItem({ comment: c, depth = 0, children, onResolve, onDelete, onReply, onPostReply, memberEmails = [], aiAgents = [], liveAliases = [], onOpenThread, onFocusAnchor }) {
  useI18n();
  const [open, setOpen] = useState(false);
  const isQuestion = c.kind === 'question';
  const isReply = !!c.parentId;
  return (
    <div className={`ai-comment${isQuestion ? ' ai-comment-question' : ''}${c.resolved ? ' ai-comment-resolved' : ''}${isReply ? ' ai-comment-thread-reply' : ''}`}
         data-comment-id={c.id}
         style={depth ? { marginLeft: Math.min(depth, 4) * 14 } : undefined}>
      <div className="ai-comment-author">
        {c.author || 'ai'}
        <span className="ai-comment-ts" title={c.ts ? new Date(c.ts).toLocaleString() : ''}>
          {' · '}{vmRelTime(Date.parse(c.ts)) || (c.ts || '').slice(11, 16)}
        </span>
        {isQuestion && <span className="ai-comment-flag" title={t('cmt.replyPh')}>?</span>}
        {c.resolved && <span className="ai-comment-flag ai-comment-flag-done"><VIcon name="check" /></span>}
      </div>
      <CommentText text={c.text} />
      {c.anchorText && !isReply && (
        <button className="ai-comment-anchor" title={c.anchorText} onClick={() => onFocusAnchor && onFocusAnchor(c)}>
          “{c.anchorText.length > 64 ? c.anchorText.slice(0, 64) + '…' : c.anchorText}”
        </button>
      )}
      {/* Legacy inline replies (older flat-replies model) kept for back-compat */}
      {Array.isArray(c.replies) && c.replies.length > 0 && (
        <div className="ai-comment-replies">
          {c.replies.map(r => (
            <div key={r.id} className="ai-comment-reply">
              <span className="ai-comment-reply-author">{r.author || 'user'}</span>
              <CommentText text={r.text} />
            </div>
          ))}
        </div>
      )}
      {/* Awaiting-reply question gets its quick-reply box inline */}
      {isQuestion && c.awaitingReply !== false && (
        <ChatComposer
          placeholder={t('cmt.replyPh')}
          memberEmails={memberEmails}
          aiAgents={aiAgents}
          compact
          onSend={onReply} />
      )}
      {/* Threaded reply box (new model) — collapsible per comment */}
      {open && (
        <ChatComposer
          placeholder={t('cmt.threadReplyPh')}
          memberEmails={memberEmails}
          aiAgents={aiAgents}
          autoFocus
          compact
          onCancel={() => setOpen(false)}
          onSend={(v) => { onPostReply(v); setOpen(false); }} />
      )}
      <div className="ai-comment-actions">
        {!c.resolved && onPostReply && (
          <button onClick={() => setOpen(v => !v)} title={t('cmt.replyThread')}><VIcon name="comment" /></button>
        )}
        {!isReply && onOpenThread && (
          <button onClick={onOpenThread} title={t('cmt.openThread')}><VIcon name="external" /></button>
        )}
        {!c.resolved && <button onClick={onResolve} title={t('cmt.resolve')}><VIcon name="check" /></button>}
        <button onClick={onDelete} title={t('btn.deleteShort')}><VIcon name="close" /></button>
      </div>
      {liveAliases && liveAliases.length > 0 && (
        <div className="ai-comment-live">
          <span className="ai-comment-live-spinner" />
          <span className="ai-comment-live-text">
            {liveAliases.map(a => '@' + a).join(', ')} {liveAliases.length === 1 ? t('cmt.thinking.one') : t('cmt.thinking.many')}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

// ── AI callout positioning ───────────────────────────────────────────
// Compute the viewport-space rect of a highlight so we can dock a
// speech-bubble next to it. Markdown mode goes through CM's pos-to-
// coords; render mode walks the DOM. Returns null if the highlight is
// off-screen or unmatchable — the caller falls back to a corner placement.
function getHighlightRect(mode, cmView, render, step) {
  if ((mode === 'markdown' || mode === 'dual' || mode === 'live') && cmView) {
    try {
      const a = cmView.coordsAtPos(Number(step.fromCh) || 0);
      const b = cmView.coordsAtPos(Number(step.toCh) || 0);
      if (a && b) {
        return {
          top: Math.min(a.top, b.top),
          bottom: Math.max(a.bottom, b.bottom),
          left: Math.min(a.left, b.left),
          right: Math.max(a.right, b.right),
        };
      }
    } catch { /* cm not ready yet */ }
  }
  if ((mode === 'render' || mode === 'dual') && render) {
    const range = findTextRangeInDom(render, step.text);
    if (range) {
      const r = range.getBoundingClientRect();
      // A 0×0 rect means the text exists but isn't visible (hidden source
      // table behind a kanban/cards view, collapsed wrapper…). Treat it as
      // not-found so the callout docks to the corner instead of anchoring
      // to (0,0) at the top of the window.
      if (r && (r.width > 0 || r.height > 0)) return r;
    }
  }
  return null;
}

// Decide which side of the highlight to put the callout on so it
// doesn't fall off-screen. Returns { side, style } where `side` matches
// a CSS class (.ai-callout-left/right/top/bottom — names refer to which
// edge of the *callout* the tail sits on, and the tail points back
// toward the highlight). The position is `position: fixed` coords.
// Top-right collapsible panel for navigating between linked notes.
// Tabs: outgoing wikilinks (notes the current one cites) and backlinks
// (notes citing the current one). Back/forward buttons on top. Auto-
// hides when there are no links and no history. Collapse toggle keeps
// it out of the way as a small badge.

// Map an MCP action (after-the-fact mutation) to a UI-friendly activity
// label — verb, target, optional "where", and icon. Used by AiPeerChip
// so both real mutations (mcpAction) and explicit pings (aiPresence)
// render through the same component.
// Friendly display name for the agent that ran an action ("Claude", "Codex",
// "Cursor", …). Falls back to a capitalized kind or the alias.
function agentDisplayName(agent) {
  if (!agent) return '';
  const k = String(agent.kind || '').toLowerCase();
  const map = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini', copilot: 'Copilot', ai: 'IA', cli: 'CLI' };
  if (map[k]) return map[k];
  if (agent.kind) return agent.kind.charAt(0).toUpperCase() + agent.kind.slice(1);
  return agent.alias || '';
}

function activityFromMcpAction(a) {
  const r = pickActivity(a);
  const who = agentDisplayName(a.agent);
  return who ? { ...r, who } : r;
}

function pickActivity(a) {
  const where = a.vault ? a.vault : '';
  switch (a.kind) {
    case 'create':           return { verb: t('act.create'),         target: a.note, where, icon: '✨', kind: 'write' };
    case 'write':            return { verb: t('act.write'),          target: a.note, where, icon: '✏️', kind: 'write' };
    case 'append':           return { verb: t('act.append'),         target: a.note, where, icon: '➕', kind: 'write' };
    case 'delete':           return { verb: t('act.delete'),         target: a.note, where, icon: '🗑️', kind: 'write' };
    case 'rename':           return { verb: t('act.rename'),         target: `${a.from} → ${a.note}`, where: '', icon: '🔄', kind: 'write' };
    case 'move':             return { verb: t('act.move'),           target: a.note, where: `→ ${a.vault}`, icon: '➡️', kind: 'write' };
    case 'vault_create':     return { verb: t('act.vault_create'),   target: a.vault, where: '', icon: '📁', kind: 'plan' };
    case 'vault_rename':     return { verb: t('act.vault_rename'),   target: `${a.from} → ${a.vault}`, where: '', icon: '📂', kind: 'plan' };
    case 'vault_delete':     return { verb: t('act.vault_delete'),   target: a.vault, where: '', icon: '🗑️', kind: 'plan' };
    case 'focus':            return { verb: t('act.focus'),          target: a.note, where, icon: '👁️', kind: 'read' };
    case 'highlight':        return { verb: t('act.highlight'),      target: a.note, where, icon: '✨', kind: 'read' };
    case 'present':          return { verb: t('act.present'),        target: a.note, where, icon: '🎬', kind: 'read' };
    case 'pulse':            return { verb: t('act.pulse'),          target: a.note, where, icon: '⚡', kind: 'read' };
    case 'reveal':           return { verb: t('act.reveal'),         target: a.note, where, icon: '🎯', kind: 'read' };
    case 'canvas_create':    return { verb: t('act.canvas_create'),  target: a.note, where, icon: '🎨', kind: 'draw' };
    case 'canvas_add_node':  return { verb: t('act.canvas_add_node'),target: a.note, where, icon: '➕', kind: 'draw' };
    case 'canvas_annotate':  return { verb: t('act.canvas_annotate'),target: a.note, where, icon: '✏️', kind: 'draw' };
    case 'mcp_tool': {
      // Floor signal for read-only tools (list_*/read_*/get_*/recall/etc.).
      // i18n verb is per-tool — `tool.<name>` falls back to a generic
      // "Ejecutó <tool>" when no key is registered.
      // Collapsed chip shows `target` only, so we fold the verb into
      // target so the user sees "Listó vaults" instead of just "vaults".
      const key = 'tool.' + (a.tool || 'default');
      const v = t(key);
      // Never surface the raw tool name (a variable) in the UI: missing keys
      // fall back to the localized generic verb only, not "Ran <tool_name>".
      const verb = v && v !== key ? v : t('act.mcp_tool');
      const folded = `${verb} ${a.target || ''}`.trim();
      return { verb, target: folded, where: a.where || '', icon: '⚙️', kind: 'think' };
    }
    default:                  return { verb: t('act.default'),        target: a.kind || '·', where: '', icon: '✦', kind: 'think' };
  }
}

// Bottom-right toast stack for incoming comment replies / mentions.
// Fed by `window` CustomEvent('edinot:reply-toast', { detail }) from two
// sources: the local CLI exit handler (AI replies, works even without
// Sync) and the NotificationsBell SSE stream (human replies / mentions
// from other devices). Clicking a toast deep-links to the note + comment
// via the global `window.__edinotGoToComment` hook. Auto-dismiss ~9s.
function ReplyToasts() {
  useI18n();
  const [items, setItems] = useState([]);
  useEffect(() => {
    const onToast = (e) => {
      const d = (e && e.detail) || {};
      const id = d.id || ('rt' + Date.now() + Math.random().toString(36).slice(2, 5));
      setItems(prev => [...prev.filter(x => x.id !== id), { ...d, id }].slice(-4));
      const ttl = d.ttl || 9000;
      setTimeout(() => setItems(prev => prev.filter(x => x.id !== id)), ttl);
    };
    window.addEventListener('edinot:reply-toast', onToast);
    return () => window.removeEventListener('edinot:reply-toast', onToast);
  }, []);
  const dismiss = useCallback((id) => setItems(prev => prev.filter(x => x.id !== id)), []);
  if (!items.length) return null;
  return (
    <div className="reply-toasts">
      {items.map(it => {
        const isAi = it.kind === 'ai-reply';
        const who = isAi ? ('@' + (it.alias || 'ai')) : (it.author || t('toast.someone'));
        const verb = it.kind === 'mention' ? t('toast.mentioned')
          : it.kind === 'comment' ? t('toast.commented')
          : t('toast.replied');
        return (
          <div key={it.id} role="button" tabIndex={0} className="reply-toast"
            onClick={() => { try { window.__edinotGoToComment && window.__edinotGoToComment(it); } catch {} dismiss(it.id); }}>
            <div className="reply-toast-head">
              <span className="reply-toast-ico"><VIcon name={isAi ? 'spark' : 'comment'} /></span>
              <span className="reply-toast-who">{who} {verb}</span>
              <button className="reply-toast-x" title={t('btn.close')}
                onClick={(e) => { e.stopPropagation(); dismiss(it.id); }}><VIcon name="close" /></button>
            </div>
            {it.noteName && (
              <div className="reply-toast-note">
                {t('toast.inNote', { name: String(it.noteName).replace(/\.(md|markdown|txt)$/i, '') })}
              </div>
            )}
            {it.preview && (
              <div className="reply-toast-preview">{String(it.preview).slice(0, 160)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AiPeerChip() {
  useI18n();
  const [state, setState] = useState({
    current: null,   // { verb, target, where, icon, kind, at }
    history: [],     // last 8 entries
    burst: 0,        // counter; bump triggers ring-burst animation
    lastAt: 0,
  });
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Repaint every 1s so the idle / hide thresholds re-evaluate without
  // needing a per-action timer. Cheap — single small component.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const push = useCallback((activity) => {
    setState(prev => {
      const entry = { ...activity, at: Date.now() };
      const history = [entry, ...prev.history].slice(0, 8);
      return { current: entry, history, burst: prev.burst + 1, lastAt: entry.at };
    });
  }, []);

  useEffect(() => {
    const offAction = onMcpAction((a) => {
      if (a.kind === 'highlight' || a.kind === 'present' || a.kind === 'pulse') return; // these have their own visual anchored to the passage
      push(activityFromMcpAction(a));
    });
    const offPresence = onAiPresence((p) => {
      push({
        verb: '',
        target: p.activity || '',
        where: p.target || '',
        icon: iconForPresenceKind(p.kind),
        kind: p.kind || 'think',
        who: agentDisplayName(p.agent),
      });
    });
    return () => { offAction && offAction(); offPresence && offPresence(); };
  }, [push]);

  if (!state.current) return null;
  const sinceLast = now - state.lastAt;
  // Hide entirely once the AI has been silent for a few seconds — no
  // half-faded zombie chip lingering after the work is done.
  if (sinceLast > 8000 && !expanded) return null;

  const c = state.current;
  // Auto-close any expanded popover ~1.5s after the AI goes quiet so the
  // chip doesn't get stuck open with stale content.
  if (expanded && sinceLast > 1500) {
    // Defer state mutation to next tick to avoid setState-in-render.
    setTimeout(() => setExpanded(false), 0);
  }

  // Short label shown next to the avatar in collapsed state. Prefer the
  // target if there is one (Notion-style "writing: Roadmap Q3"); fall
  // back to the verb alone for pure presence pings without a target.
  const collapsedText = (c.target || c.verb || '').trim();
  const collapsedShort = collapsedText.length > 26 ? collapsedText.slice(0, 26) + '…' : collapsedText;

  return (
    <div className={`ai-peer-chip${expanded ? ' expanded' : ' collapsed'}`}
      onClick={(e) => {
        // Click anywhere on the chip (not just avatar) toggles the popover
        // — bigger hit target. Don't toggle when click bubbles up from
        // inside the open popover (history rows etc.).
        if (e.target.closest && e.target.closest('.ai-peer-pop')) return;
        setExpanded(v => !v);
      }}>
      <button className="ai-peer-avatar"
        type="button"
        title={`${c.verb || ''} ${c.target || ''}`.trim() || t('peer.aiActive')}>
        <span className="ai-peer-aurora" aria-hidden="true" />
        <span className="ai-peer-aurora ai-peer-aurora-2" aria-hidden="true" />
        <span className="ai-peer-burst" key={state.burst} aria-hidden="true" />
        <span className="ai-peer-glyph">🤖</span>
        <span className="ai-peer-kind-badge" aria-hidden="true">{c.icon}</span>
      </button>
      {collapsedShort && (
        <span className="ai-peer-label" key={state.burst}>
          {c.who && <span className="ai-peer-who">{c.who}</span>}
          {collapsedShort}
        </span>
      )}
      {expanded && (
        <div className="ai-peer-pop">
          <div className="ai-peer-pop-current">
            <span className="ai-peer-pop-icon">{c.icon}</span>
            <div className="ai-peer-pop-text">
              {c.who && <span className="ai-peer-who ai-peer-who-pop">{c.who}</span>}
              {c.verb && <span className="ai-peer-verb">{c.verb}</span>}
              {c.target && <span className="ai-peer-target">{c.target}</span>}
              {c.where && <span className="ai-peer-where">{c.where}</span>}
            </div>
          </div>
          {state.history.length > 1 && (
            <div className="ai-peer-history">
              <div className="ai-peer-history-head">{t('peer.previous')}</div>
              {state.history.slice(1).map((h, i) => (
                <div key={i} className="ai-peer-history-row">
                  <span className="ai-peer-history-icon">{h.icon}</span>
                  <span className="ai-peer-history-text">
                    {h.who ? `${h.who} · ` : ''}{h.verb} {h.target}
                  </span>
                  <span className="ai-peer-history-when">{relativeTime(now - h.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function iconForPresenceKind(kind) {
  // Variation selector (U+FE0F) forces emoji presentation on glyphs that
  // could otherwise render as monochrome text symbols on Linux/Chromium.
  switch (kind) {
    case 'think':  return '🧠';
    case 'search': return '🔎';
    case 'read':   return '👁️';
    case 'write':  return '✏️';
    case 'draw':   return '🎨';
    case 'plan':   return '🗺️';
    case 'wait':   return '⏳';
    default:       return '✦';
  }
}

// ── Nota activa por equipo ─────────────────────────────────────────────
// `yMeta.activeId` es estado CRDT compartido, así que renderizar
// directamente desde ahí hacía que abrir una nota en un equipo la abriera
// en TODOS los equipos sincronizados — tanto si navegabas tú como si lo
// hacía la IA vía focus_note.
//
// Ahora cada equipo guarda la suya en localStorage y renderiza desde ella.
// yMeta.activeId se sigue escribiendo (write-through) porque es lo que lee
// `get_active_context`: el MCP tiene que saber qué estás mirando. Lo que
// desaparece es el read-back — un equipo ya no obedece a lo que escribió
// otro.
const DEVICE_ACTIVE_KEY = 'edinotDeviceActive';
function readDeviceActive() {
  try {
    const v = JSON.parse(localStorage.getItem(DEVICE_ACTIVE_KEY) || 'null');
    return v && (v.id || v.vaultId) ? v : null;
  } catch { return null; }
}
function writeDeviceActive(v) {
  try {
    if (v && (v.id || v.vaultId)) localStorage.setItem(DEVICE_ACTIVE_KEY, JSON.stringify(v));
    else localStorage.removeItem(DEVICE_ACTIVE_KEY);
  } catch {}
}

// Punteros de la IA que implican "llévame a esta nota". Se corresponden
// exactamente con los métodos que en cli/lib.mjs llaman a `_switchActive`:
// antes la navegación llegaba sola por yMeta, ahora la aplica el equipo
// destinatario al recibir el puntero.
const AI_POINTER_NAVIGATES = new Set(['focus', 'present', 'highlight', 'screenshot_request', 'pulse']);

function relativeTime(ms) {
  if (ms < 1500) return 'ahora';
  if (ms < 60_000) return `${Math.round(ms/1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms/60_000)}m`;
  return `${Math.round(ms/3_600_000)}h`;
}

function placeCallout(rect, calloutW = 320, calloutH = 140, opts = {}) {
  const GAP = 16;
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
  // During live scroll-pinning we want the bubble to track the highlight
  // 1:1 — including sliding off the bottom edge along with its anchor.
  // The clamp is only useful for the initial placement after a step
  // change, where it nudges the bubble back on-screen when there isn't
  // a perfect side.
  const noClamp = opts.clamp === false;
  const clampTop  = noClamp ? (t) => t : (t) => Math.max(12, Math.min(vh - calloutH - 12, t));
  const clampLeft = noClamp ? (l) => l : (l) => Math.max(12, Math.min(vw - calloutW - 12, l));
  // Prefer right of the highlight (most reading layouts are wider than tall)
  if (rect.right + GAP + calloutW + 12 < vw) {
    return {
      side: 'left',
      style: { top: clampTop(rect.top - 8), left: rect.right + GAP },
    };
  }
  // Then left
  if (rect.left - GAP - calloutW - 12 > 0) {
    return {
      side: 'right',
      style: { top: clampTop(rect.top - 8), left: rect.left - GAP - calloutW },
    };
  }
  // Below
  if (rect.bottom + GAP + calloutH + 12 < vh) {
    return {
      side: 'top',
      style: { top: rect.bottom + GAP, left: clampLeft(rect.left) },
    };
  }
  // Above
  return {
    side: 'bottom',
    style: { top: Math.max(12, rect.top - GAP - calloutH), left: clampLeft(rect.left) },
  };
}

// Apply a "new whole string" to a Y.Text by computing the minimal
// (delete, insert) at the common edit point. Keeps CRDT history sane
// for textarea-style edits where most keystrokes change one position.
function applyTextDiff(ytext, newValue) {
  const old = ytext.toString();
  if (old === newValue) return;
  const min = Math.min(old.length, newValue.length);
  let prefix = 0;
  while (prefix < min && old[prefix] === newValue[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < min - prefix &&
    old[old.length - 1 - suffix] === newValue[newValue.length - 1 - suffix]
  ) suffix++;
  const deleteLen = old.length - prefix - suffix;
  const insertStr = newValue.slice(prefix, newValue.length - suffix);
  (ytext.doc || ydoc).transact(() => {
    if (deleteLen > 0) ytext.delete(prefix, deleteLen);
    if (insertStr.length > 0) ytext.insert(prefix, insertStr);
  });
}

// Comments + agent tasks live in their own per-record maps (see
// shared/comments-model.js) plus the legacy yMeta keys older apps write.
// Anything that renders them must re-run when any of the four changes.
export function useCommentsVersion() {
  return useYVersion(yMeta) + useYVersion(yCommentsV2) + useYVersion(yCommentRepliesV2) + useYVersion(yAgentTasksV2);
}

// Stable function identity that always calls the latest closure. Lets the
// memo'd shell pieces (Topbar, panel, block UI…) keep their props equal
// across App renders — EdinotApp re-renders on every paced content bump
// while typing, and a fresh inline arrow per render defeated React.memo.
// «18 oct» de la barra lateral: toLocaleDateString crea un formateador Intl
// en cada llamada y EdinotApp lo pedía en cada render.
let __todayLabelCache = { key: '', label: '' };
function todayShortLabelCached(lang) {
  const d = new Date();
  const key = lang + ':' + d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  if (__todayLabelCache.key !== key) {
    let label = '';
    try { label = d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short' }).replace('.', ''); } catch {}
    __todayLabelCache = { key, label };
  }
  return __todayLabelCache.label;
}

function useStableCallback(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args) => ref.current(...args), []);
}

function useYVersion(yobj) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!yobj) return;
    // Deferred ~30ms (ms=0 → constant floor), NOT paced: yMeta/ySettings
    // changes must feel instant (note switch, theme), but the observer can
    // fire inside the Yjs transaction of a keystroke dispatch (e.g. the
    // userEditingAt heartbeat, fileStats) — a synchronous setState there
    // renders the whole App before the character paints. The floor pushes
    // the render past the paint; 30ms is under the perception threshold.
    const cb = makePacedBump(() => setV(x => x + 1), 0);
    yobj.observeDeep(cb);
    return () => { yobj.unobserveDeep(cb); cb.cancel(); };
  }, [yobj]);
  return v;
}

// Like useYVersion but coalesces rapid changes: bumps at most once per `ms`
// (leading + trailing edge) so sustained typing re-renders the host at a
// fixed cadence instead of once per keystroke. This is the lever for typing
// fluidity on slower machines (Windows): the active note's Y.Text fires on
// every character, and the top-level App reads `active.content` off this
// version — so an unthrottled bump forces a full re-render (+ an O(n)
// `.toString()` of the whole doc) per key. CodeMirror itself paints every
// keystroke directly from Yjs and does NOT depend on this version, so pacing
// it only delays the React-derived UI (render pane, counts, save pulse) by at
// most `ms`, which the existing render debounce already tolerates.
// Shared pacing for version bumps. NEVER fires synchronously: Y.Doc
// 'update' / Y.Text observers fire inside the Yjs transaction that
// CodeMirror runs during a keystroke dispatch, and a synchronous (or
// microtask) setState re-renders the whole App BEFORE the browser paints
// the character — the typing lag. Always defer to a macrotask so CM
// paints first; coalesce a burst into one bump per `ms`. The 30ms floor
// pushes the render past the paint of the frame the keystroke landed in.
function makePacedBump(fire, ms) {
  let last = 0;
  let timer = null;
  const cb = () => {
    if (timer) return;
    const wait = Math.max(30, ms - (Date.now() - last));
    timer = setTimeout(() => { timer = null; last = Date.now(); fire(); }, wait);
  };
  cb.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return cb;
}

function useThrottledYVersion(yobj, ms) {
  const [v, setV] = useState(0);
  // Tamaño que tenía el objeto en el último render. Entre ese render y la suscripción de abajo (el efecto
  // se ejecuta después, y con un árbol grande se cede el hilo entre medias) IndexedDB puede aplicar el
  // estado guardado de la nota: el observador no vería ese cambio nunca y todo lo derivado del texto
  // (panel de lectura, contadores…) se quedaba con el texto vacío con el que se calculó, hasta salir y
  // volver a entrar en la nota.
  const seenRef = useRef(-1);
  const sizeOf = (o) => (o ? (typeof o.length === 'number' ? o.length : (typeof o.size === 'number' ? o.size : 0)) : -1);
  seenRef.current = sizeOf(yobj);
  useEffect(() => {
    if (!yobj) return;
    const cb = makePacedBump(() => setV(x => x + 1), ms);
    yobj.observeDeep(cb);
    if (sizeOf(yobj) !== seenRef.current) setV(x => x + 1);   // cambió en el hueco: refrescar ya
    return () => { yobj.unobserveDeep(cb); cb.cancel(); };
  }, [yobj, ms]);
  return v;
}

// Returns `value` trailing by `delay` ms after it stops changing. Used to
// keep per-keystroke work (re-serializing every note, scanning all notes
// for wikilinks) off the typing hot path: heavy cross-note aggregates
// recompute ~once the user pauses instead of on every character. The live
// editor is unaffected — CodeMirror paints from Yjs directly.
function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// How long the render/preview pipeline trails live typing. Long enough to
// stay off the keystroke hot path during a normal typing burst (gaps between
// keys are often <180ms), short enough that the preview feels live the moment
// the user pauses.
const RENDER_DEBOUNCE_MS = 180;

// Último modo (Leer/Editar/Dividido/Markdown) por nota, local a este equipo.
const NOTE_MODES_KEY = 'edinot.noteModes.v1';
function readNoteModes() {
  try {
    const v = JSON.parse(localStorage.getItem(NOTE_MODES_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

// Like useDebouncedValue but snaps to the new value IMMEDIATELY when `key`
// changes (e.g. switching notes) instead of trailing — otherwise the render
// pane would briefly show the previous note while the debounce settles. Used
// to keep the heavy markdown-it parse + innerHTML rewrite + table enhancement
// off the per-keystroke path: that work runs ~once typing pauses, while
// CodeMirror keeps painting from Yjs with no delay.
function useDebouncedValueKeyed(value, key, delay) {
  const [state, setState] = useState(() => ({ key, value }));
  useEffect(() => {
    if (state.key !== key) { setState({ key, value }); return; }
    const id = setTimeout(() => setState({ key, value }), delay);
    return () => clearTimeout(id);
  }, [value, key, delay]);
  // On the render where `key` just changed (before the effect commits) return
  // the fresh value so there is no stale flash.
  return state.key === key ? state.value : value;
}

// Estabiliza la identidad de una lista de objetos planos entre renders:
// reutiliza el objeto anterior (mismo id) si sus campos son iguales y, si
// no cambió nada, devuelve el MISMO array. docV/allDocsV bumpean ~4 veces
// por segundo durante la sincronización; sin esto cada bump creaba objetos
// nuevos y relanzaba en cascada todos los memos/efectos que escanean notas
// (búsqueda, canvas, recordatorios, export…) aunque nada hubiera cambiado.
function shallowEqualObj(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}
function stabilizeList(prev, next) {
  if (!Array.isArray(prev) || !prev.length) return next;
  const byId = new Map();
  for (const o of prev) if (o && o.id != null) byId.set(o.id, o);
  let same = prev.length === next.length;
  const out = next.map((o, i) => {
    const old = o && o.id != null ? byId.get(o.id) : undefined;
    const keep = old && shallowEqualObj(old, o) ? old : o;
    if (same && prev[i] !== keep) same = false;
    return keep;
  });
  return same ? prev : out;
}

// Bumps whenever ANY Y.Text inside the doc updates — covers note
// bodies that aren't the currently-active one (per-note useYVersion
// only tracks the active text). Used by features that scan all notes
// for content (backlink discovery, etc.). Throttled to per-tick to
// keep typing cheap.
function useYDocVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!ydoc) return;
    // Paced (see makePacedBump): a microtask bump here ran the full App
    // render before the keystroke's paint whenever the shell doc updated.
    const cb = makePacedBump(() => setV(x => x + 1), 250);
    ydoc.on('update', cb);
    return () => { ydoc.off('update', cb); cb.cancel(); };
  }, []);
  return v;
}

// Bumps on update from ANY loaded vault Y.Doc plus the workspace
// shell. Used by cross-vault aggregators so the sidebar / search re-
// reads when a per-vault provider syncs in new data. Subscribes
// lazily and re-subscribes when the registry grows (new vault
// connected mid-session).
function useAllVaultDocsVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // Paced (see makePacedBump). This hook attaches to EVERY per-note doc —
    // including the active note's, whose 'update' fires on each keystroke.
    // The old queueMicrotask bump therefore re-rendered the whole App (plus
    // the filesMeta/files/backIndex memo cascade keyed on allDocsV) once per
    // character, BEFORE the paint — defeating useThrottledYVersion entirely.
    const cb = makePacedBump(() => { if (!cancelled) setV(x => x + 1); }, 250);
    const attached = new Set();
    const attach = (doc) => {
      if (!doc || attached.has(doc)) return;
      attached.add(doc);
      try { doc.on('update', cb); } catch {}
      // Fire immediately so any state that landed in this doc BEFORE
      // we got around to subscribing (provider SYNCED before the
      // poll fired) gets surfaced — without this, cross-vault file
      // counts in the sidebar stayed at 0 until the next mutation.
      cb();
    };
    // Workspace shell
    attach(ydoc);
    // Existing per-vault + per-note entries
    const sub = () => {
      for (const e of listVaultRegistryEntries()) attach(e.ydoc);
      for (const e of listNoteRegistryEntries()) attach(e.ydoc);
    };
    sub();
    // Poll the registry every 1s for new entries (cheap; vault + note
    // counts stay in the dozens for typical workspaces).
    const t = setInterval(sub, 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
      cb.cancel();
      for (const d of attached) { try { d.off('update', cb); } catch {} }
    };
  }, []);
  return v;
}

// Temas: ui/shared/themes.js (THEMES, ACCENT_PRESETS, «Como el sistema»).

// ─────────────────────────────────────────────────────────────
// Sample documents
// ─────────────────────────────────────────────────────────────
const SAMPLE_DOCS = {
  es: {
    manualName: 'edinot-manual.md',
    manual: `# Edinot — Manual rápido

Editor **Markdown** multiplataforma con render en vivo. Escribe en *texto plano* y alterna con \`⌘/\` para ver el resultado.

---

## Vaults, carpetas y notas

- **Vaults** = espacios aislados (Personal, Trabajo, etc.). Crea o cambia desde Ajustes → Vaults.
- **Carpetas** = árbol dentro de un vault, anidables sin límite, arrastra para mover.
- **⌘T** abre el buscador de notas (título + contenido). **⌘N** crea una nueva.

## Formato

| Atajo | Acción |
|-------|--------|
| ⌘B | Negrita |
| ⌘I | Cursiva |
| ⌘U | Subrayado |
| ⌘K | Enlace |
| ⌘/ | Alternar Render/Markdown |
| ⌘S | Guardar |
| ⌘⇧S | Guardar como… |

Listas, tareas, citas y código:

- [x] Hecho
- [ ] Pendiente

> "Un editor que no estorba."

\`\`\`js
function saludar(nombre) { return \`Hola, \${nombre}!\`; }
\`\`\`

## Wikilinks

Enlaza a otras notas con dobles corchetes: [[notas-reunion]] o con alias [[ideas|mis ideas sueltas]]. Si la nota no existe, el enlace aparece en rojo.

## Tablas inteligentes

Las tablas Markdown se vuelven interactivas: ordenar columnas, tipos (número, fecha, lista, checkbox, etiquetas) y agregados (suma, media, % rellenos…). Edita filas con doble clic.

## Canvas (pizarra infinita)

Crea **🎨 Nuevo canvas** desde el botón ＋. Añade tiles de notas, texto, etiquetas, URLs, imágenes, adjuntos, consultas live y grupos. Conecta nodos arrastrando el "+" del borde. Dibujo libre con el lápiz. Auto-layout en rejilla con un clic.

## Kanban

Cualquier tabla es una pequeña base de datos: arriba tienes las vistas **Tabla · Tablero · Calendario · Galería** (y **+** para guardar vistas propias, cada una con su filtro y su orden). Haz clic en una celda para editarla en el sitio, en la cabecera de una columna para cambiar su tipo, ordenarla, filtrarla u ocultarla, y en **Abrir** para ver la fila como una página. Con una columna de estado (Pendiente / En revisión / Completado) el **Tablero** agrupa las tarjetas y puedes arrastrarlas entre columnas; con una de fecha, el **Calendario** las coloca en su día. Edinot lo guarda como un comentario invisible justo encima de la tabla —\`<!-- edinot:view=kanban:by=Estado -->\`—, que también puedes escribir a mano. Las plantillas \`{{tareastable}}\` y \`{{kanbantable:cols=…:order=…}}\` crean uno listo para usar.

## Adjuntos

Arrastra cualquier archivo a la nota: imágenes/vídeos/audio se previsualizan; PDF, Word, Excel y código se enlazan con icono. Requiere sync (plan Free → solo local). Caché offline configurable en Ajustes → General.

## Plantillas

Carpeta "Plantillas" por vault. Variables \`{{fecha}}\`, \`{{hora}}\`, \`{{cursor}}\`, \`{{tareastable}}\`… Convierte cualquier nota en plantilla desde el menú ⋯.

## Sync (opcional)

Crea cuenta en Ajustes → Sync. El plan Free funciona sin sync (todo local). Los planes superiores sincronizan entre dispositivos en tiempo real (Yjs CRDT) y comparten workspaces.

## MCP — IAs con tus notas

Ajustes → MCP conecta Edinot con Claude Desktop, Codex, Claude Code o Cursor. La IA puede leer y escribir tus notas en vivo.

## Vídeos de YouTube

Pega la URL sola en una línea y se incrusta:

https://www.youtube.com/watch?v=jNQXAC9IVRw

## Atajos rápidos

- **Vim mode** opcional desde Ajustes → General.
- **Tema**: claro, oscuro, sepia. Cambia desde Ajustes → Tema.
- **Búsqueda global** \`⌘P\` o \`⌘T\` busca en todos los vaults (configurable).

¡Empieza! Borra esta nota cuando ya no la necesites.
`,
    meetingName: 'notas-reunion.md',
    meeting: `# Notas de reunión

## Asistentes
- Ana
- Bruno
- Clara

## Acuerdos
- [ ] Cerrar el Q2
- [ ] Mover el lanzamiento al jueves
`,
    ideasName: 'ideas.md',
    ideas: `# Ideas sueltas

> "El secreto de la creatividad es saber esconder tus fuentes."

- Modo zen sin distracciones
- Plugins propios
- Export a PDF
`,
  },
  en: {
    manualName: 'edinot-manual.md',
    manual: `# Edinot — Quick manual

Cross-platform **Markdown** editor with live render. Write in *plain text* and toggle with \`⌘/\` to see the rendered output.

---

## Vaults, folders and notes

- **Vaults** = isolated spaces (Personal, Work, etc.). Create or switch from Settings → Vaults.
- **Folders** = tree inside a vault, infinitely nestable, drag to move.
- **⌘T** opens the note finder (title + content). **⌘N** creates a new one.

## Formatting

| Shortcut | Action |
|---------|--------|
| ⌘B | Bold |
| ⌘I | Italic |
| ⌘U | Underline |
| ⌘K | Link |
| ⌘/ | Toggle Render/Markdown |
| ⌘S | Save |
| ⌘⇧S | Save as… |

Lists, tasks, quotes and code:

- [x] Done
- [ ] Pending

> "An editor that gets out of the way."

\`\`\`js
function greet(name) { return \`Hello, \${name}!\`; }
\`\`\`

## Wikilinks

Link other notes with double brackets: [[notas-reunion]] or with an alias [[ideas|my loose ideas]]. If the note does not exist, the link shows in red.

## Smart tables

Markdown tables become interactive: sort columns, types (number, date, list, checkbox, tags) and aggregates (sum, average, % filled…). Edit rows with a double click.

## Canvas (infinite whiteboard)

Create **🎨 New canvas** from the ＋ button. Add tiles for notes, text, labels, URLs, images, attachments, live queries and groups. Connect nodes by dragging the "+" on the border. Free draw with the pencil. Auto-layout to a grid with one click.

## Kanban

Every table is a small database: on top you get the **Table · Board · Calendar · Gallery** views (and **+** to save your own views, each with its own filter and sort). Click a cell to edit it in place, a column header to change its type, sort, filter or hide it, and **Open** to see the row as a page. With a status column (Pending / In review / Done) the **Board** groups the cards and lets you drag them between columns; with a date column the **Calendar** puts each row on its day. Edinot stores it as an invisible comment right above the table —\`<!-- edinot:view=kanban:by=Status -->\`— which you can also type by hand. The \`{{tareastable}}\` and \`{{kanbantable:cols=…:order=…}}\` template helpers create a ready-to-use one.

## Attachments

Drag any file into a note: images/videos/audio preview inline; PDF, Word, Excel and code are linked with an icon. Requires sync (Free plan → local only). Offline cache configurable under Settings → General.

## Templates

A "Templates" folder per vault. Variables \`{{date}}\`, \`{{time}}\`, \`{{cursor}}\`, \`{{tareastable}}\`… Convert any note into a template from the ⋯ menu.

## Sync (optional)

Create an account in Settings → Sync. The Free plan works without sync (everything local). Higher plans sync between devices in real time (Yjs CRDT) and share workspaces.

## MCP — AIs with your notes

Settings → MCP wires Edinot up to Claude Desktop, Codex, Claude Code or Cursor. The AI can read and write your notes live.

## YouTube videos

Paste a URL alone on a line and it embeds:

https://www.youtube.com/watch?v=jNQXAC9IVRw

## Quick tips

- Optional **Vim mode** under Settings → General.
- **Theme**: light, dark, sepia. Change under Settings → Theme.
- **Global search** \`⌘P\` or \`⌘T\` searches across every vault (configurable).

Get started! Delete this note when you no longer need it.
`,
    meetingName: 'meeting-notes.md',
    meeting: `# Meeting notes

## Attendees
- Anna
- Bruno
- Clara

## Decisions
- [ ] Close Q2
- [ ] Move launch to Thursday
`,
    ideasName: 'ideas.md',
    ideas: `# Loose ideas

> "The secret of creativity is knowing how to hide your sources."

- Distraction-free zen mode
- Custom plugins
- PDF export
`,
  },
};

function pickSeedLang() {
  try {
    const stored = (typeof ySettings !== 'undefined') ? ySettings.get('lang') : null;
    if (stored === 'en' || stored === 'es') return stored;
  } catch {}
  if (typeof navigator !== 'undefined') {
    const l = (navigator.language || '').toLowerCase();
    if (l.startsWith('es')) return 'es';
    return 'en';
  }
  return 'es';
}

function getSeedDocs() {
  const L = pickSeedLang();
  return SAMPLE_DOCS[L] || SAMPLE_DOCS.es;
}

const SAMPLE_DOC = SAMPLE_DOCS.es.manual; // legacy compat — first-seed uses getSeedDocs()

const TEMPLATE_SEEDS = {
  es: [
    { name: 'Plantilla Reunión.md', content:
      '# Reunión {{tema}} · {{date}}\n\n'
      + '**Fecha:** {{date:dddd DD/MM/YYYY}} · **Hora:** {{time}}\n'
      + '**Asistentes:** {{asistentes}}\n'
      + '**Convocada por:** {{user}}\n\n'
      + '## Agenda\n1. {{cursor}}\n\n'
      + '## Decisiones\n\n'
      + '## Próximos pasos\n'
      + '{{checktable:cols=Tarea,Responsable,Fecha}}\n',
    },
    { name: 'Plantilla Proyecto.md', content:
      '# Proyecto {{nombre}}\n\n'
      + '**Inicio:** {{date}} · **Estado:** {{estado|Planning/En curso/Pausado/Completado}}\n'
      + '**Owner:** {{user}} · **Vault:** {{vault}}\n\n'
      + '## Objetivo\n{{cursor}}\n\n'
      + '## Contexto / por qué\n\n'
      + '## Tareas\n{{tareastable}}\n\n'
      + '## Decisiones\n\n'
      + '## Referencias\n',
    },
    { name: 'Plantilla Diario.md', content:
      '# Diario {{date:dddd DD MMMM YYYY}}\n\n'
      + '> Semana {{week}} · {{vault}} · #{{counter:diario}}\n\n'
      + '## ¿Qué hice hoy?\n{{cursor}}\n\n'
      + '## ¿Qué haré mañana?\n\n'
      + '## Energía / mood\n\n'
      + '## Notas sueltas\n',
    },
    { name: 'Plantilla Semana.md', content:
      '# Semana {{week}} · {{year}}\n\n'
      + '## Plan diario\n{{datetable:7:cols=Día,Plan,Hecho}}\n\n'
      + '## Objetivos\n{{checktable:cols=Objetivo}}\n\n'
      + '## Retrospectiva\n{{cursor}}\n',
    },
    { name: TASK_TEMPLATE_NAMES.es, content: taskManagerTemplate('es') },
  ],
  en: [
    { name: 'Meeting Template.md', content:
      '# Meeting {{topic}} · {{date}}\n\n'
      + '**Date:** {{date:dddd DD/MM/YYYY}} · **Time:** {{time}}\n'
      + '**Attendees:** {{attendees}}\n'
      + '**Called by:** {{user}}\n\n'
      + '## Agenda\n1. {{cursor}}\n\n'
      + '## Decisions\n\n'
      + '## Next steps\n'
      + '{{checktable:cols=Task,Owner,Date}}\n',
    },
    { name: 'Project Template.md', content:
      '# Project {{name}}\n\n'
      + '**Start:** {{date}} · **Status:** {{status|Planning/In progress/Paused/Done}}\n'
      + '**Owner:** {{user}} · **Vault:** {{vault}}\n\n'
      + '## Goal\n{{cursor}}\n\n'
      + '## Context / why\n\n'
      + '## Tasks\n{{tareastable}}\n\n'
      + '## Decisions\n\n'
      + '## References\n',
    },
    { name: 'Daily Template.md', content:
      '# Daily {{date:dddd DD MMMM YYYY}}\n\n'
      + '> Week {{week}} · {{vault}} · #{{counter:daily}}\n\n'
      + '## What I did today\n{{cursor}}\n\n'
      + '## What I will do tomorrow\n\n'
      + '## Energy / mood\n\n'
      + '## Loose notes\n',
    },
    { name: 'Weekly Template.md', content:
      '# Week {{week}} · {{year}}\n\n'
      + '## Daily plan\n{{datetable:7:cols=Day,Plan,Done}}\n\n'
      + '## Goals\n{{checktable:cols=Goal}}\n\n'
      + '## Retrospective\n{{cursor}}\n',
    },
    { name: TASK_TEMPLATE_NAMES.en, content: taskManagerTemplate('en') },
  ],
};

function getTemplateSeeds() {
  const L = pickSeedLang();
  return TEMPLATE_SEEDS[L] || TEMPLATE_SEEDS.es;
}

// ─────────────────────────────────────────────────────────────
// Markdown rendering — markdown-it with custom rules:
//  · class injection to keep existing CSS hooks (md-h, md-pre, md-quote…)
//  · safe images (allowlist) with fallback label for unsafe sources
//  · wikilinks [[name]] / [[name|alias]] resolved against vault files
//  · YouTube URL on its own line → embedded iframe
// ─────────────────────────────────────────────────────────────
export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isSafeImageSrc(src) {
  const s = src.trim();
  return /^(data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);)/.test(s)
      || /^https?:\/\//i.test(s)
      || /^file:\/\//i.test(s)
      || /^edinot:\/\/blob\/[a-f0-9]{64}/i.test(s)
      || /^\.{0,2}\//.test(s);
}

const EDINOT_BLOB_RX = /^edinot:\/\/blob\/[a-f0-9]{64}/i;

// Dispatch a media reference by its filename extension. Used by the renderer
// to pick the right HTML element for `edinot://blob/<sha>` references.
const CODE_EXTS = ['js','jsx','ts','tsx','mjs','cjs','py','rb','go','rs','java','c','h','cpp','cc','cxx','hpp','cs','php','sh','bash','zsh','sql','html','htm','css','scss','less','json','xml','yaml','yml','toml','ini','conf','md','markdown','txt','log'];
export function attachmentKind(filenameOrAlt) {
  const m = String(filenameOrAlt || '').toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/);
  const ext = m ? m[1] : '';
  if (['png','jpg','jpeg','gif','webp','svg','avif','bmp'].includes(ext)) return 'image';
  if (['mp4','webm','mov','m4v','ogv'].includes(ext)) return 'video';
  if (['mp3','wav','ogg','m4a','flac','aac'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (CODE_EXTS.includes(ext)) return { kind: 'code', lang: ext };
  return 'file';
}

export function humanFileSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B','KB','MB','GB'];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function youtubeId(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? m[1] : null;
}

export function normalizeNoteName(s) {
  return s.toLowerCase().replace(/\.(md|markdown|txt)$/i, '').trim();
}

// ─── Source-markdown helpers for interactive render features ──────────────
// We parse the raw markdown source (not the rendered HTML) to map each
// rendered table back to its position in the source, and to read/write
// the `<!-- edinot:view=... -->` directive that selects an alt view.

// Captures view + any number of `:key=value` clauses. Values forbid raw `:`
// and whitespace; URL-encoded entries (`%3A`) survive intact. Known clauses:
// `by` (kanban group column), `order` (kanban column order, comma-list of
// URL-encoded names), `agg` (per-column aggregation map), `widths` (table
// view column widths in px, by header name).
const VIEW_DIRECTIVE_RE = /^[ \t]*<!--\s*edinot:view=([a-z]+)((?::[a-zA-Z]+=[^\s>:]+)*)\s*-->[ \t]*$/;
// Hidden note-level properties comment (set via MCP set_note_property).
// Stripped from the render the same way view directives are.
const PROPS_DIRECTIVE_RE = /^[ \t]*<!--\s*edinot:props\s.*-->[ \t]*$/;

function parseDirectiveClauses(s) {
  const out = {};
  if (!s) return out;
  const re = /:([a-zA-Z]+)=([^\s>:]+)/g;
  let m;
  while ((m = re.exec(s)) !== null) out[m[1]] = m[2];
  return out;
}

function parseWidthsClause(s) {
  if (!s) return null;
  const out = {};
  for (const pair of s.split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    try {
      const k = decodeURIComponent(pair.slice(0, eq));
      const v = parseInt(pair.slice(eq + 1), 10);
      if (k && Number.isFinite(v) && v >= 30 && v <= 2000) out[k] = v;
    } catch {}
  }
  return Object.keys(out).length ? out : null;
}

function serializeWidthsClause(w) {
  if (!w) return '';
  const parts = [];
  for (const [k, v] of Object.entries(w)) {
    if (!Number.isFinite(v) || v < 30) continue;
    parts.push(`${encodeURIComponent(k)}=${Math.round(v)}`);
  }
  return parts.join(',');
}

function parseAggClause(s) {
  if (!s) return null;
  const out = {};
  for (const pair of s.split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    try {
      const k = decodeURIComponent(pair.slice(0, eq));
      const v = decodeURIComponent(pair.slice(eq + 1));
      if (k && v && v !== 'none') out[k] = v;
    } catch {}
  }
  return Object.keys(out).length ? out : null;
}

function serializeAggClause(agg) {
  if (!agg) return '';
  const parts = [];
  for (const [k, v] of Object.entries(agg)) {
    if (!v || v === 'none') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.join(',');
}

// Column-types directive: `cols=Col1%3Dselect%3APendiente%7CHecho;Col2%3Dnumber`.
// Each entry is URL-encoded so the `:` separator (for select options),
// the `|` between options, and the `=` between name and type all survive
// the directive parser. Supported types: text, select, number, date,
// checkbox, tags, multiselect, status, rating, progress, person.
// Unknown types degrade gracefully to text.
const COLUMN_TYPES = ['text', 'select', 'number', 'date', 'checkbox', 'tags', 'multiselect', 'status', 'rating', 'progress', 'person', 'wikilink', 'archivo'];
const RATING_MAX = 5;
// Preset swatches for table cell/header coloring. Soft pastels that read well
// in light + dark; users can also pick any custom color via the native input.
const TABLE_COLOR_PALETTE = [
  '#fde2e2', '#ffe3c2', '#fff3bf', '#e3f3cd', '#cdeee4',
  '#cfe5fb', '#e2d6fb', '#f8d7ea', '#e9ecef', '#ffd0d0',
];
// In-memory merge of a colors patch (mirrors setTableColorsInSource for state).
function applyColorsPatch(cur, patch) {
  const groups = ['headers', 'cols', 'cells', 'headersFg', 'colsFg', 'cellsFg'];
  const out = {};
  for (const g of groups) {
    out[g] = { ...((cur && cur[g]) || {}) };
    if (patch && patch[g]) {
      for (const [k, v] of Object.entries(patch[g])) { if (v) out[g][k] = v; else delete out[g][k]; }
    }
  }
  return out;
}
// Small reusable swatch row used by the column menu + cell editor. Calls
// onPick(hex) for a preset/custom color and onClear() to remove the color.
function ColorPalette({ value, onPick, onClear, label }) {
  return (
    <div className="color-palette">
      {label ? <span className="color-palette-label">{label}</span> : null}
      <div className="color-palette-swatches">
        {TABLE_COLOR_PALETTE.map(hex => (
          <button key={hex} type="button"
            className={`color-swatch${value && value.toLowerCase() === hex ? ' on' : ''}`}
            style={{ background: hex }} title={hex}
            onClick={() => onPick(hex)} />
        ))}
        <label className="color-swatch color-swatch-custom" title="Personalizado">
          🎨
          <input type="color" value={value || '#ffffff'} style={{ display: 'none' }}
            onChange={(e) => onPick(e.target.value)} />
        </label>
        <button type="button" className="color-swatch color-swatch-clear" title="Quitar color"
          onClick={() => onClear()}>×</button>
      </div>
    </div>
  );
}
// Split a multi-value cell (multiselect / person) into trimmed tokens.
function splitMulti(v) {
  return String(v == null ? '' : v).split(/[,;]/).map(x => x.trim()).filter(Boolean);
}
// Display name for a person token — local-part of an email, else the raw token.
function personName(token) {
  const s = String(token || '').trim();
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at) : s;
}
// Parse a rating cell to an integer 0..RATING_MAX (0 = unset / invalid).
function parseRating(v) {
  const n = Math.round(Number(String(v == null ? '' : v).replace(',', '.')));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(RATING_MAX, n);
}
// Parse a progress cell to an integer 0..100 (null when blank/invalid).
function parseProgress(v) {
  const s = String(v == null ? '' : v).replace('%', '').replace(',', '.').trim();
  if (!s) return null;
  const n = Math.round(Number(s));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}
function parseColsClause(s) {
  if (!s) return null;
  const out = {};
  for (const raw of s.split(';')) {
    try {
      const dec = decodeURIComponent(raw);
      const eq = dec.indexOf('=');
      if (eq <= 0) continue;
      const k = dec.slice(0, eq).trim();
      const v = dec.slice(eq + 1).trim();
      if (!k || !v) continue;
      const colonIdx = v.indexOf(':');
      let type, options = null;
      if (colonIdx > 0) {
        type = v.slice(0, colonIdx);
        options = v.slice(colonIdx + 1).split('|').map(x => x.trim()).filter(Boolean);
      } else {
        type = v;
      }
      if (!COLUMN_TYPES.includes(type)) continue;
      out[k] = options && options.length ? { type, options } : { type };
    } catch {}
  }
  return Object.keys(out).length ? out : null;
}
function serializeColsClause(cols) {
  if (!cols) return '';
  const parts = [];
  for (const [k, conf] of Object.entries(cols)) {
    if (!conf || !conf.type || conf.type === 'text') continue;
    let v = conf.type;
    if (conf.options && conf.options.length) v += ':' + conf.options.join('|');
    parts.push(encodeURIComponent(`${k}=${v}`));
  }
  return parts.join(';');
}

// Cell/header coloring directive: `colors=h.Col=rrggbb;c.Col=rrggbb;x.R,C=rrggbb`
// (and `ht.`/`ct.`/`xt.` variants for text/foreground color). `h`=header bg,
// `c`=whole-column cell bg, `x`=single cell bg (R = data-row index, C = column
// index). Hex stored without `#`. Keys URL-encoded so the directive parser's
// `:`/whitespace exclusions are never tripped. Visible in render + share +
// exports because they all share this render pipeline.
const COLOR_KINDS = ['h', 'c', 'x', 'ht', 'ct', 'xt'];
function parseColorsClause(s) {
  if (!s) return null;
  const out = { headers: {}, cols: {}, cells: {}, headersFg: {}, colsFg: {}, cellsFg: {} };
  const bucket = { h: 'headers', c: 'cols', x: 'cells', ht: 'headersFg', ct: 'colsFg', xt: 'cellsFg' };
  for (const raw of s.split(';')) {
    if (!raw) continue;
    const eq = raw.indexOf('=');
    if (eq <= 0) continue;
    const lhs = raw.slice(0, eq);
    const val = raw.slice(eq + 1).trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(val)) continue;
    const dot = lhs.indexOf('.');
    if (dot <= 0) continue;
    const kind = lhs.slice(0, dot);
    const key = lhs.slice(dot + 1);
    if (!COLOR_KINDS.includes(kind)) continue;
    const hex = '#' + val;
    if (kind === 'x' || kind === 'xt') {
      if (/^\d+,\d+$/.test(key)) out[bucket[kind]][key] = hex;
    } else {
      try { out[bucket[kind]][decodeURIComponent(key)] = hex; } catch {}
    }
  }
  const any = Object.values(out).some(o => Object.keys(o).length);
  return any ? out : null;
}
function serializeColorsClause(c) {
  if (!c) return '';
  const parts = [];
  const hex = (v) => String(v || '').replace('#', '').toLowerCase();
  const push = (kind, key, v, cellKey) => {
    const h = hex(v);
    if (!/^[0-9a-f]{6}$/.test(h)) return;
    if (cellKey) { if (/^\d+,\d+$/.test(key)) parts.push(`${kind}.${key}=${h}`); }
    else parts.push(`${kind}.${encodeURIComponent(key)}=${h}`);
  };
  for (const [k, v] of Object.entries(c.headers || {})) push('h', k, v);
  for (const [k, v] of Object.entries(c.cols || {})) push('c', k, v);
  for (const [k, v] of Object.entries(c.cells || {})) push('x', k, v, true);
  for (const [k, v] of Object.entries(c.headersFg || {})) push('ht', k, v);
  for (const [k, v] of Object.entries(c.colsFg || {})) push('ct', k, v);
  for (const [k, v] of Object.entries(c.cellsFg || {})) push('xt', k, v, true);
  return parts.join(';');
}

// Sort directive: `sort=Col,asc` or `sort=Col,desc` (URL-encoded col name).
// Returns `{ col, dir }` or null. Only one sort column supported — keeps the
// UX (cycle on header click) decoupled from prior table state.
function parseSortClause(s) {
  if (!s) return null;
  try {
    const comma = s.lastIndexOf(',');
    if (comma <= 0) return null;
    const col = decodeURIComponent(s.slice(0, comma));
    const dir = s.slice(comma + 1).toLowerCase();
    if (!col || (dir !== 'asc' && dir !== 'desc')) return null;
    return { col, dir };
  } catch { return null; }
}
function serializeSortClause(sort) {
  if (!sort || !sort.col || (sort.dir !== 'asc' && sort.dir !== 'desc')) return '';
  return `${encodeURIComponent(sort.col)},${sort.dir}`;
}

// Filter directive: `filt=Col1%3Dval1;Col2%3Dval2` — each pair URL-encoded so
// `=` inside values + `;` separators survive the directive regex. Returns
// `{ ColName: substring }` or null. Filters are case-insensitive substring
// matches applied to the cell's plain text.
function parseFilterClause(s) {
  if (!s) return null;
  const out = {};
  for (const raw of s.split(';')) {
    try {
      const dec = decodeURIComponent(raw);
      const eq = dec.indexOf('=');
      if (eq <= 0) continue;
      const k = dec.slice(0, eq).trim();
      const v = dec.slice(eq + 1).trim();
      if (k && v) out[k] = v;
    } catch {}
  }
  return Object.keys(out).length ? out : null;
}
function serializeFilterClause(filter) {
  if (!filter) return '';
  const parts = [];
  for (const [k, v] of Object.entries(filter)) {
    if (!k || !v) continue;
    parts.push(encodeURIComponent(`${k}=${v}`));
  }
  return parts.join(';');
}

// Apply filter + sort to a parsed table's rows. Returns a new array of
// rows (unchanged contents, just possibly re-ordered and shorter). Used by
// every view (table / list / cards / kanban) so behaviour is uniform.
// When `cols` (column-type config) is provided, sort recognises `date`
// columns and orders by parsed time instead of string.
function applyTableSortFilter(headers, rows, sort, filter, cols) {
  let out = rows;
  if (filter && Object.keys(filter).length) {
    const colIdx = new Map();
    headers.forEach((h, i) => colIdx.set(h.toLowerCase(), i));
    out = out.filter(r => {
      for (const [k, sub] of Object.entries(filter)) {
        const i = colIdx.get(k.toLowerCase());
        if (i == null) continue;
        // `sub` sin prefijo = «contiene» (lo de siempre); `~op~valor` = operador.
        const conf = cols && cols[headers[i]];
        if (!dbMatchFilter(r[i], sub, conf && conf.type)) return false;
      }
      return true;
    });
  }
  if (sort && sort.col) {
    const i = headers.findIndex(h => h.toLowerCase() === sort.col.toLowerCase());
    if (i >= 0) {
      const dir = sort.dir === 'desc' ? -1 : 1;
      const colType = cols && cols[headers[i]] && cols[headers[i]].type;
      out = out.slice().sort((a, b) => {
        const av = String(a[i] || '');
        const bv = String(b[i] || '');
        if (colType === 'date') {
          const at = Date.parse(av);
          const bt = Date.parse(bv);
          if (Number.isFinite(at) && Number.isFinite(bt)) return (at - bt) * dir;
          if (Number.isFinite(at)) return -1 * dir;
          if (Number.isFinite(bt)) return 1 * dir;
        }
        if (colType === 'number' || colType === 'rating' || colType === 'progress' || (!colType)) {
          // Numeric compare when both parse as numbers, otherwise locale string.
          const an = Number(av.replace('%', '').replace(',', '.'));
          const bn = Number(bv.replace('%', '').replace(',', '.'));
          if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;
        }
        return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * dir;
      });
    }
  }
  return out;
}

function escTableCell(c) { return String(c == null ? '' : c).replace(/\|/g, '\\|'); }

// Split a pipe-table row on UNescaped `|` and unescape `\|` in each cell
// (same contract as mcp/server.mjs splitTableLine). Writers escape `|` back,
// so a cell like `a|b` round-trips instead of splitting into two cells.
function parseTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
}

export function parseSourceTables(src) {
  const lines = src.split('\n');
  const tables = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^[ \t]*(```|~~~)/.test(line)) { inFence = !inFence; i++; continue; }
    if (inFence) { i++; continue; }
    if (
      /^\s*\|.+\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|[\s:|\-]+\|\s*$/.test(lines[i + 1])
    ) {
      const startLine = i;
      const headers = parseTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      const endLine = i - 1;

      // Look up the closest non-blank line above for a view directive.
      // Also collect any *malformed* `<!-- edinot:view=… -->` siblings above
      // it so the writer can sweep them out — older bug emitted unencoded
      // values containing spaces that broke the strict directive regex, so
      // re-clicks piled up duplicate comments without ever finding the
      // existing one to replace.
      let directive = null;
      let dirLineIdx = -1;
      const garbageDirLines = [];
      const LOOSE_VIEW_RE = /^\s*<!--\s*edinot:view=/;
      let j = startLine - 1;
      while (j >= 0 && lines[j].trim() === '') j--;
      while (j >= 0 && LOOSE_VIEW_RE.test(lines[j])) {
        const m = lines[j].match(VIEW_DIRECTIVE_RE);
        if (m && directive === null) {
          const cls = parseDirectiveClauses(m[2]);
          let order = null;
          if (cls.order) {
            try { order = cls.order.split(',').map(s => decodeURIComponent(s)); }
            catch { order = null; }
          }
          let byDecoded = null;
          if (cls.by) {
            try { byDecoded = decodeURIComponent(cls.by).trim(); }
            catch { byDecoded = cls.by.trim(); }
          }
          directive = {
            view: m[1],
            by: byDecoded,
            order,
            agg: parseAggClause(cls.agg),
            widths: parseWidthsClause(cls.widths),
            sort: parseSortClause(cls.sort),
            filter: parseFilterClause(cls.filt),
            cols: parseColsClause(cls.cols),
            colors: parseColorsClause(cls.colors),
            // Cláusulas de las bases de datos (editor/db/model.js).
            hidden: dbParseNameList(cls.hide),
            cal: dbParseNameClause(cls.cal),
            optColors: dbSanitizeOptColors(dbParseJsonClause(cls.ocol)),
            views: dbSanitizeViews(dbParseJsonClause(cls.views)),
            wide: dbParseWideClause(cls.wide) || null,
            // Cláusulas desconocidas (de versiones futuras): se conservan tal cual.
            extra: (() => { const x = {}; for (const [k, v] of Object.entries(cls)) if (!KNOWN_VIEW_CLAUSES.has(k)) x[k] = v; return Object.keys(x).length ? x : null; })(),
          };
          dirLineIdx = j;
        } else {
          garbageDirLines.push(j);
        }
        j--;
        while (j >= 0 && lines[j].trim() === '') j--;
      }
      tables.push({ startLine, endLine, headers, rows, directive, dirLineIdx, garbageDirLines });
    } else {
      i++;
    }
  }
  return tables;
}

const KNOWN_VIEW_CLAUSES = new Set(['by', 'order', 'agg', 'widths', 'sort', 'filt', 'cols', 'colors', 'hide', 'cal', 'ocol', 'views', 'wide']);

export function stripViewDirectives(src) {
  return src.split('\n').map(l => (VIEW_DIRECTIVE_RE.test(l) || PROPS_DIRECTIVE_RE.test(l)) ? '' : l).join('\n');
}

// `ext` (opcional) = { hidden, cal, optColors, views, wide }: undefined en una clave
// la conserva, null la borra. Las cláusulas desconocidas siempre se conservan.
export function setTableViewInSource(src, tableIdx, view, by, order, agg, widths, sort, filter, cols, colors, ext) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t) return src;
  const prevDir = t.directive || {};
  const pick = (k) => (ext && ext[k] !== undefined ? ext[k] : (prevDir[k] || null));
  const hidden = pick('hidden'), cal = pick('cal'), optColors = pick('optColors'), views = pick('views'), wide = pick('wide');
  const extra = prevDir.extra || null;
  // Preserve the last-chosen group-by even when the user temporarily
  // switches to Lista / Tarjetas / Tabla. Caller can explicitly pass an
  // empty string to clear it.
  if (by == null && t.directive && t.directive.by) by = t.directive.by;
  // Same convention for `order`: undefined → preserve; `[]` → clear.
  if (order === undefined && t.directive && t.directive.order) order = t.directive.order;
  if (agg === undefined && t.directive && t.directive.agg) agg = t.directive.agg;
  if (widths === undefined && t.directive && t.directive.widths) widths = t.directive.widths;
  if (sort === undefined && t.directive && t.directive.sort) sort = t.directive.sort;
  if (filter === undefined && t.directive && t.directive.filter) filter = t.directive.filter;
  if (cols === undefined && t.directive && t.directive.cols) cols = t.directive.cols;
  if (colors === undefined && t.directive && t.directive.colors) colors = t.directive.colors;
  const lines = src.split('\n');
  const hasOrder = Array.isArray(order) && order.length > 0;
  const aggStr = serializeAggClause(agg);
  const hasAgg = !!aggStr;
  const widthsStr = serializeWidthsClause(widths);
  const hasWidths = !!widthsStr;
  const sortStr = serializeSortClause(sort);
  const hasSort = !!sortStr;
  const filterStr = serializeFilterClause(filter);
  const hasFilter = !!filterStr;
  const colsStr = serializeColsClause(cols);
  const hasCols = !!colsStr;
  const colorsStr = serializeColorsClause(colors);
  const hasColors = !!colorsStr;
  const hideStr = dbSerializeNameList(hidden);
  const calStr = cal ? encodeURIComponent(cal) : '';
  const ocolStr = optColors && Object.keys(optColors).length ? dbSerializeJsonClause(optColors) : '';
  const viewsStr = views && views.list && views.list.length ? dbSerializeJsonClause(views) : '';
  const wideStr = dbSerializeWideClause(wide);
  const extraStr = extra ? Object.entries(extra).filter(([k, v]) => k && v).map(([k, v]) => `:${k}=${v}`).join('') : '';
  const hasExt = !!(hideStr || calStr || ocolStr || viewsStr || wideStr || extraStr);
  const hasState = (view && view !== 'table') || (by && by.length) || hasOrder || hasAgg || hasWidths || hasSort || hasFilter || hasCols || hasColors || hasExt;
  const orderStr = hasOrder ? order.map(s => encodeURIComponent(s)).join(',') : '';
  const directiveLine = hasState
    ? `<!-- edinot:view=${view || 'table'}${by ? `:by=${encodeURIComponent(by)}` : ''}${orderStr ? `:order=${orderStr}` : ''}${aggStr ? `:agg=${aggStr}` : ''}${widthsStr ? `:widths=${widthsStr}` : ''}${sortStr ? `:sort=${sortStr}` : ''}${filterStr ? `:filt=${filterStr}` : ''}${colsStr ? `:cols=${colsStr}` : ''}${colorsStr ? `:colors=${colorsStr}` : ''}${hideStr ? `:hide=${hideStr}` : ''}${calStr ? `:cal=${calStr}` : ''}${ocolStr ? `:ocol=${ocolStr}` : ''}${viewsStr ? `:views=${viewsStr}` : ''}${wideStr ? `:wide=${wideStr}` : ''}${extraStr} -->`
    : null;
  // Sweep malformed sibling directive comments (legacy bug residue) plus
  // the canonical one — sort descending so splice indexes stay valid.
  const toRemove = (t.garbageDirLines || []).slice();
  if (t.dirLineIdx >= 0) toRemove.push(t.dirLineIdx);
  toRemove.sort((a, b) => b - a);
  for (const idx of toRemove) lines.splice(idx, 1);
  // Re-anchor the insertion point: each removal above the table shifted it up.
  const removedAboveTable = toRemove.filter(idx => idx < t.startLine).length;
  const insertAt = t.startLine - removedAboveTable;
  if (directiveLine !== null) {
    lines.splice(insertAt, 0, directiveLine);
  }
  return lines.join('\n');
}

// Parche genérico de la directiva de una tabla. Cada clave presente en `patch`
// se sustituye (null/'' la borra); las ausentes se conservan. Claves: view,
// by, order, agg, widths, sort, filter, cols, colors, hidden, cal, optColors, views, wide.
function patchTableDirective(src, tableIdx, patch) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t) return src;
  const d = t.directive || {};
  const has = (k) => patch && Object.prototype.hasOwnProperty.call(patch, k);
  const val = (k) => (has(k) ? (patch[k] == null ? null : patch[k]) : (d[k] == null ? null : d[k]));
  const nz = (o) => (o && typeof o === 'object' && !Array.isArray(o) && !Object.keys(o).length ? null : o);
  return setTableViewInSource(src, tableIdx,
    (has('view') ? patch.view : d.view) || 'table',
    (has('by') ? patch.by : d.by) || '',
    (has('order') ? patch.order : d.order) || [],
    nz(val('agg')), nz(val('widths')), val('sort'), nz(val('filter')), nz(val('cols')), val('colors'),
    {
      hidden: (val('hidden') && val('hidden').length) ? val('hidden') : null,
      cal: val('cal') || null,
      optColors: nz(val('optColors')),
      views: val('views'),
      wide: val('wide') ? true : null,
    });
}

function setTableAggInSource(src, tableIdx, colName, fn) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t) return src;
  const cur = (t.directive && t.directive.agg) ? { ...t.directive.agg } : {};
  if (!fn || fn === 'none') delete cur[colName];
  else cur[colName] = fn;
  return setTableViewInSource(src, tableIdx,
    t.directive ? t.directive.view : 'table',
    t.directive ? t.directive.by : null,
    undefined, cur);
}

// Set / clear the type of a single column. `conf` is `{type, options?}` or
// null to revert to text (the absence in the directive == text).
// Rename a column header at `colIdx` to `newName`. Cascades to every
// directive that keys by column name (cols, sort, filter, widths, agg)
// so the rename is invisible to the rest of the toolchain.
function renameTableColumn(src, tableIdx, colIdx, newName) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t || colIdx < 0 || colIdx >= t.headers.length) return src;
  const cleaned = String(newName || '').replace(/\n+/g, ' ').trim();
  if (!cleaned) return src;
  const oldName = t.headers[colIdx];
  const lines = src.split('\n');
  // Rewrite the header cell only.
  const headerLine = lines[t.startLine];
  const headerCells = parseTableRow(headerLine);
  if (headerCells.length <= colIdx) return src;
  headerCells[colIdx] = cleaned;
  const leadMatch = headerLine.match(/^(\s*)/);
  const lead = leadMatch ? leadMatch[1] : '';
  lines[t.startLine] = lead + '| ' + headerCells.map(escTableCell).join(' | ') + ' |';
  let next = lines.join('\n');
  if (oldName && oldName !== cleaned) {
    const renameKey = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k === oldName ? cleaned : k] = v;
      }
      return out;
    };
    const dir = t.directive || {};
    const cols   = renameKey(dir.cols);
    const filter = renameKey(dir.filter);
    const widths = renameKey(dir.widths);
    const agg    = renameKey(dir.agg);
    const sort = dir.sort && dir.sort.col === oldName ? { col: cleaned, dir: dir.sort.dir } : dir.sort;
    const by = dir.by === oldName ? cleaned : dir.by;
    const colors = dir.colors ? {
      ...dir.colors, headers: renameKey(dir.colors.headers), cols: renameKey(dir.colors.cols),
      headersFg: renameKey(dir.colors.headersFg), colsFg: renameKey(dir.colors.colsFg),
    } : undefined;
    const ext = dbRenameInExt({ hidden: dir.hidden || null, cal: dir.cal || null, optColors: dir.optColors || null, views: dir.views || null }, oldName, cleaned);
    next = setTableViewInSource(next, tableIdx,
      dir.view || 'table', by,
      undefined, // order keys are bucket values, not column names
      agg, widths, sort, filter, cols, colors, ext);
  }
  return next;
}

function setTableColumnTypeInSource(src, tableIdx, colName, conf) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t) return src;
  const cur = (t.directive && t.directive.cols) ? { ...t.directive.cols } : {};
  if (!conf || !conf.type || conf.type === 'text') delete cur[colName];
  else cur[colName] = conf.options && conf.options.length ? { type: conf.type, options: conf.options } : { type: conf.type };
  const v = t.directive ? t.directive.view : 'table';
  const by = t.directive ? t.directive.by : null;
  return setTableViewInSource(src, tableIdx, v, by, undefined, undefined, undefined,
    undefined, undefined,
    Object.keys(cur).length ? cur : null);
}

// Apply a coloring patch to the table directive. `patch` is a partial
// { headers, cols, cells, headersFg, colsFg, cellsFg } map; entries with a
// falsy value are removed. Pass `null` to clear ALL colors.
function setTableColorsInSource(src, tableIdx, patch) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t) return src;
  let next;
  if (patch === null) {
    next = null;
  } else {
    const cur = (t.directive && t.directive.colors) ? t.directive.colors : {};
    const groups = ['headers', 'cols', 'cells', 'headersFg', 'colsFg', 'cellsFg'];
    next = {};
    for (const g of groups) {
      next[g] = { ...(cur[g] || {}) };
      if (patch[g]) {
        for (const [k, v] of Object.entries(patch[g])) {
          if (v) next[g][k] = v; else delete next[g][k];
        }
      }
    }
    if (!groups.some(g => Object.keys(next[g]).length)) next = null;
  }
  return setTableViewInSource(src, tableIdx,
    t.directive ? t.directive.view : 'table',
    t.directive ? t.directive.by : null,
    undefined, undefined, undefined, undefined, undefined, undefined, next);
}

// Set (or clear) a fixed display width on a markdown image, encoded
// Obsidian-style as `![alt|width](src)`. Targets the `occ`-th (0-based)
// occurrence of that exact src so duplicate references resolve unambiguously.
// A width <= 0 strips any existing size hint, restoring the default layout.
function setImageWidthInSource(src, imgSrc, occ, width) {
  if (!imgSrc) return src;
  const esc = imgSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ![alt](src) or ![alt](src "title") — capture alt + any trailing title.
  const re = new RegExp('!\\[([^\\]]*)\\]\\(' + esc + '([^)]*)\\)', 'g');
  let n = 0;
  return src.replace(re, (full, alt, tail) => {
    if (n++ !== occ) return full;
    const baseAlt = alt.replace(/\s*\|\s*\d{1,5}(?:x\d{1,5})?\s*$/, '');
    const w = Math.round(Number(width) || 0);
    const newAlt = w > 0 ? `${baseAlt}|${w}` : baseAlt;
    return `![${newAlt}](${imgSrc}${tail})`;
  });
}

// Reorder a column by splicing the cell at `fromIdx` into `toIdx` across the
// header row, separator row, and every data row. Widths/agg are keyed by
// header name so they follow the move automatically.
function moveTableColumn(src, tableIdx, fromIdx, toIdx) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t) return src;
  if (fromIdx === toIdx) return src;
  const ncols = t.headers.length;
  if (fromIdx < 0 || fromIdx >= ncols || toIdx < 0 || toIdx >= ncols) return src;
  const lines = src.split('\n');
  const total = t.rows.length + 2;
  for (let i = 0; i < total; i++) {
    const lineIdx = t.startLine + i;
    const original = lines[lineIdx];
    if (original == null) continue;
    const leadMatch = original.match(/^(\s*)/);
    const lead = leadMatch ? leadMatch[1] : '';
    const cells = parseTableRow(original);
    if (cells.length < ncols) continue;
    const [moved] = cells.splice(fromIdx, 1);
    cells.splice(toIdx, 0, moved);
    lines[lineIdx] = lead + '| ' + cells.map(escTableCell).join(' | ') + ' |';
  }
  return lines.join('\n');
}

// Append cell text to the end of a table row line, preserving any leading
// whitespace and reusing the existing trailing pipe as the new separator.
function appendCellToTableLine(line, cellText) {
  const trimmed = line.replace(/\s+$/, '');
  if (trimmed.endsWith('|')) return trimmed.slice(0, -1) + '|' + cellText + '|';
  return trimmed + '|' + cellText + '|';
}

export function appendTableRow(src, tableIdx, values) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t) return src;
  const lines = src.split('\n');
  const leadMatch = lines[t.startLine].match(/^(\s*)/);
  const lead = leadMatch ? leadMatch[1] : '';
  const cells = [];
  for (let i = 0; i < t.headers.length; i++) {
    const raw = (values && values[i] != null ? String(values[i]) : '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
    cells.push(' ' + raw + ' ');
  }
  const newRow = lead + '|' + cells.join('|') + '|';
  lines.splice(t.endLine + 1, 0, newRow);
  return lines.join('\n');
}

export function updateTableRow(src, tableIdx, rowIdx, values) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t || rowIdx < 0 || rowIdx >= t.rows.length) return src;
  const lines = src.split('\n');
  const lineIdx = t.startLine + 2 + rowIdx;
  const leadMatch = lines[lineIdx].match(/^(\s*)/);
  const lead = leadMatch ? leadMatch[1] : '';
  const cells = [];
  for (let i = 0; i < t.headers.length; i++) {
    const raw = (values && values[i] != null ? String(values[i]) : '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
    cells.push(' ' + raw + ' ');
  }
  lines[lineIdx] = lead + '|' + cells.join('|') + '|';
  return lines.join('\n');
}

// Move data row `fromIdx` so it lands before row `beforeIdx` (rows.length =
// to the end). Indexes are in source order.
function moveTableRow(src, tableIdx, fromIdx, beforeIdx) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t || fromIdx < 0 || fromIdx >= t.rows.length) return src;
  const to = Math.max(0, Math.min(t.rows.length, beforeIdx));
  if (to === fromIdx || to === fromIdx + 1) return src;
  const lines = src.split('\n');
  const base = t.startLine + 2;
  const [line] = lines.splice(base + fromIdx, 1);
  lines.splice(base + (to > fromIdx ? to - 1 : to), 0, line);
  return lines.join('\n');
}

// Insert a copy of row `rowIdx` right below it.
function duplicateTableRow(src, tableIdx, rowIdx) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t || rowIdx < 0 || rowIdx >= t.rows.length) return src;
  const lines = src.split('\n');
  const at = t.startLine + 2 + rowIdx;
  lines.splice(at + 1, 0, lines[at]);
  return lines.join('\n');
}

export function removeTableRow(src, tableIdx, rowIdx) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t || rowIdx < 0 || rowIdx >= t.rows.length) return src;
  const lines = src.split('\n');
  lines.splice(t.startLine + 2 + rowIdx, 1);
  return lines.join('\n');
}

export function appendTableColumn(src, tableIdx, colName, defaultValue = '') {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t) return src;
  const lines = src.split('\n');
  const safeName = String(colName || 'col').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
  lines[t.startLine] = appendCellToTableLine(lines[t.startLine], ' ' + safeName + ' ');
  lines[t.startLine + 1] = appendCellToTableLine(lines[t.startLine + 1], '-------');
  for (let i = 0; i < t.rows.length; i++) {
    const lineIdx = t.startLine + 2 + i;
    lines[lineIdx] = appendCellToTableLine(lines[lineIdx], ' ' + (defaultValue || '') + ' ');
  }
  return lines.join('\n');
}

function removeTableColumn(src, tableIdx, colIdx) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t || colIdx < 0 || colIdx >= t.headers.length) return src;
  const lines = src.split('\n');
  const total = t.rows.length + 2; // header + sep + rows
  for (let i = 0; i < total; i++) {
    const lineIdx = t.startLine + i;
    const cells = parseTableRow(lines[lineIdx]);
    cells.splice(colIdx, 1);
    const leadMatch = lines[lineIdx].match(/^(\s*)/);
    const lead = leadMatch ? leadMatch[1] : '';
    lines[lineIdx] = lead + '| ' + cells.map(escTableCell).join(' | ') + ' |';
  }
  return lines.join('\n');
}

export function setTableCellInSource(src, tableIdx, rowIdx, colIdx, newValue) {
  const tables = parseSourceTables(src);
  const t = tables[tableIdx];
  if (!t || rowIdx < 0 || rowIdx >= t.rows.length || colIdx < 0) return src;
  const lines = src.split('\n');
  const lineIdx = t.startLine + 2 + rowIdx; // 2 = header row + separator
  const original = lines[lineIdx] || '';
  const leadMatch = original.match(/^(\s*)/);
  const lead = leadMatch ? leadMatch[1] : '';
  const cells = parseTableRow(original);
  if (colIdx >= cells.length) {
    // Ragged row (fewer cells than headers): pad up to the header count.
    if (colIdx >= t.headers.length) return src;
    while (cells.length < t.headers.length) cells.push('');
  }
  cells[colIdx] = String(newValue).replace(/\n+/g, ' ');
  lines[lineIdx] = lead + '| ' + cells.map(escTableCell).join(' | ') + ' |';
  return lines.join('\n');
}

function toggleNthChecklistInSource(src, n) {
  const re = /^([ \t]*[-*+]\s+)\[([ xX])\](.*)$/gm;
  let i = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (i === n) {
      const newChar = m[2] === ' ' ? 'x' : ' ';
      return src.slice(0, m.index) + `${m[1]}[${newChar}]${m[3]}` + src.slice(m.index + m[0].length);
    }
    i++;
  }
  return src;
}

// ─── Table aggregations ──────────────────────────────────────────────────
function tryNumber(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return NaN;
  let c = s.replace(/[^\d.,\-]/g, '');
  if (c.indexOf('.') >= 0 && c.indexOf(',') >= 0) c = c.replace(/,/g, '');
  else c = c.replace(',', '.');
  const n = Number(c);
  return Number.isFinite(n) ? n : NaN;
}
function fmtNum(n) {
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}
const AGG_LABEL_KEYS = {
  count:        'agg.count',
  count_all:    'agg.countAll',
  count_empty:  'agg.empty',
  count_unique: 'agg.unique',
  sum:          'agg.sum',
  avg:          'agg.avg',
  min:          'agg.min',
  max:          'agg.max',
  pct_filled:   'agg.pct',
};
const AGG_LABELS = new Proxy({}, { get: (_, k) => t(AGG_LABEL_KEYS[k] || k) });

// Hash-based pastel color for a string. Same value always gets the same
// hue so a select pill keeps its identity across renders. We use HSL so
// dark mode can dim the lightness via CSS without retinting.
function tplPillColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

// Format a cell value according to the column's type config. Returns an
// HTML string injected via innerHTML. Falls back to the raw value when the
// type is unknown or parsing fails.
function formatTypedCell(raw, conf) {
  const v = raw == null ? '' : String(raw);
  if (!conf || !conf.type || conf.type === 'text') return null; // null → leave existing HTML
  if (conf.type === 'select') {
    if (!v.trim()) return '';
    const h = tplPillColor(v);
    return `<span class="md-cell-pill" style="--pill-h:${h}deg">${escapeHtml(v)}</span>`;
  }
  if (conf.type === 'tags') {
    const tags = v.split(/[,;]/).map(t => t.trim()).filter(Boolean);
    if (!tags.length) return '';
    return tags.map(t => {
      const h = tplPillColor(t);
      return `<span class="md-cell-tag" style="--pill-h:${h}deg">${escapeHtml(t)}</span>`;
    }).join(' ');
  }
  if (conf.type === 'number') {
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n)) return `<span class="md-cell-num md-cell-invalid" title="${t('cell.invalidNumber')}">${escapeHtml(v)}</span>`;
    // Preserve user-formatted decimals; just align right via the class.
    return `<span class="md-cell-num">${escapeHtml(v)}</span>`;
  }
  if (conf.type === 'date') {
    const d = new Date(v);
    if (isNaN(d.getTime())) return `<span class="md-cell-date md-cell-invalid" title="${escapeHtml(t('cell.dateUnknown.tip'))}">${escapeHtml(v)}</span>`;
    const iso = d.toISOString().slice(0, 10);
    const human = d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
    return `<span class="md-cell-date" title="${escapeHtml(iso)}">${escapeHtml(human)}</span>`;
  }
  if (conf.type === 'checkbox') {
    const truthy = /^(x|✓|✔|true|1|sí|si|yes)$/i.test(v.trim());
    return `<span class="md-cell-check">${truthy ? '☑' : '☐'}</span>`;
  }
  if (conf.type === 'multiselect') {
    const vals = splitMulti(v);
    if (!vals.length) return '';
    return vals.map(x => {
      const h = tplPillColor(x);
      return `<span class="md-cell-pill" style="--pill-h:${h}deg">${escapeHtml(x)}</span>`;
    }).join(' ');
  }
  if (conf.type === 'status') {
    if (!v.trim()) return '';
    const h = tplPillColor(v);
    return `<span class="md-cell-status" style="--pill-h:${h}deg"><span class="md-cell-status-dot"></span>${escapeHtml(v)}</span>`;
  }
  if (conf.type === 'rating') {
    const n = parseRating(v);
    if (!n) return '';
    let s = '';
    for (let i = 1; i <= RATING_MAX; i++) s += i <= n ? '★' : '☆';
    return `<span class="md-cell-rating" title="${n}/${RATING_MAX}">${s}</span>`;
  }
  if (conf.type === 'progress') {
    const n = parseProgress(v);
    if (n == null) return '';
    return `<span class="md-cell-prog" title="${n}%"><span class="md-cell-prog-track"><span class="md-cell-prog-bar" style="width:${n}%"></span></span><span class="md-cell-prog-num">${n}%</span></span>`;
  }
  if (conf.type === 'person') {
    const people = splitMulti(v);
    if (!people.length) return '';
    return people.map(p => {
      const name = personName(p);
      const h = tplPillColor(p);
      const initial = escapeHtml((name[0] || '?').toUpperCase());
      return `<span class="md-cell-person" style="--pill-h:${h}deg" title="${escapeHtml(p)}"><span class="md-cell-person-av">${initial}</span>${escapeHtml(name)}</span>`;
    }).join(' ');
  }
  if (conf.type === 'wikilink') {
    if (!v.trim()) return '';
    // Optional alias syntax in the cell value: "Target|Alias".
    const pipe = v.indexOf('|');
    const target = (pipe >= 0 ? v.slice(0, pipe) : v).trim();
    const label = (pipe >= 0 ? v.slice(pipe + 1) : v).trim() || target;
    if (!target) return escapeHtml(v);
    // data-wikiname carries the raw name; the render-pane click handler
    // resolves it to a note id at click time (formatTypedCell is pure and
    // has no resolver). Reuses the .wikilink visual language.
    return `<a class="wikilink md-cell-wikilink" data-wikiname="${escapeHtml(target)}" href="#">🔗 ${escapeHtml(label)}</a>`;
  }
  if (conf.type === 'archivo') {
    if (!v.trim()) return '';
    const parsed = parseArchivoCell(v);
    if (!parsed.src) return escapeHtml(v);
    const sha = /^edinot:\/\/blob\/([a-f0-9]{64})/i.exec(parsed.src);
    const shaAttr = sha ? ` data-attach-sha="${sha[1]}"` : '';
    const name = parsed.name || (sha ? 'archivo' : parsed.src);
    const safeName = escapeHtml(name);
    const safeSrc = escapeHtml(parsed.src);
    if (parsed.isImage) {
      return `<img class="md-cell-thumb md-cell-file" data-col-file="1"${shaAttr} data-attach-name="${safeName}" data-attach-src="${safeSrc}" alt="${safeName}" src="${safeSrc}" loading="lazy" />`;
    }
    const kindRaw = attachmentKind(name);
    const kind = typeof kindRaw === 'string' ? kindRaw : kindRaw.kind;
    const icon = kind === 'pdf' ? '📕' : kind === 'video' ? '🎬' : kind === 'audio' ? '🎵'
               : kind === 'docx' ? '📄' : kind === 'xlsx' ? '📊' : kind === 'code' ? '📝' : '📎';
    return `<span class="md-cell-attach md-cell-file" data-col-file="1"${shaAttr} data-attach-name="${safeName}" data-attach-src="${safeSrc}" title="${safeName}">${icon} ${safeName}</span>`;
  }
  return null;
}

// Parse an "archivo" column cell into { src, name, isImage }. Accepts a
// markdown image/link form (`![name](src)` / `[name](src)`) or a bare URL /
// edinot://blob ref. Image detection is by extension or mime-ish hints.
function parseArchivoCell(v) {
  const s = String(v == null ? '' : v).trim();
  let name = '', src = '', isImg = false;
  let m = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(s);
  if (m) { name = m[1].trim(); src = m[2].trim(); isImg = true; }
  else {
    m = /^\[([^\]]*)\]\(([^)]+)\)/.exec(s);
    if (m) { name = m[1].trim(); src = m[2].trim(); }
    else { src = s; }
  }
  if (!isImg) {
    isImg = /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|#|$)/i.test(name || src)
         || /^data:image\//i.test(src);
  }
  return { src, name, isImage: isImg };
}

// Make a rendered table inside `root` fully interactive (sort, filter, column
// type, add/del/edit row, add col, cell edit, view switch, column resize) —
// the SAME behaviour as the Render pane, reusable so the live-preview editor's
// table widgets behave identically. `ctx` supplies source get/set and the
// shared modal openers (which already persist via the app's mutate path). The
// Render pane keeps its own inline handlers; this is a parallel, isolated path.
// Static HTML for a database table (exports): visible rows after the
// directive's filter/sort, hidden columns dropped, typed cells formatted.
function staticTableHtml(meta, renderInline) {
  const d = meta.directive || {};
  const hidden = new Set(d.hidden || []);
  const cols = d.cols || {};
  const idxs = meta.headers.map((_, i) => i).filter(i => !hidden.has(meta.headers[i]));
  const rows = applyTableSortFilter(meta.headers, meta.rows, d.sort, d.filter, cols);
  const cell = (raw, conf) => {
    const typed = formatTypedCell(raw, conf);
    if (typed != null) return typed;
    try { return renderInline(String(raw || '')); } catch { return escapeHtml(String(raw || '')); }
  };
  return `<table class="md-table"><thead><tr>${idxs.map(i => `<th>${escapeHtml(meta.headers[i] || '')}</th>`).join('')}</tr></thead><tbody>${
    rows.map(r => `<tr>${idxs.map(i => `<td>${cell(r[i], cols[meta.headers[i]])}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
}

// Source transforms handed to the database block (editor/db/*). The block
// never imports editor.jsx; it gets these instead.
export const DB_OPS = {
  parseSourceTables, patchTableDirective, setTableCellInSource, updateTableRow, appendTableRow,
  removeTableRow, moveTableRow, duplicateTableRow, appendTableColumn, removeTableColumn,
  renameTableColumn, moveTableColumn, setTableColumnTypeInSource, setTableAggInSource,
};

// Tabla en «Editar»: se monta como bloque de base de datos (editor/db), que
// conserva su estado entre reconstrucciones del widget.
function wireInteractiveTables(root, ctx) {
  let tabs = [];
  try { tabs = ctx.tables(); } catch {}
  // Índice exacto en parseSourceTables (por la línea de cabecera).
  let idx0 = ctx.tableIdx != null ? ctx.tableIdx : 0;
  if (ctx.tableLine != null) { const i = tabs.findIndex(tt => tt.startLine === ctx.tableLine); if (i >= 0) idx0 = i; }
  const meta = tabs[idx0];
  if (!meta || !ctx.dbCtxRef || !ctx.dbCache) return;
  root.innerHTML = '';
  root.classList.add('db-live');
  const noteKey = (ctx.dbCtxRef.current && ctx.dbCtxRef.current.noteId) || '';
  mountDbBlock(ctx.dbCache, `live:${noteKey}:${idx0}`, root, { meta, idx: idx0, ctxRef: ctx.dbCtxRef, ops: DB_OPS, surface: 'live' });
  sweepDbBlocks(ctx.dbCache, null, 'live:');
}


export function createMdRenderer({ resolveWikilink, getNoteContent }) {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: false,
  });
  // enabled: true → checkboxes are not `disabled`, so clicks bubble up to
  // the React onClick handler on .md-render which toggles the source markdown.
  md.use(mdTaskLists, { enabled: true, label: false });
  // Identificadores de bloque ` ^id` al final de un párrafo/elemento
  // (destino de [[Nota#^id]]): se quitan del texto y van como atributo.
  md.core.ruler.push('edinot_block_ids', (state) => {
    const toks = state.tokens;
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i];
      if (t.type !== 'inline' || !t.children || !t.children.length) continue;
      const last = t.children[t.children.length - 1];
      if (last.type !== 'text') continue;
      const m = BLOCK_ID_RE.exec(last.content);
      if (!m) continue;
      last.content = last.content.slice(0, m.index);
      toks[i - 1].attrSet('data-block-id', m[1]);
    }
  });
  // Fórmulas ($…$, $$…$$) y notas al pie ([^1] + [^1]: texto).
  md.use(mdMath);
  md.use(mdFootnote);
  md.renderer.rules.footnote_block_open = () => '<section class="md-footnotes"><ol class="md-footnotes-list">\n';
  md.renderer.rules.footnote_block_close = () => '</ol></section>\n';
  md.renderer.rules.footnote_caption = (tokens, idx) => {
    const n = Number(tokens[idx].meta.id + 1).toString();
    return tokens[idx].meta.subId > 0 ? `${n}:${tokens[idx].meta.subId}` : n;
  };

  const addClass = (token, cls) => {
    const existing = token.attrGet('class');
    token.attrSet('class', existing ? `${existing} ${cls}` : cls);
  };

  md.renderer.rules.heading_open = (tokens, idx, opts, env, self) => {
    const lv = tokens[idx].tag.slice(1);
    addClass(tokens[idx], `md-h md-h${lv}`);
    // Inject a stable slug id per render so the in-app TOC can scroll
    // to the heading without React losing the attribute on rerender.
    if (!tokens[idx].attrGet('id')) {
      const inline = tokens[idx + 1];
      const text = inline && inline.children
        ? inline.children.filter(c => c.type === 'text').map(c => c.content).join('')
        : '';
      const base = String(text).toLowerCase().normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s-]/g, '').trim()
        .replace(/\s+/g, '-').slice(0, 80) || 'sec';
      env.__slugs = env.__slugs || new Map();
      const n = (env.__slugs.get(base) || 0) + 1;
      env.__slugs.set(base, n);
      const id = 'toc-' + (n === 1 ? base : `${base}-${n}`);
      tokens[idx].attrSet('id', id);
    }
    return self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.paragraph_open = (tokens, idx, opts, env, self) => {
    addClass(tokens[idx], 'md-p');
    return self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.bullet_list_open = (tokens, idx, opts, env, self) => {
    addClass(tokens[idx], 'md-ul');
    return self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.ordered_list_open = (tokens, idx, opts, env, self) => {
    addClass(tokens[idx], 'md-ol');
    return self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.blockquote_open = (tokens, idx, opts, env, self) => {
    addClass(tokens[idx], 'md-quote');
    return self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.hr = (tokens, idx, opts, env, self) => {
    addClass(tokens[idx], 'md-hr');
    return self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.table_open = (tokens, idx, opts, env, self) => {
    addClass(tokens[idx], 'md-table');
    return self.renderToken(tokens, idx, opts);
  };

  md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    const lang = t.info ? t.info.trim() : '';
    const code = t.content.replace(/\n$/, '');
    const hl = highlightCode(code, lang);
    const line = t.map ? ` data-src-line="${t.map[0]}"` : '';
    return `<div class="md-codewrap"${line}>`
      + `<div class="md-code-bar">${langSelectHtml(lang, escapeHtml)}<button type="button" class="md-code-copy" data-code-copy="1" title="Copiar">Copiar</button></div>`
      + `<pre class="md-pre"><code class="lang-${escapeHtml(lang)}${hl ? ' hljs' : ''}">${hl != null ? hl : escapeHtml(code)}</code></pre>`
      + `</div>`;
  };
  md.renderer.rules.code_block = (tokens, idx) => {
    return `<div class="md-codewrap">`
      + `<div class="md-code-bar"><button type="button" class="md-code-copy" data-code-copy="1" title="Copiar">Copiar</button></div>`
      + `<pre class="md-pre"><code>${escapeHtml(tokens[idx].content.replace(/\n$/, ''))}</code></pre>`
      + `</div>`;
  };

  md.renderer.rules.image = (tokens, idx) => {
    const tok = tokens[idx];
    const src = tok.attrGet('src') || '';
    const rawAlt = tok.content || '';
    // Obsidian-style size hint in the alt: ![name|320](src) or
    // ![name|320x200](src). Stripped before filename/kind detection and turned
    // into an inline px width so the size persists in the markdown itself —
    // surviving sync and share without any out-of-band metadata.
    let alt = rawAlt;
    let imgStyle = '';
    const sizeM = rawAlt.match(/\|\s*(\d{1,5})(?:x\d{1,5})?\s*$/);
    if (sizeM) {
      alt = rawAlt.slice(0, sizeM.index).replace(/\s+$/, '');
      imgStyle = ` style="width:${parseInt(sizeM[1], 10)}px;max-width:100%"`;
    }
    const safeAlt = escapeHtml(alt);
    const safeSrc = src.trim().replace(/"/g, '%22');

    // `edinot://blob/<sha>` references — dispatch by filename extension (held
    // in the alt text). Inline-friendly elements only (no block-level <div>
    // inside <p>) — phrasing content like <video>/<audio>/<iframe>/<span>
    // (with display:block via CSS) is fine.
    if (EDINOT_BLOB_RX.test(src)) {
      const kindRaw = attachmentKind(alt);
      const kind = typeof kindRaw === 'string' ? kindRaw : kindRaw.kind;
      const lang = (typeof kindRaw === 'object' && kindRaw.lang) || '';
      const shaMatch = src.match(/edinot:\/\/blob\/([a-f0-9]{64})/i);
      const sha = shaMatch ? shaMatch[1].toLowerCase() : '';
      const actions =
        `<span class="md-attach-actions" data-attach-sha="${sha}" data-attach-name="${safeAlt}">`
        + `<button type="button" class="md-attach-act" data-attach-action="open" title="${escapeHtml(t('attach.open.tip'))}">${escapeHtml(t('attach.open'))}</button>`
        + `<button type="button" class="md-attach-act" data-attach-action="download" title="${escapeHtml(t('attach.download.tip'))}">${escapeHtml(t('attach.download'))}</button>`
        + `</span>`;
      if (kind === 'image') {
        return `<span class="md-attach-wrap">`
          + `<img class="md-img-real" loading="lazy" alt="${safeAlt}" src="${safeSrc}"${imgStyle} />`
          + actions
          + `</span>`;
      }
      if (kind === 'video') {
        return `<span class="md-attach-wrap">`
          + `<video class="md-attach-video" controls preload="metadata" src="${safeSrc}"></video>`
          + actions
          + `</span>`;
      }
      if (kind === 'audio') {
        return `<span class="md-attach-wrap md-attach-wrap-inline">`
          + `<audio class="md-attach-audio" controls preload="metadata" src="${safeSrc}"></audio>`
          + actions
          + `</span>`;
      }
      if (kind === 'pdf') {
        return `<span class="md-attach-wrap">`
          + `<iframe class="md-attach-pdf" src="${safeSrc}" loading="lazy" referrerpolicy="no-referrer"></iframe>`
          + actions
          + `</span>`;
      }
      // Office + code previews — emit a hydration placeholder; the renderer
      // `useLayoutEffect` walks these and replaces innerHTML with the actual
      // converted output via IPC (office) or a streaming fetch (code).
      if (kind === 'docx' || kind === 'xlsx') {
        return `<span class="md-attach-office md-attach-loading" data-attach-kind="${kind}" data-attach-sha="${sha}" data-attach-name="${safeAlt}">${escapeHtml(t('attach.office.loading', { name: safeAlt }))}</span>`;
      }
      if (kind === 'code') {
        return `<span class="md-attach-code md-attach-loading" data-attach-kind="code" data-attach-sha="${sha}" data-attach-name="${safeAlt}" data-attach-lang="${escapeHtml(lang)}">${escapeHtml(t('attach.code.loading', { name: safeAlt }))}</span>`;
      }
      // Generic file card — phrasing-content <span> so it can live inside <p>.
      return `<span class="md-attach-card">`
        + `<span class="md-attach-icon">📎</span>`
        + `<span class="md-attach-body">`
        +   `<span class="md-attach-name">${safeAlt || escapeHtml(t('cell.attach.fileFallback'))}</span>`
        +   `<span class="md-attach-hint">${escapeHtml(t('attach.card.hint'))}</span>`
        + `</span>`
        + actions
        + `</span>`;
    }

    if (isSafeImageSrc(src)) {
      return `<img class="md-img-real" loading="lazy" alt="${safeAlt}" src="${safeSrc}"${imgStyle} />`;
    }
    return `<span class="md-img"><span class="md-img-label">🖼 ${escapeHtml(alt) || 'image'}</span><span class="md-img-src">${escapeHtml(src)}</span></span>`;
  };

  const defaultLinkOpen = md.renderer.rules.link_open
    || ((tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts));
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const href = tokens[idx].attrGet('href') || '';
    if (EDINOT_BLOB_RX.test(href)) {
      // Inline chip variant of an attachment — clicks trigger download via the
      // Electron protocol handler (HTTP `Content-Disposition: attachment`).
      tokens[idx].attrSet('class', 'md-attach-chip');
      tokens[idx].attrSet('download', '');
    } else {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
    }
    return defaultLinkOpen(tokens, idx, opts, env, self);
  };

  // Wikilinks: [[name]] or [[name|alias]]
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const src = state.src;
    if (src.charCodeAt(state.pos) !== 0x5B || src.charCodeAt(state.pos + 1) !== 0x5B) return false;
    const end = src.indexOf(']]', state.pos + 2);
    if (end === -1) return false;
    const inside = src.slice(state.pos + 2, end);
    if (!inside || inside.includes('\n') || inside.includes('[[')) return false;
    if (silent) return true;
    const pipe = inside.indexOf('|');
    const name = (pipe >= 0 ? inside.slice(0, pipe) : inside).trim();
    const { note, anchor } = splitWikiTarget(name);
    const label = (pipe >= 0 ? inside.slice(pipe + 1) : (anchor ? (note ? `${note} › ${anchor.replace(/^\^/, '')}` : anchor.replace(/^\^/, '')) : name)).trim();
    // [[#Título]] → la nota actual (fileId vacío, solo ancla).
    const fileId = note ? resolveWikilink(note) : (anchor ? '' : null);
    const token = state.push('wikilink', '', 0);
    token.meta = { name, label, fileId, anchor };
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.wikilink = (tokens, idx) => {
    const { name, label, fileId, anchor } = tokens[idx].meta;
    const anc = anchor ? ` data-anchor="${escapeHtml(anchor)}"` : '';
    if (fileId || (fileId === '' && anchor)) {
      return `<a class="wikilink" data-wikilink="${escapeHtml(fileId)}"${anc} href="#">${escapeHtml(label)}</a>`;
    }
    return `<span class="wikilink wikilink-broken" title="No existe: ${escapeHtml(name)}">${escapeHtml(label)}</span>`;
  };

  // Transclusión: una línea que es solo ![[Nota]] / ![[Nota#Título]] /
  // ![[Nota#^id]] → el contenido de esa nota (o sección) en solo lectura.
  md.block.ruler.before('paragraph', 'transclude', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const line = state.src.slice(start, state.eMarks[startLine]).trim();
    const m = /^!\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+))?\]\]$/.exec(line);
    if (!m) return false;
    if (silent) return true;
    const { note, anchor } = splitWikiTarget(m[1]);
    const tok = state.push('transclude', 'div', 0);
    tok.block = true;
    tok.map = [startLine, startLine + 1];
    tok.meta = { note, anchor, label: (m[2] || '').trim() };
    state.line = startLine + 1;
    return true;
  });
  md.renderer.rules.transclude = (tokens, idx, _opts, env) => {
    const { note, anchor, label } = tokens[idx].meta;
    const fileId = note ? resolveWikilink(note) : null;
    const title = label || (anchor ? `${note || ''} › ${anchor.replace(/^\^/, '')}`.replace(/^ › /, '') : note);
    const anc = anchor ? ` data-anchor="${escapeHtml(anchor)}"` : '';
    const head = fileId
      ? `<a class="wikilink" data-wikilink="${escapeHtml(fileId)}" data-wikiname="${escapeHtml(note + (anchor ? '#' + anchor : ''))}"${anc} href="#">${escapeHtml(title)}</a>`
      : `<span class="wikilink wikilink-broken">${escapeHtml(title)}</span>`;
    let body = '';
    const depth = (env && env.__tdepth) || 0;
    if (!fileId || !getNoteContent) body = '';
    else if (depth >= 2 || (env && env.__tstack && env.__tstack.includes(fileId))) body = '<p class="md-transclude-loop">…</p>';
    else {
      let src = null;
      try { src = getNoteContent(fileId); } catch {}
      const part = src == null ? null : anchorText(src, anchor);
      if (part == null) body = `<p class="md-transclude-missing">${escapeHtml(anchor ? 'No se encuentra esa sección' : 'Nota vacía')}</p>`;
      else {
        const sub = { __tdepth: depth + 1, __tstack: [...((env && env.__tstack) || []), fileId] };
        try { body = md.render(stripViewDirectives(part.replace(/^<!--\s*edinot:props[\s\S]*?-->\s*/, '')), sub); } catch { body = ''; }
      }
    }
    return `<div class="md-transclude"><div class="md-transclude-head">${head}</div><div class="md-transclude-body">${body}</div></div>\n`;
  };

  // YouTube: line that is only a YT URL → iframe block
  md.block.ruler.before('paragraph', 'youtube', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(start, max).trim();
    if (!/^https?:\/\//.test(line)) return false;
    const id = youtubeId(line);
    if (!id) return false;
    if (silent) return true;
    const token = state.push('youtube', '', 0);
    token.meta = { id };
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  });
  md.renderer.rules.youtube = (tokens, idx) => {
    const id = tokens[idx].meta.id;
    return `<div class="md-video"><iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(id)}?rel=0&playsinline=1" title="YouTube video" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`;
  };

  // Otros servicios (Vimeo, Loom, Figma, Miro, Google Docs/Drive, Spotify,
  // CodePen, Excalidraw): URL sola en su línea → iframe.
  md.block.ruler.before('paragraph', 'edinot_embed', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const line = state.src.slice(start, state.eMarks[startLine]).trim();
    if (!/^https?:\/\/\S+$/.test(line)) return false;
    const e = embedFor(line);
    if (!e) return false;
    if (silent) return true;
    const token = state.push('edinot_embed', '', 0);
    token.meta = { e, href: line };
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  });
  md.renderer.rules.edinot_embed = (tokens, idx) => embedHtml(tokens[idx].meta.e, tokens[idx].meta.href, escapeHtml);

  // Avisos (> [!tipo]) y desplegables (<details>) del editor de bloques.
  md.use(blocksMarkdownIt);

  return md;
}

// ─────────────────────────────────────────────────────────────
// Selection-based formatting on a CodeMirror EditorView. Mirrors the old
// textarea applyAction behaviour but issues CM transactions, so it is safe
// to use while a yCollab binding owns the document.
// ─────────────────────────────────────────────────────────────
function applyActionCM(view, action, opts) {
  if (!view) return;
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const selText = sel.empty ? '' : doc.sliceString(sel.from, sel.to);

  const wrap = (left, right = left, placeholder = '') => {
    const inner = selText || placeholder;
    const replacement = `${left}${inner}${right}`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: replacement },
      selection: { anchor: sel.from + left.length, head: sel.from + left.length + inner.length },
    });
  };

  const transformLines = (fn) => {
    const lineFrom = doc.lineAt(sel.from);
    const lineTo = doc.lineAt(sel.to);
    const out = [];
    for (let n = lineFrom.number; n <= lineTo.number; n++) {
      out.push(fn(doc.line(n).text, n - lineFrom.number));
    }
    const insert = out.join('\n');
    view.dispatch({
      changes: { from: lineFrom.from, to: lineTo.to, insert },
      selection: { anchor: lineFrom.from, head: lineFrom.from + insert.length },
    });
  };

  switch (action) {
    case 'bold':      wrap('**', '**', 'texto en negrita'); break;
    case 'italic':    wrap('*', '*', 'texto en cursiva'); break;
    case 'underline': wrap('<u>', '</u>', 'subrayado'); break;
    case 'strike':    wrap('~~', '~~', 'tachado'); break;
    case 'code':      wrap('`', '`', 'código'); break;
    case 'codeblock': wrap('\n```\n', '\n```\n', 'código'); break;
    case 'canvasEmbed': {
      const noteId = (opts && opts.noteId) ? String(opts.noteId) : '';
      if (!noteId) break;
      const line = doc.lineAt(sel.from);
      const before = line.text.length === 0 ? '' : '\n\n';
      const block = '```edinot-canvas-embed\n' + noteId + '\n```\n';
      const insert = before + block;
      const insertAt = line.text.length === 0 ? line.from : line.to;
      view.dispatch({
        changes: { from: insertAt, to: insertAt, insert },
        selection: { anchor: insertAt + insert.length },
      });
      break;
    }
    case 'quote':     transformLines(l => '> ' + l); break;
    case 'ul':        transformLines(l => '- ' + l); break;
    case 'ol':        transformLines((l, i) => `${i + 1}. ${l}`); break;
    case 'checklist': transformLines(l => '- [ ] ' + l); break;
    case 'h1':        transformLines(l => '# ' + l.replace(/^#+\s*/, '')); break;
    case 'h2':        transformLines(l => '## ' + l.replace(/^#+\s*/, '')); break;
    case 'h3':        transformLines(l => '### ' + l.replace(/^#+\s*/, '')); break;
    case 'body':      transformLines(l => l.replace(/^#+\s*/, '')); break;
    case 'link': {
      const text = selText || 'enlace';
      const replacement = `[${text}](https://)`;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: replacement },
        selection: { anchor: sel.from + 1, head: sel.from + 1 + text.length },
      });
      break;
    }
    case 'emoji': {
      // arg ignored — emoji insertion uses insertAtCursorCM directly.
      // Kept here for future format-bar wiring.
      break;
    }
    case 'table': {
      const cols = Math.max(1, Math.min(10, (opts && opts.cols) | 0 || 3));
      const rows = Math.max(1, Math.min(20, (opts && opts.rows) | 0 || 3));
      const line = doc.lineAt(sel.from);
      const before = line.text.length === 0 ? '' : '\n\n';
      const after = '\n';
      const headerCells = Array.from({ length: cols }, (_, i) => ` Col ${i + 1} `);
      const sepCells = Array.from({ length: cols }, () => '-------');
      const bodyCells = Array.from({ length: cols }, () => '       ');
      const headerRow = '|' + headerCells.join('|') + '|';
      const sepRow = '|' + sepCells.join('|') + '|';
      const bodyRow = '|' + bodyCells.join('|') + '|';
      const bodyRows = Array.from({ length: rows }, () => bodyRow);
      const table = [headerRow, sepRow, ...bodyRows].join('\n');
      const insert = `${before}${table}${after}`;
      const insertAt = line.text.length === 0 ? line.from : line.to;
      view.dispatch({
        changes: { from: insertAt, to: insertAt, insert },
        // place caret in first body cell (after "| ")
        selection: { anchor: insertAt + before.length + table.indexOf(bodyRow) + 2 },
      });
      break;
    }
    default: return;
  }
  view.focus();
}

// ─── Markdown table editing keys (Tab/Shift-Tab/Enter inside | … | rows) ─
function isTableLine(text) {
  return /^\s*\|.*\|\s*$/.test(text);
}
function isSeparatorRow(text) {
  return /^\s*\|[\s|:\-]+\|\s*$/.test(text);
}
function lineInTable(state) {
  const line = state.doc.lineAt(state.selection.main.head);
  return isTableLine(line.text);
}

function moveToCellStart(view, line, pipeIdx) {
  let pos = line.from + pipeIdx + 1;
  if (line.text[pipeIdx + 1] === ' ') pos++;
  view.dispatch({ selection: { anchor: pos } });
}

function tableTab(view) {
  if (!lineInTable(view.state)) return false;
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const text = line.text;
  const idx = sel.head - line.from;
  const nextPipe = text.indexOf('|', idx);
  // After last '|' of row → jump to next non-separator row's first cell
  if (nextPipe === -1 || nextPipe === text.lastIndexOf('|')) {
    if (line.number >= view.state.doc.lines) return false;
    let target = view.state.doc.line(line.number + 1);
    if (!isTableLine(target.text)) return false;
    if (isSeparatorRow(target.text)) {
      if (target.number >= view.state.doc.lines) return false;
      target = view.state.doc.line(target.number + 1);
      if (!isTableLine(target.text)) return false;
    }
    const firstPipe = target.text.indexOf('|');
    moveToCellStart(view, target, firstPipe);
    return true;
  }
  moveToCellStart(view, line, nextPipe);
  return true;
}

function tableShiftTab(view) {
  if (!lineInTable(view.state)) return false;
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const text = line.text;
  const idx = sel.head - line.from;
  // find previous pipe before cursor
  const before = text.lastIndexOf('|', Math.max(0, idx - 2));
  if (before <= 0) {
    if (line.number <= 1) return false;
    let target = view.state.doc.line(line.number - 1);
    if (!isTableLine(target.text)) return false;
    if (isSeparatorRow(target.text)) {
      if (target.number <= 1) return false;
      target = view.state.doc.line(target.number - 1);
      if (!isTableLine(target.text)) return false;
    }
    const lastPipe = target.text.lastIndexOf('|');
    const prevPipe = target.text.lastIndexOf('|', lastPipe - 1);
    moveToCellStart(view, target, prevPipe);
    return true;
  }
  const prevPipe = text.lastIndexOf('|', before - 1);
  if (prevPipe < 0) return false;
  moveToCellStart(view, line, prevPipe);
  return true;
}

function tableEnter(view) {
  if (!lineInTable(view.state)) return false;
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  if (sel.head !== line.to) return false; // only fire when caret at end of row
  const cellCount = (line.text.match(/\|/g) || []).length - 1;
  if (cellCount < 1) return false;
  const newRow = '\n|' + Array(cellCount).fill('       ').join('|') + '|';
  view.dispatch({
    changes: { from: line.to, to: line.to, insert: newRow },
    selection: { anchor: line.to + 2 },
  });
  return true;
}

function insertAtCursorCM(view, insert) {
  if (!view) return;
  const sel = view.state.selection.main;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + insert.length, head: sel.from + insert.length },
  });
  view.focus();
}

// Custom search panel — replaces CodeMirror's default ugly built-in.
// Returns a Panel object {dom, top, mount, update}. The panel mounts inside
// .cm-panels-top; CSS pulls it out as a centered floating card.
function buildSearchPanel(view) {
  const dom = document.createElement('div');
  dom.className = 'edinot-search';
  dom.innerHTML = `
    <div class="es-row es-row-find">
      <span class="es-icon">
        <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M10 10l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </span>
      <input type="text" class="es-find" main-field="true" placeholder="${t('search.placeholderNote')}" aria-label="${t('search.placeholderNote')}" spellcheck="false" />
      <span class="es-count" aria-live="polite"></span>
      <div class="es-nav">
        <button type="button" class="es-icon-btn es-prev" title="${t('search.prevHint')}" aria-label="${t('search.prev')}">
          <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        </button>
        <button type="button" class="es-icon-btn es-next" title="${t('search.nextHint')}" aria-label="${t('search.next')}">
          <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        </button>
      </div>
      <div class="es-divider"></div>
      <button type="button" class="es-toggle es-opt-btn" data-opt="case" title="${t('search.case')}"><span>Aa</span></button>
      <button type="button" class="es-toggle es-opt-btn" data-opt="word" title="${t('search.word')}"><span>W</span></button>
      <button type="button" class="es-toggle es-opt-btn" data-opt="regex" title="${t('search.regex')}"><span>.*</span></button>
      <button type="button" class="es-toggle es-replace-toggle" title="${t('search.replace')}"><span>⇋</span></button>
      <button type="button" class="es-icon-btn es-close" title="${t('search.closeHint')}" aria-label="${t('btn.close')}">
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="es-row es-row-replace" hidden>
      <span class="es-icon"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 4h7l-2-2M3 4l2 2M13 12H6l2 2M13 12l-2-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>
      <input type="text" class="es-replace" placeholder="${t('search.replacePlaceholder')}" spellcheck="false" />
      <button type="button" class="es-text-btn es-replace-one">${t('search.replace')}</button>
      <button type="button" class="es-text-btn es-replace-all">${t('search.replaceAll')}</button>
    </div>
  `;

  const findInput = dom.querySelector('.es-find');
  const replaceRow = dom.querySelector('.es-row-replace');
  const replaceInput = dom.querySelector('.es-replace');
  const replaceToggle = dom.querySelector('.es-replace-toggle');
  const countEl = dom.querySelector('.es-count');
  const optBtns = dom.querySelectorAll('.es-opt-btn');
  const opts = { case: false, word: false, regex: false };

  const buildQuery = () => new SearchQuery({
    search: findInput.value,
    caseSensitive: opts.case,
    regexp: opts.regex,
    wholeWord: opts.word,
    replace: replaceInput.value,
  });

  const dispatchQuery = () => {
    view.dispatch({ effects: setSearchQuery.of(buildQuery()) });
  };

  // The «n/total» counter walks every match in the document: on a big note
  // with a short query that's tens of thousands of matches per keystroke.
  // It's debounced (~100 ms after the last change) and stops at
  // FIND_COUNT_CAP, showing «999+» beyond it.
  const FIND_COUNT_CAP = 999;
  let countTimer = null;
  const updateCount = () => {
    if (countTimer) { clearTimeout(countTimer); countTimer = null; }
    const q = buildQuery();
    if (!q.search) { countEl.textContent = ''; countEl.classList.remove('zero'); return; }
    let total = 0, current = 0;
    try {
      const cursor = q.getCursor(view.state.doc);
      const sel = view.state.selection.main;
      let n = cursor.next();
      while (!n.done) {
        total++;
        if (n.value.from === sel.from && n.value.to === sel.to) current = total;
        if (total > FIND_COUNT_CAP) break;
        n = cursor.next();
      }
    } catch { /* invalid regex etc */ }
    if (total === 0) { countEl.textContent = '0'; countEl.classList.add('zero'); }
    else {
      // «3 de 12» (o «12 resultados» si la selección no está en una).
      countEl.textContent = countLabel(t, current, total, FIND_COUNT_CAP);
      countEl.classList.remove('zero');
    }
  };
  const scheduleCount = () => {
    if (countTimer) clearTimeout(countTimer);
    countTimer = setTimeout(updateCount, 100);
  };

  const refresh = () => { dispatchQuery(); scheduleCount(); };
  // Al escribir, a la primera coincidencia desde donde estaba el cursor al
  // abrir (como el buscador de un navegador). No cambia el texto.
  let startPos = view.state.selection.main.from;
  const jumpToFirst = () => {
    const q = buildQuery();
    if (!q.search || !q.valid) return;
    try {
      let n = q.getCursor(view.state.doc, startPos).next();
      if (n.done) n = q.getCursor(view.state.doc).next();
      if (!n.done) view.dispatch({ selection: { anchor: n.value.from, head: n.value.to }, scrollIntoView: true, userEvent: 'select.search' });
    } catch { /* regex inválida */ }
  };

  findInput.addEventListener('input', () => { dispatchQuery(); jumpToFirst(); scheduleCount(); });
  replaceInput.addEventListener('input', () => dispatchQuery());

  // Stop Esc from bubbling to the global keydown handler (which would flip
  // markdown→render). Refocus the editor so the cursor stays on the match.
  const handleEsc = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSearchPanel(view);
    requestAnimationFrame(() => view.focus());
  };

  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) findPrevious(view); else findNext(view);
      requestAnimationFrame(updateCount);
    } else if (e.key === 'Escape') {
      handleEsc(e);
    }
  });
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      replaceNext(view);
      requestAnimationFrame(updateCount);
    } else if (e.key === 'Escape') {
      handleEsc(e);
    }
  });
  // Also catch Esc anywhere inside the panel (button focus, etc.).
  dom.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (e.target === e.currentTarget || !findInput.contains(e.target) && !replaceInput.contains(e.target))) {
      handleEsc(e);
    }
  });

  optBtns.forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.opt;
    opts[k] = !opts[k];
    b.classList.toggle('on', opts[k]);
    refresh();
    findInput.focus();
  }));
  replaceToggle.addEventListener('click', () => {
    const isHidden = replaceRow.hasAttribute('hidden');
    if (isHidden) { replaceRow.removeAttribute('hidden'); replaceToggle.classList.add('on'); replaceInput.focus(); }
    else { replaceRow.setAttribute('hidden', ''); replaceToggle.classList.remove('on'); findInput.focus(); }
  });
  dom.querySelector('.es-prev').addEventListener('click', () => { findPrevious(view); requestAnimationFrame(updateCount); });
  dom.querySelector('.es-next').addEventListener('click', () => { findNext(view); requestAnimationFrame(updateCount); });
  dom.querySelector('.es-close').addEventListener('click', () => closeSearchPanel(view));
  dom.querySelector('.es-replace-one').addEventListener('click', () => { replaceNext(view); requestAnimationFrame(updateCount); });
  dom.querySelector('.es-replace-all').addEventListener('click', () => { replaceAll(view); requestAnimationFrame(updateCount); });

  return {
    dom,
    top: true,
    mount() {
      startPos = view.state.selection.main.from;
      const q = getSearchQuery(view.state);
      if (q && q.search) {
        findInput.value = q.search;
        opts.case = q.caseSensitive;
        opts.word = q.wholeWord;
        opts.regex = q.regexp;
        if (q.replace) replaceInput.value = q.replace;
        optBtns.forEach((b) => b.classList.toggle('on', opts[b.dataset.opt]));
      }
      const sel = view.state.selection.main;
      if (!findInput.value && !sel.empty) {
        findInput.value = view.state.sliceDoc(sel.from, sel.to);
        dispatchQuery();
      }
      requestAnimationFrame(() => { findInput.focus(); findInput.select(); });
      updateCount();
    },
    update(u) {
      if (u.selectionSet || u.docChanged) scheduleCount();
    },
    destroy() {
      if (countTimer) { clearTimeout(countTimer); countTimer = null; }
    },
  };
}

// CodeMirror editor component bound to a Y.Text. Lives only while the editor
// is in markdown mode; remounts on note switch via key={active.id}.
// CodeMirror completion source for `[[wikilinks]]`. Fires while the caret sits
// just after `[[` (with an optional partial name), offers matching note names,
// and on pick inserts `Name]]` — reusing any `]]` the user already typed so we
// never double the closing brackets. `getTargets` returns the live note-name
// list (read through a ref so it stays fresh without rebuilding the editor).
function headingOptions(src) {
  const out = [];
  let fence = false;
  for (const l of String(src || '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, a, __, b) => b || a).replace(/[`*_~]/g, '').trim() });
  }
  return out;
}

function wikilinkCompletionSource(getTargets, getContent) {
  return (context) => {
    // [[Nota#… / [[#… → títulos de esa nota (o de la actual).
    const hb = context.matchBefore(/\[\[([^\[\]\n|#]*)#([^\[\]\n|#]*)$/);
    if (hb) {
      const m = /\[\[([^\[\]\n|#]*)#([^\[\]\n|#]*)$/.exec(hb.text);
      const note = m[1].trim();
      const q = m[2].toLowerCase().trim();
      let src = null;
      if (!note) src = context.state.doc.toString();
      else { try { src = getContent ? getContent(note) : null; } catch {} }
      if (src == null) return null;
      const from = hb.to - m[2].length;
      const options = headingOptions(src).filter(h => !q || h.text.toLowerCase().includes(q)).slice(0, 50).map(h => ({
        label: h.text,
        detail: 'H' + h.level,
        type: 'wikilink',
        apply: (view, _c, f, t) => {
          const hasClose = view.state.sliceDoc(t, t + 2) === ']]';
          view.dispatch({ changes: { from: f, to: t, insert: h.text + (hasClose ? '' : ']]') }, selection: { anchor: f + h.text.length + 2 } });
        },
      }));
      return options.length ? { from, options, validFor: /[^\[\]\n|#]*/ } : null;
    }
    const before = context.matchBefore(/\[\[([^\[\]\n|]*)$/);
    if (!before) return null;
    const query = before.text.slice(2).toLowerCase().trim();
    let targets = [];
    try { targets = getTargets() || []; } catch {}
    if (!targets.length) return null;
    const seen = new Set();
    const options = [];
    for (const name of targets) {
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      if (query && !key.includes(query)) continue;
      seen.add(key);
      options.push({
        label: name,
        type: 'wikilink',
        apply: (view, _c, from, to) => {
          const hasClose = view.state.sliceDoc(to, to + 2) === ']]';
          const insert = name + (hasClose ? '' : ']]');
          const cursor = from + name.length + 2; // land just past the `]]`
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: cursor } });
        },
      });
      if (options.length >= 50) break;
    }
    if (!options.length) return null;
    return { from: before.from + 2, options, validFor: /[^\[\]\n|]*/ };
  };
}

// ─── Live Preview (WYSIWYG) ───────────────────────────────────────────────
// An Obsidian-style "render while you edit" layer for CodeMirror. The buffer
// stays plain markdown (so Yjs collab, undo, the format toolbar and the MCP
// tools all keep working unchanged) — we only *decorate* it: syntax markers
// (**, _, `, #, >, -, [link](url)) are hidden and the surrounding text is
// styled. Block elements that need a real renderer (images, tables, fenced
// code) are replaced with a widget rendered by the SAME markdown-it instance
// the Render pane uses, so they look identical. EXCEPT on the line(s) the
// cursor/selection touches: there the raw markdown is revealed (widgets
// collapse to source) so editing stays natural; clicking a rendered block
// drops the caret into its source.
// Marcas, marcadores ocultos y widgets en línea: editor/blocks/livePreview.js.

// Escape a pipe-table cell value back to markdown.
function lpEscCell(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim(); }

// Regenerate a GFM pipe table's markdown from the rendered <table> DOM.
function lpTableToMarkdown(tableEl) {
  const headers = [...tableEl.querySelectorAll('thead th')].map(th => lpEscCell(th.textContent));
  if (!headers.length) return null;
  const aligns = [...tableEl.querySelectorAll('thead th')].map(th => {
    const a = (th.getAttribute('style') || '') + ' ' + (th.getAttribute('align') || '');
    if (/center/.test(a)) return ':--:'; if (/right/.test(a)) return '--:'; if (/left/.test(a)) return ':--'; return '---';
  });
  const rows = [...tableEl.querySelectorAll('tbody tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td => lpEscCell(td.textContent)));
  let md = '| ' + headers.join(' | ') + ' |\n| ' + aligns.join(' | ') + ' |';
  for (const r of rows) {
    while (r.length < headers.length) r.push('');
    md += '\n| ' + r.slice(0, headers.length).join(' | ') + ' |';
  }
  return md;
}

// Renders a markdown block/inline fragment to HTML (shared md-it renderer) and
// shows it where the source was. Tables and fenced code are EDITABLE in place
// (no reveal-to-markdown): cell/code edits are written straight back to the
// document via the editor view, mirroring how the Render pane behaves.
class LpRenderWidget extends WidgetType {
  constructor(html, from, to, block, btype, ctxRef, tableIdx, srcKey) { super(); this.html = html; this.from = from; this.to = to; this.block = block; this.btype = btype || 'other'; this.ctxRef = ctxRef; this.tableIdx = tableIdx; this.srcKey = srcKey || ''; }
  // srcKey is the raw block source: for tables the rendered html is identical
  // when only the (stripped) directive changes, so without this a view switch
  // wouldn't rebuild the widget and the visible view would go stale.
  eq(o) { return o.html === this.html && o.from === this.from && o.to === this.to && o.block === this.block && o.btype === this.btype && o.tableIdx === this.tableIdx && o.srcKey === this.srcKey; }
  toDOM(view) {
    const el = document.createElement(this.block ? 'div' : 'span');
    el.className = (this.block ? 'cm-lp-block' : 'cm-lp-inline') + ' md-render cm-lp-' + this.btype;
    el.innerHTML = this.html;
    if (!this.block && el.children.length === 1 && el.firstElementChild.tagName === 'P') {
      el.innerHTML = el.firstElementChild.innerHTML;
    }
    const self = this;
    const commit = (next) => {
      // Range can drift as the doc above changes; the decoration is rebuilt on
      // every doc change so `from/to` are current for the live DOM instance.
      try { view.dispatch({ changes: { from: self.from, to: Math.min(self.to, view.state.doc.length), insert: next } }); } catch {}
    };

    if (this.btype === 'table') {
      const ctx = this.ctxRef && this.ctxRef.current;
      if (ctx) {
        // Full render-mode parity: sort/filter/type/add-del-edit row, add col,
        // cell editor, view switch, column resize — driven by the shared app
        // modals + source transforms. `tableLine` lets it resolve the exact
        // table index against parseSourceTables.
        try {
          // Read source from the LIVE CodeMirror doc, not the React ref — the
          // ref lags a render, but the widget rebuilds synchronously on doc
          // change, so a stale read would render the previous table view.
          const liveSrc = () => view.state.doc.toString();
          wireInteractiveTables(el, { ...ctx, getSource: liveSrc, tableLine: this.tableIdx, tables: () => parseSourceTables(liveSrc()) });
        } catch {}
      } else {
        // Fallback: plain in-place cell editing.
        const table = el.querySelector('table');
        if (table) {
          table.querySelectorAll('th, td').forEach(c => { c.setAttribute('contenteditable', 'plaintext-only'); c.spellcheck = false; });
          el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur && e.target.blur(); } else e.stopPropagation(); });
          el.addEventListener('focusout', () => { setTimeout(() => { if (el.contains(document.activeElement)) return; const md = lpTableToMarkdown(table); if (md != null && md !== view.state.doc.sliceString(self.from, Math.min(self.to, view.state.doc.length))) commit(md); }, 0); });
        }
      }
    } else if (this.btype === 'math' || this.btype === 'embed') {
      // Fórmula $$…$$ / nota incrustada ![[…]]: clic → cursor dentro para
      // editar el fuente (el enlace de la cabecera abre la nota).
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const wl = e.target && e.target.closest && e.target.closest('[data-wikiname]');
        if (wl) { try { window.dispatchEvent(new CustomEvent('edinot:wikinav', { detail: { name: wl.getAttribute('data-wikiname') } })); } catch {} return; }
        try { view.dispatch({ selection: { anchor: Math.min(self.from + 2, view.state.doc.length) } }); view.focus(); } catch {}
      });
    } else if (this.btype === 'code' && /^[ \t]*```edinot-db[ \t]*\n/.test(this.srcKey)) {
      // Vista enlazada (editor/db/linked.jsx): la tabla de otra nota.
      const ctx = this.ctxRef && this.ctxRef.current;
      const m = /^[ \t]*```edinot-db[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/.exec(this.srcKey);
      const cfg = m && parseLinkedConfig(m[1]);
      if (cfg && ctx && ctx.linkedEnv && ctx.dbCache) {
        el.className = 'cm-lp-block md-render cm-lp-dblinked db-live';
        el.innerHTML = '';
        const before = view.state.doc.sliceString(0, this.from);
        const n = (before.match(/^[ \t]*```edinot-db[ \t]*$/gm) || []).length;
        mountLinkedDb(ctx.dbCache, `live:linked:${ctx.noteId || ''}:${n}`, el, {
          cfg, env: ctx.linkedEnv, baseCtxRef: ctx.dbCtxRef, ops: DB_OPS, surface: 'live',
          onConfig: (next) => commit(linkedFence(next)),
        });
      }
    } else if (this.btype === 'code') {
      const codeEl = el.querySelector('pre code') || el.querySelector('pre');
      if (codeEl) {
        codeEl.setAttribute('contenteditable', 'plaintext-only');
        codeEl.spellcheck = false;
        el.addEventListener('keydown', (e) => { e.stopPropagation(); }); // let Enter/Tab edit the code
        el.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('[data-code-lang]')) e.stopPropagation(); });
        el.addEventListener('change', (e) => {
          const sel = e.target.closest && e.target.closest('[data-code-lang]');
          if (!sel) return;
          const src = view.state.doc.sliceString(self.from, Math.min(self.to, view.state.doc.length));
          const nl = src.indexOf('\n');
          const open = nl < 0 ? src : src.slice(0, nl);
          const nextOpen = withFenceLang(open, sel.value);
          if (nextOpen !== open) commit(nextOpen + (nl < 0 ? '' : src.slice(nl)));
        });
        el.addEventListener('focusout', () => {
          setTimeout(() => {
            if (el.contains(document.activeElement)) return;
            const src = view.state.doc.sliceString(self.from, Math.min(self.to, view.state.doc.length));
            const lines = src.split('\n');
            const open = lines[0] || '```';
            const close = (lines.length > 1 && /^\s*```/.test(lines[lines.length - 1])) ? lines[lines.length - 1] : '```';
            const body = codeEl.textContent.replace(/\n$/, '');
            const next = open + '\n' + body + '\n' + close;
            if (next !== src) commit(next);
          }, 0);
        });
      }
    }
    return el;
  }
  // Let pointer + keyboard events reach the editable cells/code; CM still
  // ignores them for its own state so typing doesn't leak into the document.
  ignoreEvent() { return true; }
}

// A real checkbox for `- [ ]` / `- [x]`. Toggling just rewrites the single
// char between the brackets in the buffer (Yjs syncs it) — no app callback.
class LpTaskWidget extends WidgetType {
  constructor(checked, pos) { super(); this.checked = checked; this.pos = pos; }
  eq(o) { return o.checked === this.checked && o.pos === this.pos; }
  toDOM(view) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-lp-task';
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      const ch = view.state.doc.sliceString(this.pos + 1, this.pos + 2);
      const next = (ch === 'x' || ch === 'X') ? ' ' : 'x';
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: next } });
    });
    return box;
  }
  ignoreEvent() { return true; }
}

// Cache rendered block HTML by source slice so re-running over the whole doc
// on every keystroke doesn't re-parse unchanged tables/code/images.
const lpRenderCache = new Map();
function lpRender(renderMd, src) {
  if (lpRenderCache.has(src)) return lpRenderCache.get(src);
  let html = '';
  try { html = renderMd ? renderMd(src) : ''; } catch {}
  if (lpRenderCache.size > 240) lpRenderCache.clear();
  lpRenderCache.set(src, html);
  return html;
}

// La construcción de decoraciones (campo de bloques + plugin en línea por
// viewport), el teclado y las asas viven en editor/blocks/livePreview.js;
// aquí solo quedan los widgets compartidos (LpRenderWidget/LpTaskWidget) y
// la caché de HTML renderizado que el editor de bloques reutiliza.

function CodeMirrorEditor({ ytext, awareness, fontFamily, fontSize, focusOnMount, viewRef, onPasteImage, onSelectionChange, vimMode, undoManager: externalUndoManager, readOnly, wikiTargets, livePreview, renderMdRef, liveTableCtxRef, pageMeta, spellcheck, hideOwnCanvas }) {
  const containerRef = useRef(null);
  // Cabecera de página del editor de bloques (icono, título, editable): se
  // envía como efecto al crear la vista y cada vez que cambia.
  const pageMetaRef = useRef(pageMeta);
  pageMetaRef.current = pageMeta;
  const localViewRef = useRef(null);
  // vim() vive en su propio compartimento (el primero, para que su keymap
  // gane a defaultKeymap) y se rellena cuando llega el módulo diferido.
  const vimCompartment = useRef(null);
  if (!vimCompartment.current) vimCompartment.current = new Compartment();
  // Corrector ortográfico (Ajustes › Editor): CodeMirror pone spellcheck=false
  // en su contenido; se reconfigura sin recrear la vista.
  const spellCompartment = useRef(null);
  if (!spellCompartment.current) spellCompartment.current = new Compartment();
  const spellAttrs = (on) => EditorView.contentAttributes.of({ spellcheck: on ? 'true' : 'false' });
  const spellRef = useRef(spellcheck);
  spellRef.current = spellcheck;
  useEffect(() => {
    const v = localViewRef.current;
    if (v) v.dispatch({ effects: spellCompartment.current.reconfigure(spellAttrs(!!spellcheck)) });
  }, [spellcheck]);
  useEffect(() => {
    const v = localViewRef.current;
    if (v && livePreview && pageMeta) v.dispatch({ effects: blockPageMeta.of(pageMeta) });
  }, [pageMeta && pageMeta.icon, pageMeta && pageMeta.cover, pageMeta && pageMeta.title, pageMeta && pageMeta.editable]);
  // Keep the latest note-name getter in a ref so the completion source (built
  // once with the editor) always sees the current vault contents.
  const wikiTargetsRef = useRef(wikiTargets);
  useEffect(() => { wikiTargetsRef.current = wikiTargets; }, [wikiTargets]);

  useEffect(() => {
    if (!ytext || !containerRef.current) return;

    // Prefer the app-level UndoManager so Ctrl+Z / Ctrl+Y keep working when
    // the user toggles render mode (which unmounts this component). Fall
    // back to a local one only when no external manager is supplied.
    const localUndoManager = externalUndoManager || new Y.UndoManager(ytext);
    const ownsUndoManager = !externalUndoManager;
    const extensions = [
      // vim() must come first so its keymap takes priority over defaultKeymap.
      vimCompartment.current.of([]),
      spellCompartment.current.of(spellAttrs(!!spellRef.current)),
      // Viewer-role connections get a fully read-only editor — no caret
      // edits, no paste, no IME. ACL Fase A: server-side enforcement is
      // the source of truth (server.js ReadOnlyEnforcer); this is the
      // UI surface that prevents the user from typing into a void and
      // getting a confusing disconnect.
      ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
      // No CodeMirror history()/historyKeymap here: yCollab owns undo via the
      // shared Y.UndoManager (yUndoManagerKeymap). Having both bound Ctrl+Z to
      // two managers, which made undo inconsistent.
      // When the `[[` completion popup is open, Enter/Tab accept the
      // selection. acceptCompletion is a no-op (returns false → falls through
      // to the table handlers below) when no popup is active, so it must come
      // FIRST to win precedence over tableEnter/tableTab while completing.
      ...(wikiTargets && !readOnly ? [keymap.of([
        { key: 'Enter', run: acceptCompletion },
        { key: 'Tab', run: acceptCompletion },
      ])] : []),
      keymap.of([
        { key: 'Tab', run: tableTab, preventDefault: true },
        { key: 'Shift-Tab', run: tableShiftTab, preventDefault: true },
        { key: 'Enter', run: tableEnter, preventDefault: true },
      ]),
      keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab, ...yUndoManagerKeymap]),
      markdown({ extensions: GFM }),
      // Comentarios anclados resaltados (el editor los envía con setCommentMarks).
      commentMarksField,
      // «Editar» = editor de bloques (editor/blocks): marcadores ocultos y
      // atómicos, bloques renderizados, asas, menú «/», barra flotante,
      // pegar HTML. El documento sigue siendo Markdown plano.
      ...(livePreview ? [
        blockEditorExtensions({
          getRenderMd: () => renderMdRef && renderMdRef.current,
          renderHtml: lpRender,
          RenderWidget: LpRenderWidget,
          TaskWidget: LpTaskWidget,
          ctxRef: liveTableCtxRef,
          readOnly: !!readOnly,
          undoManager: localUndoManager,
          // Página ↔ Canvas: la valla del canvas propio no se ve en la página.
          hideOwnCanvas: () => !!hideOwnCanvas,
        }),
        // Navigate when a rendered wikilink label is clicked. Resolution +
        // navigation live in the React tree, so hand off via a window event.
        EditorView.domEventHandlers({
          mousedown(e) {
            const el = e.target && e.target.closest && e.target.closest('.cm-lp-wikilink');
            if (el) {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent('edinot:wikinav', { detail: { name: el.getAttribute('data-wikiname') } }));
              return true;
            }
            return false;
          },
        }),
      ] : []),
      // `[[` note-link autocomplete (skip for read-only viewers).
      ...(wikiTargets && !readOnly ? [autocompletion({
        override: [wikilinkCompletionSource(
          () => (wikiTargetsRef.current ? wikiTargetsRef.current() : []),
          (name) => (wikiTargetsRef.current && wikiTargetsRef.current.contentOf ? wikiTargetsRef.current.contentOf(name) : null),
        )],
        activateOnTyping: true,
        closeOnBlur: true,
      }), EditorView.updateListener.of((u) => {
        // Pop the picker the moment the user types the second `[`, so it's
        // discoverable without an explicit shortcut. Only on real typing.
        if (!u.docChanged) return;
        if (!u.transactions.some(tr => tr.isUserEvent('input.type') || tr.isUserEvent('input'))) return;
        const sel = u.state.selection.main;
        if (!sel.empty) return;
        if (u.state.sliceDoc(Math.max(0, sel.head - 2), sel.head) === '[[') startCompletion(u.view);
      })] : []),
      search({ top: true, createPanel: buildSearchPanel }),
      // No drawSelection(): its layer-drawn caret updates in CM's measure
      // phase, one frame BEHIND the freshly-typed character — the "cursor
      // trailing" feel. The NATIVE caret is composited with the text edit
      // itself, so it can never lag. Selection drawing falls back to the
      // native ::selection (styled below); we don't use multi-cursor, which
      // is the main thing drawSelection buys.
      dropCursor(),
      EditorView.lineWrapping,
      yCollab(ytext, awareness || null, { undoManager: localUndoManager }),
      EditorView.theme({
        '&': { height: '100%', backgroundColor: 'transparent' },
        '&.cm-focused': { outline: 'none' },
        '.cm-content': {
          padding: '14px 0',
          fontFamily: fontFamily,
          fontSize: fontSize + 'px',
          caretColor: 'var(--accent)',
        },
        '.cm-line': { padding: '0 22px' },
        '.cm-scroller': { lineHeight: 1.55, fontFamily: fontFamily },
        // Caret = the NATIVE one (caretColor above). No .cm-cursor rule: with
        // drawSelection() gone nothing renders that element. The vim block
        // cursor (.cm-fat-cursor) is drawn by the vim extension on its own.
        '&.cm-focused .cm-selectionBackground, ::selection': {
          backgroundColor: 'rgba(90, 122, 78, 0.22) !important',
        },
        '.cm-ySelection': { padding: '0 1px' },
        '.cm-ySelectionCaret': { borderLeftWidth: '2px' },
      }),
      EditorView.domEventHandlers({
        paste(event) {
          // First check files (works for File objects in clipboard, eg copied
          // from file manager) then DataTransferItems (in-process image data).
          const files = Array.from(event.clipboardData?.files || []);
          if (files.length && onPasteImage) {
            event.preventDefault();
            files.forEach(f => onPasteImage(f));
            return true;
          }
          const item = Array.from(event.clipboardData?.items || []).find(i => i.kind === 'file');
          if (item) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file && onPasteImage) onPasteImage(file);
            return true;
          }
          return false;
        },
        // File drops on CM6: move the caret to the drop point first so the
        // file is inserted exactly where the user pointed, then let the
        // app-level handler run attachFile. We stop propagation so the outer
        // docwrap onDrop doesn't double-handle.
        dragover(event) {
          if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            return true;
          }
          return false;
        },
        drop(event, view) {
          const files = Array.from(event.dataTransfer?.files || []);
          if (!files.length || !onPasteImage) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos != null) {
            view.dispatch({ selection: { anchor: pos, head: pos } });
          }
          view.focus();
          // Sequential so placeholders preserve drop order. We leave the
          // event un-stopped so the outer docwrap onDrop still runs to clear
          // its drop-overlay state — it skips the actual insert because
          // defaultPrevented is now true.
          (async () => { for (const f of files) await onPasteImage(f); })();
          return true;
        },
      }),
      // Broadcast selection changes upward so the AI's get_editor_selection
      // tool sees what the user has highlighted. Caller dispatches yMeta
      // updates; we just forward `{ from, to }` on actual selection change.
      EditorView.updateListener.of((() => {
        let lastFrom = -1, lastTo = -1;
        return (u) => {
          if (!onSelectionChange) return;
          if (!u.selectionSet && !u.docChanged) return;
          const m = u.state.selection.main;
          // Dedup: typing advances the caret every keystroke, but only forward
          // when the range actually changed so upstream (yMeta / comment FAB /
          // AI selection) doesn't re-fire on every character at the same spot.
          if (m.from === lastFrom && m.to === lastTo) return;
          lastFrom = m.from; lastTo = m.to;
          onSelectionChange({ from: m.from, to: m.to });
        };
      })()),
      // Track real typing activity. The MCP focus/highlight guards check
      // both `userMode` (markdown/dual) AND this timestamp before they
      // defer — opening a note in markdown view without typing should
      // not block the AI from switching notes.
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        const last = Number(yMeta.get('userEditingAt') || 0);
        const now = Date.now();
        if (now - last > 1500) {
          try { yMeta.set('userEditingAt', now); } catch {}
        }
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({ doc: ytext.toString(), extensions }),
      parent: containerRef.current,
    });
    if (viewRef) viewRef.current = view;
    localViewRef.current = view;
    view.dom.__edinotView = view; // ganchos de depuración / tests de humo
    if (vimMode) {
      loadVim().then((m) => {
        if (localViewRef.current !== view) return;
        view.dispatch({ effects: vimCompartment.current.reconfigure(m.vim()) });
      }).catch((err) => console.warn('[vim] no se pudo cargar', err));
    }
    if (livePreview && pageMetaRef.current) view.dispatch({ effects: blockPageMeta.of(pageMetaRef.current) });

    if (focusOnMount) {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length, head: view.state.doc.length } });
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length) });
    }

    return () => {
      view.destroy();
      if (ownsUndoManager) localUndoManager.destroy();
      if (viewRef && viewRef.current === view) viewRef.current = null;
      if (localViewRef.current === view) localViewRef.current = null;
    };
  }, [ytext, awareness, vimMode, externalUndoManager, readOnly, livePreview]);

  return <div ref={containerRef} className="cm-host" />;
}

// ─────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────
export const I = {
  view: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2" width="11" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5 5.5h6M5 8h6M5 10.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="11.5" cy="11.5" r="2" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M13 13l1.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  undo: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8s1.5-4 5.5-4S14 6.5 14 9s-1.8 4.5-5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/><path d="M3 8l3-2.5M3 8l3 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  redo: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13 8s-1.5-4-5.5-4S2 6.5 2 9s1.8 4.5 5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/><path d="M13 8l-3-2.5M13 8l-3 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  theme: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5C4 1.5 1.5 4 1.5 7.5c0 2.5 2 4 4 4 1 0 1.5-.5 1.5-1.2 0-.5-.3-.7-.3-1.3 0-.6.5-1 1.2-1H10c2.5 0 4.5-1.5 4.5-4 0-1.8-2.5-2.5-6.5-2.5z" stroke="currentColor" strokeWidth="1.2" fill="none"/><circle cx="4.5" cy="6" r="0.8" fill="currentColor"/><circle cx="7" cy="4" r="0.8" fill="currentColor"/><circle cx="10" cy="4.5" r="0.8" fill="currentColor"/><circle cx="11.5" cy="7.5" r="0.8" fill="currentColor"/></svg>,
  gear: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  textSize: <svg width="16" height="14" viewBox="0 0 18 14" fill="none"><path d="M2 12L5.5 2h1.5L10.5 12M3.2 8.5h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/><path d="M12 12l2.2-7h1l2.2 7M12.7 10h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  chevDown: <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  bold: <svg width="11" height="13" viewBox="0 0 12 14" fill="none"><path d="M3 1.5h4.2c1.6 0 2.8 1 2.8 2.5 0 1.5-1.2 2.3-2.8 2.3M3 6.3h4.7c1.8 0 3 1 3 2.6 0 1.6-1.2 2.6-3 2.6H3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 1.5v10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
  italic: <svg width="9" height="13" viewBox="0 0 10 14" fill="none"><path d="M4 1.5h5M1 12.5h5M7 1.5L3 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fontStyle="italic"/></svg>,
  underline: <svg width="11" height="13" viewBox="0 0 12 14" fill="none"><path d="M2.5 1.5v6.2c0 1.9 1.5 3.3 3.5 3.3s3.5-1.4 3.5-3.3V1.5M2 13h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>,
  strike: <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 4.5c0-1.5 1.5-2.5 3.5-2.5 1.7 0 3 .7 3.5 2M3.5 9.5c.4 1.5 2 2.5 4 2.5 2.2 0 3.5-1.2 3.5-2.8 0-.5-.1-1-.4-1.4M1.5 7h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>,
  codeTag: <svg width="14" height="11" viewBox="0 0 15 12" fill="none"><path d="M5 2L1.5 6 5 10M10 2l3.5 4L10 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  quote: <svg width="14" height="11" viewBox="0 0 14 12" fill="none"><path d="M1.5 6c0-2.2 1-3.7 3-4.5M7.5 6c0-2.2 1-3.7 3-4.5M1.5 6h3v4.5h-3V6zm6 0h3v4.5h-3V6z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.85"/></svg>,
  ul: <svg width="14" height="11" viewBox="0 0 15 12" fill="none"><circle cx="2" cy="2.5" r="0.9" fill="currentColor"/><circle cx="2" cy="6" r="0.9" fill="currentColor"/><circle cx="2" cy="9.5" r="0.9" fill="currentColor"/><path d="M5.5 2.5h8M5.5 6h8M5.5 9.5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  ol: <svg width="14" height="11" viewBox="0 0 16 12" fill="none"><path d="M1 1l1-.5v3M0.5 4h2M6 2h9M6 6h9M6 10h9M1 8.5c0-.5.5-1 1-1s1 .4 1 .9-2 1.6-2 2.6h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  checklist: <svg width="14" height="11" viewBox="0 0 15 12" fill="none"><rect x="0.5" y="0.5" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.1" fill="none"/><rect x="0.5" y="4.5" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.1" fill="none"/><rect x="0.5" y="8.5" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.1" fill="currentColor"/><path d="M1.2 9.8l.7.7 1.4-1.5" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none"/><path d="M5.5 2h8M5.5 6h8M5.5 10h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  codeBlock: <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M4.5 2.5l-3 4.5 3 4.5M9.5 2.5l3 4.5-3 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  link: <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M6 4.5L8 2.5c1.2-1.2 3-1.2 4 0s1.2 3 0 4L10 8.5M8 9.5l-2 2c-1.2 1.2-3 1.2-4 0s-1.2-3 0-4L4 5.5M5 9l4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>,
  image: <svg width="14" height="13" viewBox="0 0 16 14" fill="none"><rect x="1" y="1" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><circle cx="5" cy="5" r="1.3" fill="currentColor"/><path d="M2 11l3.5-3.5 2 2L11 6l3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" fill="none"/></svg>,
  table: <svg width="14" height="12" viewBox="0 0 16 14" fill="none"><rect x="1" y="1.5" width="14" height="11" rx="1.3" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M1 5.5h14M1 9h14M6 1.5v11M11 1.5v11" stroke="currentColor" strokeWidth="1.1"/></svg>,
  comment: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2.5 3.5A2 2 0 014.5 1.5h7A2 2 0 0113.5 3.5v4.8a2 2 0 01-2 2H8l-3.5 3v-3a2 2 0 01-2-2V3.5z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" fill="none"/><path d="M5 5h6M5 7.5h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/></svg>,
  hamburger: <svg width="15" height="13" viewBox="0 0 16 14" fill="none"><path d="M2 3h12M2 7h12M2 11h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  calendar: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="12" rx="1.6" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M1.5 6h13M5 1.2v2.4M11 1.2v2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  clock: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8.4" r="6" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M8 4.9v3.5l2.3 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  back: <svg width="14" height="13" viewBox="0 0 16 14" fill="none"><path d="M6.5 2.5L2 7l4.5 4.5M2.5 7h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  emoji: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><circle cx="6" cy="6.5" r="0.9" fill="currentColor"/><circle cx="10" cy="6.5" r="0.9" fill="currentColor"/><path d="M5.5 10c.7 1 1.6 1.5 2.5 1.5s1.8-.5 2.5-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>,
  folderNew: <svg width="15" height="13" viewBox="0 0 16 14" fill="none"><path d="M1.5 4l1.5-2h4l1.5 2H14a.5.5 0 01.5.5V12a.5.5 0 01-.5.5H2A.5.5 0 011.5 12V4z" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M8 7v3M6.5 8.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  // Canvas-specific icons. All monochrome via currentColor for visual
  // consistency with the rest of the format toolbar.
  cNote:   <svg width="15" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 1.5h6L13 5v9a1 1 0 01-1 1H3.5a1 1 0 01-1-1V2.5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3"/><path d="M9.5 1.5V5h3.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  cText:   <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2.5 4V2.5h11V4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M8 2.5v11M5.5 13.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  cLabel:  <svg width="15" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 5h12M2 8.5h12M2 12h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  cUrl:    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M7 5L9 3c1.4-1.4 3.5-1.4 4.8 0 1.4 1.4 1.4 3.5 0 4.8L11.8 9.8M9 11l-2 2c-1.4 1.4-3.5 1.4-4.8 0-1.4-1.4-1.4-3.5 0-4.8L4.2 6.2M6 10l4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>,
  cImage:  <svg width="14" height="13" viewBox="0 0 16 14" fill="none"><rect x="1" y="1" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><circle cx="5" cy="5" r="1.3" fill="currentColor"/><path d="M2 11l3.5-3.5 2 2L11 6l3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" fill="none"/></svg>,
  cAttach: <svg width="13" height="14" viewBox="0 0 14 16" fill="none"><path d="M11.5 5.5L6 11c-1.4 1.4-3.6 1.4-5 0-1.4-1.4-1.4-3.6 0-5L7 .5c1-1 2.6-1 3.5 0s1 2.5 0 3.5L4.5 10c-.6.6-1.6.6-2.2 0s-.6-1.6 0-2.2L7 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>,
  cQuery:  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  cGroup:  <svg width="15" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3" width="13" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeDasharray="2 1.5"/><path d="M4 5.5h3M9 5.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  cDraw:   <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3-9.5 9.5H2v-3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/><path d="M9.5 3.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  cLayout: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="0.8" stroke="currentColor" strokeWidth="1.3" fill="none"/><rect x="9" y="2" width="5" height="5" rx="0.8" stroke="currentColor" strokeWidth="1.3" fill="none"/><rect x="2" y="9" width="5" height="5" rx="0.8" stroke="currentColor" strokeWidth="1.3" fill="none"/><rect x="9" y="9" width="5" height="5" rx="0.8" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>,
  cFit:    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  cFull:   <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  cExit:   <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  cMinus:  <svg width="12" height="12" viewBox="0 0 16 16"><path d="M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  cPlus:   <svg width="12" height="12" viewBox="0 0 16 16"><path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  cAddNode:<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3.5" width="9" height="9" rx="1.3" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M13 6v6M10 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  share:   <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4.5L8 2.5c1.2-1.2 3-1.2 4 0s1.2 3 0 4L10 8.5M8 9.5l-2 2c-1.2 1.2-3 1.2-4 0s-1.2-3 0-4L4 5.5M5 9l4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>,
  bell:    <svg width="14" height="15" viewBox="0 0 16 17" fill="none"><path d="M3.5 12V8.5C3.5 5.7 5.5 3.5 8 3.5s4.5 2.2 4.5 5V12l1.5 1.5h-12L3.5 12z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/><path d="M6.5 15c0 .8.7 1.5 1.5 1.5s1.5-.7 1.5-1.5M8 1.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  users:   <svg width="15" height="13" viewBox="0 0 17 14" fill="none"><circle cx="6" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M1.5 12.5c0-2.2 2-3.7 4.5-3.7s4.5 1.5 4.5 3.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/><circle cx="12.5" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M11 12.5c.2-1.6 1.7-2.8 3.5-2.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none"/></svg>,
  audit:   <svg width="13" height="14" viewBox="0 0 14 16" fill="none"><rect x="2" y="2.5" width="10" height="12" rx="1.2" stroke="currentColor" strokeWidth="1.3" fill="none"/><rect x="4.5" y="1" width="5" height="2.5" rx="0.6" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M4.5 7.5h5M4.5 10h5M4.5 12h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  pencil:  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M11 1.5l3 3-9.5 9.5H2v-3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/><path d="M9 3.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  trash:   <svg width="13" height="14" viewBox="0 0 14 16" fill="none"><path d="M2 4h10M5 4V2.5h4V4M3.5 4l.7 9.5c0 .8.7 1.5 1.5 1.5h3c.8 0 1.4-.7 1.5-1.5L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/><path d="M6 7v5M8 7v5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  plus:    <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  refresh: <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 7a5 5 0 019.4-2.3M12 7a5 5 0 01-9.4 2.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/><path d="M9.5 2.5L11.5 4l-1.5 1.5M4.5 11.5L2.5 10 4 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  check:   <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  arrowDl: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v9M3 7l4 4 4-4M2 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  arrowUp: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 12V3M3 7l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  power:   <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 3.5a5 5 0 106 0M7 1.5v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>,
  alert:   <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L13 12H1L7 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/><path d="M7 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="7" cy="10.5" r="0.7" fill="currentColor"/></svg>,
  info:    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M7 6v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="7" cy="4" r="0.7" fill="currentColor"/></svg>,
  spinner: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeOpacity="0.3"/><path d="M12.5 7a5.5 5.5 0 00-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>,
};

const EMOJI_GROUPS = {
  '😀': ['😀','😁','😂','🤣','😊','😍','😘','🤩','😎','🤔','🙃','😴','🥱','😭','😡','🥺','🤯','🤐','🤫','😈','💀','👻','🤖','🎃','😺','🙈','🙉','🙊'],
  '👍': ['👍','👎','👏','🙏','💪','🫶','🤝','👀','🧠','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🔥','✨','⭐','🌟','💯','🎉','🎊','🏆','🥇'],
  '📌': ['📌','📍','📎','🖇️','✂️','📐','📏','📝','✏️','🖊️','🖋️','✒️','🖌️','🖍️','📓','📔','📒','📕','📗','📘','📙','📚','🔖','📒','📑','🧾','📊','📈','📉'],
  '💻': ['💻','⌨️','🖥️','🖱️','🖨️','💾','💿','📀','📱','📲','☎️','📞','📟','📠','🔋','🔌','💡','🔦','🕯️','📡','🧭','⚙️','🔧','🔨','⛏️','🪓','🔩'],
  '📁': ['📁','📂','🗂️','🗃️','🗄️','📦','📫','📬','📭','📮','📪','📰','🗞️','📃','📜','📄','📑','📊','📈','📉','🧮','🗒️','🗓️','📆','📅','🗳️','🗝️','🔑'],
  '⚠️': ['⚠️','✅','❌','❓','❗','‼️','⁉️','💡','🛑','🚧','🔒','🔓','🔔','🔕','📢','📣','📌','📍','🆗','🆕','🆙','🆒','🆓','🆖','♻️','✳️','✴️','❇️'],
  '🌍': ['🌍','🌎','🌏','🌐','🗺️','🧭','🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🌅','🌄','🌠','🎇','🎆','🌇','🌆','🌃','🌌','🌉','🌁','🌪️','🌧️','☀️','⛅','☁️','❄️','⛈️','🌈'],
  '🍎': ['🍎','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥕','🌽','🍕','🍔','🍟','🌭','🥪','🌮','🌯','🥙','🍝','🍜','🍣','🍱','🍰','🍪','☕','🍵','🍺','🍷'],
};
// EMOJI_FOLDER_SET / EMOJI_FILE_SET viven en ui/shared/emoji.js (también los usa la barra lateral).

function EmojiPicker({ choices, onPick, onClose, columns = 8 }) {
  return (
    <>
      <div className="dropdown-backdrop" onClick={onClose} />
      <div className="emoji-picker" onClick={(e) => e.stopPropagation()}>
        {choices.map((e, i) => (
          <button key={i} className="emoji-cell" onClick={() => { onPick(e); onClose(); }}>{e}</button>
        ))}
      </div>
    </>
  );
}

function ConfirmModal({ state, onResolve }) {
  useI18n();
  if (!state) return null;
  return (
    <>
      <div className="dropdown-backdrop" style={{ background: 'rgba(0,0,0,0.35)', zIndex: 250 }} onClick={() => onResolve(false)} />
      <div style={{
        position: 'fixed', top: '32%', left: '50%', transform: 'translateX(-50%)',
        width: 'min(420px, 92vw)', zIndex: 260,
        background: 'var(--toolbar)', color: 'var(--fg)',
        border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 12,
        padding: 16, boxShadow: '0 30px 80px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.15)',
        animation: 'slidein 0.14s ease-out',
      }}>
        {state.title && <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{state.title}</div>}
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--fg)', opacity: 0.9 }}>{state.message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={() => onResolve(false)}
            style={{ height: 30, padding: '0 14px', borderRadius: 7, border: '0.5px solid rgba(0,0,0,0.15)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>
            {state.cancelLabel || t('btn.cancel')}
          </button>
          <button onClick={() => onResolve(true)} autoFocus
            style={{
              height: 30, padding: '0 16px', borderRadius: 7, border: 'none',
              background: state.danger ? '#c53030' : 'var(--accent)',
              color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            }}>
            {state.confirmLabel || t('btn.confirm')}
          </button>
        </div>
      </div>
    </>
  );
}

function PromptModal({ state, onResolve }) {
  useI18n();
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    if (state) {
      setValue(state.defaultValue || '');
      setTimeout(() => { if (inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, 20);
    }
  }, [state]);
  if (!state) return null;
  const submit = () => onResolve((value || '').trim() || null);
  return (
    <>
      <div className="dropdown-backdrop" style={{ background: 'rgba(0,0,0,0.35)', zIndex: 250 }} onClick={() => onResolve(null)} />
      <div style={{
        position: 'fixed', top: '32%', left: '50%', transform: 'translateX(-50%)',
        width: 'min(420px, 92vw)', zIndex: 260,
        background: 'var(--toolbar)', color: 'var(--fg)',
        border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 12,
        padding: 16, boxShadow: '0 30px 80px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.15)',
        animation: 'slidein 0.14s ease-out',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{state.title}</div>
        <input ref={inputRef} value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { e.preventDefault(); onResolve(null); }
          }}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 8,
            border: '0.5px solid rgba(0,0,0,0.2)', background: 'rgba(255,255,255,0.6)',
            fontSize: 14, outline: 'none', fontFamily: 'inherit',
          }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={() => onResolve(null)}
            style={{ height: 30, padding: '0 14px', borderRadius: 7, border: '0.5px solid rgba(0,0,0,0.15)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>{t('btn.cancel')}</button>
          <button onClick={submit}
            style={{ height: 30, padding: '0 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>OK</button>
        </div>
      </div>
    </>
  );
}

function EmojiToolbarButton({ onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="fmt-btn" title="Insertar emoji" onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); }}>
        <span className="fmt-ic">{I.emoji}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100 }}>
          <EmojiPicker choices={Object.values(EMOJI_GROUPS).flat()}
            onPick={onPick} onClose={() => setOpen(false)} />
        </div>
      )}
    </span>
  );
}

// Convert "2026-05-16" / parseable date strings → "YYYY-MM-DD" for
// <input type=date> binding. Returns '' when unparseable so the field
// stays empty rather than showing the literal source string.
function toIsoDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}
function isCheckboxTruthy(v) { return /^(x|✓|✔|true|1|sí|si|yes)$/i.test(String(v || '').trim()); }

// File-attachment input for "archivo" columns (formularios). Stores the cell value as markdown (`![name](url)` for images,
// `[name](url)` otherwise) so render + exports keep working unchanged.
function ArchivoCellInput({ value, disabled, onChange, onAttach, autoFocus }) {
  useI18n();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const parsed = parseArchivoCell(value || '');
  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !onAttach) return;
    setBusy(true);
    try {
      const info = await onAttach(file);
      if (info && (info.url || info.sha)) {
        const url = info.url || `edinot://blob/${info.sha}`;
        const nm = (info.name || file.name || 'archivo').replace(/[\]\[\n\r]/g, '');
        const isImg = (file.type || '').startsWith('image/');
        onChange(`${isImg ? '!' : ''}[${nm}](${url})`);
      }
    } catch (err) { window.alert(String((err && err.message) || err)); }
    finally { setBusy(false); }
  };
  return (
    <div className="tre-archivo">
      {value ? (
        <div className="tre-archivo-cur">
          {parsed.isImage && parsed.src
            ? <img className="tre-archivo-thumb" src={parsed.src} alt="" />
            : <span className="tre-archivo-icon">📎</span>}
          <span className="tre-archivo-name">{parsed.name || parsed.src || value}</span>
          <button type="button" className="tre-archivo-x" disabled={disabled}
            onClick={() => onChange('')} title={t('btn.clear')}>×</button>
        </div>
      ) : null}
      <button type="button" className="tre-archivo-btn" disabled={disabled || busy}
        autoFocus={autoFocus} onClick={() => fileRef.current && fileRef.current.click()}>
        {busy ? '⏳ …' : (value ? t('archivo.change') : t('archivo.attach'))}
      </button>
      <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onFile} />
    </div>
  );
}

// Type-aware validation shared by the row editor and the inline form. Empty
// cells are always allowed; only filled values are checked against their
// column type. Returns an errors object keyed by column index.
export function validateTypedValues(headers, cols, values) {
  const errs = {};
  (headers || []).forEach((h, i) => {
    const conf = cols && cols[h];
    if (!conf) return;
    const v = String(values[i] || '').trim();
    if (!v) return;
    if (conf.type === 'number') {
      if (!Number.isFinite(Number(v.replace(',', '.')))) errs[i] = t('cell.notNumber');
    } else if (conf.type === 'date') {
      if (isNaN(Date.parse(v))) errs[i] = t('cell.dateUnknown');
    } else if (conf.type === 'select' && conf.options && conf.options.length) {
      if (!conf.options.some(o => o.toLowerCase() === v.toLowerCase())) errs[i] = t('cell.outOfOptions', { opts: conf.options.join(', ') });
    }
  });
  return errs;
}

// One type-aware field (label + control + error) for a table column, used by
// FormView (inline form). `showTypeTag` adds the column-type chip
// (editor only); `simpleComplex` downgrades person/wikilink/archivo to a plain
// text input where the form context lacks members/note-names/upload wiring.
export function TypedFieldInput({
  index, conf, value, label, error, help,
  disabled = false, autoFocus = false, required = false,
  showTypeTag = false, simpleComplex = false, idPrefix = 'tre',
  members, noteNames, onAttach, onChange, onKeyDown,
}) {
  const i = index;
  const colType = conf && conf.type;
  const set = (v) => onChange(v);
  const onKey = onKeyDown || (() => {});
  // simpleComplex downgrades person/wikilink to plain text where the form
  // context lacks member/note-name data. `archivo` stays a real uploader when
  // an onAttach handler is supplied (so forms can collect files).
  const effType = (simpleComplex && (colType === 'person' || colType === 'wikilink' || (colType === 'archivo' && !onAttach)))
    ? 'text'
    : colType;
  let control;
  if (effType === 'select' && conf.options && conf.options.length) {
    control = (
      <select autoFocus={autoFocus} disabled={disabled} value={value || ''}
        onChange={(e) => set(e.target.value)} onKeyDown={onKey}>
        <option value="">{t('cell.optNone')}</option>
        {conf.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  } else if (effType === 'date') {
    control = <input type="date" autoFocus={autoFocus} disabled={disabled}
      value={toIsoDate(value)} onChange={(e) => set(e.target.value)} onKeyDown={onKey} />;
  } else if (effType === 'number') {
    control = <input type="number" step="any" autoFocus={autoFocus} disabled={disabled}
      value={value || ''} onChange={(e) => set(e.target.value)} onKeyDown={onKey} />;
  } else if (effType === 'checkbox') {
    control = (
      <label className="tre-checkbox">
        <input type="checkbox" disabled={disabled} checked={isCheckboxTruthy(value)}
          onChange={(e) => set(e.target.checked ? 'x' : '')} />
        <span>{isCheckboxTruthy(value) ? t('cell.yes') : t('cell.no')}</span>
      </label>
    );
  } else if (effType === 'status') {
    control = (
      <select autoFocus={autoFocus} disabled={disabled} value={value || ''}
        onChange={(e) => set(e.target.value)} onKeyDown={onKey}>
        <option value="">{t('cell.optNone')}</option>
        {(conf.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  } else if (effType === 'multiselect' || effType === 'person') {
    const opts = effType === 'person'
      ? (members || []).map(m => ({ key: m.email, label: personName(m.email), title: m.email }))
      : (conf.options || []).map(o => ({ key: o, label: o, title: o }));
    const sel = splitMulti(value).map(x => x.toLowerCase());
    const toggle = (token) => {
      const cur = splitMulti(value);
      const has = cur.some(x => x.toLowerCase() === token.toLowerCase());
      set((has ? cur.filter(x => x.toLowerCase() !== token.toLowerCase()) : [...cur, token]).join(', '));
    };
    if (effType === 'person' && !opts.length) {
      control = <input type="text" disabled={disabled} placeholder="email1, email2"
        value={value || ''} onChange={(e) => set(e.target.value)} onKeyDown={onKey} />;
    } else {
      control = (
        <div className="tre-chips">
          {opts.map(o => (
            <button key={o.key} type="button" disabled={disabled} title={o.title}
              className={`tre-chip${sel.includes(String(o.key).toLowerCase()) ? ' on' : ''}`}
              style={{ '--pill-h': `${tplPillColor(o.key)}deg` }}
              onClick={() => toggle(o.key)}>{o.label}</button>
          ))}
        </div>
      );
    }
  } else if (effType === 'rating') {
    control = (
      <div className="tre-stars">
        {Array.from({ length: RATING_MAX }, (_, k) => k + 1).map(n => (
          <button key={n} type="button" disabled={disabled} className="tre-star"
            onClick={() => set(parseRating(value) === n ? '' : String(n))}>
            {n <= parseRating(value) ? '★' : '☆'}
          </button>
        ))}
      </div>
    );
  } else if (effType === 'progress') {
    control = (
      <div className="tre-prog-edit">
        <input type="range" min="0" max="100" step="5" disabled={disabled}
          value={parseProgress(value) || 0} onChange={(e) => set(e.target.value)} />
        <input type="number" min="0" max="100" className="tre-prog-num" disabled={disabled}
          value={value == null ? '' : String(value).replace('%', '')}
          onChange={(e) => set(e.target.value)} onKeyDown={onKey} />
        <span>%</span>
      </div>
    );
  } else if (effType === 'wikilink') {
    control = (
      <>
        <input type="text" list={`${idPrefix}-wiki-${i}`} autoFocus={autoFocus} disabled={disabled}
          placeholder={t('cell.wikiPlaceholder')} value={value || ''}
          onChange={(e) => set(e.target.value)} onKeyDown={onKey} />
        <datalist id={`${idPrefix}-wiki-${i}`}>
          {(noteNames || []).slice(0, 800).map(n => <option key={n} value={n} />)}
        </datalist>
      </>
    );
  } else if (effType === 'archivo') {
    control = <ArchivoCellInput value={value} disabled={disabled} autoFocus={autoFocus}
      onAttach={onAttach} onChange={(val) => set(val)} />;
  } else {
    // text / tags / select-libre → plain input
    control = <input type="text" autoFocus={autoFocus} disabled={disabled}
      placeholder={colType === 'tags' ? 'tag1, tag2, tag3' : ''} value={value || ''}
      onChange={(e) => set(e.target.value)} onKeyDown={onKey} />;
  }

  const TYPE_ICONS = { select: t('cell.typeList'), number: '#', date: '📅', checkbox: '☑', tags: '🏷', multiselect: '▤', status: '◍', rating: '★', progress: '▰', person: '👤', wikilink: '🔗', archivo: '📎' };
  return (
    <div className={`tre-field${error ? ' tre-err' : ''}`}>
      <label>
        {label}
        {required && <span className="tre-req" aria-hidden="true"> *</span>}
        {showTypeTag && colType && (
          <span className="tre-type-tag" title={t('cell.lockedType', { type: colType })}>
            {TYPE_ICONS[colType] || colType}
          </span>
        )}
      </label>
      {help ? <div className="tre-help">{help}</div> : null}
      {control}
      {error && <div className="tre-err-msg">{error}</div>}
    </div>
  );
}

function TableGridPicker({ onPick, onClose }) {
  const MAX_ROWS = 8;
  const MAX_COLS = 10;
  const [hover, setHover] = useState({ rows: 0, cols: 0 });

  useEffect(() => {
    const onDocDown = (e) => {
      if (!e.target.closest || !e.target.closest('.table-grid-picker')) onClose && onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    // Defer the outside-click listener one tick so the click that OPENED the
    // picker doesn't immediately close it. Capture the timer id and clear it on
    // cleanup — otherwise a re-render before it fires leaks an orphaned
    // document listener that re-closes the picker on the next open (the menu
    // appears to "not open at all" once the note already has a table and is
    // re-rendering frequently).
    const id = setTimeout(() => document.addEventListener('mousedown', onDocDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const cells = [];
  for (let r = 1; r <= MAX_ROWS; r++) {
    for (let c = 1; c <= MAX_COLS; c++) {
      const on = r <= hover.rows && c <= hover.cols;
      cells.push(
        <div key={`${r}-${c}`}
          className={`tgp-cell${on ? ' on' : ''}`}
          onMouseEnter={() => setHover({ rows: r, cols: c })}
          onMouseDown={(e) => { e.preventDefault(); onPick(r, c); }}
        />
      );
    }
  }
  const label = hover.rows && hover.cols ? `${hover.rows} × ${hover.cols}` : 'Tabla';

  return (
    <div className="table-grid-picker" onMouseLeave={() => setHover({ rows: 0, cols: 0 })}>
      <div className="tgp-label">{label}</div>
      <div className="tgp-grid"
        style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 18px)` }}>
        {cells}
      </div>
    </div>
  );
}

// Canvas embed button: opens a tiny menu with two actions —
// insert a reference to an existing canvas note, or spawn a new one.
function CanvasEmbedToolbarButton({ onAction, canvases, onCreateAndEmbed }) {
  useI18n();
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="fmt-btn" title={t('canvas.embed.title')}
        onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); }}>
        <span className="fmt-ic">{I.cFull || '🎨'}</span>
      </button>
      {open && (
        <>
          <div className="dropdown-backdrop" style={{ background: 'transparent', zIndex: 50 }}
            onClick={() => setOpen(false)} />
          <div className="fmt-menu" style={{ top: 'calc(100% + 6px)', right: 0, left: 'auto', minWidth: 240, zIndex: 60 }}
            onMouseDown={(e) => e.stopPropagation()}>
            <div className="fmt-menu-item"
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); setPickerOpen(true); }}>
              <span style={{ marginRight: 8 }}>🔗</span> {t('canvas.embed.existing')}
            </div>
            <div className="fmt-menu-item"
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); onCreateAndEmbed && onCreateAndEmbed(); }}>
              <span style={{ marginRight: 8 }}>＋</span> {t('canvas.embed.new')}
            </div>
          </div>
        </>
      )}
      {pickerOpen && (
        <CanvasEmbedPicker
          canvases={canvases}
          onPick={(noteId) => { setPickerOpen(false); onAction('canvasEmbed', { noteId }); }}
          onClose={() => setPickerOpen(false)} />
      )}
    </span>
  );
}

function CanvasEmbedPicker({ canvases, onPick, onClose }) {
  useI18n();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { setTimeout(() => inputRef.current && inputRef.current.focus(), 30); }, []);
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const base = (canvases || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return q ? base.filter(f => (f.name || '').toLowerCase().includes(q)) : base;
  }, [canvases, q]);
  return (
    <>
      <div className="view-spotlight-backdrop" onClick={onClose} />
      <div className="view-menu canvas-note-picker" role="dialog"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="view-search">
          <svg viewBox="0 0 13 13"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8.5 8.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          <input ref={inputRef}
            placeholder={t('canvas.embed.pickerPh')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
              else if (e.key === 'Enter' && rows[0]) { e.preventDefault(); onPick(rows[0].id); }
            }} />
        </div>
        <div className="view-menu-body">
          {rows.length === 0 && (
            <div className="view-empty">{t('canvas.embed.empty')}</div>
          )}
          {rows.map(f => (
            <div key={f.id} className="view-item"
              onClick={() => onPick(f.id)}>
              <div className="view-item-main">
                <span className="view-doticon">🎨</span>
                <span className="view-name">{f.name.replace(/\.(md|markdown|txt)$/i, '')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function TableToolbarButton({ onAction }) {
  const [open, setOpen] = useState(false);
  // Stable identities so TableGridPicker's [onClose] effect runs once per open
  // instead of on every parent re-render — re-running it churns (and used to
  // leak) the document mousedown listener that dismisses the picker.
  const close = useCallback(() => setOpen(false), []);
  const pick = useCallback((rows, cols) => { setOpen(false); onAction('table', { rows, cols }); }, [onAction]);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="fmt-btn" title="Insertar tabla"
        onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); }}>
        <span className="fmt-ic">{I.table}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100 }}>
          <TableGridPicker onPick={pick} onClose={close} />
        </div>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Floating formatting toolbar
// ─────────────────────────────────────────────────────────────
function FormatToolbar({ onAction, theme, hidden, entering, onUndo, onRedo, onInsertText, onReminderFromSelection, canvases, onCreateAndEmbedCanvas }) {
  useI18n();
  const [bodyOpen, setBodyOpen] = useState(false);
  const [bodyLabel, setBodyLabel] = useState(() => t('fmt.style.body'));

  const pickStyle = (kind, label) => {
    onAction(kind);
    setBodyLabel(label);
    setBodyOpen(false);
  };

  const Btn = ({ act, ic, title }) => (
    <button className="fmt-btn" title={title} onMouseDown={(e) => { e.preventDefault(); onAction(act); }}>
      <span className="fmt-ic">{ic}</span>
    </button>
  );

  return (
    <div className={`fmt-bar${hidden ? ' gone' : ''}${entering ? ' entering' : ''}`} aria-hidden={hidden}>
      <div className="fmt-body" onMouseDown={(e) => { e.preventDefault(); setBodyOpen(!bodyOpen); }}>
        <span className="fmt-ic" style={{ marginRight: 6 }}>{I.textSize}</span>
        <span style={{ fontWeight: 500 }}>{bodyLabel}</span>
        <span style={{ marginLeft: 8, opacity: 0.55 }}>{I.chevDown}</span>
        {bodyOpen && (
          <div className="fmt-menu" onMouseDown={(e) => e.stopPropagation()}>
            <div className="fmt-menu-item" onMouseDown={(e) => { e.preventDefault(); pickStyle('h1', t('fmt.style.h1')); }}>
              <span style={{ fontSize: 22, fontWeight: 700 }}>{t('fmt.style.h1')}</span>
            </div>
            <div className="fmt-menu-item" onMouseDown={(e) => { e.preventDefault(); pickStyle('h2', t('fmt.style.h2')); }}>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{t('fmt.style.h2')}</span>
            </div>
            <div className="fmt-menu-item" onMouseDown={(e) => { e.preventDefault(); pickStyle('h3', t('fmt.style.h3')); }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{t('fmt.style.h3')}</span>
            </div>
            <div className="fmt-menu-sep" />
            <div className="fmt-menu-item" onMouseDown={(e) => { e.preventDefault(); pickStyle('body', t('fmt.style.body')); }}>
              <span style={{ fontSize: 14 }}>{t('fmt.style.body')}</span>
            </div>
          </div>
        )}
      </div>
      <div className="fmt-sep" />
      <Btn act="bold"      ic={I.bold}      title={t('fmt.bold')} />
      <Btn act="italic"    ic={I.italic}    title={t('fmt.italic')} />
      <Btn act="underline" ic={I.underline} title={t('fmt.underline')} />
      <Btn act="strike"    ic={I.strike}    title={t('fmt.strike')} />
      <Btn act="code"      ic={I.codeTag}   title={t('fmt.code')} />
      <Btn act="quote"     ic={I.quote}     title={t('fmt.quote')} />
      <Btn act="ul"        ic={I.ul}        title={t('fmt.ul')} />
      <Btn act="ol"        ic={I.ol}        title={t('fmt.ol')} />
      <Btn act="checklist" ic={I.checklist} title={t('fmt.checklist')} />
      <Btn act="codeblock" ic={I.codeBlock} title={t('fmt.codeblock')} />
      <Btn act="link"      ic={I.link}      title={t('fmt.link')} />
      <Btn act="image"     ic={I.image}     title={t('fmt.image')} />
      <TableToolbarButton onAction={onAction} />
      <CanvasEmbedToolbarButton onAction={onAction} canvases={canvases} onCreateAndEmbed={onCreateAndEmbedCanvas} />
      <EmojiToolbarButton onPick={(e) => onInsertText && onInsertText(e)} />
      <button className="fmt-btn" title={t('cal.remFromSel')}
        onMouseDown={(e) => { e.preventDefault(); onReminderFromSelection && onReminderFromSelection(); }}>
        <span className="fmt-ic">{I.clock}</span>
      </button>
      <div className="fmt-sep" />
      <button className="fmt-btn" title={t('fmt.undo')} onMouseDown={(e) => { e.preventDefault(); onUndo && onUndo(); }}>
        <span className="fmt-ic">{I.undo}</span>
      </button>
      <button className="fmt-btn" title={t('fmt.redo')} onMouseDown={(e) => { e.preventDefault(); onRedo && onRedo(); }}>
        <span className="fmt-ic">{I.redo}</span>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ajustes: página completa en ui/settings/ (SettingsPage + sections/*).
// Los antiguos paneles del modal (GeneralPane, ThemePane, SyncPane, McpPane,
// AiLocalPane, SemanticRecallPane, UpdatesPane, WebClipperPane,
// GoogleCalendarPane, ShortcutsPane…) se movieron allí sin cambiar su lógica.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// View menu (file picker)
// ─────────────────────────────────────────────────────────────
// Iconos SVG del editor (selector de modos antiguo, toasts, comentarios…).
// Los emoji que el usuario elige a mano siguen teniendo prioridad; estos son
// the user picked by hand still win; these are the defaults.
export function VIcon({ name }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'note': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M4 1.8h5.2l3.6 3.6v8a.9.9 0 0 1-.9.9H4a.9.9 0 0 1-.9-.9V2.7a.9.9 0 0 1 .9-.9z"/>
        <path {...p} d="M9.2 1.8v3.6h3.6"/>
        <path {...p} d="M5.6 8.4h4.8M5.6 10.8h3.2"/>
      </svg>);
    case 'canvas': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <rect {...p} x="1.8" y="1.8" width="12.4" height="12.4" rx="2"/>
        <circle {...p} cx="5.5" cy="5.5" r="1.6"/>
        <rect {...p} x="8.7" y="8.7" width="3.6" height="3.6" rx=".8"/>
        <path {...p} d="M6.7 6.7l1.9 1.9"/>
      </svg>);
    case 'folder': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M1.8 4.2a1 1 0 0 1 1-1h3.1l1.5 1.6h5.8a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/>
      </svg>);
    case 'vault': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M1.8 5.2l6.2-3 6.2 3v5.6l-6.2 3-6.2-3z"/>
        <path {...p} d="M1.8 5.2l6.2 3 6.2-3M8 8.2v5.6"/>
      </svg>);
    case 'clock': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <circle {...p} cx="8" cy="8" r="6.2"/>
        <path {...p} d="M8 4.8V8l2.4 1.6"/>
      </svg>);
    case 'plus': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M8 3.2v9.6M3.2 8h9.6"/>
      </svg>);
    case 'import': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M8 2.2v7.6M5 7l3 3 3-3"/>
        <path {...p} d="M2.5 10.8v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"/>
      </svg>);
    case 'external': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M4 1.8h5.2l3.6 3.6v8a.9.9 0 0 1-.9.9H4a.9.9 0 0 1-.9-.9V2.7a.9.9 0 0 1 .9-.9z"/>
        <path {...p} d="M9.2 1.8v3.6h3.6"/>
        <path {...p} d="M6 11.2l4-4M10 10V7.2H7.2"/>
      </svg>);
    case 'spark': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M8 1.8L9.6 6.4 14.2 8 9.6 9.6 8 14.2 6.4 9.6 1.8 8 6.4 6.4z"/>
      </svg>);
    case 'bell': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M8 2a4 4 0 0 1 4 4c0 2.6.8 3.9 1.4 4.6H2.6C3.2 9.9 4 8.6 4 6a4 4 0 0 1 4-4z"/>
        <path {...p} d="M6.6 13a1.5 1.5 0 0 0 2.8 0"/>
      </svg>);
    case 'repeat': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M3 6.5a4 4 0 0 1 4-3.7h4.2M11.2 1l2 1.8-2 1.8"/>
        <path {...p} d="M13 9.5a4 4 0 0 1-4 3.7H4.8M4.8 15l-2-1.8 2-1.8"/>
      </svg>);
    case 'calendar': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <rect {...p} x="2" y="3" width="12" height="11" rx="1.6"/>
        <path {...p} d="M2 6.4h12M5.4 1.6v2.6M10.6 1.6v2.6"/>
      </svg>);
    case 'chevL': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M9.8 3.4L5.4 8l4.4 4.6"/>
      </svg>);
    case 'chevR': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M6.2 3.4L10.6 8l-4.4 4.6"/>
      </svg>);
    case 'close': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M4 4l8 8M12 4l-8 8"/>
      </svg>);
    case 'check': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M3 8.6l3.2 3.2L13 4.6"/>
      </svg>);
    case 'refresh': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M13.4 8A5.4 5.4 0 1 1 11.8 4.2"/>
        <path {...p} d="M13.6 1.6v3h-3"/>
      </svg>);
    case 'edit': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M10.8 2.6l2.6 2.6L5.6 13 2.6 13.4 3 10.4z"/>
        <path {...p} d="M9.4 4l2.6 2.6"/>
      </svg>);
    case 'eye': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M1.8 8s2.4-4.2 6.2-4.2S14.2 8 14.2 8s-2.4 4.2-6.2 4.2S1.8 8 1.8 8z"/>
        <circle {...p} cx="8" cy="8" r="1.8"/>
      </svg>);
    case 'split': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <rect {...p} x="1.8" y="2.6" width="12.4" height="10.8" rx="1.4"/>
        <path {...p} d="M8 2.6v10.8"/>
      </svg>);
    case 'markdown': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M5.2 4.8L2 8l3.2 3.2M10.8 4.8L14 8l-3.2 3.2"/>
      </svg>);
    case 'comment': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M2 3.6A1.6 1.6 0 0 1 3.6 2h8.8A1.6 1.6 0 0 1 14 3.6v6.2a1.6 1.6 0 0 1-1.6 1.6H8.4L5 14.2v-2.8H3.6A1.6 1.6 0 0 1 2 9.8z"/>
      </svg>);
    case 'zap': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M8.8 1.6L3.4 9h3.4L6 14.4 11.4 7H8z"/>
      </svg>);
    case 'warn': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M8 2.2l6.4 11H1.6z"/>
        <path {...p} d="M8 6.6v3.2M8 11.8h.01"/>
      </svg>);
    case 'upload': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M8 10.4V2.8M5 5.8l3-3 3 3"/>
        <path {...p} d="M2.5 10.8v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"/>
      </svg>);
    case 'alignL': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M2.8 2.2v11.6"/>
        <rect {...p} x="5" y="4" width="8.2" height="2.8" rx="0.8"/>
        <rect {...p} x="5" y="9.2" width="5" height="2.8" rx="0.8"/>
      </svg>);
    case 'alignCH': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M8 2.2v11.6"/>
        <rect {...p} x="3.6" y="4" width="8.8" height="2.8" rx="0.8"/>
        <rect {...p} x="5.4" y="9.2" width="5.2" height="2.8" rx="0.8"/>
      </svg>);
    case 'alignR': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M13.2 2.2v11.6"/>
        <rect {...p} x="2.8" y="4" width="8.2" height="2.8" rx="0.8"/>
        <rect {...p} x="6" y="9.2" width="5" height="2.8" rx="0.8"/>
      </svg>);
    case 'alignT': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M2.2 2.8h11.6"/>
        <rect {...p} x="4" y="5" width="2.8" height="8.2" rx="0.8"/>
        <rect {...p} x="9.2" y="5" width="2.8" height="5" rx="0.8"/>
      </svg>);
    case 'alignCV': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M2.2 8h11.6"/>
        <rect {...p} x="4" y="3.6" width="2.8" height="8.8" rx="0.8"/>
        <rect {...p} x="9.2" y="5.4" width="2.8" height="5.2" rx="0.8"/>
      </svg>);
    case 'alignB': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M2.2 13.2h11.6"/>
        <rect {...p} x="4" y="2.8" width="2.8" height="8.2" rx="0.8"/>
        <rect {...p} x="9.2" y="6" width="2.8" height="5" rx="0.8"/>
      </svg>);
    case 'distH': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M2.8 2.6v10.8M13.2 2.6v10.8"/>
        <rect {...p} x="6.2" y="5" width="3.6" height="6" rx="0.8"/>
      </svg>);
    case 'distV': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path {...p} d="M2.6 2.8h10.8M2.6 13.2h10.8"/>
        <rect {...p} x="5" y="6.2" width="6" height="3.6" rx="0.8"/>
      </svg>);
    case 'duplicate': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <rect {...p} x="5.6" y="5.6" width="7.8" height="7.8" rx="1.2"/>
        <path {...p} d="M2.6 10.4V3.9a1.3 1.3 0 0 1 1.3-1.3h6.5"/>
      </svg>);
    case 'front': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <rect {...p} x="5.6" y="2.6" width="7.8" height="7.8" rx="1"/>
        <path {...p} d="M2.6 6.6v5.8a1 1 0 0 0 1 1h5.8"/>
      </svg>);
    case 'back': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <rect {...p} x="2.6" y="5.6" width="7.8" height="7.8" rx="1"/>
        <path {...p} d="M6.6 2.6h5.8a1 1 0 0 1 1 1v5.8"/>
      </svg>);
    case 'noColor': return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <circle {...p} cx="8" cy="8" r="5.6"/>
        <path {...p} d="M4.2 11.8l7.6-7.6"/>
      </svg>);
    default: return null;
  }
}

// True when the note's body carries a real ```edinot-canvas fence (not just
// an embed reference) — drives the canvas icon + badge in the tree.
const VM_CANVAS_RX = /^[ \t]*```edinot-canvas[ \t]*$/m;
// Cacheado por string de contenido: el selector y la búsqueda lo llaman por
// fila en cada render, y la regex recorre el cuerpo entero de la nota.
const _vmCanvasCache = new Map();
function vmIsCanvasNote(file) {
  const text = file && file.content;
  if (!text) return false;
  const id = file.id;
  const hit = id != null ? _vmCanvasCache.get(id) : null;
  if (hit && hit.text === text) return hit.val;
  const val = VM_CANVAS_RX.test(text);
  if (id != null) _vmCanvasCache.set(id, { text, val });
  return val;
}

// Compact relative timestamp for row metadata ("hace 2 h"). Falls back to a
// locale date past 30 days. Returns null when the note was never opened.
export function vmRelTime(ts) {
  if (!ts) return null;
  const d = Date.now() - ts;
  if (d < 60e3) return t('time.now');
  if (d < 3600e3) return t('time.min', { n: Math.floor(d / 60e3) });
  if (d < 86400e3) return t('time.h', { n: Math.floor(d / 3600e3) });
  if (d < 2 * 86400e3) return t('time.yesterday');
  if (d < 30 * 86400e3) return t('time.d', { n: Math.floor(d / 86400e3) });
  return new Date(ts).toLocaleDateString();
}

// "Vault › Carpeta › Sub" location line for search hits / recents.
function vmBreadcrumb(file, folders, vaults, showVault) {
  const parts = [];
  let fid = file.folderId || null;
  for (let guard = 0; fid && guard < 20; guard++) {
    const fd = folders.find(f => f.id === fid);
    if (!fd) break;
    parts.unshift(fd.name);
    fid = fd.parentId || null;
  }
  if (showVault) {
    const v = vaults.find(v => v.id === (file.vaultId || 'default'));
    if (v) parts.unshift(v.name);
  }
  return parts.join(' › ');
}

// Subsequence fuzzy match of `q` inside `s` (both accent-folded, lowercase).
// Greedy left-to-right with word-boundary + consecutive-run bonuses — enough
// for a quick switcher. Returns { score, positions } or null on miss.
function vmFuzzyMatch(s, q) {
  const positions = [];
  let score = 0, si = 0, prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    if (c === ' ') continue; // spaces act as free separators
    let found = -1;
    for (let i = si; i < s.length; i++) { if (s[i] === c) { found = i; break; } }
    if (found < 0) return null;
    const boundary = found === 0 || /[\s\-_./(){}[\]]/.test(s[found - 1]);
    score += boundary ? 8 : (found === prev + 1 ? 6 : 1);
    positions.push(found);
    prev = found; si = found + 1;
  }
  if (!positions.length) return null;
  // Density bonus: tight spans beat scattered letters.
  const span = positions[positions.length - 1] - positions[0] + 1;
  score += Math.max(0, 12 - (span - positions.length));
  return { score, positions };
}

// Rank a query against a note name. Exact > prefix > word-boundary substring
// > substring > fuzzy subsequence.
function vmScoreName(nameFolded, qFolded) {
  if (nameFolded === qFolded) return { kind: 'exact', score: 1000 };
  const idx = nameFolded.indexOf(qFolded);
  if (idx === 0) return { kind: 'prefix', score: 820 };
  if (idx > 0) {
    const boundary = /[\s\-_./]/.test(nameFolded[idx - 1]);
    return { kind: 'substr', score: boundary ? 740 : 640 };
  }
  const fz = vmFuzzyMatch(nameFolded, qFolded);
  if (fz) return { kind: 'fuzzy', score: 240 + Math.min(fz.score * 4, 320), positions: fz.positions };
  return null;
}

// First content occurrence → occurrence count + one-line snippet around the
// hit. Reuses the global-search fold cache (searchableContent + accent fold
// are cached per note body, so per-keystroke cost stays flat).
const VM_SNIPPET_CONTEXT = 46;
function vmContentHit(file, qFolded) {
  const text = file.content || '';
  if (!text) return null;
  const { folded, map } = gsFoldedSearchable(file);
  const first = folded.indexOf(qFolded);
  if (first < 0) return null;
  let count = 0, from = first;
  while (from >= 0 && count < 50) { count++; from = folded.indexOf(qFolded, from + qFolded.length); }
  const orig = map[first];
  const origEnd = map[first + qFolded.length];
  const lineStart = text.lastIndexOf('\n', orig - 1) + 1;
  let lineEnd = text.indexOf('\n', orig);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  const li = orig - lineStart, le = origEnd - lineStart;
  return {
    count,
    snippet: {
      before: line.slice(Math.max(0, li - VM_SNIPPET_CONTEXT), li).trimStart(),
      match: line.slice(li, le),
      after: line.slice(le, le + VM_SNIPPET_CONTEXT),
      truncatedLeft: li > VM_SNIPPET_CONTEXT,
      truncatedRight: le + VM_SNIPPET_CONTEXT < line.length,
    },
  };
}

// Highlight the characters a fuzzy match landed on. Positions come in
// folded-string coords; translate back through the fold map so accented
// names render intact.
function vmFuzzyFrag(base, positions) {
  const { map } = gsFoldWithMap(base.toLowerCase());
  const marked = new Set(positions.map(p => map[p]));
  const out = [];
  let run = '', runMarked = null;
  const flush = () => {
    if (!run) return;
    out.push(runMarked ? <mark key={out.length}>{run}</mark> : run);
    run = '';
  };
  for (let i = 0; i < base.length; i++) {
    const m = marked.has(i);
    if (m !== runMarked) { flush(); runMarked = m; }
    run += base[i];
  }
  flush();
  return out;
}

// Fallback estable para fileStats: un `{}` nuevo en cada render invalidaba
// los memos de búsqueda que dependen de él.
const EMPTY_FILE_STATS = Object.freeze({});

// Ranked quick-switcher results: name matches (exact/prefix/substring/fuzzy)
// plus content-only hits, weighted by open frequency + recency (same signals
// the global search uses).
const VM_MAX_RESULTS = 50;
// Nombre sin extensión + plegado de acentos, cacheado por (id, nombre): el
// selector lo necesitaba para cada nota en cada pulsación (NFD normalize).
const _vmNameCache = new Map();
function vmNameInfo(f) {
  const name = f.name || '';
  const hit = _vmNameCache.get(f.id);
  if (hit && hit.name === name) return hit;
  const base = name.replace(/\.(md|markdown|txt)$/i, '');
  const info = { name, base, folded: gsFold(base.toLowerCase()) };
  _vmNameCache.set(f.id, info);
  return info;
}
function buildViewMenuResults(files, folders, vaults, query, fileStats, { scopeVaultId, showVault, namesOnly } = {}) {
  const qFolded = gsFold(query.trim().toLowerCase());
  if (!qFolded) return [];
  const now = Date.now();
  const RECENCY_MS = 30 * 24 * 60 * 60 * 1000;
  const out = [];
  for (const f of files) {
    if (scopeVaultId && (f.vaultId || 'default') !== scopeVaultId) continue;
    if (isTemplateFile(f, folders)) continue; // templates live in their own panel
    const { base, folded: nameFolded } = vmNameInfo(f);
    const nm = vmScoreName(nameFolded, qFolded);
    // 1 carácter: sólo nombres (en contenido coincidiría casi todo).
    // namesOnly: Ctrl K ya busca el contenido aparte (buildGlobalSearchResults).
    const content = nm || namesOnly || qFolded.length < 2 ? null : vmContentHit(f, qFolded);
    if (!nm && !content) continue;
    const st = fileStats[f.id] || {};
    const rec = st.t ? Math.max(0, 1 - (now - st.t) / RECENCY_MS) : 0;
    const score = (nm ? nm.score : 40 + Math.min(content.count, 10) * 8)
      + Math.log((st.c || 0) + 1) * 6 + rec * 30;
    out.push({ file: f, base, nameMatch: nm, snippet: content ? content.snippet : null, score, lastOpened: st.t || 0 });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, VM_MAX_RESULTS).map(h => ({
    ...h,
    crumb: vmBreadcrumb(h.file, folders, vaults, showVault),
  }));
}


// Resolve `@hoy` / `@today` / `@mañana` / `@tomorrow` / `@ayer` / `@yesterday`
// shortcuts in render-mode markdown to actual dates. Respects code fences
// (``` blocks) and inline code (`...`) so technical content stays untouched.
// Tokens must be standalone (preceded by whitespace/start, followed by
// whitespace/punctuation/end) to avoid clobbering emails like a@b.com or @hojita.
const DATE_SHORTCUTS = {
  '@today': () => new Date().toISOString().slice(0, 10),
  '@hoy':   () => new Date().toISOString().slice(0, 10),
  '@tomorrow': () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); },
  '@mañana':   () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); },
  '@manana':   () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); },
  '@yesterday': () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); },
  '@ayer':      () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); },
};
export function resolveDateShortcuts(src) {
  if (!src) return '';
  // Split on fenced code blocks (``` ... ```) keeping them as-is; process
  // each non-code segment for inline `...` spans similarly.
  const fenceRe = /```[\s\S]*?```/g;
  const out = [];
  let last = 0;
  let m;
  while ((m = fenceRe.exec(src)) !== null) {
    out.push(processSegment(src.slice(last, m.index)));
    out.push(m[0]);
    last = m.index + m[0].length;
  }
  out.push(processSegment(src.slice(last)));
  return out.join('');
  function processSegment(seg) {
    const inlineRe = /`[^`\n]*`/g;
    const parts = [];
    let pLast = 0;
    let pm;
    while ((pm = inlineRe.exec(seg)) !== null) {
      parts.push(substituteShortcuts(seg.slice(pLast, pm.index)));
      parts.push(pm[0]);
      pLast = pm.index + pm[0].length;
    }
    parts.push(substituteShortcuts(seg.slice(pLast)));
    return parts.join('');
  }
  function substituteShortcuts(text) {
    // Match @token bounded by start-of-string/whitespace on the left and
    // word-end (non word char or EOS) on the right. Token chars include ñ.
    return text.replace(/(^|[^\w@ñ])(@(?:today|hoy|tomorrow|mañana|manana|yesterday|ayer))(?=[^a-zA-Z0-9_ñ]|$)/giu, (full, pre, tok) => {
      const key = tok.toLowerCase();
      const fn = DATE_SHORTCUTS[key];
      return fn ? pre + fn() : full;
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Canvas — visual board stored as a fenced ```edinot-canvas``` block
// inside a regular markdown note. The block contains JSON with nodes,
// edges and groups. Two render modes:
//   - "Primary canvas": note whose body is essentially the canvas block →
//     entire render-pane is replaced by the CanvasView component.
//   - "Inline canvas" (v4): note with normal markdown plus a canvas block
//     somewhere in the middle → block is replaced in-place with a smaller
//     embedded CanvasView. (Not wired yet — placeholder for later.)
// Storage is fenced-markdown so sync, MCP and CLI keep working with the
// existing primitives; we never invent a new file format.
// ─────────────────────────────────────────────────────────────
const CANVAS_FENCE_RE = /^[ \t]*```edinot-canvas[ \t]*$/;
const __holdsCanvasCache = new WeakMap(); // file object → boolean
function holdsCanvasBlock(f) {
  if (!f) return false;
  let v = __holdsCanvasCache.get(f);
  if (v === undefined) {
    const c = f.content || '';
    v = c.indexOf('edinot-canvas') >= 0 && (CANVAS_FENCE_RE.test(c) || /```edinot-canvas\b/m.test(c));
    __holdsCanvasCache.set(f, v);
  }
  return v;
}

// Canvas co-edición (Fase 1): structured Yjs model as the source of truth,
// with the fenced block kept as a deterministic derived mirror. Enabled by
// default now that migration + mirror + MCP redirect are in place. Opening a
// canvas migrates it once (idempotent, lossless). Disable with:
//   localStorage.setItem('edinot.canvasStructured','0')  + reload.
const CANVAS_STRUCTURED = (() => {
  try { return localStorage.getItem('edinot.canvasStructured') !== '0'; } catch { return true; }
})();

// Find every canvas block in the source. Returns array of
// `{ json, startLine, endLine }` (line indices include the fences). The
// JSON parse is lenient: malformed JSON returns `{ nodes: [], edges: [], groups: [] }`
// so the user sees an empty canvas rather than a crash.
function parseCanvasBlocks(src) {
  const lines = String(src || '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (CANVAS_FENCE_RE.test(lines[i])) {
      const startLine = i;
      let endLine = -1;
      const buf = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^[ \t]*```\s*$/.test(lines[j])) { endLine = j; break; }
        buf.push(lines[j]);
      }
      if (endLine < 0) { i++; continue; }
      let json = { nodes: [], edges: [], groups: [] };
      const text = buf.join('\n').trim();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object') {
            json = {
              nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
              edges: Array.isArray(parsed.edges) ? parsed.edges : [],
              groups: Array.isArray(parsed.groups) ? parsed.groups : [],
            };
          }
        } catch { /* keep empty json so UI shows clean canvas */ }
      }
      out.push({ json, startLine, endLine });
      i = endLine + 1;
    } else {
      i++;
    }
  }
  return out;
}

export function firstCanvasBlock(src) {
  const blocks = parseCanvasBlocks(src);
  return blocks.length ? blocks[0] : null;
}

// True when the note's primary content is the canvas — everything else is
// just whitespace or leading headings. Drives the "fullscreen canvas"
// render mode.
function isPrimaryCanvasNote(src) {
  const blocks = parseCanvasBlocks(src);
  if (!blocks.length) return false;
  const b = blocks[0];
  const lines = String(src || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i >= b.startLine && i <= b.endLine) continue;
    const l = lines[i].trim();
    if (!l) continue;
    if (/^#{1,6}\s/.test(l)) continue; // heading is fine
    return false;
  }
  return true;
}

// ── Página ↔ Canvas ─────────────────────────────────────────────────────
// La elección de modo de cada nota, local a este equipo.
const SURFACE_KEY = 'edinot.surface';
function readSurfaceChoices() {
  try { const o = JSON.parse(localStorage.getItem(SURFACE_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
function writeSurfaceChoices(o) {
  try { localStorage.setItem(SURFACE_KEY, JSON.stringify(o)); } catch {}
}
// 'canvas' | 'page'. Sin elección: los canvas de siempre (la nota es solo su
// tablero) abren en Canvas; el resto, en Página.
export function surfaceOfNote(note, choices) {
  if (!note) return 'page';
  const c = choices && choices[note.id];
  if (c === 'canvas' || c === 'page') return c;
  return isPrimaryCanvasNote(note.content) ? 'canvas' : 'page';
}

// Write a new JSON payload into an existing block (replacing its body) or
// append a brand-new block at end of source if `block` is null. Pretty-prints
// with 2-space indent so the markdown is readable when the user pops into
// raw mode.
function writeCanvasBlock(src, json, block) {
  const text = JSON.stringify(json, null, 2);
  const lines = String(src || '').split('\n');
  if (block) {
    const before = lines.slice(0, block.startLine + 1);
    const after = lines.slice(block.endLine);
    return [...before, ...text.split('\n'), ...after].join('\n');
  }
  // append
  const suffix = src && !src.endsWith('\n') ? '\n' : '';
  return src + suffix + '\n```edinot-canvas\n' + text + '\n```\n';
}

// ─────────────────────────────────────────────────────────────
// Forms — a ```edinot-form``` fenced block carries a small JSON config and,
// in render mode, becomes an inline form whose fields are auto-derived from a
// target table's columns. Submitting appends a row to that table. Mirrors the
// canvas block plumbing (parse → mount React in the render effect).
// ─────────────────────────────────────────────────────────────
const FORM_FENCE_RE = /^[ \t]*```edinot-form[ \t]*$/;
function parseFormBlocks(src) {
  const lines = String(src || '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (FORM_FENCE_RE.test(lines[i])) {
      const startLine = i;
      let endLine = -1;
      const buf = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^[ \t]*```\s*$/.test(lines[j])) { endLine = j; break; }
        buf.push(lines[j]);
      }
      if (endLine < 0) { i++; continue; }
      let json = {};
      const text = buf.join('\n').trim();
      if (text) {
        try { const p = JSON.parse(text); if (p && typeof p === 'object') json = p; }
        catch { /* keep empty config so the form still derives from the table */ }
      }
      out.push({ json, startLine, endLine });
      i = endLine + 1;
    } else {
      i++;
    }
  }
  return out;
}

// Insert a ```edinot-form``` block into `src`, anchored just above the table
// at `anchorTableIdx` (above its view directive if it has one). `cfg` is the
// form config object written into the block (defaults to targeting the anchor
// table). For cross-note forms `cfg` carries a `note` id so responses land in
// another note while the form lives here.
function insertFormBlockBeforeTable(src, anchorTableIdx, cfg) {
  const tables = parseSourceTables(src);
  const t = tables[anchorTableIdx];
  const lines = String(src || '').split('\n');
  const anchor = t ? (t.dirLineIdx >= 0 ? t.dirLineIdx : t.startLine) : lines.length;
  const json = cfg || { table: anchorTableIdx };
  const block = ['```edinot-form', JSON.stringify(json), '```', ''];
  lines.splice(anchor, 0, ...block);
  return lines.join('\n');
}

// Replace the JSON config of the Nth ```edinot-form``` block in `src`.
// Used by the visual form builder to persist edits without the user touching
// the fenced block by hand.
function writeFormBlockConfig(src, blockIdx, cfg) {
  const blocks = parseFormBlocks(src);
  const b = blocks[blockIdx];
  if (!b) return src;
  const lines = String(src || '').split('\n');
  lines.splice(b.startLine + 1, b.endLine - b.startLine - 1, JSON.stringify(cfg));
  return lines.join('\n');
}

// Resolve which table a form writes into within a SINGLE source: explicit
// 0-based `table` index, else the nearest table below the block, else the
// first table. Returns { table, tableIdx } or null when there are no tables.
function resolveFormTargetTable(src, formBlock, cfg) {
  const tables = parseSourceTables(src);
  if (!tables.length) return null;
  if (cfg && Number.isFinite(cfg.table) && tables[cfg.table]) {
    return { table: tables[cfg.table], tableIdx: cfg.table };
  }
  if (formBlock) {
    for (let k = 0; k < tables.length; k++) {
      if (tables[k].startLine > formBlock.endLine) return { table: tables[k], tableIdx: k };
    }
  }
  return { table: tables[0], tableIdx: 0 };
}

// Resolve a form's target table, which may live in ANOTHER note (cfg.note =
// note id or name). Returns { noteId, src, table, tableIdx } or null. When
// cfg.note is absent the target is the active note. The nearest-table-below
// rule only applies within the active note (a cross-note target uses
// cfg.table or the first table).
function resolveFormTarget(cfg, formBlock, activeId, activeSrc, files) {
  let noteId = activeId;
  let src = activeSrc;
  let local = true;
  if (cfg && cfg.note) {
    const want = String(cfg.note);
    const wantNorm = normalizeNoteName(want.replace(/\.(md|markdown|txt)$/i, ''));
    const hit = (files || []).find(f => f.id === want)
      || (files || []).find(f => normalizeNoteName((f.name || '').replace(/\.(md|markdown|txt)$/i, '')) === wantNorm);
    if (!hit) return null;
    noteId = hit.id;
    src = hit.content || '';
    local = false;
  }
  const r = resolveFormTargetTable(src, local ? formBlock : null, cfg);
  if (!r) return null;
  return { noteId, src, table: r.table, tableIdx: r.tableIdx, local };
}

// ─────────────────────────────────────────────────────────────
// Templates — notes living inside a top-level "Plantillas" folder per
// vault. Filtered out of the main note tree; surface only via the
// collapsible Templates panel and the MCP. Variable syntax in body:
//   {{var}}              — required placeholder
//   {{var|default}}      — placeholder with default value
//   {{date}} / {{time}}  — auto-resolved built-ins (ISO date, HH:MM)
//   {{vault}}            — current vault name
//   {{cursor}}           — caret target marker, stripped on apply
// ─────────────────────────────────────────────────────────────
const TEMPLATES_FOLDER_NAMES = new Set(['Plantillas', 'Templates']);
function templatesFolderNameForLang() {
  const L = pickSeedLang();
  return L === 'en' ? 'Templates' : 'Plantillas';
}
// Names auto-resolved on apply (never asked from user).
const TEMPLATE_BUILTIN_NAMES = new Set([
  'date', 'time', 'datetime', 'year', 'month', 'day', 'weekday', 'week',
  'tomorrow', 'yesterday',
  'user', 'email', 'vault', 'folder', 'folderpath',
  'uuid', 'shortid', 'template', 'notecount',
  'clipboard', 'selection', 'cursor',
]);
const TEMPLATE_BUILTIN_PREFIXES = ['date+', 'date-', 'date:', 'datetime:', 'counter:', 'choice:', 'upper:', 'lower:', 'cap:', 'slug:'];
const TEMPLATE_TRANSFORMS = new Set(['upper', 'lower', 'cap', 'slug']);
// Generators expand to multi-line markdown blocks (tables / dashboards).
const TEMPLATE_GENERATORS = new Set([
  'table', 'kanbantable', 'checktable', 'tareastable',
  'datetable', 'weekdaystable', 'monthstable', 'daterange',
  'tasksopen', 'notesindex', 'tableof', 'csvclipboard',
]);
function isBuiltinVar(name) {
  if (!name) return false;
  if (TEMPLATE_BUILTIN_NAMES.has(name)) return true;
  if (TEMPLATE_GENERATORS.has(name)) return true;
  for (const p of TEMPLATE_BUILTIN_PREFIXES) if (name.startsWith(p)) return true;
  // date+N / date-N parametric form (e.g. date+7) is also a built-in.
  if (/^date[+-]\d+$/.test(name)) return true;
  return false;
}

function isRootTemplateFolder(folder) {
  return !!folder && !folder.parentId && TEMPLATES_FOLDER_NAMES.has(folder.name);
}
// Set de ids de carpeta que cuelgan de una carpeta de plantillas, calculado
// una vez por array `folders` (los memos lo mantienen estable). Antes cada
// llamada subía por la cadena de padres con folders.find: O(notas × carpetas
// × profundidad) en cada render del selector o la barra lateral.
const _tplFolderSets = new WeakMap();
function templateFolderIds(folders) {
  let set = _tplFolderSets.get(folders);
  if (set) return set;
  const byId = new Map();
  for (const f of folders) if (f) byId.set(f.id, f);
  set = new Set();
  for (const f of folders) {
    if (!f) continue;
    const seen = new Set();
    let cur = f;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (isRootTemplateFolder(cur)) { set.add(f.id); break; }
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
  }
  _tplFolderSets.set(folders, set);
  return set;
}
function isTemplateFile(file, folders) {
  if (!file || !file.folderId || !Array.isArray(folders)) return false;
  return templateFolderIds(folders).has(file.folderId);
}
const TPL_VAR_RE = /\{\{\s*([a-zA-Z_][\w-]*(?:[+\-]\d+)?)(?:\s*[:|]\s*([\s\S]*?))?\s*\}\}/g;
function parseTemplateVars(text) {
  // Returns ordered list of user-fillable vars: { name, default, choices? }.
  // `{{var|opt1/opt2/opt3}}` or `{{var:choice=opt1|opt2}}` exposes a `choices`
  // array so the apply modal can render a <select> instead of a free input.
  const out = [];
  const seen = new Set();
  const src = String(text || '');
  let m;
  TPL_VAR_RE.lastIndex = 0;
  while ((m = TPL_VAR_RE.exec(src)) !== null) {
    const name = m[1];
    if (isBuiltinVar(name) || seen.has(name)) continue;
    seen.add(name);
    const raw = (m[2] || '').trim();
    let choices = null;
    let defaultVal = raw;
    const choiceKv = raw.match(/^choice\s*=\s*(.+)$/i);
    if (choiceKv) {
      choices = choiceKv[1].split('|').map(s => s.trim()).filter(Boolean);
      defaultVal = choices[0] || '';
    } else if (raw.includes('/') && !raw.includes(' ')) {
      // Heuristic: `opt1/opt2/opt3` (no spaces) is treated as a slash-choice.
      // Spaces opt the user out (treated as plain default).
      const parts = raw.split('/').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) { choices = parts; defaultVal = parts[0]; }
    }
    out.push({ name, default: defaultVal, choices });
  }
  return out;
}

const TPL_WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const TPL_WEEKDAYS_ES_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const TPL_MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TPL_MONTHS_ES_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function tplPad(n, w = 2) { return String(n).padStart(w, '0'); }
function tplIsoWeek(d) {
  const tgt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (tgt.getUTCDay() + 6) % 7;
  tgt.setUTCDate(tgt.getUTCDate() - dayNr + 3);
  const firstThu = new Date(Date.UTC(tgt.getUTCFullYear(), 0, 4));
  const diff = (tgt - firstThu) / 86400000;
  return 1 + Math.round((diff - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}
function tplFormatDate(d, fmt) {
  if (!fmt) return d.toISOString().slice(0, 10);
  return String(fmt)
    .replace(/YYYY/g, d.getFullYear())
    .replace(/YY/g, String(d.getFullYear()).slice(-2))
    .replace(/MMMM/g, TPL_MONTHS_ES[d.getMonth()])
    .replace(/MMM/g, TPL_MONTHS_ES_SHORT[d.getMonth()])
    .replace(/MM/g, tplPad(d.getMonth() + 1))
    .replace(/(?<![A-Za-z])M(?![A-Za-z])/g, String(d.getMonth() + 1))
    .replace(/DDDD/g, TPL_WEEKDAYS_ES[d.getDay()])
    .replace(/DDD/g, TPL_WEEKDAYS_ES_SHORT[d.getDay()])
    .replace(/DD/g, tplPad(d.getDate()))
    .replace(/(?<![A-Za-z])D(?![A-Za-z])/g, String(d.getDate()))
    .replace(/HH/g, tplPad(d.getHours()))
    .replace(/mm/g, tplPad(d.getMinutes()))
    .replace(/ss/g, tplPad(d.getSeconds()))
    .replace(/dddd/g, TPL_WEEKDAYS_ES[d.getDay()])
    .replace(/ddd/g, TPL_WEEKDAYS_ES_SHORT[d.getDay()]);
}
function tplOffsetDays(base, n) {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + n);
  return d;
}
function tplParseKv(args) {
  const out = {};
  if (!args) return out;
  for (const p of String(args).split(':')) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    out[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
  }
  return out;
}
function tplCols(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean); }
function tplTable(cols, rowsContent = []) {
  if (!cols.length) return '';
  const header = `| ${cols.join(' | ')} |`;
  const sep = `|${cols.map(() => '-------').join('|')}|`;
  const rows = rowsContent.length
    ? rowsContent.map(r => `| ${cols.map((_, i) => (r[i] != null ? String(r[i]) : '')).join(' | ')} |`)
    : [`| ${cols.map(() => ' ').join(' | ')} |`];
  return [header, sep, ...rows].join('\n');
}
function tplKanbanTable(cols, order) {
  const orderEnc = order.map(s => encodeURIComponent(s)).join(',');
  const widths = cols.map(c => `${encodeURIComponent(c)}=${c === cols[0] ? 341 : 138}`).join(',');
  const statusCol = cols[cols.length - 1];
  const comment = `<!-- edinot:view=kanban:by=${encodeURIComponent(statusCol)}:order=${orderEnc}:widths=${widths} -->`;
  return `${comment}\n${tplTable(cols)}`;
}
function tplGenerator(name, args, ctx) {
  const kv = tplParseKv(args);
  const now = (ctx && ctx.now) || new Date();
  if (name === 'table') {
    const cols = tplCols(kv.cols || 'Columna 1,Columna 2');
    const n = Math.max(1, Number(kv.rows) || 1);
    return tplTable(cols, Array.from({ length: n }, () => cols.map(() => '')));
  }
  if (name === 'kanbantable') {
    const cols = tplCols(kv.cols || 'Descripción,Prioridad,Estado');
    const order = tplCols(kv.order || 'Pendiente,En revisión,Completado');
    return tplKanbanTable(cols, order);
  }
  if (name === 'checktable') {
    const cols = tplCols(kv.cols || 'Tarea');
    const row = cols.map((_, i) => i === 0 ? '- [ ] ' : '');
    return tplTable(cols, [row]);
  }
  if (name === 'tareastable') {
    return tplKanbanTable(['Descripción', 'Prioridad', 'Estado'], ['Pendiente', 'En revisión', 'Completado']);
  }
  if (name === 'datetable') {
    const segs = String(args || '').split(':');
    let n = Number(kv.n || kv.N);
    if (!n) for (const s of segs) { const v = Number(s); if (v) { n = v; break; } }
    n = Math.max(1, n || 7);
    const cols = tplCols(kv.cols || 'Fecha,Notas');
    const rows = Array.from({ length: n }, (_, i) => {
      const d = tplOffsetDays(now, i);
      return [tplFormatDate(d, 'YYYY-MM-DD'), ''].slice(0, cols.length);
    });
    return tplTable(cols, rows);
  }
  if (name === 'weekdaystable') {
    const cols = tplCols(kv.cols || 'Día,Plan');
    const rows = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
      .map(d => [d, ''].slice(0, cols.length));
    return tplTable(cols, rows);
  }
  if (name === 'monthstable') {
    const cols = tplCols(kv.cols || 'Mes,Objetivo');
    const rows = TPL_MONTHS_ES.map(m => [m, ''].slice(0, cols.length));
    return tplTable(cols, rows);
  }
  if (name === 'daterange') {
    const start = kv.start ? new Date(kv.start) : now;
    const end = kv.end ? new Date(kv.end) : tplOffsetDays(now, 6);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
    const cols = tplCols(kv.cols || 'Día,Notas');
    const rows = [];
    for (let d = new Date(start); d <= end && rows.length < 366; d = tplOffsetDays(d, 1)) {
      rows.push([tplFormatDate(d, 'YYYY-MM-DD'), ''].slice(0, cols.length));
    }
    return tplTable(cols, rows);
  }
  // Dashboards — need ctx.notes (array of { name, content, vaultId, folderPath }).
  // When notes are unavailable (e.g. CLI without session) we degrade to an empty marker.
  if (name === 'tasksopen') {
    const notes = (ctx && ctx.notes) || [];
    const vaultFilter = kv.vault || ctx.vaultName || '';
    const statusFilter = (kv.status || 'Pendiente,En revisión').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const rows = [];
    for (const n of notes) {
      if (vaultFilter && (n.vaultName || '') !== vaultFilter && (n.vaultId || '') !== vaultFilter) continue;
      const parsed = tplParseMarkdownTables(n.content || '');
      for (const t of parsed) {
        const estIdx = t.headers.findIndex(h => h.toLowerCase() === 'estado');
        const descIdx = t.headers.findIndex(h => /descripci|tarea/i.test(h));
        const prIdx = t.headers.findIndex(h => /prio/i.test(h));
        if (estIdx < 0 || descIdx < 0) continue;
        for (const r of t.rows) {
          const est = (r[estIdx] || '').trim();
          if (!statusFilter.includes(est.toLowerCase())) continue;
          rows.push([
            (r[descIdx] || '').trim(),
            prIdx >= 0 ? (r[prIdx] || '').trim() : '',
            est,
            n.name.replace(/\.(md|markdown|txt)$/i, ''),
          ]);
        }
      }
    }
    const cols = ['Descripción', 'Prioridad', 'Estado', 'Nota'];
    return rows.length ? tplTable(cols, rows) : tplTable(cols, [['(sin tareas pendientes)', '', '', '']]);
  }
  if (name === 'notesindex') {
    const notes = (ctx && ctx.notes) || [];
    const folderFilter = (kv.folder || '').trim();
    const vaultFilter = kv.vault || ctx.vaultName || '';
    const cols = tplCols(kv.cols || 'Nota,Vault,Carpeta');
    const rows = [];
    for (const n of notes) {
      if (vaultFilter && (n.vaultName || '') !== vaultFilter && (n.vaultId || '') !== vaultFilter) continue;
      if (folderFilter && !(n.folderPath || '').startsWith(folderFilter)) continue;
      rows.push([
        n.name.replace(/\.(md|markdown|txt)$/i, ''),
        n.vaultName || '',
        n.folderPath || '',
      ].slice(0, cols.length));
    }
    return rows.length ? tplTable(cols, rows) : tplTable(cols);
  }
  if (name === 'tableof') {
    // tableof:NoteName:column=X[:filter=Y]
    const segs = String(args || '').split(':');
    const noteName = segs[0] || '';
    const colFilter = (kv.column || '').trim();
    const valueFilter = (kv.filter || '').trim().toLowerCase();
    const notes = (ctx && ctx.notes) || [];
    const target = notes.find(n => (n.name || '').toLowerCase().replace(/\.md$/, '') === noteName.toLowerCase().replace(/\.md$/, ''));
    if (!target) return '';
    const parsed = tplParseMarkdownTables(target.content || '');
    if (!parsed.length) return '';
    const t = parsed[0];
    const keep = colFilter
      ? t.headers.map((h, i) => h.toLowerCase().includes(colFilter.toLowerCase()) ? i : -1).filter(i => i >= 0)
      : t.headers.map((_, i) => i);
    const filterIdx = valueFilter ? t.headers.findIndex(h => h.toLowerCase() === (kv.filterColumn || 'estado').toLowerCase()) : -1;
    const rows = t.rows
      .filter(r => filterIdx < 0 || (r[filterIdx] || '').toLowerCase().includes(valueFilter))
      .map(r => keep.map(i => r[i] || ''));
    return tplTable(keep.map(i => t.headers[i]), rows);
  }
  if (name === 'csvclipboard') {
    const csv = (ctx && ctx.clipboard) || '';
    if (!csv.trim()) return '';
    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const parsed = lines.map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
    const headers = parsed[0] || ['Columna'];
    const rows = parsed.slice(1);
    return tplTable(headers, rows);
  }
  return '';
}

// Minimal markdown table parser — used by dashboard generators. Recognises
// pipe-table blocks: header row, separator row (---), data rows. Skips
// anything that doesn't match. Returns array of { headers, rows }.
function tplParseMarkdownTables(text) {
  // Splits a row on unescaped `|` and unescapes `\|` back to `|`. Centralises
  // the pipe-escape quirk so cells survive their own literal `|` characters.
  const splitRow = (s) => String(s).split(/(?<!\\)\|/).slice(1, -1).map(x => x.trim().replace(/\\\|/g, '|'));
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const sepLine = (lines[i + 1] || '').trim();
    if (!/^\|[\s\-:|]+\|$/.test(sepLine)) continue;
    const headers = splitRow(line);
    const rows = [];
    for (let j = i + 2; j < lines.length; j++) {
      const r = lines[j].trim();
      if (!r.startsWith('|')) break;
      rows.push(splitRow(r));
    }
    out.push({ headers, rows });
    i += rows.length + 1;
  }
  return out;
}

function tplApplyTransform(name, args, vars, ctx) {
  // Look up the referenced variable: user-supplied → ctx-builtin → empty.
  const ref = String(args || '').trim();
  let val = (vars && vars[ref]) != null ? vars[ref] : null;
  if (val == null) {
    const built = tplResolveBuiltin(ref, '', ctx);
    if (built !== undefined) val = built;
  }
  if (val == null) return '';
  const s = String(val);
  if (name === 'upper') return s.toUpperCase();
  if (name === 'lower') return s.toLowerCase();
  if (name === 'cap') return s.replace(/\b\p{L}/gu, c => c.toUpperCase());
  if (name === 'slug') return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s;
}
function tplResolveBuiltin(name, args, ctx) {
  const now = (ctx && ctx.now) || new Date();
  if (name === 'cursor') return ' CURSOR_MARKER ';
  if (name === 'date') return args ? tplFormatDate(now, args) : tplFormatDate(now, 'YYYY-MM-DD');
  if (name === 'datetime') return args ? tplFormatDate(now, args) : tplFormatDate(now, 'YYYY-MM-DD HH:mm');
  if (name === 'time') return tplFormatDate(now, 'HH:mm');
  if (name === 'year') return String(now.getFullYear());
  if (name === 'month') return TPL_MONTHS_ES[now.getMonth()];
  if (name === 'day') return tplPad(now.getDate());
  if (name === 'weekday') return TPL_WEEKDAYS_ES[now.getDay()];
  if (name === 'week') return String(tplIsoWeek(now));
  if (name === 'tomorrow') return tplFormatDate(tplOffsetDays(now, 1), 'YYYY-MM-DD');
  if (name === 'yesterday') return tplFormatDate(tplOffsetDays(now, -1), 'YYYY-MM-DD');
  const off = name.match(/^date([+-])(\d+)$/);
  if (off) {
    const n = (off[1] === '+' ? 1 : -1) * Number(off[2]);
    const d = tplOffsetDays(now, n);
    return args ? tplFormatDate(d, args) : tplFormatDate(d, 'YYYY-MM-DD');
  }
  if (name === 'user') return ctx.userName || ctx.userEmail || '';
  if (name === 'email') return ctx.userEmail || '';
  if (name === 'vault') return ctx.vaultName || '';
  if (name === 'folder') return ctx.folderName || '';
  if (name === 'folderpath') return ctx.folderPath || '';
  if (name === 'template') return ctx.templateName || '';
  if (name === 'notecount') return String(ctx.noteCount != null ? ctx.noteCount : '');
  if (name === 'uuid') {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  if (name === 'shortid') return Math.random().toString(36).slice(2, 10);
  if (name === 'clipboard') return ctx.clipboard || '';
  if (name === 'selection') return ctx.selection || '';
  if (name === 'counter') {
    const key = String(args || 'default');
    const map = ctx.counters || {};
    const cur = (map[key] || 0) + 1;
    map[key] = cur;
    if (ctx.counters !== map) ctx.counters = map;
    return tplPad(cur, 4);
  }
  if (name === 'choice') {
    const opts = String(args || '').split('|').map(s => s.trim()).filter(Boolean);
    return opts[0] || '';
  }
  return undefined;
}

export function applyTemplate(text, vars = {}, ctx = {}) {
  // Substitutes every {{var}} occurrence. Returns { body, cursorPos } where
  // cursorPos is the offset of the {{cursor}} marker (or null) and that
  // marker is stripped from the body so the file is saved clean.
  const src = String(text || '');
  const body = src.replace(TPL_VAR_RE, (full, rawName, rawArgs) => {
    const name = rawName;
    const args = rawArgs != null ? rawArgs : '';
    if (TEMPLATE_TRANSFORMS.has(name)) return tplApplyTransform(name, args, vars, ctx);
    if (TEMPLATE_GENERATORS.has(name)) return tplGenerator(name, args, ctx);
    const built = tplResolveBuiltin(name, args, ctx);
    if (built !== undefined) return built;
    const v = vars[name];
    if (v != null && v !== '') return String(v);
    return args || '';
  });
  const idx = body.indexOf(' CURSOR_MARKER ');
  let clean = body;
  let cursorPos = null;
  if (idx >= 0) {
    cursorPos = idx;
    clean = body.slice(0, idx) + body.slice(idx + ' CURSOR_MARKER '.length);
  }
  return { body: clean, cursorPos };
}

// Extract wikilinks `[[Target]]` from a note body so backlink edges can be
// drawn between tiles that reference each other. We strip aliases (`[[A|B]]`)
// to compare against the target's base name.
export function extractWikilinks(text) {
  const out = [];
  if (!text) return out;
  const re = /\[\[([^\]\n|#]+)(?:[#|][^\]\n]*)?\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim().toLowerCase());
  return out;
}

// Unique, normalized outgoing wikilink names for a note (Fase 4b). Cached
// and keyed by the content string's identity: getContentString (store.js)
// hands back a stable reference until a note's content changes, so this
// auto-invalidates and re-runs the regex only for the note that actually
// changed. Feeds the reverse backlink index so counts/lists are O(1)
// lookups instead of an O(N) all-notes regex scan on every keystroke.
const _outLinkCache = new Map();   // fileId → { str, keys: string[] }
function outgoingLinkKeys(fileId, contentStr) {
  const s = contentStr || '';
  const c = _outLinkCache.get(fileId);
  if (c && c.str === s) return c.keys;
  const keys = Array.from(new Set(extractWikilinks(s).map(normalizeNoteName)));
  _outLinkCache.set(fileId, { str: s, keys });
  return keys;
}

function ApplyTemplateModal({ state, vaults, folders, onCancel, onCreate }) {
  useI18n();
  // state: { template: file, defaults?: { name?, vaultId?, folderId? } } | null
  const [name, setName] = useState('');
  const [vaultId, setVaultId] = useState('');
  const [folderId, setFolderId] = useState('');
  const [values, setValues] = useState({});
  const vars = useMemo(
    () => state ? parseTemplateVars(state.template.content || '') : [],
    [state && state.template && state.template.id, state && state.template && state.template.content]
  );

  useEffect(() => {
    if (!state) return;
    const tpl = state.template;
    const defaults = state.defaults || {};
    const cleanName = (tpl.name || 'nota').replace(/\.(md|markdown|txt)$/i, '').replace(/^Plantilla[\s_-]*/i, '');
    setName(defaults.name || cleanName);
    setVaultId(defaults.vaultId || tpl.vaultId || 'default');
    setFolderId(defaults.folderId || '');
    const initial = {};
    for (const v of parseTemplateVars(tpl.content || '')) initial[v.name] = v.default || '';
    setValues(initial);
  }, [state && state.template && state.template.id]);

  if (!state) return null;
  const tpl = state.template;
  const vaultFolders = folders
    .filter(f => f.vaultId === vaultId && !isRootTemplateFolder(f))
    .filter(f => {
      // Hide descendants of any "Plantillas" root folder.
      let cur = f;
      while (cur) {
        if (isRootTemplateFolder(cur)) return false;
        cur = cur.parentId ? folders.find(x => x.id === cur.parentId) : null;
      }
      return true;
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const insertHere = !!state.insertHere;
  const submit = (e) => {
    e && e.preventDefault && e.preventDefault();
    if (!insertHere && !name.trim()) return;
    onCreate({ name: name.trim(), vaultId, folderId: folderId || null, vars: values });
  };

  return (
    <>
      <div className="apply-tpl-backdrop" onClick={onCancel} />
      <div className="apply-tpl-modal" role="dialog">
        <div className="apply-tpl-head">
          <span className="apply-tpl-glyph"><ShIcon name="template" size={18} /></span>
          <div className="apply-tpl-titles">
            <div className="apply-tpl-title">{insertHere ? t('blk.tpl.insertFrom') : t('tpl.createFrom')}</div>
            <div className="apply-tpl-sub">{tpl.name.replace(/\.(md|markdown|txt)$/i, '')}</div>
          </div>
          <button className="apply-tpl-close" onClick={onCancel} title={t('btn.cancel')}>×</button>
        </div>
        <form className="apply-tpl-body" onSubmit={submit}>
          {!insertHere && <label className="apply-tpl-field">
            <span>{t('tpl.noteName')}</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('tpl.namePh')} />
          </label>}
          {!insertHere && <div className="apply-tpl-row">
            <label className="apply-tpl-field">
              <span>Vault</span>
              <select value={vaultId} onChange={(e) => { setVaultId(e.target.value); setFolderId(''); }}>
                {vaults.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label className="apply-tpl-field">
              <span>{t('tpl.folderLabel')}</span>
              <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                <option value="">{t('tpl.vaultRootOpt')}</option>
                {vaultFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          </div>}
          {vars.length > 0 && (
            <>
              <div className="apply-tpl-vars-head">{t('tpl.varsHead', { n: vars.length })}</div>
              <div className="apply-tpl-vars">
                {vars.map(v => (
                  <label key={v.name} className="apply-tpl-field">
                    <span>{v.name}</span>
                    {v.choices && v.choices.length > 0 ? (
                      <select value={values[v.name] || v.default || v.choices[0]}
                              onChange={(e) => setValues(prev => ({ ...prev, [v.name]: e.target.value }))}>
                        {v.choices.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input value={values[v.name] || ''}
                             onChange={(e) => setValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                             placeholder={v.default || `{{${v.name}}}`} />
                    )}
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="apply-tpl-foot">
            <button type="button" className="apply-tpl-btn ghost" onClick={onCancel}>{t('btn.cancel')}</button>
            <button type="submit" className="apply-tpl-btn primary" autoFocus={insertHere}>{insertHere ? t('blk.tpl.insert') : t('tpl.createNote')}</button>
          </div>
        </form>
      </div>
    </>
  );
}

// ─── Template builder (floating side panel) ────────────────────────────────
// Appears whenever the active note is a template. Compact, non-blocking
// (the editor keeps focus). Drag a chip onto the editor or click to insert
// at the caret. Detected vars list below shows live count + rename helper.
function getTplChipCatalog() {
  return [
    {
      group: t('tplbuilder.group.dateTime'),
      chips: [
        { token: 'date', label: '{{date}}', help: t('tplbuilder.help.date') },
        { token: 'date:DD/MM/YYYY', label: '{{date:DD/MM/YYYY}}', help: t('tplbuilder.help.dateFmt') },
        { token: 'time', label: '{{time}}', help: t('tplbuilder.help.time') },
        { token: 'datetime', label: '{{datetime}}', help: t('tplbuilder.help.datetime') },
        { token: 'year', label: '{{year}}', help: t('tpl.varHelp.year') },
        { token: 'month', label: '{{month}}', help: t('tplbuilder.help.month') },
        { token: 'day', label: '{{day}}', help: t('tpl.varHelp.day') },
        { token: 'weekday', label: '{{weekday}}', help: t('tpl.varHelp.weekday') },
        { token: 'week', label: '{{week}}', help: t('tplbuilder.help.week') },
        { token: 'tomorrow', label: '{{tomorrow}}', help: t('tpl.varHelp.tomorrow') },
        { token: 'yesterday', label: '{{yesterday}}', help: t('tplbuilder.help.yesterday') },
        { token: 'date+7', label: '{{date+7}}', help: t('tpl.varHelp.dateAdd') },
        { token: 'date-7', label: '{{date-7}}', help: t('tpl.varHelp.dateSub') },
      ],
    },
    {
      group: t('tplbuilder.group.identity'),
      chips: [
        { token: 'vault', label: '{{vault}}', help: t('tplbuilder.help.vault') },
        { token: 'folder', label: '{{folder}}', help: t('tpl.varHelp.folder') },
        { token: 'folderpath', label: '{{folderpath}}', help: t('tplbuilder.help.folderpath') },
        { token: 'user', label: '{{user}}', help: t('tplbuilder.help.user') },
        { token: 'email', label: '{{email}}', help: t('tplbuilder.help.email') },
        { token: 'template', label: '{{template}}', help: t('tplbuilder.help.template') },
        { token: 'notecount', label: '{{notecount}}', help: t('tplbuilder.help.notecount') },
      ],
    },
    {
      group: t('tplbuilder.group.ids'),
      chips: [
        { token: 'uuid', label: '{{uuid}}', help: t('tplbuilder.help.uuid') },
        { token: 'shortid', label: '{{shortid}}', help: t('tplbuilder.help.shortid') },
        { token: 'counter:diario', label: '{{counter:nombre}}', help: t('tplbuilder.help.counter') },
      ],
    },
    {
      group: t('tplbuilder.group.special'),
      chips: [
        { token: 'cursor', label: '{{cursor}}', help: t('tpl.varHelp.cursor') },
        { token: 'clipboard', label: '{{clipboard}}', help: t('tplbuilder.help.clipboard') },
        { token: 'selection', label: '{{selection}}', help: t('tplbuilder.help.selection') },
        { token: 'choice:opt1|opt2|opt3', label: '{{choice:a|b|c}}', help: t('tplbuilder.help.choice') },
      ],
    },
    {
      group: t('tplbuilder.group.tables'),
      chips: [
        { token: 'tareastable', label: '{{tareastable}}', help: t('tpl.varHelp.tareasTable') },
        { token: 'kanbantable:cols=Tarea,Prioridad,Estado:order=Pendiente,En revisión,Completado', label: '{{kanbantable:...}}', help: t('tplbuilder.help.kanban') },
        { token: 'table:cols=A,B,C:rows=3', label: '{{table:...}}', help: t('tplbuilder.help.table') },
        { token: 'checktable:cols=Tarea', label: '{{checktable:...}}', help: t('tplbuilder.help.checktable') },
        { token: 'datetable:7:cols=Fecha,Notas', label: '{{datetable:...}}', help: t('tplbuilder.help.datetable') },
        { token: 'weekdaystable:cols=Día,Plan', label: '{{weekdaystable}}', help: t('tplbuilder.help.weekdaystable') },
        { token: 'monthstable:cols=Mes,Objetivo', label: '{{monthstable}}', help: t('tplbuilder.help.monthstable') },
        { token: 'daterange:start=2026-01-01:end=2026-01-07:cols=Día,Notas', label: '{{daterange:...}}', help: t('tplbuilder.help.daterange') },
      ],
    },
    {
      group: t('tplbuilder.group.transforms'),
      chips: [
        { token: 'upper:miVar', label: '{{upper:var}}', help: t('tplbuilder.help.upper') },
        { token: 'lower:miVar', label: '{{lower:var}}', help: t('tplbuilder.help.lower') },
        { token: 'cap:miVar', label: '{{cap:var}}', help: t('tplbuilder.help.cap') },
        { token: 'slug:miVar', label: '{{slug:var}}', help: t('tplbuilder.help.slug') },
      ],
    },
    {
      group: t('tplbuilder.group.dashboards'),
      chips: [
        { token: 'tasksopen:status=Pendiente', label: '{{tasksopen}}', help: t('tplbuilder.help.tasksopen') },
        { token: 'notesindex:folder=Proyectos', label: '{{notesindex:folder=X}}', help: t('tplbuilder.help.notesindex') },
        { token: 'tableof:NoteName:column=Estado:filter=Pendiente', label: '{{tableof:Nota:...}}', help: t('tplbuilder.help.tableof') },
        { token: 'csvclipboard', label: '{{csvclipboard}}', help: t('tplbuilder.help.csvclipboard') },
      ],
    },
  ];
}

function TplChip({ token, label, help, onInsert }) {
  const dragStart = (e) => {
    e.dataTransfer.setData('text/plain', `{{${token}}}`);
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <button className="tpl-chip" draggable onDragStart={dragStart}
      onClick={() => onInsert(`{{${token}}}`)} title={help}>
      <span className="tpl-chip-label">{label}</span>
    </button>
  );
}

function TemplateBuilderPanel({ active, content, folders, cmViewRef, askPrompt, askConfirm, onRenameVar, onShowPreview, onClose }) {
  useI18n();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('edinotTplBuilderCollapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('edinotTplBuilderCollapsed', collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);
  const [openGroups, setOpenGroups] = useState(() => ({ [t('tplbuilder.group.dateTime')]: true, [t('tplbuilder.group.tables')]: true }));
  const catalog = getTplChipCatalog();
  const detectedVars = useMemo(() => parseTemplateVars(content || ''), [content]);

  const insertAtCaret = (text) => {
    const view = cmViewRef && cmViewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + text.length },
    });
    view.focus();
  };

  const addCustomVar = async () => {
    const name = await askPrompt(t('tplbuilder.askVarName'), 'miVar');
    if (!name || !/^[a-zA-Z_][\w-]*$/.test(name)) return;
    const def = await askPrompt(
      t('tplbuilder.askVarDef', { name }) + '\n' + t('tplbuilder.askVarHints'),
      '',
    );
    const inserted = def ? `{{${name}|${def}}}` : `{{${name}}}`;
    insertAtCaret(inserted);
  };

  if (!active) return null;
  return (
    <div className={`tpl-builder ${collapsed ? 'collapsed' : ''}`}>
      <div className="tpl-builder-head">
        <button className="tpl-builder-toggle" onClick={() => setCollapsed(c => !c)} title={collapsed ? t('tplbuilder.open') : t('tplbuilder.collapse')}>
          {collapsed ? '◂' : '▸'}
        </button>
        <span className="tpl-builder-glyph"><ShIcon name="template" size={16} /></span>
        {!collapsed && <span className="tpl-builder-title">{t('tplbuilder.title')}</span>}
        {!collapsed && (
          <button className="tpl-builder-close" onClick={onClose} title={t('btn.close')}>×</button>
        )}
      </div>
      {!collapsed && (
        <div className="tpl-builder-body">
          <div className="tpl-builder-hint">
            {t('tplbuilder.hint')}
          </div>
          {catalog.map(({ group, chips }) => {
            const open = openGroups[group] !== false;
            return (
              <div key={group} className={`tpl-builder-group ${open ? 'open' : ''}`}>
                <button className="tpl-builder-group-head" onClick={() => setOpenGroups(o => ({ ...o, [group]: !open }))}>
                  <span className="tpl-builder-group-chev">▸</span>
                  <span className="tpl-builder-group-name">{group}</span>
                  <span className="tpl-builder-group-count">{chips.length}</span>
                </button>
                {open && (
                  <div className="tpl-builder-chips">
                    {chips.map(c => <TplChip key={c.token} {...c} onInsert={insertAtCaret} />)}
                  </div>
                )}
              </div>
            );
          })}
          <button className="tpl-builder-custom" onClick={addCustomVar} title={t('tplbuilder.customVarTip')}>
            ＋ {t('tplbuilder.customVar')}
          </button>
          <div className="tpl-builder-section-head">{t('tplbuilder.detected', { n: detectedVars.length })}</div>
          {detectedVars.length === 0 && (
            <div className="tpl-builder-empty">{t('tplbuilder.detectedEmpty')}</div>
          )}
          {detectedVars.length > 0 && (
            <div className="tpl-builder-detected">
              {detectedVars.map(v => (
                <div key={v.name} className="tpl-builder-var">
                  <span className="tpl-builder-var-name" title={v.default ? t('tplbuilder.varDefVal', { v: v.default }) : t('tplbuilder.varNoDef')}>{`{{${v.name}}}`}</span>
                  {v.default && <span className="tpl-builder-var-def">= {v.default}</span>}
                  <button className="tpl-builder-var-action" title={t('tplbuilder.renameAllTip')}
                    onClick={async () => {
                      const newName = await askPrompt(t('tplbuilder.renameAsk', { name: v.name }), v.name);
                      if (!newName || newName === v.name) return;
                      if (!/^[a-zA-Z_][\w-]*$/.test(newName)) return;
                      onRenameVar && onRenameVar(v.name, newName);
                    }}>✎</button>
                  <button className="tpl-builder-var-action" title={t('tpl.removeVarTip')}
                    onClick={async () => {
                      const ok = await askConfirm(t('tpl.removeVar', { name: v.name }), { title: t('tpl.removeVar.title') });
                      if (!ok) return;
                      onRenameVar && onRenameVar(v.name, null);
                    }}>×</button>
                </div>
              ))}
            </div>
          )}
          <div className="tpl-builder-foot">
            <button className="tpl-builder-preview-btn" onClick={() => onShowPreview(content)} title={t('tplbuilder.previewTip')}><ShIcon name="eye" size={14} /> {t('tplbuilder.preview')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplatePreviewModal({ state, vaults, activeVault, onClose }) {
  useI18n();
  if (!state) return null;
  const sample = useMemo(() => {
    const vault = vaults.find(v => v.id === activeVault);
    const ctx = {
      vaultName: vault ? vault.name : '',
      folderName: t('tplpreview.ctx.folderName'),
      folderPath: t('tplpreview.ctx.folderPath'),
      templateName: t('tplpreview.ctx.templateName'),
      noteCount: 42,
      userName: t('tplpreview.ctx.userName'),
      userEmail: 'you@example.com',
      clipboard: t('tplpreview.ctx.clipboard'),
      selection: '',
      counters: {},
    };
    const userVars = {};
    for (const v of parseTemplateVars(state.content || '')) userVars[v.name] = `«${v.name}»`;
    return applyTemplate(state.content || '', userVars, ctx).body;
  }, [state && state.content]);
  return (
    <>
      <div className="apply-tpl-backdrop" onClick={onClose} />
      <div className="apply-tpl-modal tpl-preview-modal" role="dialog">
        <div className="apply-tpl-head">
          <span className="apply-tpl-glyph">👁</span>
          <div className="apply-tpl-titles">
            <div className="apply-tpl-title">{t('tplpreview.title')}</div>
            <div className="apply-tpl-sub">{t('tplpreview.sub')}</div>
          </div>
          <button className="apply-tpl-close" onClick={onClose}>×</button>
        </div>
        <pre className="tpl-preview-body">{sample}</pre>
        <div className="apply-tpl-foot">
          <button className="apply-tpl-btn primary" onClick={onClose}>{t('btn.close')}</button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Global search modal — full-text across every note in every vault.
// Streams results with snippets; clicking jumps to the match in-place.
// ─────────────────────────────────────────────────────────────
const GS_CONTEXT = 42;
const GS_MAX_RESULTS = 60;

// Returns one entry per matching note: { fileId, fileName, vaultId,
// nameMatched, contentMatches (count), snippet?: {before, match, after, pos, truncatedLeft, truncatedRight} }.
// Notes whose name matches rank above content-only matches.
// Module-level cache of extracted attachment text — keyed by blob sha,
// shared across the lifetime of the renderer. Search prefetches missing
// entries on modal open; never refetches an already-cached sha.
const __blobTextCache = new Map();           // sha -> string
const __blobTextNegative = new Set();        // sha → known to have no text
function getCachedBlobText(sha) { return __blobTextCache.get(sha) || ''; }
// Sube cada vez que llega texto de adjuntos nuevo: invalida el texto unido
// que cachea attachmentTextForFile.
let __blobTextVersion = 0;
function setCachedBlobText(sha, text) { __blobTextCache.set(sha, text); __blobTextVersion++; }

const BLOB_SHA_RX = /[a-f0-9]{64}/gi;
function extractFileBlobShas(content) {
  if (!content) return [];
  const out = new Set();
  for (const m of String(content).matchAll(BLOB_SHA_RX)) out.add(m[0].toLowerCase());
  return [...out];
}
// Igual que extractFileBlobShas pero cacheado por (nota, contenido): la
// búsqueda global lo pedía para cada nota sin coincidencias en cada consulta.
const __fileBlobShaCache = new Map(); // f.id -> { src, shas }
function fileBlobShas(file) {
  const src = file.content || '';
  const hit = __fileBlobShaCache.get(file.id);
  if (hit && hit.src === src) return hit.shas;
  const shas = extractFileBlobShas(src);
  __fileBlobShaCache.set(file.id, { src, shas });
  return shas;
}

// Concatenated attachment text for one note (all referenced blobs joined
// by `\n\n`). Returns null when the note has no attachments at all so
// callers can skip the empty-string check. Cacheado: devolver el MISMO
// string permite que gsAttachFolded acierte por identidad.
const __attachTextCache = new Map(); // f.id -> { shas, ver, text }
function attachmentTextForFile(file) {
  const shas = fileBlobShas(file);
  if (!shas.length) return null;
  const hit = __attachTextCache.get(file.id);
  if (hit && hit.shas === shas && hit.ver === __blobTextVersion) return hit.text;
  const parts = [];
  for (const sha of shas) {
    const t = getCachedBlobText(sha);
    if (t) parts.push(t);
  }
  const text = parts.length ? parts.join('\n\n') : '';
  __attachTextCache.set(file.id, { shas, ver: __blobTextVersion, text });
  return text;
}

// Nombre completo plegado (para la búsqueda global), cacheado por nombre.
const __gsNameFoldCache = new Map(); // f.id -> { name, folded }
export function gsNameFolded(f) {
  const name = f.name || '';
  const hit = __gsNameFoldCache.get(f.id);
  if (hit && hit.name === name) return hit.folded;
  const folded = gsFold(name.toLowerCase());
  __gsNameFoldCache.set(f.id, { name, folded });
  return folded;
}



// Per-file fold cache. searchableContent() + gsFoldWithMap() are pure
// functions of the note body, but the global-search memo re-runs on every
// keystroke while `files` is unchanged. Re-folding every note per keystroke
// was the slowness; cache keyed by file id, invalidated when raw content
// changes.
const __gsFoldCache = new Map(); // f.id -> { src, folded, map }
export function gsFoldedSearchable(f) {
  const rawText = f.content || '';
  const cached = __gsFoldCache.get(f.id);
  if (cached && cached.src === rawText) return cached;
  const searchable = searchableContent(rawText).toLowerCase();
  const { folded, map } = gsFoldWithMap(searchable);
  const entry = { src: rawText, folded, map };
  __gsFoldCache.set(f.id, entry);
  return entry;
}

// Fold cache for attachment text (extracted PDF/doc text can run to
// hundreds of KB) — re-folding it on EVERY query change was a per-keystroke
// cost for notes whose body doesn't match. Keyed by file id, invalidated
// when the joined attachment text changes (new blob text arrives).
const __gsAttachFoldCache = new Map(); // f.id -> { src, folded, map }
function gsAttachFolded(fileId, attachText) {
  const cached = __gsAttachFoldCache.get(fileId);
  if (cached && cached.src === attachText) return cached;
  const { folded, map } = gsFoldWithMap(attachText.toLowerCase());
  const entry = { src: attachText, folded, map };
  __gsAttachFoldCache.set(fileId, entry);
  return entry;
}


// `idx` (optional): Map noteId → hit from the worker index (ui/search). Its
// hits replace the per-note scan of the folded body; a note whose text
// changed after the last index sync (the one being edited) is scanned here
// as before, so results always match the live content.
const NO_IDX_HIT = { phraseIdx: -1, contentMatches: 0, multi: null, seed: null };
function buildGlobalSearchResults(files, q, fileStats = {}, idx = null) {
  if (!q) return [];
  const needleRaw = q.toLowerCase();
  const needleFolded = gsFold(needleRaw);
  const terms = gsQueryTerms(q);
  // Multi-term scoring kicks in when the user typed ≥2 useful tokens AND
  // the literal phrase doesn't match the note. Order-independent: notes
  // hitting every term rank above notes hitting fewer terms.
  const multiTerm = terms.length > 1;
  // Con 1 carácter casi todas las notas coinciden: sólo se buscan nombres.
  // El contenido (y los adjuntos) se escanean a partir de 2.
  const scanContent = needleFolded.replace(/\s+/g, '').length >= 2;
  const now = Date.now();
  const out = [];
  for (const f of files) {
    const nameFolded = gsNameFolded(f);
    // Strip <!-- comments --> + fenced code from the searchable text so a
    // query like "edinot" doesn't hit `<!-- edinot:view=table -->`
    // directives that live in render-table notes. Snippets still come
    // from the raw text — we just disqualify matches that only exist in
    // the stripped regions.
    const nameMatched = nameFolded.indexOf(needleFolded) >= 0;
    if (!scanContent && !nameMatched) continue;
    const ih = idx && scanContent && searchIndex.isFresh(f.id, f.content) ? (idx.get(f.id) || NO_IDX_HIT) : null;
    const textFolded = scanContent && !ih ? gsFoldedSearchable(f).folded : '';
    const phraseIdx = ih ? ih.phraseIdx : (scanContent ? textFolded.indexOf(needleFolded) : -1);

    // Per-term scan — populated when phrase doesn't match the body and
    // the query has ≥2 useful tokens. We record the first occurrence of
    // each term so we can build a snippet pointing at the earliest hit.
    let multiHits = null;
    if (ih) {
      if (!nameMatched && phraseIdx < 0 && multiTerm && ih.multi) multiHits = { contentMatches: ih.multi.contentMatches };
    } else if (!nameMatched && phraseIdx < 0 && multiTerm) {
      let allHit = true;
      let total = 0;
      let firstTerm = null;
      let firstIdx = Infinity;
      for (const term of terms) {
        if (!term) continue;
        const idx = textFolded.indexOf(term);
        if (idx < 0) { allHit = false; break; }
        // Count occurrences of this term in the body.
        let from = idx;
        let count = 0;
        while (from >= 0 && count < 999) {
          count++;
          from = textFolded.indexOf(term, from + term.length);
        }
        total += count;
        if (idx < firstIdx) { firstIdx = idx; firstTerm = term; }
      }
      if (allHit) multiHits = { contentMatches: total, firstIdx, firstTerm };
    }

    // Attachment fallback — match against extracted blob text when the
    // note body / name has nothing. Cheap path: only build the haystack
    // when the primary indices miss.
    let attachmentHit = null;
    let nameFuzzy = null;
    if (!nameMatched && phraseIdx < 0 && !multiHits) {
      const attachText = scanContent ? attachmentTextForFile(f) : null;
      if (attachText) {
        const { folded: attFolded, map: attMap } = gsAttachFolded(f.id, attachText);
        // Try phrase first, then any single term so a multi-word query
        // still surfaces attachments that include the strongest word.
        let aIdx = attFolded.indexOf(needleFolded);
        let matchLen = needleFolded.length;
        if (aIdx < 0 && multiTerm) {
          for (const term of terms) {
            const idx = attFolded.indexOf(term);
            if (idx >= 0) { aIdx = idx; matchLen = term.length; break; }
          }
        }
        if (aIdx >= 0) {
          const startOrig = attMap[aIdx];
          const endOrig = attMap[aIdx + matchLen];
          const aStart = Math.max(0, startOrig - GS_CONTEXT);
          const aEnd = Math.min(attachText.length, endOrig + GS_CONTEXT);
          attachmentHit = {
            before: (aStart > 0 ? '…' : '') + attachText.slice(aStart, startOrig).replace(/\s+/g, ' '),
            match: attachText.slice(startOrig, endOrig),
            after: attachText.slice(endOrig, aEnd).replace(/\s+/g, ' ') + (aEnd < attachText.length ? '…' : ''),
          };
        }
      }
      if (!attachmentHit) {
        // Last resort: fuzzy subsequence on the note name (quick-switcher
        // parity — "ldc" still finds "Lista de la compra" from ⌘F). Only
        // for queries of ≥3 useful chars; shorter ones match everything.
        if (needleFolded.replace(/\s+/g, '').length >= 3) {
          const fz = vmFuzzyMatch(vmNameInfo(f).folded, needleFolded);
          if (fz) nameFuzzy = fz;
        }
        if (!nameFuzzy) continue;
      }
    }

    let contentMatches = 0;
    // Build a snippet either from a literal phrase match or the earliest
    // multi-term hit. Both paths translate the folded position back to
    // the original text so `jumpToMatch(pos)` lands on the right char.
    // El snippet en sí se construye después de ordenar, sólo para el top.
    const snippetSeed = ih
      ? ((phraseIdx >= 0 || multiHits) && ih.seed ? { orig: ih.seed } : null)
      : phraseIdx >= 0
        ? { foldedIdx: phraseIdx, len: needleFolded.length }
        : (multiHits ? { foldedIdx: multiHits.firstIdx, len: multiHits.firstTerm.length } : null);

    if (ih && phraseIdx >= 0) {
      contentMatches = ih.contentMatches;
    } else if (phraseIdx >= 0) {
      let from = 0;
      while (true) {
        const i = textFolded.indexOf(needleFolded, from);
        if (i < 0) break;
        contentMatches++;
        from = i + needleFolded.length;
        if (contentMatches > 999) break;
      }
    } else if (multiHits) {
      contentMatches = multiHits.contentMatches;
    }

    const st = fileStats[f.id] || { c: 0, t: 0 };
    out.push({
      fileId: f.id, fileName: f.name, vaultId: f.vaultId,
      nameMatched, contentMatches, snippet: null,
      _file: f, _seed: snippetSeed,
      attachmentHit, nameFuzzy,
      // Multi-term hits get a small extra weight so a note matching all
      // requested terms beats a note matching only one — even when the
      // single-term note happens to have more raw occurrences.
      multiTermAll: !!multiHits,
      openCount: st.c || 0, lastOpened: st.t || 0,
    });
  }

  // Composite ranking: name matches > content matches, then visit bonus.
  // Visit bonus = log(openCount + 1) * 4 + recency factor (decays over 30 days).
  // Multi-term-all hits earn a small bonus so a note with every requested
  // term outranks a note matching just one term with more raw occurrences.
  const RECENCY_MS = 30 * 24 * 60 * 60 * 1000;
  out.sort((a, b) => {
    if (a.nameMatched !== b.nameMatched) return a.nameMatched ? -1 : 1;
    const recA = a.lastOpened ? Math.max(0, 1 - (now - a.lastOpened) / RECENCY_MS) : 0;
    const recB = b.lastOpened ? Math.max(0, 1 - (now - b.lastOpened) / RECENCY_MS) : 0;
    const mtA = a.multiTermAll ? 2 : 0;
    const mtB = b.multiTermAll ? 2 : 0;
    // Fuzzy-name-only hits get a flat nudge so they don't sink below weak
    // single-occurrence content matches, without outranking strong ones.
    const scoreA = a.contentMatches + Math.log(a.openCount + 1) * 4 + recA * 3 + mtA + (a.nameFuzzy ? 4 : 0);
    const scoreB = b.contentMatches + Math.log(b.openCount + 1) * 4 + recB * 3 + mtB + (b.nameFuzzy ? 4 : 0);
    return scoreB - scoreA;
  });
  const top = out.slice(0, GS_MAX_RESULTS);
  for (const r of top) {
    const seed = r._seed, f = r._file;
    delete r._seed; delete r._file;
    if (seed) r.snippet = gsBuildSnippet(f, seed);
  }
  return top;
}

function gsBuildSnippet(f, seed) {
  const text = f.content || '';
  let origIdx, origEnd;
  if (seed.orig) {
    // Offsets already mapped to the original text by the worker index.
    origIdx = seed.orig.origIdx;
    origEnd = seed.orig.origEnd;
  } else {
    const { map: textMap } = gsFoldedSearchable(f);
    origIdx = textMap[seed.foldedIdx];
    origEnd = textMap[seed.foldedIdx + seed.len];
  }
  const lineStart = text.lastIndexOf('\n', origIdx - 1) + 1;
  let lineEnd = text.indexOf('\n', origIdx);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  const localIdx = origIdx - lineStart;
  const localEnd = origEnd - lineStart;
  return {
    before: line.slice(Math.max(0, localIdx - GS_CONTEXT), localIdx),
    match: line.slice(localIdx, localEnd),
    after: line.slice(localEnd, localEnd + GS_CONTEXT),
    pos: origIdx,
    truncatedLeft: localIdx > GS_CONTEXT,
    truncatedRight: localEnd + GS_CONTEXT < line.length,
  };
}

// Highlight occurrences of `needle` inside `text` as React fragments.
// Searches in the accent-folded copy so a query without diacritics still
// lights up the same word with them in the source; positions are mapped
// back through `gsFoldWithMap` so the rendered fragment is the original
// text (accents intact). When the query has ≥2 tokens we also highlight
// each token separately so partial multi-term matches stay visible.
function highlightSubstring(text, needle) {
  if (!needle) return text;
  const src = String(text);
  const { folded, map } = gsFoldWithMap(src.toLowerCase());
  const phrase = gsFold(String(needle).toLowerCase());
  const terms = phrase.split(/\s+/).filter(Boolean);
  // Build ranges in folded coords, then translate to original.
  const ranges = [];
  const pushRanges = (term) => {
    if (!term) return;
    let from = 0;
    while (true) {
      const i = folded.indexOf(term, from);
      if (i < 0) break;
      ranges.push([i, i + term.length]);
      from = i + term.length;
    }
  };
  pushRanges(phrase);
  if (terms.length > 1) for (const t of terms) pushRanges(t);
  if (!ranges.length) return src;
  // Merge overlaps then convert to original indices.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    if (merged.length && r[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
    } else merged.push([r[0], r[1]]);
  }
  const parts = [];
  let cursor = 0;
  let key = 0;
  for (const [fStart, fEnd] of merged) {
    const oStart = map[fStart];
    const oEnd = map[fEnd];
    if (oStart > cursor) parts.push(src.slice(cursor, oStart));
    parts.push(<mark key={key++} className="gs-mark">{src.slice(oStart, oEnd)}</mark>);
    cursor = oEnd;
  }
  if (cursor < src.length) parts.push(src.slice(cursor));
  return parts;
}

// Full-thread conversation view. Mounted from AiCommentItem's 🗨
// button on root comments. Reads the comment store live (so resolve /
// delete / reply inside the modal stays in sync with the side panel)
// and walks the descendants of `rootId`, rendering them flat (depth
// limit 6 to keep deep threads scannable).
function ConversationModal({ rootId, onClose, noteId, memberEmails = [], aiAgents = [], onPostReply }) {
  const v = useCommentsVersion();
  const all = useMemo(() => readNoteComments(ydoc, noteId), [v, noteId]);
  useEffect(() => {
    if (!rootId) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rootId, onClose]);
  if (!rootId || !noteId) return null;
  const root = all.find(c => c.id === rootId);
  if (!root) return null;
  const byParent = new Map();
  for (const c of all) {
    const p = c.parentId || null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(c);
  }
  const walk = (node, depth) => {
    const kids = byParent.get(node.id) || [];
    return (
      <div key={node.id} className={`ai-comment${node.resolved ? ' ai-comment-resolved' : ''}`}
        style={{ marginLeft: Math.min(depth, 6) * 14 }}>
        <div className="ai-comment-author">
          {node.author || 'user'} · {(node.ts || '').slice(11, 16)}
          {node.resolved ? ' · ✓' : ''}
        </div>
        <CommentText text={node.text} />
        {kids.map(k => walk(k, depth + 1))}
      </div>
    );
  };
  const post = (text) => {
    const v = String(text || '').trim();
    if (!v) return;
    const list = readNoteComments(ydoc, noteId);
    const rec = {
      id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      noteId,
      kind: 'note',
      parentId: rootId,
      author: 'me',
      ts: new Date().toISOString(),
      text: v,
      anchorText: null,
      resolved: false,
      replies: [],
      awaitingReply: false,
      mentions: (v.match(/@[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).map(s => s.slice(1).toLowerCase()),
    };
    putComment(ydoc, rec);
    if (onPostReply) onPostReply(rec, [...list, rec]);
  };
  return (
    <>
      <div className="view-spotlight-backdrop" onClick={onClose} />
      <div className="vault-share-modal" role="dialog" style={{ maxWidth: 640 }}>
        <div className="vault-share-head">
          <span className="vault-share-title">{t('cmt.modal.title')}</span>
          <button className="history-close" onClick={onClose} title={t('btn.closeEsc')}>×</button>
        </div>
        <div className="vault-share-body" style={{ maxHeight: '65vh', overflow: 'auto' }}>
          {walk(root, 0)}
          <ChatComposer
            placeholder={t('comments.addToThread')}
            memberEmails={memberEmails}
            aiAgents={aiAgents}
            autoFocus
            compact
            onSend={post} />
        </div>
      </div>
    </>
  );
}

// Bell-icon notification center — header dropdown showing the current
// user's inbox. Polls the unread-count endpoint every 30s for badge
// updates; the full list is fetched lazily when the dropdown opens.
// Click on a notification marks it read + (when applicable) navigates
// to the relevant workspace.
function NotificationsBell({ syncConfig, onOpenWorkspace }) {
  useI18n();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const popRef = useRef(null);

  const canCall = !!(syncConfig && syncConfig.token && syncConfig.httpUrl);

  const refreshCount = useCallback(async () => {
    if (!canCall) return;
    try {
      const r = await apiUnreadNotifCount(syncConfig.httpUrl, syncConfig.token);
      setUnread(r.unread || 0);
    } catch { /* silent — header bell isn't critical */ }
  }, [syncConfig, canCall]);

  const refreshList = useCallback(async () => {
    if (!canCall) return;
    setBusy(true);
    try {
      const r = await apiListNotifications(syncConfig.httpUrl, syncConfig.token, { limit: 50 });
      setList(r.notifications || []);
      setUnread(r.unread || 0);
    } catch { /* silent */ }
    finally { setBusy(false); }
  }, [syncConfig, canCall]);

  // Pop a corner toast for genuinely new notifications. Called on each
  // SSE 'notif' event (we re-fetch the head of the list rather than trust
  // the event payload shape). The first call only sets a baseline so we
  // never replay the backlog as toasts on startup.
  const lastSeenNotifTsRef = useRef(0);
  const toastNew = useCallback(async () => {
    if (!canCall) return;
    try {
      const r = await apiListNotifications(syncConfig.httpUrl, syncConfig.token, { limit: 8 });
      const ns = r.notifications || [];
      setUnread(r.unread || 0);
      const maxTs = ns.length ? Math.max(...ns.map(n => n.ts || 0)) : 0;
      if (!lastSeenNotifTsRef.current) { lastSeenNotifTsRef.current = maxTs || Date.now(); return; }
      const fresh = ns.filter(n => (n.ts || 0) > lastSeenNotifTsRef.current && !n.read_at);
      if (maxTs > lastSeenNotifTsRef.current) lastSeenNotifTsRef.current = maxTs;
      for (const n of fresh) {
        if (!['reply', 'ai-reply', 'mention'].includes(n.kind)) continue;
        const pl = n.payload || {};
        window.dispatchEvent(new CustomEvent('edinot:reply-toast', { detail: {
          // Align the id with the Y.Doc observer ('cm'+commentId) so that
          // when a same-workspace reply triggers both the SSE notification
          // and the local doc observer, ReplyToasts dedupes to one toast.
          id: pl.commentId ? ('cm' + pl.commentId) : ('n' + n.id),
          kind: n.kind, alias: pl.alias, author: n.source_user_email,
          noteId: pl.noteId, noteName: pl.noteName, commentId: pl.commentId,
          threadRootId: pl.threadRootId, workspaceId: n.source_workspace_id,
          preview: pl.preview,
        } }));
      }
    } catch { /* silent */ }
  }, [syncConfig, canCall]);

  useEffect(() => {
    if (!canCall) return;
    refreshCount();
    toastNew(); // set the baseline so old notifications don't toast
    // Live push via SSE. Server sends 'notif' events whenever
    // insertNotification fires for this user — we re-fetch the head of
    // the inbox to update the badge AND pop a toast for the new ones.
    // Falls back to a 90s poll for missed events (network blip / proxy
    // buffering).
    let es = null;
    try {
      const base = syncConfig.httpUrl.replace(/\/$/, '');
      const url = base + '/me/notifications/stream?token=' + encodeURIComponent(syncConfig.token);
      es = new EventSource(url);
      es.addEventListener('notif', () => { toastNew(); });
    } catch { /* EventSource unavailable; rely on poll */ }
    const t = setInterval(refreshCount, 90_000);
    return () => {
      clearInterval(t);
      if (es) { try { es.close(); } catch {} }
    };
  }, [canCall, refreshCount, toastNew, syncConfig]);

  useEffect(() => {
    if (!open) return;
    refreshList();
    const onClick = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false);
    };
    setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, refreshList]);

  if (!canCall) return null;

  const markOne = async (id) => {
    try {
      await apiMarkNotifRead(syncConfig.httpUrl, syncConfig.token, id);
      setList(prev => prev.map(n => n.id === id ? { ...n, read_at: Date.now() } : n));
      setUnread(u => Math.max(0, u - 1));
    } catch {}
  };
  const markAll = async () => {
    try {
      await apiMarkAllNotifsRead(syncConfig.httpUrl, syncConfig.token);
      setList(prev => prev.map(n => n.read_at ? n : { ...n, read_at: Date.now() }));
      setUnread(0);
    } catch {}
  };
  const remove = async (id) => {
    try {
      await apiDeleteNotif(syncConfig.httpUrl, syncConfig.token, id);
      setList(prev => prev.filter(n => n.id !== id));
    } catch {}
  };

  const summarize = (n) => {
    const from = n.source_user_email || 'sistema';
    const ws = n.source_workspace_name ? ` · ${n.source_workspace_name}` : '';
    const pl = n.payload || {};
    const note = pl.noteName ? ` en "${pl.noteName}"` : '';
    const preview = pl.preview ? ': ' + String(pl.preview).slice(0, 80) : '';
    switch (n.kind) {
      case 'workspace.invite':   return `${from} te invitó a ${pl.workspaceName || ws} como ${pl.role}`;
      case 'vault.invite':       return `${from} te dio acceso al vault "${pl.vaultId}" como ${pl.role}${ws}`;
      case 'snapshot.restore':   return `${from} restauró un snapshot${ws}`;
      case 'mention':            return `${from} te mencionó${ws}${preview}`;
      case 'reply':              return `${from} respondió a tu comentario${note}${preview}`;
      case 'ai-reply':           return `@${pl.alias || 'ai'} respondió en tu hilo${note}${preview}`;
      case 'ambient':            return `Tarea estancada${note}: @${pl.targetAlias || 'agente'} lleva ${pl.ageMins}min sin terminar${preview}`;
      case 'form.submit':        return `${t('notif.formSubmit')}${pl.formTitle ? ` "${pl.formTitle}"` : ''}${ws}`;
      default:                   return `${from} · ${n.kind}${ws}`;
    }
  };

  const open_ = () => {
    setOpen(true);
    refreshList();
  };

  return (
    <div className="notif-bell" ref={popRef}>
      <button className="notif-bell-btn" title={t('notif.bell.tip')} onClick={() => open ? setOpen(false) : open_()}>
        <span className="ic">{I.bell}</span>
        {unread > 0 && <span className="notif-bell-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-pop">
          <div className="notif-pop-head">
            <span className="notif-pop-title">{t('notif.pop.title')}</span>
            {unread > 0 && (
              <button className="notif-pop-action" onClick={markAll}>{t('notif.pop.markAll')}</button>
            )}
          </div>
          <div className="notif-pop-body">
            {busy && <div className="notif-pop-empty">{t('state.loading')}</div>}
            {!busy && list.length === 0 && <div className="notif-pop-empty">{t('notif.pop.empty')}</div>}
            {list.map(n => (
              <div key={n.id} className={`notif-row${n.read_at ? '' : ' unread'}`}>
                <div className="notif-row-body"
                  onClick={() => {
                    if (!n.read_at) markOne(n.id);
                    if (n.source_workspace_id && onOpenWorkspace) onOpenWorkspace(n.source_workspace_id);
                  }}>
                  <div className="notif-row-summary">{summarize(n)}</div>
                  <div className="notif-row-ts">{new Date(n.ts).toLocaleString()}</div>
                </div>
                <button className="notif-row-del" onClick={(e) => { e.stopPropagation(); remove(n.id); }} title={t('btn.delete.tip')}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// (El antiguo ThemeMenu flotante era código muerto — la selección de tema
// vive en Ajustes → ThemePane, que comparte las clases .theme-tile/.theme-swatch.)

// ─────────────────────────────────────────────────────────────
// Main app
// ─────────────────────────────────────────────────────────────
// Global renderer error capture → forwarded to the main-process log file
// (userData/edinot.log) so a blank/crashed renderer leaves a trace the user
// can attach to a bug report. Installs once per renderer load.
(function installRendererErrorLog() {
  if (typeof window === 'undefined' || window.__edinotLogInstalled) return;
  window.__edinotLogInstalled = true;
  const send = (entry) => {
    try {
      if (window.electronAPI && window.electronAPI.logAppend) {
        window.electronAPI.logAppend(entry);
      }
    } catch {}
  };
  window.addEventListener('error', (ev) => {
    send({
      level: 'error',
      source: 'renderer:onerror',
      msg: ev.message || 'error',
      extra: {
        url: ev.filename || '',
        line: ev.lineno || 0,
        col: ev.colno || 0,
        stack: (ev.error && ev.error.stack) || '',
      },
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    send({
      level: 'error',
      source: 'renderer:unhandledrejection',
      msg: (r && r.message) || String(r || 'rejection'),
      extra: (r && r.stack) || '',
    });
  });
  // Mirror console.error/warn to the log so React stack traces, fetch
  // failures, etc. land in the file even when the user doesn't have
  // DevTools open. Native console still fires — we just tee a copy.
  const origErr = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args) => {
    try {
      send({ level: 'error', source: 'console.error', msg: args.map(a => (a && a.stack) || (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ') });
    } catch {}
    origErr(...args);
  };
  console.warn = (...args) => {
    try {
      send({ level: 'warn', source: 'console.warn', msg: args.map(a => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ') });
    } catch {}
    origWarn(...args);
  };
  send({ level: 'info', source: 'renderer:boot', msg: `ua=${navigator.userAgent}` });
})();

// ── Calendar (F1) ─────────────────────────────────────────────────────
// La página Calendario vive en ui/calendar/CalendarPage.jsx (se pinta en el
// área principal del shell cuando routeView === 'calendar').
const EMPTY_CRUMBS = [];


// ── Reminder banner (F2) ──────────────────────────────────────────────
// Bottom-right toast shown when the Electron scheduler fires a reminder.
// User can snooze (10m / 1h / tomorrow) or dismiss; we persist into
// yEvents from the parent so other devices honor the choice.
function ReminderBanner({ state, onSnooze, onDismiss, onClose }) {
  useI18n();
  if (!state || !state.item) return null;
  const { item } = state;
  const fireTxt = item.fireAt ? new Date(item.fireAt).toLocaleString() : '';
  return (
    <div className="reminder-banner" role="alert">
      <div className="reminder-banner-head">
        <span className="reminder-banner-icon"><VIcon name="bell" /></span>
        <div className="reminder-banner-title">{item.title || t('cal.kindReminder')}</div>
        <button className="reminder-banner-x" onClick={onClose} title={t('btn.close')}><VIcon name="close" /></button>
      </div>
      {fireTxt && <div className="reminder-banner-when">{fireTxt}</div>}
      <div className="reminder-banner-actions">
        <button className="cal-btn" onClick={() => onSnooze(10)}>{t('rem.snooze10')}</button>
        <button className="cal-btn" onClick={() => onSnooze(60)}>{t('rem.snooze1h')}</button>
        <button className="cal-btn" onClick={() => onSnooze(60 * 24)}>{t('rem.snoozeDay')}</button>
        <button className="cal-btn cal-del" onClick={onDismiss}>{t('rem.dismiss')}</button>
      </div>
    </div>
  );
}

// Búsquedas que Ctrl K reutiliza tal cual (ui/palette/CommandPalette.jsx).
// Ctrl K content search: asks the worker index first (no full-vault scan on
// the main thread); without index (not seeded yet, failed, timed out) it
// falls back to the synchronous scan.
async function buildGlobalSearchResultsAsync(files, q, fileStats = {}) {
  if (!q) return [];
  const scanContent = gsFold(q.toLowerCase()).replace(/\s+/g, '').length >= 2;
  if (scanContent && searchIndex.ready) {
    const hits = await searchIndex.search(q);
    if (hits) {
      return perfTime('search:index', () => buildGlobalSearchResults(files, q, fileStats, new Map(hits.map(h => [h.id, h]))),
        `q=${JSON.stringify(q)} hits=${hits.length} worker=${searchIndex.lastMs ? searchIndex.lastMs.worker.toFixed(1) : '?'}ms`);
    }
  }
  return perfTime('search:scan', () => buildGlobalSearchResults(files, q, fileStats), `q=${JSON.stringify(q)}`);
}

const PALETTE_SEARCH = {
  buildViewMenuResults, buildGlobalSearchResults, buildGlobalSearchResultsAsync, highlightSubstring, vmFuzzyFrag,
  vmBreadcrumb, vmIsCanvasNote, vmRelTime, vmNameInfo, gsFold, isTemplateFile,
};

function EdinotApp() {
  perfCountRender('EdinotApp');
  // Subscribe to language changes so every dynamic string in the shell
  // (including popovers like the aggregation menu) re-renders when the
  // user switches Settings → idioma.
  useI18n();
  const DEFAULTS = useMemo(() => {
    const seed = getSeedDocs();
    return {
      vaults: [{ id: 'default', name: 'Default' }],
      activeVault: 'default',
      files: [
        { id: 'f1', name: seed.manualName, vaultId: 'default', content: seed.manual,  size: '2.1 KB' },
        { id: 'f2', name: seed.meetingName, vaultId: 'default', content: seed.meeting, size: '0.4 KB' },
        { id: 'f3', name: seed.ideasName,   vaultId: 'default', content: seed.ideas,   size: '0.3 KB' },
      ],
      activeId: 'f1',
    };
  }, []);

  // One-shot: migrate legacy localStorage and seed defaults *after* the
  // IndexedDB persistence has loaded the existing Y.Doc — otherwise we'd
  // race with the local sync and duplicate the seeded content via CRDT
  // append (each reload was inserting another copy of SAMPLE_DOC).
  // Boot veil: keep the splash up until the LOCAL state the first frame
  // shows has hydrated (shell doc → active vault's file list → active
  // note's content). Purely IndexedDB — the network/sync never gates it.
  // The 900ms cap guarantees a missing/slow entry can't hold the splash
  // hostage; in the normal warm-profile case this settles in well under
  // 200ms. `booted` fades the veil; `bootVeilGone` unmounts it after the
  // CSS transition so it stops covering the app.
  const [booted, setBooted] = useState(false);
  const [bootVeilGone, setBootVeilGone] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let hydrationStarted = false;

    perfMark('app-mount');
    const hydrate = async () => {
      if (cancelled || hydrationStarted) return;
      hydrationStarted = true;
      perfMark('idb-ready');
      migrateFromLocalStorage();
      seedDefaultsIfEmpty(DEFAULTS);
      // La nota que este equipo va a pintar es la suya, no la que otro
      // equipo dejó en yMeta — precargar la de yMeta levantaría el velo de
      // arranque sobre una nota que no es la que se muestra.
      let av = 'default', aid = null;
      const mine = readDeviceActive();
      try { av = (mine && mine.vaultId) || yMeta.get('activeVault') || 'default'; } catch {}
      try { aid = (mine && mine.id) || yMeta.get('activeId') || null; } catch {}
      await Promise.race([
        Promise.all([whenVaultLocalReady(av), whenNoteLocalReady(aid)]),
        new Promise(r => setTimeout(r, 900)),
      ]);
      if (cancelled) return;
      perfMark('vault-ready');
      // A beat so React commits the hydrated sidebar/editor (version bumps
      // are paced ~30ms) before the veil starts fading over it.
      setTimeout(() => { if (!cancelled) setBooted(true); }, 120);
    };

    // A broken/corrupt IndexedDB profile must not make the application look
    // frozen forever. The persistence package can leave `synced` unresolved
    // when opening the database fails, so cap only this visual gate. We keep
    // waiting in the background and hydrate as soon as it recovers.
    const idbTimeout = new Promise(resolve => setTimeout(() => resolve(false), 4000));
    Promise.race([
      whenIndexedDbReady().then(() => true).catch(() => false),
      idbTimeout,
    ]).then((idbReady) => {
      if (cancelled) return;
      if (idbReady) {
        return hydrate();
      }
      console.warn('[boot] IndexedDB no respondió en 4s; mostrando la interfaz y continuando en segundo plano.');
      setBooted(true);
      whenIndexedDbReady().then(hydrate).catch((err) => {
        console.warn('[boot] IndexedDB sigue sin estar disponible:', err && err.message || err);
      });
    }).catch((err) => {
      console.warn('[boot] fallo al inicializar la persistencia local:', err && err.message || err);
      if (!cancelled) setBooted(true);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!booted) return;
    perfReportBoot();
    const t = setTimeout(() => setBootVeilGone(true), 320);
    // Ya arrancados: en reposo se precargan (descarga + compilación) los
    // chunks diferidos que casi toda sesión acaba usando, para que la
    // primera base de datos o el primer canvas no esperen.
    prefetchWhenIdle([loadDatabaseBlock, loadCanvasView], 3000);
    return () => clearTimeout(t);
  }, [booted]);

  const vaultsV   = useYVersion(yVaults);
  const foldersV  = useYVersion(yFolders);
  const filesV    = useYVersion(yFiles);
  const settingsV = useYVersion(ySettings);
  const docV      = useYDocVersion();
  const allDocsV  = useAllVaultDocsVersion();
  // Holds the latest settings so callbacks defined BEFORE the `settings` memo
  // (e.g. doExportNote) can read it at call time without a TDZ on the dep array.
  const settingsRef = useRef(null);
  // yMeta + the comment/agent-task maps (comments panel, badges, toasts…).
  const metaV     = useCommentsVersion();

  const vaults = useMemo(() => Array.from(yVaults.values()), [vaultsV]);
  // Nota activa de ESTE equipo. Mientras el equipo no haya navegado nunca
  // (perfil nuevo) cae de vuelta a yMeta para aterrizar donde lo dejaste;
  // en cuanto tiene valor propio deja de seguir a los demás equipos.
  const [deviceActive, setDeviceActive] = useState(readDeviceActive);
  const activeId = useMemo(
    () => (deviceActive && deviceActive.id) || yMeta.get('activeId') || DEFAULTS.activeId,
    [deviceActive, metaV],
  );
  const activeVault = useMemo(
    () => (deviceActive && deviceActive.vaultId) || yMeta.get('activeVault') || DEFAULTS.activeVault,
    [deviceActive, metaV],
  );
  // Espejo en ref para los callbacks diferidos (timers) que antes releían
  // yMeta directamente. Ahora yMeta puede haber cambiado por culpa de OTRO
  // equipo, así que preguntarle a él "¿sigue el usuario en la misma nota?"
  // daría la respuesta equivocada.
  const activeRef = useRef({ id: null, vaultId: null });
  activeRef.current = { id: activeId, vaultId: activeVault };
  const defaultNoteId = useMemo(() => yMeta.get('defaultNoteId') || null, [metaV]);
  // Cross-vault aggregate in per-vault mode so the sidebar / Ctrl+P
  // sees every accessible vault's content, not just the active one.
  // docV bumps on any vault doc update so the memo recomputes when
  // a per-vault provider syncs new data. MUST come after activeVault
  // is declared or we hit TDZ at first render.
  // ACL UI-hide sets — derived from /grants/me. A 'none' grant for a
  // folder hides that folder + all its files; for a note hides just
  // that note. NOT a security boundary (server doesn't enforce Y.Doc
  // writes at this granularity); cosmetic only.
  // myGrants useState is hoisted here (was further down) because the
  // blockedFolders / blockedNotes memos below close over it — without
  // the hoist React-fn-component execution order hits TDZ when this
  // memo runs before the useState declaration.
  const [myGrants, setMyGrants] = useState([]);
  const blockedFolders = useMemo(() => {
    const s = new Set();
    for (const g of myGrants) {
      if (g.resource_type === 'folder' && g.level === 'none') s.add(String(g.resource_id));
    }
    return s;
  }, [myGrants]);
  const blockedNotes = useMemo(() => {
    const s = new Set();
    for (const g of myGrants) {
      if (g.resource_type === 'note' && g.level === 'none') s.add(String(g.resource_id));
    }
    return s;
  }, [myGrants]);
  // Stable identity (stabilizeList): allDocsV bumps while typing (it also
  // listens to the active note's doc), and a fresh `folders` array rebuilt
  // the sidebar tree index (a 3k-name localeCompare sort) on every bump.
  const foldersStableRef = useRef(null);
  const folders = useMemo(() => {
    const all = getAllFoldersAcrossVaults();
    const visible = !blockedFolders.size ? all : all.filter(f => !blockedFolders.has(String(f.id)));
    return (foldersStableRef.current = stabilizeList(foldersStableRef.current, visible));
  }, [foldersV, docV, allDocsV, activeVault, blockedFolders]);
  const filesMetaRef = useRef(null);
  const filesMeta = useMemo(() => {
    const all = getAllFilesAcrossVaults();
    const visible = (!blockedNotes.size && !blockedFolders.size) ? all : all.filter(f => {
      if (blockedNotes.has(String(f.id))) return false;
      if (f.folderId && blockedFolders.has(String(f.folderId))) return false;
      return true;
    });
    return (filesMetaRef.current = stabilizeList(filesMetaRef.current, visible));
  }, [filesV, docV, allDocsV, activeVault, blockedNotes, blockedFolders]);

  // External files: opened via OS file association or File → Open menu.
  // Stored locally only (not in yFiles / not synced) until user imports.
  // Each entry has its own local Y.Doc so CodeMirror can edit it normally.
  const [externalFiles, setExternalFiles] = useState([]); // {id, name, path}
  const externalDocsRef = useRef(new Map()); // id -> { ydoc, ytext, lastSavedAt, dirty }

  const getOrCreateExternalYText = useCallback((extId, initialContent) => {
    const cache = externalDocsRef.current;
    if (cache.has(extId)) return cache.get(extId).ytext;
    const doc = new Y.Doc();
    const text = doc.getText('content');
    if (initialContent) text.insert(0, initialContent);
    cache.set(extId, { ydoc: doc, ytext: text, lastSavedAt: Date.now(), dirty: false });
    return text;
  }, []);

  const isExternalId = (id) => typeof id === 'string' && id.startsWith('ext:');

  // Platform — used to hide mac-only traffic lights on Windows/Linux.
  const platform = (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.platform) || 'unknown';
  const isMacOS = platform === 'darwin';
  const isWindows = platform === 'win32';

  // Navigation history — back/forward stacks for wikilink browsing.
  // navigateTo pushes the current note onto `back`, clears `forward` (a
  // fresh navigation invalidates redo). goBack pops `back` → current,
  // pushes old current onto `forward`. goForward does the inverse.
  const navHistoryRef = useRef([]);            // back stack
  const navForwardRef = useRef([]);            // forward stack
  const pendingCreatedNoteIdsRef = useRef(new Set());
  const lastNewFileAtRef = useRef(0);
  const [navHistoryLen, setNavHistoryLen] = useState(0);
  const [navForwardLen, setNavForwardLen] = useState(0);
  // Salto pendiente a un ancla (#Título / #^id) tras abrir la nota.
  const [anchorReq, setAnchorReq] = useState(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const navigateTo = useCallback((nextId) => {
    if (!nextId || nextId === activeId) return;
    if (activeId) navHistoryRef.current.push(activeId);
    navForwardRef.current = [];                // fresh nav kills redo stack
    setNavHistoryLen(navHistoryRef.current.length);
    setNavForwardLen(0);
    setActiveId(nextId);
  }, [activeId]);
  // Live Preview wikilink clicks (the CodeMirror extension can't resolve note
  // names) — resolve here and navigate, mirroring the render-pane handler.
  useEffect(() => {
    const onWikiNav = (e) => {
      const full = e.detail && e.detail.name;
      if (!full) return;
      const { note: name, anchor } = splitWikiTarget(full);
      if (!name) { if (anchor) setAnchorReq({ noteId: activeIdRef.current, anchor, at: Date.now() }); return; }
      const norm = normalizeNoteName(name);
      let match = filesRef.current.find(f => normalizeNoteName(f.name) === norm);
      if (!match) { try { match = getAllFilesAcrossVaults().find(f => normalizeNoteName(f.name) === norm); } catch {} }
      if (match) {
        if (anchor) setAnchorReq({ noteId: match.id, anchor, at: Date.now() });
        navigateTo(match.id);
      }
    };
    window.addEventListener('edinot:wikinav', onWikiNav);
    return () => window.removeEventListener('edinot:wikinav', onWikiNav);
  }, [navigateTo]);
  const goBack = useCallback(() => {
    const prev = navHistoryRef.current.pop();
    if (prev == null) return;
    if (activeId) navForwardRef.current.push(activeId);
    setNavHistoryLen(navHistoryRef.current.length);
    setNavForwardLen(navForwardRef.current.length);
    setActiveId(prev);
  }, [activeId]);
  const goForward = useCallback(() => {
    const next = navForwardRef.current.pop();
    if (next == null) return;
    if (activeId) navHistoryRef.current.push(activeId);
    setNavHistoryLen(navHistoryRef.current.length);
    setNavForwardLen(navForwardRef.current.length);
    setActiveId(next);
  }, [activeId]);

  const activeMeta = isExternalId(activeId)
    ? externalFiles.find(f => f.id === activeId)
    : (filesMeta.find(f => f.id === activeId)
        // Fallback to the live store: a just-created note (Ctrl+N) lives in
        // the vault doc before the memoised filesMeta aggregate catches up,
        // so without this the editor would render blank for up to a tick.
        || (() => { const l = locateFileAcrossVaults(activeId); return l ? l.meta : null; })());

  // If the active file disappears from yFiles (most common cause: the MCP or
  // another peer deleted it while we had it open), switch to a sibling note
  // automatically instead of leaving the editor staring at an empty Y.Text.
  // We prefer a file in the same vault so the user's context stays put.
  // Skipped for external files (their lifecycle is local-only).
  //
  // CRITICAL: this must NOT fire during the boot/hydration window or right
  // after an activeVault switch, while the target vault's provider is still
  // syncing. In that gap filesMeta + locateFileAcrossVaults both report the
  // note as missing even though it exists — which used to bounce a freshly
  // restored note to the default note and then to filesMeta[0] (the first
  // created note) depending on which vault hydrated first. So we DEBOUNCE:
  // only fall back if the note is still missing after a grace period, and
  // we re-read live state inside the timer (the closed-over filesMeta is
  // stale by then). A genuine deletion persists past the grace window; a
  // provider that is merely still loading does not.
  const missingActiveTimerRef = useRef(null);
  const clearMissingActiveTimer = () => {
    if (missingActiveTimerRef.current) {
      clearTimeout(missingActiveTimerRef.current);
      missingActiveTimerRef.current = null;
    }
  };
  const fallbackFiredRef = useRef(false);
  useEffect(() => {
    if (!activeId) { clearMissingActiveTimer(); return; }
    if (isExternalId(activeId)) { clearMissingActiveTimer(); return; }
    if (filesMeta.some(f => f.id === activeId)) {
      pendingCreatedNoteIdsRef.current.delete(activeId);
      clearMissingActiveTimer();
      // Once we've successfully resolved the active id against the
      // filesMeta aggregate we lock the default-note fallback. After
      // this point any vault hiccup (reconnect, resync, AppImage
      // suspend/resume) must not yank the user back to their default
      // note — they were reading something else and a transient miss
      // is no reason to redirect.
      fallbackFiredRef.current = true;
      return;
    }
    // filesMeta is a memoised cross-vault aggregate that can lag a tick
    // behind a direct vault-doc write (e.g. Ctrl+N writes the new note
    // straight into the active vault's Y.Map, which doesn't always bump
    // the version dep that recomputes this memo in the same render).
    // Confirm against the live store before treating this as a deletion,
    // or the new note bounces back to an existing one while it sits in
    // the sidebar.
    if (locateFileAcrossVaults(activeId)) {
      pendingCreatedNoteIdsRef.current.delete(activeId);
      clearMissingActiveTimer();
      return;
    }
    if (pendingCreatedNoteIdsRef.current.has(activeId)) return;
    // Note is missing from every loaded vault. Don't react yet — schedule a
    // single deferred re-check. If a timer is already pending, leave it.
    if (missingActiveTimerRef.current) return;
    const startId = activeId;
    // Stretched from 2s → 8s. Vault providers can briefly drop entries
    // during reconnect/resync (suspend/resume on Linux WMs is the worst
    // offender), and a tight 2s window was bouncing users back to the
    // configured default note while they were still reading their
    // current one. 8s lets re-hydration finish before we panic.
    missingActiveTimerRef.current = setTimeout(() => {
      missingActiveTimerRef.current = null;
      // Re-read everything live; the captured filesMeta is stale by now.
      if ((activeRef.current.id || null) !== startId) return;  // user moved on
      if (locateFileAcrossVaults(startId)) return;             // vault hydrated
      if (pendingCreatedNoteIdsRef.current.has(startId)) return;
      // Double-check via the cross-vault aggregator. If ANY vault knows
      // this id, it'll surface here even if the registry's still
      // settling.
      if (getAllFilesAcrossVaults().some(f => f.id === startId)) return;
      const allNow = getAllFilesAcrossVaults();
      // Only fall back to the configured default note on the very first
      // bounce of a session. After that the user has been driving the
      // active id explicitly, and yanking them around because a vault
      // momentarily lost the file is worse than leaving the pane empty.
      if (!fallbackFiredRef.current) {
        fallbackFiredRef.current = true;
        const def = yMeta.get('defaultNoteId');
        if (def && allNow.some(f => f.id === def)) { setActiveId(def); return; }
        const av = activeRef.current.vaultId || 'default';
        const sameVault = allNow.filter(f => (f.vaultId || 'default') === av);
        const fallback = sameVault[0] || allNow[0] || null;
        setActiveId(fallback ? fallback.id : null);
      }
    }, 8000);
  }, [filesMeta, activeId, activeVault]);
  // Clear any pending fallback timer on unmount.
  useEffect(() => () => clearMissingActiveTimer(), []);

  // Watch the active file's Y.Text so the textarea/render see live content.
  // ACL Fase D — calling getNoteDoc materialises the per-note registry
  // entry synchronously during render so getContent returns the
  // per-note Y.Text on the FIRST render (rather than the vault-doc
  // fallback that would then swap underneath the editor 1s later when
  // the registry poll fires, losing edits made in that window).
  if (activeMeta && !isExternalId(activeId)) getNoteDoc(activeId);
  const activeContentText = activeMeta
    ? (isExternalId(activeId)
        ? (externalDocsRef.current.get(activeId) || {}).ytext || null
        : getContent(activeMeta.id))
    : null;
  // Paced (not per-keystroke) so the giant App tree re-renders at a fixed
  // cadence while typing instead of once per character — the main typing-lag
  // fix. CodeMirror paints every key from Yjs directly; this only gates the
  // React-derived UI (counts, save pulse, render pane via its own debounce).
  // ~250ms ≈ 4 renders/sec under sustained typing — leaves more frame budget
  // for keystrokes on slow machines; the derived UI tolerates the extra trail.
  const contentV = useThrottledYVersion(activeContentText, 250);
  // Trails contentV so cross-note aggregates (files serialization, backlink
  // scans) recompute when typing pauses rather than on every keystroke.
  const contentVDebounced = useDebouncedValue(contentV, 300);
  const activeContent = useMemo(
    () => activeContentText ? activeContentText.toString() : '',
    [activeContentText, contentV]
  );
  // Debounced snapshot of the active note's text — drives the titlebar
  // wiki-nav counts so the all-notes backlink scan doesn't run per key.
  const activeContentDebounced = useMemo(
    () => activeContentText ? activeContentText.toString() : '',
    [activeContentText, contentVDebounced]
  );
  const active = activeMeta ? { ...activeMeta, content: activeContent } : null;
  // Always-current source for the render-effect pointer handlers (column /
  // image resize, inline-canvas writes). The render layout effect is debounced
  // and may have been attached a beat ago, so handlers read live content from
  // this ref instead of the (possibly stale) captured `active.content`.
  const activeContentRef = useRef('');
  activeContentRef.current = activeContent;
  const activeYTextRef = useRef(null);
  activeYTextRef.current = activeContentText || null;
  const activeCommentsSummary = useMemo(() => {
    const list = active ? readNoteComments(ydoc, active.id) : [];
    const roots = list.filter(c => !c.parentId);
    const unresolvedRoots = roots.filter(c => !c.resolved);
    // The visible count includes replies: a thread is "open" while its
    // root is unresolved, and every reply inside it counts too — so an
    // incoming reply bumps the badge instead of staying invisible.
    const byId = new Map(list.map(c => [c.id, c]));
    const resolvedRootIds = new Set(roots.filter(c => c.resolved).map(c => c.id));
    const rootIdOf = (c) => {
      let cur = c, guard = 0;
      while (cur && cur.parentId && byId.has(cur.parentId) && guard++ < 60) cur = byId.get(cur.parentId);
      return cur ? cur.id : c.id;
    };
    const openComments = list.filter(c => !resolvedRootIds.has(rootIdOf(c)));
    return {
      total: list.length,
      roots: roots.length,
      unresolved: openComments.length,
      resolved: roots.filter(c => c.resolved).length,
      pending: unresolvedRoots.filter(c => c.kind === 'question' && c.awaitingReply !== false).length,
    };
  }, [metaV, active && active.id]);

  // activeNoteLevel / activeNoteReadOnly are computed further down
  // (after resolveAclLevel + currentRole + syncConfigState declare).
  // Moved out of this block to avoid a TDZ at first render.

  // ─── Y.Doc-backed setters that preserve the old array-shaped API ──────────
  const setVaults = useCallback((updater) => {
    const current = Array.from(yVaults.values());
    const next = typeof updater === 'function' ? updater(current) : updater;
    ydoc.transact(() => {
      const ids = new Set(next.map(v => v.id));
      for (const id of Array.from(yVaults.keys())) if (!ids.has(id)) yVaults.delete(id);
      for (const v of next) yVaults.set(v.id, { id: v.id, name: v.name, ...(v.color ? { color: v.color } : null), ...(v.icon ? { icon: v.icon } : null) });
    });
  }, []);

  const setFiles = useCallback((updater) => {
    const current = Array.from(yFiles.values()).map(m => ({
      ...m, content: getContent(m.id).toString(),
    }));
    const next = typeof updater === 'function' ? updater(current) : updater;
    ydoc.transact(() => {
      const ids = new Set(next.map(f => f.id));
      for (const id of Array.from(yFiles.keys())) {
        if (!ids.has(id)) { yFiles.delete(id); deleteContent(id); }
      }
      for (const f of next) {
        const { content, ...meta } = f;
        yFiles.set(f.id, meta);
        const prev = getContent(f.id).toString();
        if (content !== undefined && content !== prev) setContent(f.id, content);
      }
    });
  }, []);

  // Actualiza la nota activa de este equipo y la propaga a yMeta para que
  // el MCP siga viendo qué miras. El resto de equipos NO reaccionan a esa
  // escritura: cada uno renderiza desde su propio deviceActive.
  const adoptDeviceActive = useCallback((id, vaultId) => {
    setDeviceActive((prev) => {
      const next = {
        id: id || null,
        vaultId: vaultId || (prev && prev.vaultId) || null,
      };
      writeDeviceActive(next);
      return (next.id || next.vaultId) ? next : null;
    });
  }, []);

  // ── Shell: vista, barra lateral, panel de contexto, Ctrl K ──────────────
  // `view` es la página principal: 'home' | 'note'. Calendario y Ajustes
  // siguen siendo modales (calendarOpen / settingsOpen) y `routeView` los
  // expone como ruta para la barra lateral; cuando existan como páginas
  // basta con pintarlas aquí según routeView. `null` = aún sin decidir
  // (arranque): se resuelve al hidratar (última nota → 'note', si no Inicio).
  const [view, setView] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('edinot.shell.sidebar.v1') === 'rail'; } catch { return false; }
  });
  const toggleSidebarPref = useCallback(() => setSidebarCollapsed(v => {
    try { localStorage.setItem('edinot.shell.sidebar.v1', v ? 'full' : 'rail'); } catch {}
    return !v;
  }), []);
  // Calendario: la barra lateral se queda en carril para que la semana
  // tenga columnas anchas (con la barra completa salían ~82px a 1440).
  // Desplegarla ahí es temporal: al salir del calendario vuelve a carril
  // y no toca la preferencia guardada.
  const [calSideExpanded, setCalSideExpanded] = useState(false);
  const calRailRef = useRef(false);
  const toggleSidebar = useCallback(() => {
    if (calRailRef.current) setCalSideExpanded(v => !v);
    else toggleSidebarPref();
  }, [toggleSidebarPref]);
  const [ctxPanelOpen, setCtxPanelOpenRaw] = useState(() => {
    try { return localStorage.getItem('edinot.shell.panel.v1') !== 'closed'; } catch { return true; }
  });
  const setCtxPanelOpen = useCallback((v) => setCtxPanelOpenRaw(prev => {
    const next = typeof v === 'function' ? v(prev) : v;
    try { localStorage.setItem('edinot.shell.panel.v1', next ? 'open' : 'closed'); } catch {}
    return next;
  }), []);
  const [ctxTab, setCtxTab] = useState('context'); // 'context' | 'comments'
  const [palette, setPalette] = useState(null);     // null | { filter }
  const openPalette = useCallback((filter = 'all', query = '') => setPalette({ filter, query, at: Date.now() }), []);

  const setActiveId = useCallback((id) => {
    if (id == null) { adoptDeviceActive(null, null); yMeta.delete('activeId'); return; }
    setView('note');
    adoptDeviceActive(id, null);
    yMeta.set('activeId', id);
    // Follow the note's vault. Critical for per-vault mode — when the
    // user picks a note in another vault from Ctrl+P, the active vault
    // must update so our useEffect spins up that vault's provider.
    // We look the file up wherever it currently lives: per-vault mode
    // means we scan all loaded vault docs; legacy mode reads from the
    // workspace yFiles. Best-effort; if not found we leave activeVault
    // alone so the user doesn't end up in a non-existent vault.
    try {
      let fileVaultId = null;
      if (isPerVaultMode()) {
        for (const e of listVaultRegistryEntries()) {
          const meta = e.yFiles.get(id);
          if (meta) { fileVaultId = e.vaultId; break; }
        }
        // Fallback: also check legacy in case migration leftover.
        if (!fileVaultId) {
          const legacy = yFiles.get(id);
          if (legacy && legacy.vaultId) fileVaultId = legacy.vaultId;
        }
      } else {
        const legacy = yFiles.get(id);
        if (legacy && legacy.vaultId) fileVaultId = legacy.vaultId;
      }
      if (fileVaultId) {
        adoptDeviceActive(id, fileVaultId);
        if (fileVaultId !== yMeta.get('activeVault')) yMeta.set('activeVault', fileVaultId);
      }
    } catch {}
    // Track open count + last-visited timestamp per file. Used by the
    // global search ranking to surface frequently-opened notes higher.
    const cur = yMeta.get('fileStats');
    const stats = (cur && typeof cur === 'object') ? { ...cur } : {};
    const prev = stats[id] || { c: 0, t: 0 };
    stats[id] = { c: (prev.c || 0) + 1, t: Date.now() };
    yMeta.set('fileStats', stats);
  }, [adoptDeviceActive]);
  const setActiveVault = useCallback((id) => {
    setDeviceActive((prev) => {
      const next = { id: (prev && prev.id) || null, vaultId: id || null };
      writeDeviceActive(next);
      return (next.id || next.vaultId) ? next : null;
    });
    yMeta.set('activeVault', id);
  }, []);

  // Al arrancar, este equipo adopta como propia la última nota activa
  // conocida (para aterrizar donde lo dejaste) y a partir de ahí deja de
  // seguir a los demás equipos. Sin esto, un equipo recién abierto que aún
  // no ha navegado seguiría heredando cada cambio de yMeta.
  const adoptedRef = useRef(false);
  useEffect(() => {
    if (adoptedRef.current || !booted) return;
    if (deviceActive && deviceActive.id) { adoptedRef.current = true; return; }
    const id = yMeta.get('activeId') || null;
    if (!id) return;
    adoptedRef.current = true;
    adoptDeviceActive(id, yMeta.get('activeVault') || null);
  }, [booted, metaV, deviceActive, adoptDeviceActive]);

  // Cold-launch default note. Once per session, after the vault docs
  // have hydrated, jump to the user-configured `defaultNoteId` if it
  // still exists. Never repeats during the session — the user can
  // navigate freely without snapping back.
  //
  // Read defaultNoteId/activeId straight from yMeta inside the effect
  // (rather than the memoised props) so a late hydration doesn't lose
  // the value to a stale closure.
  const bootedDefaultRef = useRef(false);
  useEffect(() => {
    if (bootedDefaultRef.current) return;
    const def = yMeta.get('defaultNoteId') || null;
    // "Lo que estaba activo antes" es lo de ESTE equipo. Mirar yMeta haría
    // que la nota abierta en otro equipo cuente como sesión previa aquí.
    const cur = activeRef.current.id || null;
    // Respect a previously-active note. If the user closed the app
    // reading note Y, we keep Y on relaunch instead of bouncing to the
    // default note X. The fallback only fires when nothing was active
    // before.
    if (cur) { bootedDefaultRef.current = true; return; }
    if (!def) { bootedDefaultRef.current = true; return; }
    const visible = filesMeta.some(f => f.id === def) || !!locateFileAcrossVaults(def);
    if (!visible) return;
    bootedDefaultRef.current = true;
    setActiveId(def);
  }, [filesMeta, metaV]);

  // Safety net for the very first cold launch: if no activeId is
  // persisted yet AND no provider has hydrated by 1.5s, jump to the
  // configured default. Skips entirely if the user already has an
  // active note from a prior session.
  useEffect(() => {
    const id = setTimeout(() => {
      if (bootedDefaultRef.current) return;
      const cur = activeRef.current.id || null;
      if (cur) { bootedDefaultRef.current = true; return; }
      const def = yMeta.get('defaultNoteId') || null;
      if (!def) { bootedDefaultRef.current = true; return; }
      if (!locateFileAcrossVaults(def)) return;
      bootedDefaultRef.current = true;
      setActiveId(def);
    }, 1500);
    return () => clearTimeout(id);
  }, [setActiveId]);

  // Vista de arranque: la última nota abierta (de este equipo o la del
  // workspace) o la nota por defecto → 'note'; perfil sin historial → Inicio.
  useEffect(() => {
    if (!booted || view !== null) return;
    // (El activeId que siembra un perfil nuevo no cuenta: sólo una nota que
    // de verdad se abrió — fileStats — o la nota por defecto configurada.)
    let had = null;
    try {
      const stats = yMeta.get('fileStats') || {};
      const mine = readDeviceActive() && readDeviceActive().id;
      const wsActive = yMeta.get('activeId');
      had = (mine && stats[mine] ? mine : null)
        || (wsActive && stats[wsActive] ? wsActive : null)
        || yMeta.get('defaultNoteId') || null;
    } catch {}
    setView(had ? 'note' : 'home');
  }, [booted, view]);

  // files-with-content view, kept for compatibility with code that reads it
  // Identidad estable por nota (ver stabilizeList): sólo cambia el objeto
  // de la nota cuyo contenido o metadatos cambiaron, y el array entero sólo
  // si algo cambió — así los memos que dependen de `files` no se relanzan en
  // cada bump de sincronización.
  // Per-meta cache (WeakMap on the stabilized meta object): an unchanged
  // note reuses its previous `{ ...meta, content }` object without
  // allocating or shallow-comparing — with thousands of notes the old
  // map+stabilizeList pass was a per-bump cost while typing.
  const filesStableRef = useRef(null);
  const filesObjCacheRef = useRef(null);
  if (!filesObjCacheRef.current) filesObjCacheRef.current = new WeakMap();
  const files = useMemo(() => {
    const cache = filesObjCacheRef.current;
    const prev = filesStableRef.current;
    let same = Array.isArray(prev) && prev.length === filesMeta.length;
    const out = new Array(filesMeta.length);
    for (let i = 0; i < filesMeta.length; i++) {
      const m = filesMeta[i];
      const content = getContentString(m.id);
      let o = cache.get(m);
      if (!o || o.content !== content) { o = { ...m, content }; cache.set(m, o); }
      out[i] = o;
      if (same && prev[i] !== o) same = false;
    }
    return (filesStableRef.current = same ? prev : out);
  }, [filesMeta, filesV, contentVDebounced, activeId, docV, allDocsV]);

  // Search index (ui/search, Web Worker): seeded on idle after boot, then
  // kept in step with `files` — sync() only posts the notes whose text
  // changed (identity compare against what it last sent), debounced so
  // typing costs nothing here.
  useEffect(() => {
    if (!booted) return;
    const id = setTimeout(() => runWhenIdle(() => { searchIndex.sync(files); }, 2000), searchIndex.seeded ? 900 : 1500);
    return () => clearTimeout(id);
  }, [booted, files]);

  // Reverse wikilink index (Fase 4b): normalized note-name → [fileId, …] of
  // the notes that link to it. Built from the per-note cached outgoing links
  // (no regex re-run for unchanged notes), so backlink counts and the
  // WikiNavPanel list become O(1) name lookups instead of scanning every
  // note's content on each keystroke.
  const backIndex = useMemo(() => {
    const idx = new Map();
    for (const f of files) {
      for (const key of outgoingLinkKeys(f.id, f.content)) {
        let arr = idx.get(key);
        if (!arr) { arr = []; idx.set(key, arr); }
        arr.push(f.id);
      }
    }
    return idx;
  }, [files]);

  // Bases de datos (cada tabla de cada nota) y etiquetas, para la barra
  // lateral, Ctrl K, «/ Vista enlazada» y las sugerencias de etiquetas. Con
  // caché por nota (ui/shared/workspaceIndex.js) y en diferido.
  const filesForIndex = useDeferredValue(files);
  const tableEntries = useMemo(() => buildTableIndex(filesForIndex, parseSourceTables), [filesForIndex]);
  const tagIndex = useMemo(() => buildTagIndex(filesForIndex, parseSourceTables), [filesForIndex]);
  const tagList = useMemo(() => [...tagIndex.values()]
    .sort((a, b) => b.ids.length - a.ids.length || a.tag.localeCompare(b.tag)), [tagIndex]);
  const tagNames = useMemo(() => tagList.map(x => x.tag), [tagList]);
  const dbNoteIds = useMemo(() => new Set(files.filter(f => f.kind === 'database').map(f => f.id)), [files]);

  // Counts for the wiki-nav titlebar pill (outgoing + backlinks). Lifted
  // out of WikiNavPanel so the badge can render before the panel opens.
  const wikiNavCounts = useMemo(() => {
    if (!active) return { outgoing: 0, backlinks: 0, total: 0 };
    const outNames = extractWikilinks(activeContentDebounced || '');
    const outKeys = new Set();
    for (const n of outNames) outKeys.add(normalizeNoteName(n));
    const myKey = normalizeNoteName(active.name || '');
    const backIds = backIndex.get(myKey) || [];
    let backlinks = 0;
    for (const id of backIds) if (id !== active.id) backlinks += 1;
    const outgoing = outKeys.size;
    return { outgoing, backlinks, total: outgoing + backlinks };
  }, [active && active.id, activeContentDebounced, active && active.name, backIndex]);

  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);
  const foldersRef = useRef([]);
  // Keyed on foldersV — deps-less it re-materialized the folder array on
  // EVERY App render (i.e. several times/sec while typing) for nothing.
  useEffect(() => { foldersRef.current = Array.from(yFolders.values()); }, [foldersV]);
  // Notes that hold a `edinot-canvas` fenced block — fuel for the canvas
  // embed picker shown in the format toolbar.
  // Per-note cached (WeakMap on the stabilized file object — only the note
  // whose content changed gets re-tested), so typing doesn't re-scan the
  // whole vault's text on every bump.
  const canvasNotesRef = useRef(null);
  const canvasNotes = useMemo(
    () => (canvasNotesRef.current = stabilizeList(canvasNotesRef.current, files.filter(holdsCanvasBlock))),
    [files]
  );

  // Nombre normalizado → id para resolver [[wikilinks]]. Se recalcula sólo
  // cuando cambia el conjunto de nombres, no con cada edición de contenido:
  // antes el renderer (un MarkdownIt nuevo) y el render completo de la nota
  // activa se rehacían con cada cambio de `files`.
  // Names live in the metadata: keyed on filesMeta (stable while typing)
  // instead of `files` (new on every content bump).
  const wikiNamesSig = useMemo(
    () => filesMeta.map(f => f.id + '\u0000' + f.name).join('\u0001'),
    [filesMeta]
  );
  const wikiNameIndex = useMemo(() => {
    const idx = new Map();
    for (const f of files) {
      const norm = normalizeNoteName(f.name || '');
      if (!idx.has(norm)) idx.set(norm, f.id);
    }
    return idx;
  }, [wikiNamesSig]);
  const mdRenderer = useMemo(() => createMdRenderer({
    resolveWikilink: (name) => wikiNameIndex.get(normalizeNoteName(name)) ?? null,
    getNoteContent: (id) => getContentString(id),
  }), [wikiNameIndex]);
  // Stable getter the Live Preview CodeMirror extension uses to render block
  // fragments (tables/images/code) with the SAME markdown-it instance as the
  // render pane. A ref so the editor never rebuilds when the renderer changes.
  const renderMdRef = useRef(null);
  renderMdRef.current = (src) => {
    try { return mdRenderer.render(resolveDateShortcuts(stripViewDirectives(src || ''))); }
    catch { return ''; }
  };
  // Source that drives the render pane — trails typing by RENDER_DEBOUNCE_MS so
  // the markdown-it parse, innerHTML rewrite and table re-enhancement below
  // don't run synchronously on every keystroke (the main cause of typing lag in
  // dual/render mode). Snaps immediately when the active note changes.
  const renderSrc = useDebouncedValueKeyed(
    active ? active.content : '',
    active ? active.id : null,
    RENDER_DEBOUNCE_MS,
  );
  const renderedHtml = useMemo(
    () => mdRenderer.render(resolveDateShortcuts(stripViewDirectives(renderSrc))),
    [mdRenderer, renderSrc]
  );
  // Note-name list for wikilink column pickers (datalist). Cross-vault so a
  // cell can link anywhere. Recomputed only when the doc set changes, not on
  // every cell-editor keystroke.
  const tableNoteNames = useMemo(() => {
    let list;
    try { list = getAllFilesAcrossVaults(); } catch { list = files; }
    return [...new Set((list || files || []).map(f => (f.name || '').replace(/\.(md|markdown|txt)$/i, '')).filter(Boolean))];
    // filesMeta already follows allDocsV (and is identity-stable): names
    // don't change while typing, so this no longer rebuilds per keystroke.
  }, [filesMeta]);
  // Export the active note to PDF / HTML / Markdown via the Electron main
  // process. Prefer the live render DOM (typed-cell pills already applied)
  // over the raw markdown-it output so exported tables keep their styling.
  const doExportNote = useCallback(async (format) => {
    if (!active || !window.electronAPI || !window.electronAPI.noteExport) return;
    // Build the export HTML from a CLONE of the render DOM with interactive
    // chrome stripped — otherwise the ↗ Open / 📥 Download attachment buttons,
    // image resize grips, code "Copiar" buttons and table toolbars all bleed
    // into the exported PDF/HTML.
    const STRIP_FOR_EXPORT = [
      '.md-attach-actions',   // ↗ Abrir / 📥 Descargar on attachments
      '.md-img-grip',         // image resize handle
      '.md-code-copy',        // code-block "Copiar" button
      '.blk-noexport',        // «Añadir icono/propiedad» de la cabecera de página
    ].join(',');
    let liveHtml;
    const srcEl = (typeof document !== 'undefined') ? document.querySelector('.md-render') : null;
    let container;
    if (srcEl) { container = srcEl.cloneNode(true); }
    // No live render DOM (e.g. exporting from markdown-only mode): render fresh
    // from the current source rather than the debounced `renderedHtml`, which
    // could trail the last keystroke by a debounce window.
    else { container = document.createElement('div'); container.innerHTML = mdRenderer.render(resolveDateShortcuts(stripViewDirectives(active.content || ''))); }
    try { container.querySelectorAll(STRIP_FOR_EXPORT).forEach(el => el.remove()); } catch {}
    // Bloques de base de datos → tabla estática (filtrada/ordenada, con tipos).
    try {
      const parsed = parseSourceTables(active.content || '');
      container.querySelectorAll('.db-mount[data-db-idx]').forEach((el) => {
        const meta = parsed[Number(el.dataset.dbIdx)];
        const tmp = document.createElement('div');
        tmp.innerHTML = meta ? staticTableHtml(meta, (x) => mdRenderer.renderInline(x)) : '';
        el.replaceWith(...tmp.childNodes);
      });
      // Vistas enlazadas → la tabla de origen, con la vista del bloque.
      container.querySelectorAll('.db-mount-linked[data-linked-cfg]').forEach((el) => {
        const cfg = parseLinkedConfig(el.dataset.linkedCfg);
        const src = cfg ? linkedDbEnv.read(cfg.note) : null;
        const tables = src == null ? [] : parseSourceTables(src);
        const i = resolveLinkedTable(tables, cfg);
        const meta = i >= 0 ? parseSourceTables(virtualSource(src, tables[i], cfg.dir))[i] : null;
        const tmp = document.createElement('div');
        tmp.innerHTML = meta ? staticTableHtml(meta, (x) => mdRenderer.renderInline(x)) : '';
        el.replaceWith(...tmp.childNodes);
      });
    } catch {}
    liveHtml = container.innerHTML;
    const res = await window.electronAPI.noteExport({
      format,
      name: active.name,
      markdown: active.content || '',
      html: format === 'md' ? '' : liveHtml,
      // Company letterhead (logo + alignment) from settings — PDF/HTML/DOCX.
      letterhead: (() => {
        const s = settingsRef.current || {};
        return (format !== 'md' && s.exportLogo)
          ? { logo: s.exportLogo, align: s.exportLogoAlign || 'left' }
          : null;
      })(),
    });
    if (res && !res.ok && !res.canceled && res.error) window.alert(t('export.note.fail', { err: res.error }));
  }, [active, renderedHtml, mdRenderer]);
  const tablesParsed = useMemo(
    () => parseSourceTables(renderSrc),
    [renderSrc]
  );
  const renderRef = useRef(null);
  // (1.2) Buscador de la nota en modo Leer (Ctrl/⌘ F): { key, initial } | null.
  const [readFind, setReadFind] = useState(null);
  const getReadRoot = useCallback(() => renderRef.current, []);
  // El texto vivo de la nota, para que el buscador del canvas busque en la página.
  const pageSourceForFind = useCallback(() => (activeYTextRef.current ? activeYTextRef.current.toString() : ''), []);

  const [formBuilder, setFormBuilder] = useState(null); // { mode:'create'|'edit', anchorTableIdx?, blockIdx?, cfg? }
  // Context handed to the live-preview editor so its table widgets reuse the
  // exact same interactivity (modals + source transforms) as the Render pane.
  const liveTableCtxRef = useRef(null);
  // Raíces React de los bloques de base de datos (Live y Leer), por nota+tabla.
  const liveDbCacheRef = useRef(null);
  if (!liveDbCacheRef.current) liveDbCacheRef.current = new Map();
  const renderDbCacheRef = useRef(null);
  if (!renderDbCacheRef.current) renderDbCacheRef.current = new Map();
  // Excel de una tabla (lo usa el ⋯ del bloque). `function` para que se
  // pueda llamar desde el literal de arriba sin TDZ.
  function exportTableXlsx(tIdx, data) {
    if (!window.electronAPI || !window.electronAPI.tableExportXlsx) { window.alert(t('tbl.exportXlsx.unavailable')); return; }
    const base = (active && active.name ? active.name : 'nota').replace(/\.(md|markdown|txt)$/i, '');
    window.electronAPI.tableExportXlsx({
      headers: data.headers, rows: data.rows,
      defaultName: `${base}-tabla${tIdx + 1}.xlsx`, sheetName: base.slice(0, 28) || 'Tabla',
    }).then((res) => { if (res && !res.ok && !res.canceled && res.error) window.alert(t('tbl.exportXlsx.fail', { err: res.error })); });
  }
  // Entorno de las vistas enlazadas (editor/db/linked.jsx): leer, observar y
  // escribir la nota de origen. Estable entre renders; lo que se declara más
  // abajo (jumpToMatch…) se lee de linkedApiRef al usarlo.
  const linkedApiRef = useRef({});
  const linkedDbEnv = useMemo(() => {
    const fileOf = (id) => {
      let f = (filesRef.current || []).find(x => x.id === id);
      if (!f) { try { f = getAllFilesAcrossVaults().find(x => x.id === id); } catch {} }
      return f || null;
    };
    return {
      read: (id) => {
        const f = fileOf(id);
        if (!f) return null;
        let txt = '';
        try { const yt = getContent(id); txt = yt ? yt.toString() : ''; } catch {}
        if (txt) return txt;
        return typeof f.content === 'string' ? f.content : null;
      },
      subscribe: (id, fn) => {
        let yt = null;
        try { yt = getContent(id); } catch {}
        if (!yt) return () => {};
        const h = () => fn();
        yt.observe(h);
        return () => { try { yt.unobserve(h); } catch {} };
      },
      write: (id, src) => linkedApiRef.current.write && linkedApiRef.current.write(id, src),
      noteName: (id) => { const f = fileOf(id); return f ? String(f.name || '').replace(/\.(md|markdown|txt)$/i, '') : ''; },
      open: (id, line) => linkedApiRef.current.open && linkedApiRef.current.open(id, line),
      canEdit: (id) => !!(linkedApiRef.current.canEdit && linkedApiRef.current.canEdit(id)),
    };
  }, []);
  liveTableCtxRef.current = {
    linkedEnv: linkedDbEnv,
    // Live Y.Text content (falls back to the render-state copy while the
    // note's text isn't bound yet) so widget edits never start from a lag.
    getSource: () => { const yt = activeYTextRef.current; return yt ? yt.toString() : activeContentRef.current; },
    // Lazy wrappers: mutateActiveSource / askPrompt / askConfirm are declared
    // further down the component — reading them eagerly in this literal during
    // render would hit the TDZ. Arrows defer the read to call time.
    mutateSource: (s) => mutateActiveSource(s),
    askPrompt: (title, def) => askPrompt(title, def),
    askConfirm: (msg, opts) => askConfirm(msg, opts),
    navigateTo,
    setFormBuilder,
    // Base de datos (editor/db): el bloque lee esto en el momento de usarlo
    // (getters: varias de estas constantes se declaran más abajo).
    dbCtxRef: liveTableCtxRef,
    dbCache: liveDbCacheRef.current,
    noteId: active ? active.id : null,
    get readOnly() { return isViewer; },
    get members() { return workspaceMembers; },
    noteNames: tableNoteNames,
    onAttach: (file) => uploadCanvasAttachment(file),
    renderInline: (src) => mdRenderer.renderInline(resolveDateShortcuts(src)),
    renderMarkdown: (src) => mdRenderer.render(resolveDateShortcuts(stripViewDirectives(src || ''))),
    openWikilink: (name) => { try { window.dispatchEvent(new CustomEvent('edinot:wikinav', { detail: { name } })); } catch {} },
    getNote: (name) => {
      const norm = normalizeNoteName(name || '');
      let f = (filesRef.current || []).find(x => normalizeNoteName(x.name || '') === norm);
      if (!f) { try { f = getAllFilesAcrossVaults().find(x => normalizeNoteName(x.name || '') === norm); } catch {} }
      if (!f) return null;
      let content = '';
      try { content = getContentString ? getContentString(f.id) : getContent(f.id).toString(); } catch { content = ''; }
      return { id: f.id, name: f.name, content };
    },
    exportXlsx: (tIdx, data) => exportTableXlsx(tIdx, data),
    openFormBuilder: (tIdx) => setFormBuilder({ mode: 'create', anchorTableIdx: tIdx }),
  };
  const [mode, setMode] = useState('render'); // 'markdown' | 'render' | 'dual' | 'live'
  // El buscador de Leer se cierra al cambiar de modo o de nota.
  useEffect(() => { setReadFind(null); }, [mode, activeId]);

  // ── Página ↔ Canvas (1.2) ─────────────────────────────────────────────
  // Cada nota se ve como página o como canvas, con el mismo contenido. La
  // elección es de cada persona (no se sincroniza: dos personas pueden ver
  // la misma nota en modos distintos) y se recuerda por nota. Sin elección,
  // un canvas de los de antes (la nota es solo su tablero) abre en Canvas y
  // el resto en Página.
  const [surfaceChoice, setSurfaceChoice] = useState(() => readSurfaceChoices());
  const activeSurface = active ? surfaceOfNote(active, surfaceChoice) : 'page';
  const activeSurfaceRef = useRef(activeSurface);
  activeSurfaceRef.current = activeSurface;

  // Publish the current view mode to yMeta so the MCP store's _switchActive
  // gate can read it. While the user is in 'markdown' or 'dual' they're
  // actively editing — the AI shouldn't yank the active note out from under
  // them. 'render' is passive (read-only preview) so switches are fine.
  useEffect(() => {
    try { yMeta.set('userMode', mode); } catch {}
  }, [mode]);

  // Leer → Editar con doble clic: dejar el cursor en la palabra pulsada (la
  // ocurrencia cuyo entorno en el Markdown más se parece al bloque leído).
  const pendingCaretRef = useRef(null);
  useEffect(() => {
    const want = pendingCaretRef.current;
    if (mode !== 'live' || !want) return;
    pendingCaretRef.current = null;
    const id = setTimeout(() => {
      const v = cmViewRef.current;
      if (!v || !want.word) return;
      const src = v.state.doc.toString();
      const ctxWords = new Set(String(want.context).toLowerCase().split(/\W+/).filter(w => w.length > 2));
      let best = -1, bestScore = -1;
      for (let i = src.indexOf(want.word); i >= 0 && i < src.length; i = src.indexOf(want.word, i + 1)) {
        const around = src.slice(Math.max(0, i - 120), i + 120).toLowerCase().split(/\W+/);
        let score = 0;
        for (const w of around) if (ctxWords.has(w)) score++;
        if (score > bestScore) { bestScore = score; best = i; }
      }
      if (best < 0) return;
      v.focus();
      v.dispatch({ selection: { anchor: best, head: best + want.word.length }, scrollIntoView: true });
    }, 60);
    return () => clearTimeout(id);
  }, [mode]);

  // Modo recordado por nota (solo en este equipo): al abrir una nota vuelve
  // al último modo que se usó en ella. Las notas nuevas abren en «Editar»
  // (lo fijan los flujos de creación). Sin recuerdo, se queda el modo actual.
  const modeNoteRef = useRef(null);
  useEffect(() => {
    if (!activeId) return;
    modeNoteRef.current = activeId;
    const m = readNoteModes()[activeId];
    if (m && m !== mode && ['render', 'live', 'dual', 'markdown'].includes(m)) setMode(m);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  useEffect(() => {
    if (!activeId || modeNoteRef.current !== activeId) return;
    const map = readNoteModes();
    if (map[activeId] === mode) return;
    delete map[activeId];
    map[activeId] = mode;
    const keys = Object.keys(map);
    if (keys.length > 600) for (const k of keys.slice(0, keys.length - 600)) delete map[k];
    try { localStorage.setItem(NOTE_MODES_KEY, JSON.stringify(map)); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Broadcast HTML-side selection to yMeta so the MCP `get_editor_selection`
  // tool can see what the user picked in render mode (not just CodeMirror).
  // Approximate source offsets via indexOf; if the selected substring is
  // unique in the source we get accurate from/to, otherwise we still publish
  // the text so the MCP can fall back to a text-only payload.
  useEffect(() => {
    if (mode !== 'render') return;
    if (!active) return;
    const root = renderRef.current;
    if (!root) return;
    let lastPushed = null;
    let debounce = null;
    const handler = () => {
      const sel = typeof window !== 'undefined' ? window.getSelection() : null;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        if (lastPushed) {
          const cur = yMeta.get('editorSelection');
          if (cur && cur.fileId === active.id) yMeta.delete('editorSelection');
          lastPushed = null;
        }
        return;
      }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const text = sel.toString().trim();
      if (!text) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        const src = active.content || '';
        const first = src.indexOf(text);
        const second = first >= 0 ? src.indexOf(text, first + 1) : -1;
        const unique = first >= 0 && second < 0;
        const payload = unique
          ? { fileId: active.id, from: first, to: first + text.length, text, source: 'render' }
          : { fileId: active.id, text, source: 'render' };
        yMeta.set('editorSelection', payload);
        lastPushed = text;
      }, 120);
    };
    document.addEventListener('selectionchange', handler);
    return () => {
      document.removeEventListener('selectionchange', handler);
      if (debounce) clearTimeout(debounce);
    };
  }, [mode, active && active.id, active && active.content]);

  // Mutate the source markdown of the active note, respecting Yjs-backed vs.
  // external (transient) files. `applyTextDiff` minimises the patch so the
  // CRDT history stays sane.
  //
  // Pass an UPDATER `(liveSrc) => newSrc` (return null to skip): it runs
  // against the Y.Text content at mutation time. Building the new source from
  // `active.content` / `activeContentRef` (React state, which lags the Y.Text
  // by a render or a debounce) and diffing it against the live text silently
  // reverted whatever a collaborator — or the user — typed in between.
  const mutateActiveSource = useCallback((newSrcOrFn) => {
    if (!active) return;
    const yt = activeContentText;
    if (!yt) return;
    const newSrc = typeof newSrcOrFn === 'function' ? newSrcOrFn(yt.toString()) : newSrcOrFn;
    if (typeof newSrc !== 'string') return;
    applyTextDiff(yt, newSrc);
    if (!isExternalId(active.id)) mirrorContentToVault(active.id, newSrc);
  }, [active && active.id, activeContentText]);
  const updateNoteContentById = useCallback((fileId, newSrc) => {
    if (!fileId) return;
    if (isExternalId(fileId)) {
      const entry = externalDocsRef.current.get(fileId);
      if (entry && entry.ytext) applyTextDiff(entry.ytext, newSrc);
      return;
    }
    const yt = getContent(fileId);
    if (yt) applyTextDiff(yt, newSrc);
    mirrorContentToVault(fileId, newSrc);
  }, []);

  // After every render-mode HTML update, walk the rendered tables and apply
  // alt-view enhancements (list / cards / kanban) based on directives parsed
  // from the source. We re-set innerHTML at the start so a state-only
  // dependency change (e.g. opening the kanban column picker without a source
  // change) still rebuilds tables from scratch instead of nesting wrappers.
  // React roots mounted in-place to host inline canvases. We keep a list so
  // we can unmount them before each re-render (innerHTML wipes the host
  // nodes but the React roots leak otherwise).
  const canvasRootsRef = useRef([]);
  useEffect(() => () => {
    for (const r of canvasRootsRef.current) { try { r.unmount(); } catch {} }
    canvasRootsRef.current = [];
  }, []);

  useLayoutEffect(() => {
    const root = renderRef.current;
    if (!root) return;
    // Skip the rewrite if the user has an active selection inside the
    // render pane — otherwise an unrelated yMeta tick (presence,
    // awareness, etc.) wipes the DOM under them and the selection
    // collapses. We retry on the next change.
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (root.contains(range.commonAncestorContainer)) return;
    }
    // PDF iframes flash to black on every innerHTML wipe (the browser tears
    // down the embedded viewer and reloads it). Detach the iframe nodes
    // before the wipe and re-graft them onto the new placeholders, keyed by
    // src — so a keystroke in dual mode doesn't restart the PDF render.
    const pdfCache = new Map();
    root.querySelectorAll('iframe.md-attach-pdf').forEach((frame) => {
      const src = frame.getAttribute('src');
      if (!src) return;
      frame.remove();
      pdfCache.set(src, frame);
    });
    // Tear down any inline canvas mounts from the previous render. They'll
    // be re-created below if the new source still contains canvas blocks.
    for (const r of canvasRootsRef.current) { try { r.unmount(); } catch {} }
    canvasRootsRef.current = [];
    root.innerHTML = renderedHtml;
    // Cabecera de página del editor de bloques (icono, título si no hay H1,
    // propiedades de edinot:props) — la misma que en «Editar».
    if (active && !isPrimaryCanvasNote(renderSrc)) {
      try {
        injectPageHeader(root, {
          content: renderSrc, icon: active.icon || '', cover: active.cover || '', title: splitExt(active.name).base,
          onCover: (action, rect) => blockBus.emit('cover:menu', { action, rect }),
          editable: !isViewer && !activeNoteReadOnly && !isExternalId(active.id),
          onIcon: (rect) => blockBus.emit('icon:pick', { rect }),
          onProp: (key, rect) => blockBus.emit('props:edit', { key, rect }),
          onAdd: (rect) => blockBus.emit('props:add', { rect }),
        });
      } catch (err) { console.warn('[blocks] page header', err); }
    }
    // Cada tabla es un bloque de base de datos (editor/db). Su raíz React se
    // reutiliza entre renders (mismo nodo, otro sitio) para no perder estado.
    const tables = root.querySelectorAll('table.md-table');
    const dbAlive = new Set();
    tables.forEach((tbl, idx) => {
      const meta = tablesParsed[idx];
      if (!meta || !active) return;
      const key = `render:${active.id}:${idx}`;
      dbAlive.add(key);
      const host = document.createElement('div');
      host.className = 'db-mount';
      host.dataset.dbIdx = String(idx);
      tbl.parentNode.replaceChild(host, tbl);
      mountDbBlock(renderDbCacheRef.current, key, host, { meta, idx, ctxRef: liveTableCtxRef, ops: DB_OPS, surface: 'render' });
    });
    // Vistas enlazadas (```edinot-db): una tabla de otra nota, con vista propia.
    if (active) {
      root.querySelectorAll('code.lang-' + LINKED_LANG).forEach((codeEl, n) => {
        const cfg = parseLinkedConfig(codeEl.textContent);
        const wrapper = codeEl.closest('.md-codewrap') || codeEl.closest('pre');
        if (!cfg || !wrapper || !wrapper.parentNode) return;
        const key = `render:linked:${active.id}:${n}`;
        dbAlive.add(key);
        const host = document.createElement('div');
        host.className = 'db-mount db-mount-linked';
        host.dataset.linkedCfg = codeEl.textContent; // para exportar (doExportNote)
        wrapper.parentNode.replaceChild(host, wrapper);
        mountLinkedDb(renderDbCacheRef.current, key, host, {
          cfg, env: linkedDbEnv, baseCtxRef: liveTableCtxRef, ops: DB_OPS, surface: 'render',
          onConfig: (next) => mutateActiveSource(src => replaceLinkedFence(src, n, next)),
        });
      });
    }
    sweepDbBlocks(renderDbCacheRef.current, dbAlive);

    // Image resize: a corner grip on each top-level rendered image lets the
    // user drag to a fixed pixel width that persists into the markdown as
    // ![alt|width](src) — so it survives sync + share. Table-cell thumbnails
    // keep their own fixed layout and are skipped. Read-only viewers get no
    // grip. The grip wraps the <img> in an inline-block host so it sits at the
    // image's actual corner (not the full-width attachment block).
    if (active && !isViewer) {
      const imgs = Array.from(root.querySelectorAll('.md-img-real'))
        .filter((img) => !img.closest('.md-table'));
      const srcCount = new Map();
      imgs.forEach((img) => {
        const imgSrc = img.getAttribute('src') || '';
        const occ = srcCount.get(imgSrc) || 0;
        srcCount.set(imgSrc, occ + 1);
        let host = img.parentElement;
        if (!host || !host.classList.contains('md-img-host')) {
          const inWrap = host && host.classList.contains('md-attach-wrap');
          const wrapper = document.createElement('span');
          wrapper.className = inWrap ? 'md-img-host' : 'md-img-host md-img-host-block';
          img.parentNode.insertBefore(wrapper, img);
          wrapper.appendChild(img);
          host = wrapper;
        }
        const grip = document.createElement('span');
        grip.className = 'md-img-grip';
        grip.title = t('img.resizeHint');
        host.appendChild(grip);
        // Pointer Events + setPointerCapture (NOT window mousemove/up). Capture
        // guarantees pointerup fires even when the user releases outside the
        // window — a plain window-mouseup is dropped by the OS in that case,
        // which would leak the listeners permanently and slowly grind the app
        // to a halt. Listeners live on the grip, so they GC with it on the
        // next render regardless.
        grip.addEventListener('pointerdown', (ev) => {
          if (ev.button !== 0) return;
          ev.preventDefault();
          ev.stopPropagation();
          const startX = ev.clientX;
          const startW = img.getBoundingClientRect().width;
          const maxW = host.parentElement
            ? host.parentElement.getBoundingClientRect().width
            : startW;
          host.classList.add('md-img-resizing');
          try { grip.setPointerCapture(ev.pointerId); } catch {}
          const onMove = (e2) => {
            let w = Math.round(startW + (e2.clientX - startX));
            w = Math.max(40, Math.min(w, Math.round(maxW) || w));
            img.style.width = `${w}px`;
            img.style.maxWidth = '100%';
          };
          const onUp = () => {
            grip.removeEventListener('pointermove', onMove);
            grip.removeEventListener('pointerup', onUp);
            grip.removeEventListener('pointercancel', onUp);
            try { grip.releasePointerCapture(ev.pointerId); } catch {}
            host.classList.remove('md-img-resizing');
            const finalW = parseInt(img.style.width, 10);
            if (active && Number.isFinite(finalW)) {
              mutateActiveSource(src => setImageWidthInSource(src, imgSrc, occ, finalW));
            }
          };
          grip.addEventListener('pointermove', onMove);
          grip.addEventListener('pointerup', onUp);
          grip.addEventListener('pointercancel', onUp);
        });
      });
    }

    // Hydrate office (docx/xlsx) and code/text attachment placeholders. These
    // are async — we fire-and-forget per node, and bail if the node is
    // detached from the DOM by the time the data resolves (e.g. user switched
    // notes while a conversion was in flight).
    const officeNodes = root.querySelectorAll('.md-attach-office[data-attach-sha]');
    const officeAuth = syncCfgRef.current
      ? { httpUrl: syncCfgRef.current.httpUrl, token: syncCfgRef.current.token }
      : null;
    const actionsRow = () =>
      `<span class="md-attach-actions">`
      + `<button type="button" class="md-attach-act" data-attach-action="open" title="${escapeHtml(t('attach.open.tip'))}">${escapeHtml(t('attach.open'))}</button>`
      + `<button type="button" class="md-attach-act" data-attach-action="download" title="${escapeHtml(t('attach.download.tip'))}">${escapeHtml(t('attach.download'))}</button>`
      + `</span>`;
    officeNodes.forEach((node) => {
      const sha = node.getAttribute('data-attach-sha');
      const kind = node.getAttribute('data-attach-kind');
      const name = node.getAttribute('data-attach-name') || '';
      if (!sha || !window.electronAPI || !window.electronAPI.convertOfficeBlob) return;
      window.electronAPI.convertOfficeBlob(sha, kind, officeAuth).then((res) => {
        if (!node.isConnected) return;
        node.classList.remove('md-attach-loading');
        if (res && res.ok) {
          node.innerHTML = `<span class="md-attach-office-title">📄 ${name}${actionsRow()}</span><span class="md-attach-office-body">${res.html}</span>`;
        } else {
          node.innerHTML = `<span class="md-attach-office-title">${escapeHtml(t('attach.office.fail', { name }))}${actionsRow()}</span><span class="md-attach-office-body md-attach-err">${(res && res.error) || escapeHtml(t('attach.error.unknown'))}</span>`;
        }
      }).catch((err) => {
        if (!node.isConnected) return;
        node.innerHTML = `<span class="md-attach-office-title">⚠ ${name}${actionsRow()}</span><span class="md-attach-office-body md-attach-err">${err.message || err}</span>`;
      });
    });

    const codeNodes = root.querySelectorAll('.md-attach-code[data-attach-sha]');
    codeNodes.forEach((node) => {
      const sha = node.getAttribute('data-attach-sha');
      const name = node.getAttribute('data-attach-name') || '';
      const lang = node.getAttribute('data-attach-lang') || '';
      if (!sha) return;
      fetch(`edinot://blob/${sha}`).then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))).then((text) => {
        if (!node.isConnected) return;
        node.classList.remove('md-attach-loading');
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        node.innerHTML = `<span class="md-attach-office-title">📝 ${name}${lang ? ` <span class="md-attach-lang">${lang}</span>` : ''}${actionsRow()}</span>`
          + `<pre class="md-attach-code-body"><code>${escaped}</code></pre>`;
      }).catch((err) => {
        if (!node.isConnected) return;
        node.innerHTML = `<span class="md-attach-office-title">⚠ ${name}${actionsRow()}</span><span class="md-attach-office-body md-attach-err">${err.message || err}</span>`;
      });
    });

    // Inline canvases — for every ```edinot-canvas``` block in the source,
    // find the rendered code-block wrapper and replace it with a React-
    // mounted CanvasView. Order matches: the Nth `code.lang-edinot-canvas`
    // element corresponds to the Nth parsed block.
    if (active) {
      // Parse from renderSrc (the same source that produced root.innerHTML)
      // so the Nth canvas code-block lines up with the Nth parsed block.
      const canvasBlocks = parseCanvasBlocks(renderSrc);
      if (canvasBlocks.length) {
        const codeNodes = root.querySelectorAll('code.lang-edinot-canvas');
        codeNodes.forEach((codeEl, idx) => {
          const blk = canvasBlocks[idx];
          if (!blk) return;
          const wrapper = codeEl.closest('.md-codewrap') || codeEl.closest('pre');
          if (!wrapper || !wrapper.parentNode) return;
          // Página ↔ Canvas: el canvas propio de la nota (el primero) no se ve
          // en modo Página; se abre con el interruptor junto al título.
          if (idx === 0 && activeSurfaceRef.current === 'page') { wrapper.parentNode.removeChild(wrapper); return; }
          const host = document.createElement('div');
          host.className = 'md-canvas-host';
          wrapper.parentNode.replaceChild(host, wrapper);
          try {
            const r = createRoot(host);
            r.render(
              <CanvasView
                json={blk.json}
                notes={files}
                vaults={vaults}
                activeNoteId={active.id}
                syncConfig={syncConfigState}
                onChange={(updater) => {
                  if (!active) return;
                  // Read live content so a canvas edit never writes over typing
                  // that happened during the render debounce window.
                  mutateActiveSource(src => {
                    const target = parseCanvasBlocks(src)[idx];
                    if (!target) return null;
                    const next = typeof updater === 'function' ? updater(target.json) : updater;
                    return writeCanvasBlock(src, next, target);
                  });
                }}
                onOpenNote={setActiveId}
                onUploadAttachment={uploadCanvasAttachment}
                onUpdateNoteContent={updateNoteContentById}
                onCreateReminder={createReminderForNote}
                askPrompt={askPrompt}
                askConfirm={askConfirm}
              />
            );
            canvasRootsRef.current.push(r);
          } catch (err) {
            host.textContent = 'Canvas: ' + (err.message || err);
          }
        });
      }

      // Canvas embeds — fenced ```edinot-canvas-embed blocks contain just
      // a target note id. Replace each with a CanvasEmbedPreview card that
      // shows the canvas thumbnail + an "Open" button.
      const embedNodes = root.querySelectorAll('code.lang-edinot-canvas-embed');
      embedNodes.forEach((codeEl) => {
        const wrapper = codeEl.closest('.md-codewrap') || codeEl.closest('pre');
        if (!wrapper || !wrapper.parentNode) return;
        const noteId = (codeEl.textContent || '').trim().split(/\s+/)[0];
        const host = document.createElement('div');
        host.className = 'md-canvas-embed-host';
        wrapper.parentNode.replaceChild(host, wrapper);
        const target = files.find(f => f.id === noteId);
        const json = target ? firstCanvasBlock(target.content || '') : null;
        try {
          const r = createRoot(host);
          r.render(
            <CanvasEmbedPreview
              targetId={noteId}
              targetName={target ? target.name.replace(/\.(md|markdown|txt)$/i, '') : ''}
              found={!!target}
              json={json}
              onOpen={() => setActiveId(noteId)} />
          );
          canvasRootsRef.current.push(r);
        } catch (err) {
          host.textContent = 'Canvas embed: ' + (err.message || err);
        }
      });

      // Inline forms — fenced ```edinot-form``` blocks become a FormView whose
      // fields derive from a target table. Submitting appends a row to that
      // table in the live source. Parse from renderSrc so the Nth code-block
      // lines up with the Nth parsed form, matching the canvas pattern above.
      const formBlocks = parseFormBlocks(renderSrc);
      if (formBlocks.length) {
        const formReadOnly = isViewer || activeNoteReadOnly;
        const formNodes = root.querySelectorAll('code.lang-edinot-form');
        formNodes.forEach((codeEl, idx) => {
          const blk = formBlocks[idx];
          if (!blk) return;
          const wrapper = codeEl.closest('.md-codewrap') || codeEl.closest('pre');
          if (!wrapper || !wrapper.parentNode) return;
          const host = document.createElement('div');
          host.className = 'md-form-host';
          wrapper.parentNode.replaceChild(host, wrapper);
          // Target may be a table in this note or in another (cfg.note).
          const resolved = resolveFormTarget(blk.json, blk, active.id, renderSrc, files);
          try {
            const r = createRoot(host);
            r.render(
              <FormView
                cfg={blk.json}
                headers={resolved ? resolved.table.headers : []}
                cols={(resolved && resolved.table.directive && resolved.table.directive.cols) || {}}
                tableIdx={resolved ? resolved.tableIdx : 0}
                rowCount={resolved ? (resolved.table.rows || []).length : 0}
                onAttach={uploadCanvasAttachment}
                onConfigure={() => setFormBuilder({ mode: 'edit', blockIdx: idx, cfg: blk.json })}
                readOnly={formReadOnly}
                missingTarget={!resolved}
                crossNote={resolved ? !resolved.local : false}
                onSubmit={(vals) => {
                  if (resolved && !resolved.local) {
                    // Cross-note: append to the target note's LIVE content.
                    let base = '';
                    try { base = getContent(resolved.noteId).toString(); } catch { base = resolved.src || ''; }
                    const tt = parseSourceTables(base);
                    if (!tt[resolved.tableIdx]) return;
                    updateNoteContentById(resolved.noteId, appendTableRow(base, resolved.tableIdx, vals));
                    return;
                  }
                  // Same note: re-resolve against LIVE content so the row is
                  // never appended to a stale table index after edits.
                  mutateActiveSource(live => {
                    const liveBlocks = parseFormBlocks(live);
                    const r2 = resolveFormTargetTable(live, liveBlocks[idx] || blk, blk.json);
                    return r2 ? appendTableRow(live, r2.tableIdx, vals) : null;
                  });
                }} />
            );
            canvasRootsRef.current.push(r);
          } catch (err) {
            host.textContent = 'Form: ' + (err.message || err);
          }
        });
      }
    }
    // Swap freshly-rendered pdf placeholders for the preserved iframes so
    // the embedded viewer keeps its state across re-renders.
    if (pdfCache.size) {
      root.querySelectorAll('iframe.md-attach-pdf').forEach((frame) => {
        const src = frame.getAttribute('src');
        if (!src) return;
        const cached = pdfCache.get(src);
        if (cached && cached !== frame) {
          frame.parentNode.replaceChild(cached, frame);
          pdfCache.delete(src);
        }
      });
    }
    // `files`/`vaults` are only used inside the canvas-embed branch
    // to look up the target preview. We intentionally do NOT depend on
    // them here — those memos churn every Y.Doc update (awareness /
    // presence pulses included), which would rip + rebuild the whole
    // render pane each tick and flicker the toolbar buttons every
    // time the mouse passes over them. Canvas embed previews update
    // on the next content edit, which is good enough.
    // NB: intentionally NOT depending on `active.content` — renderedHtml /
    // tablesParsed already trail it (debounced), so this effect re-runs once
    // per typing pause instead of per keystroke. Live-content reads inside the
    // pointer handlers go through activeContentRef.
  }, [renderedHtml, tablesParsed, mode, active && active.id, active && active.icon, active && active.cover, activeSurface]);

  // Inline ⏰ markers for reminders anchored to passages in the active note.
  // Reminders live in yEvents (not the note text), so without this the only
  // cue is the calendar. We tag the first text match of each reminder's anchor
  // snippet with a badge. Signature-keyed so it doesn't walk the DOM on every
  // keystroke — only when the note's reminders actually change (or re-render).
  const activeNoteReminders = useMemo(() => {
    if (!active) return [];
    try {
      return getVaultEvents(activeVault)
        .filter(ev => isPendingReminder(ev)
          && ev.noteId === active.id && ev.anchor && ev.anchor.snippet);
    } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active && active.id, activeVault, allDocsV]);
  const reminderSig = useMemo(
    () => activeNoteReminders.map(r => `${r.id}:${r.anchor.snippet}`).join('|'),
    [activeNoteReminders],
  );
  useLayoutEffect(() => {
    const root = renderRef.current;
    if (!root || (mode !== 'render' && mode !== 'dual')) return;
    // Strip markers from a previous pass (a reminder-only change doesn't wipe
    // innerHTML the way the main render effect does).
    // Normaliza sólo donde había marcas: un normalize() de toda la raíz
    // fusionaría nodos de texto de los bloques de base de datos (React).
    const touched = new Set();
    root.querySelectorAll('mark.reminder-marker').forEach(m => {
      if (m.parentNode) touched.add(m.parentNode);
      m.replaceWith(document.createTextNode(m.getAttribute('data-text') || ''));
    });
    touched.forEach(n => { try { n.normalize(); } catch {} });
    if (!activeNoteReminders.length) return;
    const tag = (snippet, title) => {
      const needle = (snippet || '').trim();
      if (!needle) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          if (!n.nodeValue || (n.parentElement && n.parentElement.closest('mark.reminder-marker, .db-host, script, style'))) return NodeFilter.FILTER_REJECT;
          return n.nodeValue.includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
      });
      const node = walker.nextNode();
      if (!node) return;
      const idx = node.nodeValue.indexOf(needle);
      if (idx < 0) return;
      const after = node.splitText(idx);
      after.nodeValue = after.nodeValue.slice(needle.length);
      const mark = document.createElement('mark');
      mark.className = 'reminder-marker';
      mark.setAttribute('data-text', needle);
      mark.title = title ? t('reminder.markerTipNamed', { title }) : t('reminder.markerTip');
      mark.textContent = needle;
      const badge = document.createElement('span');
      badge.className = 'reminder-marker-badge';
      badge.textContent = '⏰';
      mark.appendChild(badge);
      node.parentNode.insertBefore(mark, after);
    };
    for (const r of activeNoteReminders) { try { tag(r.anchor.snippet, r.title); } catch {} }
  }, [reminderSig, renderedHtml, mode, active && active.id]);

  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef(null);
  // themeKeyRaw = lo guardado (puede ser 'system' → sigue al SO);
  // themeKey = el tema efectivo que se pinta.
  const themeKeyRaw = useMemo(() => yMeta.get('themeKey') || 'edinot', [metaV]);
  const osPrefersDark = usePrefersDark();
  const themeKey = resolveThemeKey(themeKeyRaw, osPrefersDark);
  const setThemeKey = useCallback((k) => yMeta.set('themeKey', k), []);
  const theme = THEMES[themeKey] || THEMES.edinot;
  const dark = !!theme.dark;
  // (El mirror del tema a localStorage vive más abajo, tras declararse
  // `settings` — necesita el acento personalizado para el primer frame.)

  const [calendarOpen, setCalendarOpen] = useState(false);
  // «Todas las notas» (ui/allnotes): página como Calendario y Ajustes. `allRequest` lo pide la barra lateral (etiqueta, colección…).
  const [allOpen, setAllOpen] = useState(false);
  const [allRequest, setAllRequest] = useState(null);
  const [calendarDraft, setCalendarDraft] = useState(null); // prefill for the calendar editor (e.g. reminder from selection)
  const [pendingJump, setPendingJump] = useState(null); // { fileId, pos }
  const [applyTplState, setApplyTplState] = useState(null); // { template, defaults? }
  const [tplPreviewState, setTplPreviewState] = useState(null); // { content }
  const [tplBuilderClosed, setTplBuilderClosed] = useState(false); // user-dismissed for current note
  useEffect(() => { setTplBuilderClosed(false); }, [activeId]);

  const jumpToMatch = useCallback((fileId, pos, findText) => {
    // Resolve `pos` from a literal substring when callers don't have it
    // (semantic search has snippets, not source offsets).
    if (findText) {
      try {
        const content = getContent(fileId).toString();
        const idx = content.indexOf(findText);
        if (idx >= 0) pos = idx;
      } catch {}
    }
    // Preserve the user's current mode (markdown or render). The jump only
    // needs cursor placement when in markdown — render has no caret.
    if (activeId === fileId) {
      if (mode !== 'render' && cmViewRef.current) {
        const view = cmViewRef.current;
        view.dispatch({
          selection: { anchor: pos, head: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
        view.focus();
      } else if (mode === 'render' && findText && renderRef.current) {
        // Render-mode jump within the same note: use the pulse path so
        // the user actually sees where the answer lives.
        setTimeout(() => {
          try { pulseInRenderDom(renderRef.current, findText); } catch {}
        }, 60);
      }
      return;
    }
    if (mode !== 'render') setPendingJump({ fileId, pos });
    setActiveId(fileId);
    if (mode === 'render' && findText) {
      // Defer the pulse until after the new note's render has mounted.
      setTimeout(() => {
        try { pulseInRenderDom(renderRef.current, findText); } catch {}
      }, 320);
    }
  }, [activeId, mode]);
  linkedApiRef.current = {
    write: updateNoteContentById,
    open: (id, line) => {
      const lines = (linkedDbEnv.read(id) || '').split('\n').slice(0, line || 0);
      jumpToMatch(id, lines.reduce((a, l) => a + l.length + 1, 0));
    },
    canEdit: (id) => !isViewer && !isExternalId(id),
  };

  // F2 — Reminders. Snapshot due/upcoming reminders across every
  // accessible vault and hand them to the Electron scheduler. Debounced
  // (allDocsV bumps on every keystroke), so we don't re-scan every note
  // body 60 times per second while the user is typing.
  // Queue of fired reminders so several overdue at once (e.g. many missed
  // while the app was closed) surface one-by-one in the banner instead of
  // clobbering each other — the front of the queue is the one shown.
  const [reminderQueue, setReminderQueue] = useState([]);
  // Bumping this re-runs the reminder sync so a recurring reminder arms its
  // NEXT occurrence right after the current one fires (firing alone doesn't
  // touch the Y.Doc, so allDocsV wouldn't change).
  const [reminderResyncTick, setReminderResyncTick] = useState(0);
  const activeReminder = reminderQueue[0] || null;
  const lastJumpedReminderRef = useRef(null);
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.remindersSync) return;
    const handle = setTimeout(() => {
    const horizon = Date.now() + 90 * 86400 * 1000;
    const seen = new Set();
    const items = [];
    const vaultIds = new Set([activeVault]);
    try { for (const e of listVaultRegistryEntries()) if (e && e.vaultId) vaultIds.add(e.vaultId); } catch {}
    for (const vid of vaultIds) {
      let evs;
      try { evs = getVaultEvents(vid); } catch { continue; }
      for (const ev of evs) {
        // Calendario v2: un EVENTO con `reminderOffset` avisa N min antes
        // (eventAlarmAt; no cuenta como pendiente si ya pasó).
        if (ev && ev.kind !== 'reminder' && ev.reminderOffset != null) {
          if (seen.has(ev.id)) continue;
          seen.add(ev.id);
          const at = eventAlarmAt(ev, Date.now());
          if (at == null || at > horizon) continue;
          items.push({ id: ev.id, vaultId: vid, noteId: ev.noteId || null, title: ev.title || 'Evento', anchor: ev.anchor || null, recurring: !!(ev.recurrence && ev.recurrence.freq), fireAt: at });
          continue;
        }
        // Dismissed reminders and checked-off tasks (`- [x] … ⏰`) never fire.
        if (!isPendingReminder(ev)) continue;
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        const recurring = !!(ev.recurrence && ev.recurrence.freq);
        let fireAt;
        if (recurring) {
          // Honor a one-off snooze into the future; otherwise arm the next
          // occurrence at or after now. The just-fired occurrence is already
          // in the past, so nextOccurrence(now) returns the upcoming one.
          // With a reminderOffset the alarm rings that many minutes earlier.
          const offMs = Number.isFinite(ev.reminderOffset) ? ev.reminderOffset * 60000 : 0;
          const snoozeMs = ev.snoozedUntil ? Date.parse(ev.snoozedUntil) : NaN;
          if (Number.isFinite(snoozeMs) && snoozeMs > Date.now()) fireAt = snoozeMs;
          else { const n = nextOccurrence(ev, Date.now() + offMs); if (n == null) continue; fireAt = n - offMs; }
        } else {
          const iso = ev.snoozedUntil || ev.remindAt || ev.start;
          if (!iso) continue;
          fireAt = Date.parse(iso);
        }
        if (!Number.isFinite(fireAt) || fireAt > horizon) continue;
        items.push({
          id: ev.id,
          vaultId: vid,
          noteId: ev.noteId || null,
          title: ev.title || 'Recordatorio',
          anchor: ev.anchor || null,
          recurring,
          fireAt,
        });
      }
    }
    try { window.electronAPI.remindersSync(items); } catch {}
    }, 800);
    return () => clearTimeout(handle);
  }, [allDocsV, activeVault, reminderResyncTick]);

  // Count of reminders due today or overdue, across every accessible vault.
  // Drives the badge on the calendar pill so pending reminders are visible
  // at a glance without opening the calendar.
  const dueReminderCount = useMemo(() => {
    let endOfToday, startOfToday;
    try {
      const d = new Date(); d.setHours(23, 59, 59, 999); endOfToday = d.getTime();
      const s = new Date(); s.setHours(0, 0, 0, 0); startOfToday = s.getTime();
    } catch { return 0; }
    const seen = new Set();
    let n = 0;
    const vaultIds = new Set([activeVault]);
    try { for (const e of listVaultRegistryEntries()) if (e && e.vaultId) vaultIds.add(e.vaultId); } catch {}
    for (const vid of vaultIds) {
      let evs;
      try { evs = getVaultEvents(vid); } catch { continue; }
      for (const ev of evs) {
        if (!isPendingReminder(ev)) continue; // dismissed or a checked-off task
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        if (ev.recurrence && ev.recurrence.freq) {
          // Recurring: due today = it has an occurrence that lands today (its
          // original start is in the past, so don't count by start). A snooze
          // parked past midnight means "done for today" (calendar pending
          // strip) — don't count it, or the badge would never clear.
          const sn = ev.snoozedUntil ? Date.parse(ev.snoozedUntil) : NaN;
          if (Number.isFinite(sn) && sn > endOfToday) continue;
          if (expandOccurrences(ev, startOfToday, endOfToday).length > 0) n++;
          continue;
        }
        const iso = ev.snoozedUntil || ev.remindAt || ev.start;
        const ts = Date.parse(iso);
        if (Number.isFinite(ts) && ts <= endOfToday) n++;
      }
    }
    return n;
  }, [allDocsV, docV, activeVault]);

  // Create a reminder seeded with the editor's current selection (FormatToolbar
  // ⏰ button). Opens the calendar with the editor pre-filled: title = selected
  // text, kind = reminder, defaulting to the next full hour today (the user
  // adjusts date/time before saving). This is the discoverable, in-editor path
  // to reminders that the calendar pill alone didn't surface.
  const createReminderFromSelection = useCallback(() => {
    let selText = '';
    try {
      const view = cmViewRef.current;
      if (view) {
        const sel = view.state.selection.main;
        if (!sel.empty) selText = view.state.doc.sliceString(sel.from, sel.to).replace(/\s+/g, ' ').trim();
      }
    } catch {}
    let date = '', time = '';
    try {
      const dt = new Date(Date.now() + 60 * 60 * 1000);
      date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      time = `${String(dt.getHours()).padStart(2, '0')}:00`;
    } catch {}
    // Link the reminder to the current note + anchor it on the selected text so
    // the render pane can flag the passage with an inline ⏰ marker.
    const anchor = selText ? { snippet: selText.slice(0, 160) } : null;
    setCalendarDraft({
      id: null, title: (selText || '').slice(0, 200), date, time, kind: 'reminder',
      noteId: active ? active.id : null,
      vaultId: activeVault,
      anchor,
    });
    setCalendarOpen(true);
  }, [active && active.id, activeVault]);

  // Create a reminder linked to a note (from a canvas note tile). Opens the
  // calendar prefilled; the draft carries noteId + the note's vault so the
  // reminder links back and shows on the tile's ⏰ badge.
  const createReminderForNote = useCallback((note) => {
    if (!note) return;
    const name = (note.name || '').replace(/\.(md|markdown|txt)$/i, '');
    let date = '', time = '';
    try {
      const dt = new Date(Date.now() + 60 * 60 * 1000);
      date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      time = `${String(dt.getHours()).padStart(2, '0')}:00`;
    } catch {}
    setCalendarDraft({ id: null, title: name || 'Recordatorio', date, time, kind: 'reminder', noteId: note.id, vaultId: note.vaultId || activeVault });
    setCalendarOpen(true);
  }, [activeVault]);

  // ── Google Calendar sync ───────────────────────────────────────────────
  // Pull Google events into the target vault's calendar and (optionally) push
  // local manual events back. Tokens live in the main process; we only pass
  // the client id/secret from settings. Returns { ok, pulled, pushed } or an
  // { ok:false, error } so the settings pane can surface failures.
  const googleSyncBusyRef = useRef(false);
  const googleSync = useCallback(async () => {
    if (!window.electronAPI || !window.electronAPI.gcalList) return { ok: false, error: 'no-electron' };
    const s = settingsRef.current || {};
    const clientId = s.gcalClientId, clientSecret = s.gcalClientSecret || '';
    if (!clientId) return { ok: false, error: 'missing_client' };
    const calendarId = s.gcalCalendarId || 'primary';
    const vid = s.gcalTargetVault || activeVault;
    const dir = s.gcalDirection || 'both';
    if (googleSyncBusyRef.current) return { ok: false, error: 'busy' };
    googleSyncBusyRef.current = true;
    try {
      let pulled = null, pushed = 0;
      if (dir === 'pull' || dir === 'both') {
        const now = new Date();
        const timeMin = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString();
        const timeMax = new Date(now.getFullYear(), now.getMonth() + 12, 1).toISOString();
        const res = await window.electronAPI.gcalList({ clientId, clientSecret, calendarId, timeMin, timeMax });
        if (!res.ok) return res;
        pulled = syncGoogleEvents(vid, calendarId, res.events || []);
      }
      if (dir === 'push' || dir === 'both') {
        // v1 pushes one-off (non-recurring) manual events only.
        const pushable = listPushableEvents(vid).filter(e => e.start && !e.recurrence);
        for (const ev of pushable) {
          const r = await window.electronAPI.gcalPush({
            clientId, clientSecret, calendarId, gcalId: ev.gcalId || null,
            event: { title: ev.title, start: ev.start, end: ev.end, allDay: ev.allDay },
          });
          if (r && r.ok) {
            pushed++;
            if (r.gcalId && !ev.gcalId) updateEvent(vid, ev.id, { gcalId: r.gcalId, gcalCalendarId: calendarId, etag: r.etag || null });
          }
        }
      }
      try { localStorage.setItem('edinotGcalLastSync', String(Date.now())); } catch {}
      return { ok: true, pulled, pushed };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    } finally {
      googleSyncBusyRef.current = false;
    }
  }, [activeVault]);


  // ── Canvas structured model (Fase 1) ──────────────────────────────────
  // `json` fed to CanvasView: the live structured snapshot once a canvas has
  // been migrated; the parsed fence as a fallback during the (sub-frame)
  // window before seed-on-open runs. Recomputes when the doc structure
  // (allDocsV) or note source changes.
  // Página ↔ Canvas: el canvas propio de una nota (su primera valla) usa el
  // modelo estructurado en cuanto se abre en modo Canvas, sea o no la nota
  // «solo tablero»; las vallas de más abajo siguen como bloques sueltos.
  const ownCanvasLive = !!(active && firstCanvasBlock(active.content)) && (activeSurface === 'canvas' || isPrimaryCanvasNote(active.content));
  const structuredCanvasJson = useMemo(() => {
    if (!CANVAS_STRUCTURED || !active) return null;
    if (!ownCanvasLive) return null;
    if (isCanvasMigrated(active.id)) return readCanvasSnapshot(active.id);
    const blk = firstCanvasBlock(active.content);
    return blk ? blk.json : { nodes: [], edges: [] };
  }, [active && active.id, active && active.content, allDocsV, ownCanvasLive]);

  // Seed-on-open: copy the fence JSON into the structured Yjs types once.
  // Idempotent (guarded by the migrated flag + emptiness check in store).
  useEffect(() => {
    if (!CANVAS_STRUCTURED || !active || !ownCanvasLive) return;
    const blk = firstCanvasBlock(active.content);
    if (blk) {
      // Depend on content too: a freshly-opened note's per-note doc may sync
      // its body in after this fires, so retry when it lands. seedCanvasFromJson
      // is idempotent (migrated flag), so re-runs are no-ops.
      try { seedCanvasFromJson(active.id, blk.json); } catch (e) { console.warn('[canvas] seed', e && e.message); }
    }
  }, [active && active.id, active && active.content, ownCanvasLive]);

  // Derived mirror: regenerate the ```edinot-canvas fence from the structure
  // (deterministic → converges across peers, no text-merge conflict). The
  // body-equality guard makes this idempotent and stops the write loop.
  useEffect(() => {
    // Cualquier nota cuyo canvas ya es estructurado (abierto alguna vez en modo
    // Canvas, aquí o en otro equipo) mantiene su valla al día.
    if (!CANVAS_STRUCTURED || !active || !firstCanvasBlock(active.content)) return;
    if (!ownCanvasLive && !isCanvasMigrated(active.id)) return;
    const id = active.id;
    const handle = setTimeout(() => {
      try {
        if (!isCanvasMigrated(id)) return;
        const mirror = serializeCanvasDeterministic(id);
        mutateActiveSource(src => {
          const blk = firstCanvasBlock(src);
          if (!blk) return null;
          const lines = src.split('\n');
          const curBody = lines.slice(blk.startLine + 1, blk.endLine).join('\n');
          if (curBody === mirror) return null;
          const before = lines.slice(0, blk.startLine + 1);
          const after = lines.slice(blk.endLine);
          return [...before, ...mirror.split('\n'), ...after].join('\n');
        });
      } catch (e) { console.warn('[canvas] mirror', e && e.message); }
    }, 600);
    return () => clearTimeout(handle);
  }, [active && active.id, active && active.content, allDocsV]);

  // Reminder fired by main: open the source note + show the in-app
  // snooze/dismiss banner so the user can react without leaving the app.
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.on) return;
    return window.electronAPI.on('reminder:fire', ({ id, item, action }) => {
      if (!item) return;
      // Enqueue (dedupe by id). The jump-to-note happens when each reminder
      // reaches the front of the queue (effect below), so stacking several
      // doesn't yank the editor through every note at once.
      setReminderQueue(q => q.some(r => r.id === id) ? q : [...q, { id, item, firedAt: Date.now(), action }]);
      // Recurring: re-sync so the next occurrence gets armed now that this one
      // has fired (the fired time is already recorded in main's reminderFired).
      if (item && item.recurring) setReminderResyncTick(t => t + 1);
    });
  }, []);

  // Jump to the front reminder's note when it becomes active (once per id).
  useEffect(() => {
    if (!activeReminder) { lastJumpedReminderRef.current = null; return; }
    const { id, item } = activeReminder;
    if (lastJumpedReminderRef.current === id) return;
    lastJumpedReminderRef.current = id;
    if (item && item.noteId) {
      const snip = item.anchor && item.anchor.snippet;
      try { jumpToMatch(item.noteId, 0, snip); } catch {}
    }
  }, [activeReminder, jumpToMatch]);

  // Disk → Y.Doc reverse sync: when the local-mode MCP (or any external
  // editor) writes a `.md` under <userData>/vault-export, main detects it
  // and pushes the new content here so we apply a Y.Text diff. The existing
  // export feedback loop is harmless because applyTextDiff is a no-op when
  // the content already matches.
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.on) return;
    return window.electronAPI.on('vault-export:fileChanged', ({ fileId, content }) => {
      if (!fileId) return;
      const yt = getContent(fileId);
      if (yt) applyTextDiff(yt, content);
      mirrorContentToVault(fileId, content);
    });
  }, []);

  // ─── Blob reference reconciler (server-side GC) ────────────────────────
  // Walks every note's content for `edinot://blob/<sha>` references after each
  // Y.Doc update. When a sha disappears from the set (referenced before, not
  // any more) we DELETE /blobs/<sha> on the server to reclaim storage — but
  // only after it stays gone for REMOVAL_GRACE_MS (so a transient mid-edit /
  // mid-resync blip can't purge a live blob) and only when `safeToDelete`
  // confirms the disappearance is real, not an unloaded per-note doc reading
  // empty. The first run (post-IDB-load) only snapshots — no deletes — so
  // opening a fresh note doesn't trash the server's state.
  // `syncCfgRef` is read at runtime by the reconciler; the effect that keeps
  // it in sync with `syncConfigState` is declared further down (after that
  // state is declared) to avoid a TDZ on the dep array.
  const syncCfgRef = useRef(null);
  useEffect(() => {
    let lastSet = null;
    let timer = null;
    let flush = null;
    let cancelled = false;

    // sha → a fileId we last saw referencing it. Lets us distinguish a real
    // removal (note still loaded, ref genuinely gone) from a false one (the
    // note's per-note doc isn't connected, so getContent reads empty — see
    // store.js getContent). Without this, navigating away from an unconnected
    // note makes its blobs look unreferenced and they'd be wrongly deleted.
    const refOrigin = new Map();
    // sha → timestamp it first looked removed. A reference must stay gone for
    // the whole grace window before we issue a server delete, so a transient
    // blip mid-edit / mid-resync (which once purged live shared images) is a
    // no-op once the reference comes back.
    const pendingRemoval = new Map();
    const REMOVAL_GRACE_MS = 30000;

    // fileId → { txt, shas }: getContentString hands back the same string
    // while a note is unchanged, so only edited notes are re-scanned.
    const refScanCache = new Map();
    const shasOf = (fileId, txt) => {
      const hit = refScanCache.get(fileId);
      if (hit && hit.txt === txt) return hit.shas;
      const shas = [];
      if (txt.indexOf('edinot://blob/') >= 0) {
        const re = /edinot:\/\/blob\/([a-f0-9]{64})/gi;
        let m;
        while ((m = re.exec(txt)) !== null) shas.push(m[1].toLowerCase());
      }
      refScanCache.set(fileId, { txt, shas });
      return shas;
    };
    const computeRefSet = () => {
      const refs = new Set();
      // EVERY vault's notes, not the active-vault yFiles proxy. The proxy made
      // a vault switch look like a mass deletion: the other vault's notes
      // vanished from the scan, their blobs entered pendingRemoval, and
      // safeToDelete's yFiles.has(origin) — also proxy-backed — confirmed
      // "note deleted" → live images were purged from the server. Pre-migration
      // leftovers in the legacy shell map are appended for completeness.
      const metas = getAllFilesAcrossVaults();
      const seen = new Set(metas.map(f => f.id));
      try {
        for (const f of ydoc.getMap('files').values()) {
          if (f && f.id && !seen.has(f.id)) metas.push(f);
        }
      } catch {}
      for (const f of metas) {
        for (const sha of shasOf(f.id, getContentString(f.id))) {
          refs.add(sha);
          refOrigin.set(sha, f.id);
        }
      }
      return refs;
    };

    // A disappeared sha is only safe to delete when we can prove it's gone for
    // real: its origin note is still present in a loaded vault doc, its
    // per-note doc is synced, and the (non-empty) content genuinely dropped
    // the ref. An origin we can't find is NOT proof of deletion — the vault
    // may simply be unloaded (workspace switch, ACL, mid-boot). Real note
    // deletions reclaim their blobs explicitly in deleteFile; everywhere else
    // we leak storage rather than risk purging a referenced blob.
    const safeToDelete = (sha) => {
      const origin = refOrigin.get(sha);
      if (origin == null) return false;                  // unknown origin → don't guess
      if (!locateFileAcrossVaults(origin)) return false; // not visible ≠ deleted
      // Only trust a "reference removed" signal when the origin note's
      // per-note doc is connected AND synced — then getContent() returns
      // authoritative, current content. With lazy loading an unopened note
      // reads the (possibly stale, non-empty) vault doc; treating that as
      // proof the ref is gone would delete live images.
      if (!isNoteSynced(origin)) return false;
      return getContentString(origin).length > 0;        // synced & ref genuinely removed
    };

    const reconcile = () => {
      if (cancelled) return;
      const cur = computeRefSet();
      if (lastSet === null) { lastSet = cur; return; }
      const now = Date.now();
      for (const sha of lastSet) {
        if (!cur.has(sha) && !pendingRemoval.has(sha)) pendingRemoval.set(sha, now);
      }
      lastSet = cur;
      for (const sha of cur) pendingRemoval.delete(sha); // reference came back → cancel
      const cfg = syncCfgRef.current;
      if (!cfg || !cfg.httpUrl || !cfg.token) return; // offline → keep pending, retry later
      for (const [sha, since] of pendingRemoval) {
        if (now - since < REMOVAL_GRACE_MS) continue;  // still cooling down
        if (!safeToDelete(sha)) continue;              // likely just unloaded → wait
        pendingRemoval.delete(sha);
        refOrigin.delete(sha);
        apiDeleteBlob(cfg.httpUrl, cfg.token, sha).catch(() => { /* 404 is fine — peer already deleted */ });
      }
    };

    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(reconcile, 1500);
    };

    let cancelIdle = null;
    // Nada de esto es urgente: se aplaza a que el hilo esté libre tras el
    // arranque en vez de escanear todas las notas justo al hidratar IndexedDB.
    whenIndexedDbReady().then(() => { if (!cancelled) cancelIdle = runWhenIdle(() => {
      if (cancelled) return;
      // Sweep upload-placeholder orphans. These live in the markdown as
      // `[Subiendo X… ⏳](edinot://uploading#tag)` while a upload is in
      // flight; if the app closed mid-upload they got synced to disk and
      // stay forever. On boot there's no active session, so every match is
      // orphan → remove the placeholder + its trailing newline.
      const PLACEHOLDER_RX = /\n?\[Subiendo [^\]\n]*\]\(edinot:\/\/uploading[^)]*\)\n?/g;
      for (const f of yFiles.values()) {
        if (!getContentString(f.id).includes('edinot://uploading')) continue;
        const yt = getContent(f.id);
        const src = yt.toString();
        if (!PLACEHOLDER_RX.test(src)) { PLACEHOLDER_RX.lastIndex = 0; continue; }
        PLACEHOLDER_RX.lastIndex = 0;
        applyTextDiff(yt, src.replace(PLACEHOLDER_RX, ''));
      }
      lastSet = computeRefSet();
      ydoc.on('update', onUpdate);
      // Pending removals only get re-evaluated on the next reconcile tick; if
      // editing stops, flush them on a slow timer (only while something is
      // pending) so storage is still reclaimed without the user typing more.
      flush = setInterval(() => { if (pendingRemoval.size) reconcile(); }, 15000);
    }, 10000); });

    return () => {
      cancelled = true;
      if (cancelIdle) cancelIdle();
      if (timer) clearTimeout(timer);
      if (flush) clearInterval(flush);
      ydoc.off('update', onUpdate);
    };
  }, []);

  // Once the editor mounts (or remounts) with the right file, consume
  // the pending jump and move the cursor.
  useEffect(() => {
    if (!pendingJump || pendingJump.fileId !== activeId) return;
    if (mode === 'render') return;
    let tries = 0;
    const tick = () => {
      const view = cmViewRef.current;
      if (view) {
        view.dispatch({
          selection: { anchor: pendingJump.pos, head: pendingJump.pos },
          effects: EditorView.scrollIntoView(pendingJump.pos, { y: 'center' }),
        });
        view.focus();
        setPendingJump(null);
      } else if (tries++ < 20) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }, [pendingJump, activeId, mode]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Deep-link into a settings tab (e.g. sync-dot → Ajustes › Sync).
  const [settingsInitialTab, setSettingsInitialTab] = useState(null);
  // Ajustes es una página (routeView 'settings'); cerrar = volver a la vista
  // de debajo (Inicio o la nota), que nunca se desmonta.
  const closeSettings = useCallback(() => { setSettingsOpen(false); setSettingsInitialTab(null); }, []);
  // Abrir una nota (árbol, Ctrl K, Ctrl N, enlaces…) sale de Ajustes.
  const settingsPrevActiveRef = useRef(activeId);
  useEffect(() => {
    if (settingsPrevActiveRef.current === activeId) return;
    settingsPrevActiveRef.current = activeId;
    setSettingsOpen(false);
  }, [activeId]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareVault, setShareVault] = useState(null); // vault {id,name} being shared
  const [auditWorkspaceId, setAuditWorkspaceId] = useState(null);
  // Los comentarios viven ahora en la pestaña «Comentarios» del panel de
  // contexto: «abrir comentarios» = abrir el panel en esa pestaña.
  const aiCommentsOpen = view === 'note' && ctxPanelOpen && ctxTab === 'comments';
  const setAiCommentsOpen = useCallback((v) => {
    if (v === false) { setCtxTab('context'); return; }
    setView('note');
    setCtxTab('comments');
    setCtxPanelOpen(true);
  }, [setCtxPanelOpen]);
  const [aiCommentsShowResolved, setAiCommentsShowResolved] = useState(false);
  // Floating "+ comentar" button anchored to the CM selection end so
  // the user has a one-click affordance instead of digging into the
  // comments panel.
  const [commentFab, setCommentFab] = useState(null);
  // Draft modal triggered by the comment-fab — replaces the plain
  // askPrompt() so the user gets @mention autocomplete + multiline
  // textarea via ChatComposer.
  const [commentDraft, setCommentDraft] = useState(null); // { anchorText }
  // Inline popover anchored to a mark.comment-anchor click in the
  // render pane — shows the thread + a reply composer without forcing
  // the user to open the full panel.
  const [anchorPopover, setAnchorPopover] = useState(null); // { commentId, x, y }
  // (El índice flotante y el panel de enlaces se sustituyeron por la pestaña
  // «Contexto» del panel lateral: esquema + enlazan aquí.)
  const [shareNoteOpen, setShareNoteOpen] = useState(false);
  const [shareFolder, setShareFolder] = useState(null);
  // Workspace members fetched on connect for @mention autocomplete +
  // the ConversationModal header. Cheap (one HTTP per workspace).
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const workspaceMemberEmails = useMemo(
    () => workspaceMembers.map(m => m.email).filter(Boolean),
    [workspaceMembers]
  );
  // Root id of the comment thread currently expanded in the
  // ConversationModal (full-thread view). null = closed.
  const [threadRoot, setThreadRoot] = useState(null);
  const lastCommentsSignalRef = useRef({ noteId: null, unresolved: 0 });
  // myGrants moved earlier in the function so it's in scope when the
  // blockedFolders / blockedNotes useMemos run during render.

  const SETTINGS_DEFAULTS = {
    fontSize: 16,
    // Rediseño: el editor usa la fuente de la interfaz por defecto (antes
    // 'mono'); quien la eligió en Ajustes la conserva.
    editorFont: 'sans',
    width: 'medium',
    autosave: true,
    ruler: false,
    vim: false,
    searchAllVaults: true,
    // Offline-first attachment prefetch. 'lite' caches blobs up to
    // offlinePrefetchMax bytes on sync; 'full' prefetches every blob.
    offlineMode: 'lite',
    offlinePrefetchMax: 5 * 1024 * 1024,
    // Hard ceiling on the on-disk blob cache. When prefetch or on-demand
    // fetches push the cache over this, the LRU evictor in main drops the
    // least-recently-accessed bytes. 0 disables enforcement.
    offlineCacheMax: 2 * 1024 * 1024 * 1024,
    // Accent override (Ajustes → Tema). null = use the theme's own accent.
    accentOverride: null,
    // Ajustes rediseñados: modo de las notas nuevas ('live' = Editar,
    // 'render' = Leer), corrector, interfaz compacta, región. reduceMotion
    // sin valor = sigue a prefers-reduced-motion; shortcuts = overrides.
    newNoteMode: 'live',
    spellcheck: true,
    compactUi: false,
    weekStart: 'mon',
    dateFormat: 'auto',
  };
  const settings = useMemo(() => {
    const out = { ...SETTINGS_DEFAULTS };
    for (const [k, v] of ySettings.entries()) out[k] = v;
    return out;
  }, [settingsV]);
  settingsRef.current = settings; // expose to earlier-defined callbacks (export)
  const setSettings = useCallback((updater) => {
    const current = (() => {
      const out = { ...SETTINGS_DEFAULTS };
      for (const [k, v] of ySettings.entries()) out[k] = v;
      return out;
    })();
    const next = typeof updater === 'function' ? updater(current) : updater;
    ydoc.transact(() => {
      for (const [k, v] of Object.entries(next)) {
        if (ySettings.get(k) !== v) ySettings.set(k, v);
      }
    });
  }, []);

  // Effective accent: the user's override (Ajustes → Tema) wins over the
  // theme's own accent everywhere --accent is read.
  const effectiveAccent = settings.accentOverride || theme.accent;
  // Mirror the active theme to localStorage so the next cold start paints
  // the right colors from the very first frame (index.html runs a tiny
  // inline script that reads this key BEFORE the bundle loads — see
  // THEME_BOOT_SCRIPT in build/build.mjs). Without it, dark-theme users
  // got a sage flash while yMeta hydrated from IndexedDB.
  useEffect(() => {
    try {
      // Tokens del shell sólo si el tema los define; si no, shell.css los
      // deriva. Con acento personalizado accent-soft también se deriva.
      // «Como el sistema» guarda las dos paletas para que el arranque elija
      // con matchMedia antes del primer pintado.
      const payload = themeBootPayload(theme, themeKey, effectiveAccent, !!settings.accentOverride);
      if (themeKeyRaw === SYSTEM_THEME) {
        const lightT = THEMES.edinot, darkT = THEMES.edinotDark;
        payload.system = {
          light: themeBootPayload(lightT, 'edinot', settings.accentOverride || lightT.accent, !!settings.accentOverride),
          dark: themeBootPayload(darkT, 'edinotDark', settings.accentOverride || darkT.accent, !!settings.accentOverride),
        };
      }
      localStorage.setItem('edinot.theme.v1', JSON.stringify(payload));
    } catch {}
  }, [themeKey, themeKeyRaw, effectiveAccent]);
  // Los mismos tokens en :root, para lo que se pinta en portales sobre
  // <body> (menús del shell, listas de Ajustes), fuera de .macwin.
  useEffect(() => {
    const r = document.documentElement;
    const mix = (a, b, p) => `color-mix(in srgb, ${a} ${p}%, ${b})`;
    const vars = {
      bg: theme.bg, toolbar: theme.toolbar, fg: theme.fg, muted: theme.muted, accent: effectiveAccent,
      side: theme.side || mix(theme.bg, theme.fg, 95), panel: theme.panel || mix(theme.bg, theme.fg, 97.5),
      line: theme.line || mix(theme.bg, theme.fg, 87.5), hover: theme.hover || mix(theme.bg, theme.fg, 91),
      'accent-soft': (!settings.accentOverride && theme.accentSoft) || mix(theme.bg, effectiveAccent, 84),
      faint: theme.faint || mix(theme.muted, theme.bg, 72), hl: theme.hl || (dark ? '#5B4D1C' : '#F3E3A6'),
    };
    for (const [k, v] of Object.entries(vars)) r.style.setProperty('--' + k, v);
    r.classList.toggle('dark', dark);
  }, [themeKey, effectiveAccent, dark]);
  // Ajustes → Apariencia: interfaz compacta y reducir animaciones (por
  // defecto sigue a prefers-reduced-motion).
  const osReducedMotion = usePrefersReducedMotion();
  const reduceMotion = typeof settings.reduceMotion === 'boolean' ? settings.reduceMotion : osReducedMotion;
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', !!reduceMotion);
    try { window.__edinotReduceMotion = !!reduceMotion; } catch {}
  }, [reduceMotion]);

  // Ajustes → Editor → corrector ortográfico (sesión de Electron).
  useEffect(() => {
    const on = settings.spellcheck !== false;
    try { document.documentElement.spellcheck = on; } catch {}
    if (window.electronAPI && window.electronAPI.setSpellcheck) window.electronAPI.setSpellcheck(on).catch(() => {});
  }, [settings.spellcheck]);
  // Atajos efectivos (Ajustes → Atajos). El keydown global los lee del ref;
  // los que también son aceleradores del menú se mandan a main.
  const shortcutBindings = useMemo(() => effectiveBindings(settings.shortcuts), [settings.shortcuts]);
  const shortcutBindingsRef = useRef(shortcutBindings);
  shortcutBindingsRef.current = shortcutBindings;
  useEffect(() => {
    setActiveBindings(shortcutBindings);
    if (window.electronAPI && window.electronAPI.menuSetAccelerators) {
      window.electronAPI.menuSetAccelerators(menuAccelerators(shortcutBindings)).catch(() => {});
    }
  }, [shortcutBindings]);

  // Auto-sync Google Calendar: once shortly after launch, then every 10 min,
  // when enabled. Placed after `settings` is defined (TDZ-safe).
  useEffect(() => {
    if (!settings.gcalAuto || !settings.gcalClientId) return;
    let alive = true;
    const tick = () => { if (alive) googleSync().catch(() => {}); };
    const first = setTimeout(tick, 6000);
    const iv = setInterval(tick, 10 * 60 * 1000);
    return () => { alive = false; clearTimeout(first); clearInterval(iv); };
  }, [settings.gcalAuto, settings.gcalClientId, settings.gcalCalendarId, settings.gcalDirection, settings.gcalTargetVault, googleSync]);

  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'

  // y-indexeddb persists Y.Doc automatically. Surface a brief 'saved' pulse
  // whenever the active content actually changes.
  useEffect(() => {
    setSaveStatus('saved');
    const t = setTimeout(() => setSaveStatus('idle'), 800);
    return () => clearTimeout(t);
  }, [contentV]);

  // Sync (Hocuspocus) — connects on mount if a config exists, listens for status.
  const [syncStatus, setSyncStatus] = useState('disconnected');
  const [presence, setPresence] = useState([]);
  const [aiAgents, setAiAgents] = useState([]);
  const knownAiAgents = useMemo(() => {
    const raw = yMeta.get('knownAiAgents');
    const map = new Map();
    if (Array.isArray(raw)) {
      for (const a of raw) {
        if (a && a.alias) map.set(String(a.alias).toLowerCase(), { ...a, online: false });
      }
    }
    for (const a of aiAgents) {
      if (a && a.alias) map.set(String(a.alias).toLowerCase(), { ...a, online: true });
    }
    return Array.from(map.values()).sort((a, b) => String(a.alias || '').localeCompare(String(b.alias || '')));
  }, [metaV, aiAgents]);
  const [syncConfigState, setSyncConfigState] = useState(() => getSyncConfig());
  // ACL Fase B — derive workspace-owner flag from syncConfigState so
  // owner-only UI (share menu, migration button) can show. MUST be
  // declared AFTER syncConfigState — placing it before triggers a TDZ
  // ReferenceError when the useMemo runs at render time.
  const isWorkspaceOwner = useMemo(() => {
    if (!syncConfigState || !Array.isArray(syncConfigState.workspaces)) return false;
    const cur = syncConfigState.workspaces.find(w => w.id === syncConfigState.currentWorkspaceId);
    return !!(cur && cur.isOwn);
  }, [syncConfigState]);
  // ACL Fase A — derive the current user's role on the active workspace.
  // 'viewer' makes the entire UI read-only (CodeMirror non-editable,
  // edit toolbars hidden, MCP / format actions short-circuited). The
  // server enforces this independently via ReadOnlyEnforcer in
  // server/server.js — even if a malicious client tries to bypass UI
  // checks, Y.Doc update messages are rejected for viewer connections.
  const currentRole = useMemo(() => {
    if (!syncConfigState || !Array.isArray(syncConfigState.workspaces)) return null;
    const cur = syncConfigState.workspaces.find(w => w.id === syncConfigState.currentWorkspaceId);
    return cur ? (cur.role || null) : null;
  }, [syncConfigState]);
  const isViewer = currentRole === 'viewer';

  // Per-resource ACL resolver — most-specific grant wins, then
  // falls back to the workspace role. Returns one of:
  //   none | view | comment | edit | admin
  // `none` means UI hide (already filtered out upstream); the editor
  // gate treats anything below 'edit' as read-only.
  const resolveAclLevel = useCallback((opts) => {
    if (!opts) return null;
    const { fileId, folderId, vaultId: vid } = opts;
    // Indexed lookup avoids O(n) scans per render — grants list is
    // small (per-user, per-workspace) so a single Map suffices.
    for (const g of myGrants) {
      if (g.resource_type === 'note' && String(g.resource_id) === String(fileId)) return g.level;
    }
    for (const g of myGrants) {
      if (g.resource_type === 'folder' && folderId && String(g.resource_id) === String(folderId)) return g.level;
    }
    for (const g of myGrants) {
      if (g.resource_type === 'vault' && vid && String(g.resource_id) === String(vid)) return g.level;
    }
    // Workspace-role fallback.
    if (currentRole === 'viewer') return 'view';
    if (currentRole === 'owner')  return 'admin';
    return 'edit';
  }, [myGrants, currentRole]);

  // ACL-resolved level for the currently active note. Drives the
  // editor read-only gate so a 'view'/'comment' grant downgrades a
  // workspace-editor user to read-only on this specific note (or
  // up-grants a workspace-viewer to 'edit' on a note shared with
  // them explicitly). Must come AFTER resolveAclLevel + active.
  const activeNoteLevel = useMemo(() => {
    if (!active) return null;
    return resolveAclLevel({
      fileId: active.id,
      folderId: active.folderId || null,
      vaultId: active.vaultId || 'default',
    });
  }, [active, resolveAclLevel]);
  const activeNoteReadOnly = activeNoteLevel === 'view' || activeNoteLevel === 'comment';

  // ── Página ↔ Canvas: cambiar de modo ────────────────────────────────────
  // A Canvas: si la nota aún no tiene canvas se le crea, con su página como
  // bloque (nada cambia en la nota hasta este momento); si lo tiene sin el
  // bloque de página y la nota tiene texto, se le añade. La transición sale de
  // la columna de lectura medida aquí. A Página: el canvas lleva la cámara de
  // vuelta a la columna y entonces se cambia.
  const surfaceIntroRef = useRef(null);       // { noteId, column, ms } para el canvas que se monta
  const canvasTransitionRef = useRef(null);    // { outro } del canvas montado
  const lastPageColumnRef = useRef(null);      // { noteId, column } medida en modo Página
  const measurePageColumn = useCallback(() => {
    const el = document.querySelector('.docwrap .md-render') || document.querySelector('.docwrap .cm-content');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 50 ? { left: r.left, top: r.top, width: r.width } : null;
  }, []);
  const estimatePageColumn = useCallback(() => {
    const box = document.querySelector('.docwrap');
    if (!box) return null;
    const r = box.getBoundingClientRect();
    const mw = readMaxWidth(settings.width); // como `maxWidth`
    const colW = Math.min(mw, r.width);
    return { left: r.left + (r.width - colW) / 2 + 48, top: r.top + 40, width: colW - 96 };
  }, [settings.width]);
  const chooseSurface = useCallback((id, next) => {
    setSurfaceChoice(prev => {
      if (prev[id] === next) return prev;
      const o = { ...prev, [id]: next };
      writeSurfaceChoices(o);
      return o;
    });
  }, []);
  const switchSurface = useCallback((next) => {
    if (!active || isExternalId(active.id)) return;
    const id = active.id;
    if (next === activeSurfaceRef.current) return;
    if (next === 'canvas') {
      const column = measurePageColumn();
      if (column) lastPageColumnRef.current = { noteId: id, column };
      const editable = !isViewer && !activeNoteReadOnly;
      const src = activeContentText ? activeContentText.toString() : (active.content || '');
      if (editable) {
        if (!firstCanvasBlock(src)) {
          // Primer uso: la nota estrena su canvas, con la página dentro.
          mutateActiveSource(cur => addOwnCanvas(cur));
        } else if (!isPrimaryCanvasNote(src)) {
          // Ya tenía canvas (un tablero dentro del texto): se le pone la página.
          if (CANVAS_STRUCTURED && isCanvasMigrated(id)) {
            const snap = readCanvasSnapshot(id);
            const withPage = withPageNode(snap, src);
            if (withPage !== snap) applyCanvasSnapshot(id, withPage);
          } else {
            mutateActiveSource(cur => {
              const blk = firstCanvasBlock(cur);
              if (!blk) return null;
              const withPage = withPageNode(blk.json, cur);
              return withPage === blk.json ? null : writeCanvasBlock(cur, withPage, blk);
            });
          }
        }
      }
      surfaceIntroRef.current = (!reduceMotion && column) ? { noteId: id, column, ms: 460, at: Date.now() } : null;
      chooseSurface(id, 'canvas');
      return;
    }
    // A Página.
    const tr = canvasTransitionRef.current;
    const remembered = lastPageColumnRef.current && lastPageColumnRef.current.noteId === id ? lastPageColumnRef.current.column : null;
    const column = remembered || estimatePageColumn();
    if (tr && tr.outro && !reduceMotion && column) {
      tr.outro(column, () => chooseSurface(id, 'page'));
    } else {
      chooseSurface(id, 'page');
    }
  }, [active && active.id, activeContentText, isViewer, activeNoteReadOnly, mutateActiveSource, reduceMotion, measurePageColumn, estimatePageColumn, chooseSurface]);
  // El canvas se carga en diferido: con una nota abierta se trae ya, para que el
  // primer cambio a Canvas no pase por el esqueleto de carga.
  useEffect(() => { if (active) { try { Promise.resolve(loadCanvasView()).catch(() => {}); } catch {} } }, [!!active]);
  const switchSurfaceRef = useRef(switchSurface);
  switchSurfaceRef.current = switchSurface;
  const chooseSurfaceRef = useRef(chooseSurface);
  chooseSurfaceRef.current = chooseSurface;
  // Gancho de pruebas (sólo con localStorage.edinotCanvasDebug = '1', como el del canvas).
  const pageCanvasTextRef = useRef(null);
  pageCanvasTextRef.current = activeContentText;
  useEffect(() => {
    let on = false;
    try { on = localStorage.getItem('edinotCanvasDebug') === '1'; } catch {}
    if (!on) return undefined;
    window.__edinotPageCanvas = {
      seed: (id, text) => seedNoteContent(id, text),
      surface: () => activeSurfaceRef.current,
      setSurface: (v) => switchSurfaceRef.current(v),
      text: () => (pageCanvasTextRef.current ? pageCanvasTextRef.current.toString() : null),
    };
    return () => { delete window.__edinotPageCanvas; };
  }, []);

  useEffect(() => {
    if (!active) return;
    // Track unresolved count without auto-opening the panel — the
    // titlebar badge is enough feedback; popping the modal on every
    // note-switch is intrusive.
    lastCommentsSignalRef.current = { noteId: active.id, unresolved: activeCommentsSummary.unresolved };
  }, [active && active.id, activeCommentsSummary.unresolved]);

  useEffect(() => {
    const off = onSyncStatus(setSyncStatus);
    return off;
  }, []);
  useEffect(() => {
    const off = onPresence(setPresence);
    return off;
  }, []);
  useEffect(() => {
    const off = onAiAgents(setAiAgents);
    return off;
  }, []);
  useEffect(() => {
    if (!aiAgents.length) return;
    // Solo se escribe si algo cambia de verdad. Antes cada pulso de presencia
    // de un agente reescribía la lista entera con un `lastSeenAt` nuevo: cada
    // escritura de una clave de yMeta deja una lápida permanente en el Y.Doc
    // y un perfil real acumuló ~3 millones (≈13 s de carga al arrancar).
    // `lastSeenAt` se refresca como mucho una vez por hora y agente.
    const raw = Array.isArray(yMeta.get('knownAiAgents')) ? yMeta.get('knownAiAgents') : [];
    const map = new Map(raw.filter(a => a && a.alias).map(a => [String(a.alias).toLowerCase(), a]));
    const nowMs = Date.now();
    const SEEN_REFRESH_MS = 60 * 60 * 1000;
    let changed = false;
    for (const a of aiAgents) {
      if (!a || !a.alias) continue;
      const key = String(a.alias).toLowerCase();
      const next = {
        alias: key,
        kind: a.kind || 'ai',
        ownerEmail: a.ownerEmail || null,
        device: a.device || null,
        platform: a.platform || null,
        localLauncher: !!a.localLauncher,
        capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
      };
      const prev = map.get(key);
      const prevSeen = prev && Date.parse(prev.lastSeenAt || '');
      const same = prev && JSON.stringify({ ...prev, lastSeenAt: undefined }) === JSON.stringify({ ...next, lastSeenAt: undefined });
      if (same && Number.isFinite(prevSeen) && nowMs - prevSeen < SEEN_REFRESH_MS) continue;
      map.set(key, { ...next, lastSeenAt: new Date(nowMs).toISOString() });
      changed = true;
    }
    if (!changed) return;
    yMeta.set('knownAiAgents', Array.from(map.values()).sort((a, b) => String(a.alias).localeCompare(String(b.alias))));
  }, [aiAgents]);
  // Fetch workspace members for @mention autocomplete + thread modal.
  useEffect(() => {
    if (!syncConfigState || !syncConfigState.token || !syncConfigState.httpUrl || !syncConfigState.currentWorkspaceId) {
      setWorkspaceMembers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiListMembers(syncConfigState.httpUrl, syncConfigState.token, syncConfigState.currentWorkspaceId);
        if (!cancelled) setWorkspaceMembers(r.members || []);
      } catch { if (!cancelled) setWorkspaceMembers([]); }
    })();
    return () => { cancelled = true; };
  }, [
    syncConfigState && syncConfigState.httpUrl,
    syncConfigState && syncConfigState.token,
    syncConfigState && syncConfigState.currentWorkspaceId,
  ]);
  useEffect(() => {
    if (syncConfigState && syncConfigState.wsUrl && syncConfigState.token && syncConfigState.currentWorkspaceId) {
      connectSync(syncConfigState);
      ensureActiveVaultProvider(syncConfigState);
    } else {
      disconnectSync();
    }
  }, [
    syncConfigState && syncConfigState.wsUrl,
    syncConfigState && syncConfigState.token,
    syncConfigState && syncConfigState.currentWorkspaceId,
  ]);

  // Keep ~/.config/edinot/cli.json mirrored to the live session so the MCP
  // server subprocess always reads a fresh token on its next restart. Runs
  // on login, logout, workspace switch, and token refresh. Best-effort —
  // failures here don't affect the app itself.
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.mcpSetup) return;
    const cfg = syncConfigState;
    const loggedIn = !!(cfg && cfg.token && cfg.currentWorkspaceId);
    const args = loggedIn && cfg.hub
      ? { mode: 'hub', workspaceId: cfg.currentWorkspaceId }
      : loggedIn
      ? {
        mode: 'sync',
        httpUrl: cfg.httpUrl,
        token: cfg.token,
        workspaceId: cfg.currentWorkspaceId,
        email: cfg.email,
        userId: cfg.userId,
        tier: cfg.tier,
        tlsCa: cfg.tlsCa,
      }
      : { mode: 'local' };
    window.electronAPI.mcpSetup(args).catch(() => {});
  }, [
    syncConfigState && syncConfigState.token,
    syncConfigState && syncConfigState.currentWorkspaceId,
    syncConfigState && syncConfigState.httpUrl,
  ]);

  // Auto-refresh the JWT before it expires so the app session — and the
  // mirrored cli.json — keep working without forcing the user to re-enter
  // a password every week. Checks once on mount and every 30 minutes; if
  // the server `/auth/refresh` returns a fresh token we persist it via
  // updateSyncConfig, which also re-fires the mcpSetup effect above.
  useEffect(() => {
    const cfg = syncConfigState;
    if (!cfg || !cfg.token || !cfg.httpUrl) return;
    let cancelled = false;
    const decodeExp = (token) => {
      try {
        const part = String(token).split('.')[1];
        const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4 ? b64 + '='.repeat(4 - (b64.length % 4)) : b64;
        const json = JSON.parse(atob(pad));
        return typeof json.exp === 'number' ? json.exp * 1000 : null;
      } catch { return null; }
    };
    const tryRefresh = async () => {
      const exp = decodeExp(cfg.token);
      if (exp == null) return;
      const now = Date.now();
      // Refresh when <2 days remain. Expired tokens cannot self-refresh —
      // user must re-login from the sync pane.
      if (exp <= now || exp - now > 48 * 3600 * 1000) return;
      try {
        const r = await apiRefresh(cfg.httpUrl, cfg.token);
        if (cancelled || !r || !r.token) return;
        updateSyncConfig({
          ...cfg,
          token: r.token,
          tier: r.tier || cfg.tier,
          tierLabel: r.tierLabel || cfg.tierLabel,
          expiresAt: r.expiresAt != null ? r.expiresAt : cfg.expiresAt,
          workspaces: r.workspaces || cfg.workspaces,
          limits: r.limits || cfg.limits,
        });
      } catch (err) {
        console.warn('[sync] token refresh failed:', err && err.message);
      }
    };
    tryRefresh();
    const id = setInterval(tryRefresh, 30 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [
    syncConfigState && syncConfigState.token,
    syncConfigState && syncConfigState.httpUrl,
  ]);
  // Refresh this user's grants whenever workspace/token changes. Used
  // by the UI hide filter to drop resources with explicit level='none'
  // grants from the sidebar + global search.
  useEffect(() => {
    if (!syncConfigState || !syncConfigState.token || !syncConfigState.httpUrl || !syncConfigState.currentWorkspaceId) {
      setMyGrants([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiListMyGrants(syncConfigState.httpUrl, syncConfigState.token, syncConfigState.currentWorkspaceId);
        if (!cancelled) setMyGrants(r.grants || []);
      } catch { if (!cancelled) setMyGrants([]); }
    })();
    return () => { cancelled = true; };
  }, [
    syncConfigState && syncConfigState.httpUrl,
    syncConfigState && syncConfigState.token,
    syncConfigState && syncConfigState.currentWorkspaceId,
  ]);
  useEffect(() => {
    if (!syncConfigState || !syncConfigState.wsUrl || !syncConfigState.token) return;
    ensureActiveVaultProvider(syncConfigState);
    // vaultsV bumps when the workspace shell yVaults map gains a new
    // entry (typically after the shell ydoc finishes syncing). That's
    // when ensureActiveVaultProvider can finally see the full vault
    // list and pre-boot every per-vault provider — without this dep,
    // secondary vaults never connect on cold start and their notes
    // show as 0 in the sidebar.
  }, [activeVault, vaultsV, syncConfigState && syncConfigState.token]);

  // ACL Fase D — connect the per-note provider for whichever note is
  // active so its Y.Doc starts syncing. Server gates the connection
  // via ACL (note → folder → vault → workspace); a level='none'
  // grant is rejected outright and the provider lives in 'auth-failed'.
  useEffect(() => {
    if (!syncConfigState || !syncConfigState.wsUrl || !syncConfigState.token) return;
    if (!activeId || isExternalId(activeId)) return;
    const located = locateFileAcrossVaults(activeId);
    if (!located) return;
    connectNoteProvider(activeId, located.vaultId || 'default', syncConfigState);
  }, [activeId, syncConfigState && syncConfigState.token, allDocsV]);

  // Lazy note loading (Fase 1) — we DON'T bulk-connect a per-note
  // provider for every accessible note at login. That opened one
  // Hocuspocus logical connection per note (multiplexed over the shared
  // socket) and made cold start O(N notes): the connection storm + sync
  // herd is what stalled "connecting…" on workspaces with many notes,
  // and wouldn't scale to thousands.
  //
  // Only the active note connects (the effect above). Backlinks / global
  // search / disk-export still work because they read via getContent /
  // getVaultContent, which fall back to the vault doc's `content:{id}`
  // for notes without a live per-note provider — and the vault doc is
  // kept current by the active-note mirror (mirrorContentToVault) syncing
  // through the per-vault provider. So cross-device content stays fresh
  // without holding N live note providers open. Obsidian works the same
  // way: only the open file is "live", everything else is read from the
  // local persisted copy.

  // Keep the reconciler's view of the current sync config up to date. The ref
  // is declared earlier (before the reconciler effect) but the assignment
  // lives here so the dep array can see `syncConfigState` without TDZ.
  useEffect(() => { syncCfgRef.current = syncConfigState; }, [syncConfigState]);
  const updateSyncConfig = (next) => {
    setSyncConfig(next);
    setSyncConfigState(next);
  };

  // ─── Hub local ─────────────────────────────────────────────────────────────
  // Si no hay sesión en un servidor remoto, la app se sincroniza con el hub de
  // este equipo (hub/): una copia completa en disco que el CLI y el MCP usan
  // sin red, con o sin la app abierta. Una sesión remota se respeta tal cual.
  // Si la persona cierra la sesión remota, vuelve al hub.
  const syncStatusRef = useRef('disconnected');
  syncStatusRef.current = syncStatus;
  useEffect(() => {
    const api = window.electronAPI;
    if (!api || !api.hubEnsure) return undefined;
    let cancelled = false;
    const adopt = async () => {
      const cur = getSyncConfig();
      if (cur && !cur.hub) return;                    // servidor remoto: no se toca
      let info = null;
      try { info = await api.hubEnsure(); } catch {}
      if (cancelled || !info || !info.ok) return;
      try {
        const r = await apiLogin(info.url, 'local', info.key);
        if (cancelled) return;
        const list = r.workspaces || [];
        if (!list.length) return;
        const again = getSyncConfig();
        if (again && !again.hub) return;              // inició sesión remota mientras tanto
        const keep = again && list.some(w => w.id === again.currentWorkspaceId) ? again.currentWorkspaceId : list[0].id;
        updateSyncConfig({
          hub: true, httpUrl: info.url, wsUrl: deriveWsUrl(info.url),
          email: r.email, userId: r.userId, token: r.token, tier: r.tier, tierLabel: r.tierLabel,
          expiresAt: r.expiresAt, workspaces: list, limits: r.limits, currentWorkspaceId: keep,
        });
      } catch { /* el hub aún no responde: se reintenta */ }
    };
    adopt();
    // Si el hub se cae o cambia de puerto, se vuelve a entrar.
    const id = setInterval(() => {
      const cur = getSyncConfig();
      if ((!cur || cur.hub) && syncStatusRef.current !== 'connected') adopt();
    }, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ─── Offline-first blob prefetch ───────────────────────────────────────────
  // After the workspace finishes syncing we walk every note for blob refs and
  // ask main to pull the bytes into the local cache. `offlineMode === 'full'`
  // ignores the size cap; 'lite' (default) only caches blobs up to
  // `offlinePrefetchMax` bytes. The reconciler that runs on every Y.Doc update
  // already handles deletions — this effect only adds the inverse: warm the
  // cache so newly-synced refs don't render as broken images when offline.
  const prefetchSignature = `${syncConfigState && syncConfigState.token}|${syncStatus}|${settings.offlineMode}|${settings.offlinePrefetchMax}|${settings.offlineCacheMax}`;
  useEffect(() => {
    if (syncStatus !== 'connected') return;
    if (!syncConfigState || !syncConfigState.token || !syncConfigState.httpUrl) return;
    if (!window.electronAPI || !window.electronAPI.blobPrefetch) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      const refs = new Set();
      const re = /edinot:\/\/blob\/([a-f0-9]{64})/gi;
      for (const f of yFiles.values()) {
        const txt = getContent(f.id).toString();
        let m;
        while ((m = re.exec(txt)) !== null) refs.add(m[1].toLowerCase());
      }
      if (refs.size === 0) return;
      const cap = settings.offlineMode === 'full'
        ? Number.POSITIVE_INFINITY
        : Number(settings.offlinePrefetchMax) || 5 * 1024 * 1024;
      const cacheMax = Number(settings.offlineCacheMax) || 0;
      try {
        await window.electronAPI.blobPrefetch(
          Array.from(refs),
          Number.isFinite(cap) ? cap : -1,
          { httpUrl: syncConfigState.httpUrl, token: syncConfigState.token },
          cacheMax,
        );
      } catch { /* offline / 401 — surfaced via individual fetches later */ }
    }, 2000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [prefetchSignature]);

  // ─── Attachment self-heal ───────────────────────────────────────────────
  // A historic reconciler bug (active-vault proxy) deleted server blobs that
  // notes still reference; the bytes usually survive in this device's blob
  // cache. Once per session, ~30s after sync credentials land (vault docs
  // have synced by then): diff every referenced sha against the server's
  // metadata and re-upload cache-hit misses. Content-addressing guarantees a
  // re-upload restores the exact same edinot://blob/<sha> URL, so notes and
  // share links heal without touching any text.
  const selfHealRanRef = useRef(false);
  useEffect(() => {
    const cfg = syncConfigState;
    if (selfHealRanRef.current) return;
    if (!cfg || !cfg.httpUrl || !cfg.token) return;
    if (!window.electronAPI || !window.electronAPI.blobCacheRead) return;
    const t = setTimeout(async () => {
      if (selfHealRanRef.current) return;
      selfHealRanRef.current = true;
      try {
        const refs = new Set();
        for (const f of getAllFilesAcrossVaults()) {
          const txt = getContentString(f.id);
          const re = /edinot:\/\/blob\/([a-f0-9]{64})/gi;
          let m;
          while ((m = re.exec(txt)) !== null) refs.add(m[1].toLowerCase());
        }
        if (!refs.size) return;
        const ids = [...refs];
        const present = new Set();
        for (let i = 0; i < ids.length; i += 400) {
          const res = await apiBlobMetaBatch(cfg.httpUrl, cfg.token, ids.slice(i, i + 400));
          for (const b of (res && res.blobs) || []) present.add(String(b.id).toLowerCase());
        }
        const missing = ids.filter(s => !present.has(s));
        if (!missing.length) return;
        let healed = 0;
        // Cap per session so a pathological backlog can't hammer the quota;
        // the next launch picks up the remainder.
        for (const sha of missing.slice(0, 200)) {
          let got = null;
          try { got = await window.electronAPI.blobCacheRead(sha); } catch {}
          if (!got || !got.ok || !got.bytes || !got.bytes.byteLength) continue;
          try {
            const file = new File([got.bytes], 'recuperado-' + sha.slice(0, 12), { type: got.mime || 'application/octet-stream' });
            const up = await apiUploadBlob(cfg.httpUrl, cfg.token, file);
            if (up && String(up.id).toLowerCase() === sha) healed++;
          } catch { /* quota/tier errors — leave for manual recovery */ }
        }
        if (healed) {
          console.log(`[blobs] self-heal: re-uploaded ${healed}/${missing.length} missing attachment(s) from local cache`);
          try { window.electronAPI.logAppend && window.electronAPI.logAppend(`[blobs] self-heal re-uploaded ${healed}/${missing.length}`); } catch {}
        }
      } catch (err) {
        console.warn('[blobs] self-heal failed:', err && err.message);
      }
    }, 30000);
    return () => clearTimeout(t);
  }, [syncConfigState]);

  // Disk autosave for files that have a path (opened via File→Open)
  useEffect(() => {
    if (!settings.autosave || !window.electronAPI) return;
    const f = files.find(x => x.id === activeId);
    if (!f || !f.__path) return;
    const t = setTimeout(() => {
      window.electronAPI.saveFile(f.__path, f.content).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [files, activeId, settings.autosave]);

  // "Exportar con adjuntos…" menu item → bundles the active note into a
  // single .md with every `edinot://blob/<sha>` reference inlined as base64.
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.on) return;
    return window.electronAPI.on('menu:saveAsBundle', async () => {
      if (!active) return;
      const defaultName = (active.name || 'nota').replace(/\.(md|markdown|txt)$/i, '') + '.md';
      try {
        const res = await window.electronAPI.saveFileWithAttachments(active.content, defaultName);
        if (res && !res.canceled && res.unresolvedCount) {
          window.alert(`Exportado con ${res.attachmentsCount} adjunto(s). ${res.unresolvedCount} no se pudo(eron) resolver (probablemente no descargado y sin conexión).`);
        }
      } catch (err) {
        window.alert('Error al exportar: ' + (err.message || err));
      }
    });
  }, [active && active.id, active && active.content, active && active.name]);

  // "Exportar workspace…" — bundles every note in the active vault into a
  // folder with an `attachments/` subdir and relative-path rewrites. Result is
  // portable without Edinot (any markdown viewer can open it).
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.on) return;
    return window.electronAPI.on('menu:exportWorkspace', async () => {
      const vaultFiles = filesMeta.filter(f => (f.vaultId || 'default') === activeVault);
      if (!vaultFiles.length) {
        window.alert('Este vault no tiene notas para exportar.');
        return;
      }
      const payload = vaultFiles.map(f => ({
        name: f.name || 'untitled',
        content: getContent(f.id).toString(),
      }));
      try {
        const res = await window.electronAPI.exportWorkspaceBundle(payload);
        if (!res || res.canceled) return;
        const lines = [
          `Exportado a: ${res.outDir}`,
          `Notas: ${res.noteCount}`,
          `Adjuntos resueltos: ${res.attachmentCount}`,
        ];
        if (res.unresolvedCount) lines.push(`⚠ Adjuntos no resueltos: ${res.unresolvedCount} (probablemente sin caché y sin conexión)`);
        window.alert(lines.join('\n'));
      } catch (err) {
        window.alert('Error al exportar workspace: ' + (err.message || err));
      }
    });
  }, [filesMeta, activeVault]);

  // CodeMirror integration
  const cmViewRef = useRef(null);
  const pendingActionRef = useRef(null);
  const enteringRef = useRef(false);
  const [awareness, setAwareness] = useState(null);

  // VFX flag: trigger shimmer when toolbar re-enters (render→markdown).
  useEffect(() => {
    if (mode === 'markdown') {
      enteringRef.current = true;
      const t = setTimeout(() => { enteringRef.current = false; }, 700);
      return () => clearTimeout(t);
    }
  }, [mode]);

  // Pick up awareness whenever the provider connects/disconnects.
  useEffect(() => {
    const p = getProvider();
    setAwareness(p ? p.awareness : null);
  }, [syncStatus]);

  // App-level Y.UndoManager — keeps history alive when the user toggles
  // render mode (which unmounts CodeMirror). We hand the same instance to
  // CodeMirror's `yCollab` so its internal Mod-z keymap and our window-level
  // shortcuts share state.
  const activeUndoManager = useMemo(() => {
    if (!activeContentText) return null;
    return new Y.UndoManager(activeContentText, { captureTimeout: 350 });
  }, [activeContentText]);
  useEffect(() => () => { if (activeUndoManager) activeUndoManager.destroy(); }, [activeUndoManager]);
  // On a structured canvas, route undo/redo to the canvas UndoManager (the
  // text-doc manager wouldn't see node/edge ops). Falls back to text undo.
  const canvasUndoTarget = () => {
    if (!CANVAS_STRUCTURED || !active || !isPrimaryCanvasNote(active.content)) return null;
    if (!isCanvasMigrated(active.id)) return null;
    return getCanvasUndoManager(active.id);
  };
  const doUndo = () => { const c = canvasUndoTarget(); if (c) { c.undo(); return; } if (activeUndoManager) activeUndoManager.undo(); };
  const doRedo = () => { const c = canvasUndoTarget(); if (c) { c.redo(); return; } if (activeUndoManager) activeUndoManager.redo(); };

  const fileInputRef = useRef(null);
  const [imageModal, setImageModal] = useState(null); // { src }
  const [pdfModal, setPdfModal] = useState(null); // { src, name }

  // Drop-overlay state. We use a counter (not a boolean) because dragenter /
  // dragleave fire for every child the cursor crosses inside the drop zone —
  // a plain boolean would flicker on every text-node boundary.
  const dragDepthRef = useRef(0);
  const [dragHover, setDragHover] = useState(false);
  // Safety net: if the user drags off the window, presses Esc, or the OS
  // cancels the drag, the overlay can get stuck. Reset on window-level
  // dragend / blur.
  useEffect(() => {
    const reset = () => {
      dragDepthRef.current = 0;
      setDragHover(false);
    };
    window.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
    };
  }, []);

  const insertAtCursor = (insert) => {
    insertAtCursorCM(cmViewRef.current, insert);
  };

  // Floating per-upload progress entries shown bottom-right. Each upload's
  // bytes/total updates here; the markdown placeholder stays simple.
  const [uploads, setUploads] = useState([]); // [{id, filename, loaded, total, status, error}]

  // MCP actions used to stack up as toasts here. Replaced by the live
  // AiPeerChip (one animated chip with crossfading activity line + a
  // popout history) — see the <AiPeerChip /> render below. The mcpAction
  // event still flows through the same awareness channel; AiPeerChip
  // subscribes directly via onMcpAction + onAiPresence.

  // Anchored speech-bubble for AI highlights and presentations — sits
  // next to the actual passage in the editor surface (CM coords in
  // markdown mode, getBoundingClientRect in render mode) with a tail
  // pointing back at the text. Replaces the bottom-right toast for
  // these two cases because the user wants to associate the comment
  // with a specific spot, not glance at a corner.
  const [aiCallout, setAiCallout] = useState(null);
  const dismissAiCallout = useCallback(() => setAiCallout(null), []);
  // Esc closes the callout — same shortcut the rest of the modals use.
  useEffect(() => {
    if (!aiCallout) return;
    const onKey = (e) => { if (e.key === 'Escape') setAiCallout(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aiCallout]);

  // Keep the AI callout glued to its highlight while the user scrolls or
  // the window resizes. Bypasses React for the per-frame style updates
  // — writes top/left/right directly on the DOM node so the bubble
  // tracks the highlight without a transition lerp. Adds the
  // `.ai-callout-pinning` class so CSS disables the slide animation
  // while pinning, restoring it after the user stops scrolling so the
  // next presentation step still glides between callout positions.
  const aiCalloutDomRef = useRef(null);
  useEffect(() => {
    if (!aiCallout || !aiCallout.anchor) return;
    let raf = null;
    let idleTimer = null;
    const recompute = () => {
      raf = null;
      const el = aiCalloutDomRef.current;
      if (!el) return;
      const cmView = cmViewRef.current;
      const render = renderRef.current;
      const { mode: anchorMode, step } = aiCallout.anchor;
      const rect = getHighlightRect(anchorMode, cmView, render, step);
      if (!rect) return;
      const vh = window.innerHeight || 800;
      // Use the SCROLLER's visible viewport bounds (not the content div).
      // `.md-render` is the content surface — its bottom extends past the
      // viewport whenever the note overflows. The actual visible window
      // for the highlight is the scrolling ancestor (e.g. `.body`).
      const scrollPane = (render && findScrollableAncestor(render))
        || (cmView && cmView.scrollDOM)
        || render
        || null;
      const paneRect = scrollPane ? scrollPane.getBoundingClientRect() : { top: 0, bottom: vh };

      const CALLOUT_H = 140;
      const EDGE_PAD = 8;
      const { side, style } = placeCallout(rect, 320, CALLOUT_H, { clamp: false });
      // Clamp the bubble's vertical position INTO the visible pane area
      // so it can't bleed over the app header / status-bar footer.
      // Horizontal placement is left to placeCallout (window-wide is fine).
      const naturalTop = typeof style.top === 'number'
        ? style.top
        : (rect.top - 8);
      const minTop = paneRect.top + EDGE_PAD;
      const maxTop = paneRect.bottom - CALLOUT_H - EDGE_PAD;
      const clampedTop = Math.max(minTop, Math.min(maxTop, naturalTop));
      style.top = clampedTop;
      // Only fade when the highlight has left the visible pane ENTIRELY
      // (fully above the top or fully below the bottom). While any part of
      // the passage is on screen, keep the bubble visible (clamped into the
      // pane) so it doesn't vanish the moment the user scrolls a little.
      const offscreen = rect.bottom < paneRect.top + EDGE_PAD
                     || rect.top    > paneRect.bottom - EDGE_PAD;
      // Direct DOM writes — skip the React render + CSS transition that
      // were producing the laggy "catch up" feel during scroll.
      el.classList.add('ai-callout-pinning');
      el.classList.toggle('ai-callout-offscreen', offscreen);
      // Refresh the side class so the tail stays on the right edge.
      el.classList.remove('ai-callout-left', 'ai-callout-right', 'ai-callout-top', 'ai-callout-bottom', 'ai-callout-corner');
      el.classList.add('ai-callout-' + side);
      el.style.top   = style.top   != null ? (typeof style.top   === 'number' ? style.top   + 'px' : style.top)   : '';
      el.style.left  = style.left  != null ? (typeof style.left  === 'number' ? style.left  + 'px' : style.left)  : '';
      el.style.right = style.right != null ? (typeof style.right === 'number' ? style.right + 'px' : style.right) : '';
      // Remove pinning class shortly after the last update so the next
      // step transition (different key) animates as before.
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (aiCalloutDomRef.current) aiCalloutDomRef.current.classList.remove('ai-callout-pinning');
      }, 220);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(recompute);
    };
    // Listen on every plausible scroller: the render pane, its scrollable
    // ancestor, the CM scroller in markdown mode, and window/resize.
    const targets = new Set([window]);
    if (renderRef.current) {
      targets.add(renderRef.current);
      const anc = findScrollableAncestor(renderRef.current);
      if (anc) targets.add(anc);
    }
    const cmScroller = cmViewRef.current && cmViewRef.current.scrollDOM;
    if (cmScroller) targets.add(cmScroller);
    targets.forEach((t) => t.addEventListener('scroll', onScroll, { passive: true }));
    window.addEventListener('resize', onScroll);
    // First sync after the DOM mounted (covers the case where the highlight
    // moved between applyStep's setAiCallout and this effect attaching).
    requestAnimationFrame(recompute);
    return () => {
      targets.forEach((t) => t.removeEventListener('scroll', onScroll));
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [aiCallout && aiCallout.key]);

  // AI pointer events — live "look at this" requests from focus_note /
  // highlight_in_note. The data side (yMeta.activeId) flips automatically
  // because both are stored in shared yjs maps; this handler is what
  // brings the OS window forward and (for highlight) tells the right
  // surface to select the passage: CodeMirror in markdown mode, the
  // rendered DOM in render mode (via CSS.highlights). We use a ref bag
  // so the subscription stays single-use even though it reads current
  // mode/active state — adding those to the dep array would tear down
  // and re-subscribe on every keystroke.
  const aiPointerRefs = useRef({});
  useEffect(() => {
    aiPointerRefs.current = {
      mode, active,
      cmView: cmViewRef.current,
      render: renderRef.current,
    };
  });
  useEffect(() => {
    let presentTimer = null;
    let calloutClearTimer = null;
    const clearAll = () => {
      if (presentTimer) { clearTimeout(presentTimer); presentTimer = null; }
      if (calloutClearTimer) { clearTimeout(calloutClearTimer); calloutClearTimer = null; }
      // Note: we don't auto-clear aiCallout on cancel — letting it
      // disappear gracefully via the calloutClearTimer feels less abrupt.
      // If a new pointer arrives we'll overwrite it anyway.
    };

    const applyStep = (pointer, step, stepIdx, stepCount) => {
      const refs = aiPointerRefs.current;
      const { mode: curMode, active: curActive, cmView, render } = refs;
      if (!curActive || curActive.id !== pointer.noteId) return false;
      // Paint the highlight (CM selection / CSS.highlights). The
      // callout positioning then anchors to the freshly-drawn rect on
      // the next frame.
      if (curMode === 'markdown' || curMode === 'dual' || curMode === 'live') highlightInCm(cmView, step);
      if (curMode === 'render' || curMode === 'dual') {
        highlightInRenderDom(render, step.text);
        // DOM match failed (text lives in a stripped directive / a render
        // component the walker can't reach). Do NOT auto-scroll — the old
        // source-offset ratio jumped to the top of the note on every step
        // whose passage sat near the start. Stay put; the callout falls back
        // to a fixed corner so the message still surfaces.
      }
      // Give the layout a frame to settle, then a second deferred pass
      // after ~120ms to catch the end of any smooth-scroll the editor or
      // browser may have queued. The follow-up recompute prevents the
      // bubble from snapping into place before the highlight stops
      // moving. The scroll/resize listener attached on aiCallout mount
      // also covers ongoing user scrolling beyond this initial paint.
      const base = {
        message: step.message,
        note: pointer.noteName,
        stepIdx, stepCount,
        key: `${pointer.id}:${stepIdx || 0}`,
        // Stored so the scroll/resize listener can recompute placement.
        anchor: { mode: curMode, step },
      };
      const apply = () => {
        const rect = getHighlightRect(curMode, cmView, render, step);
        if (rect) {
          const { side, style } = placeCallout(rect);
          setAiCallout({ ...base, side, style });
        } else {
          // Couldn't pinpoint the passage (off-screen, search failed):
          // fall back to a fixed corner so the message still surfaces.
          setAiCallout({ ...base, side: 'corner', style: { top: 80, right: 24 } });
        }
      };
      requestAnimationFrame(apply);
      setTimeout(apply, 180);
      return true;
    };

    const off = onAiPointer((p) => {
      // Any new pointer cancels an in-flight presentation.
      clearAll();
      // Multi-device: visual pointers (focus/reveal/canvas/present/…) should
      // only act on the device the user is currently on — otherwise the AI
      // pops + switches windows on every logged-in machine. The active device
      // is the last one whose window had focus (tracked in yMeta.activeDevice).
      const ad = yMeta.get('activeDevice');
      const isActiveDevice = !ad || !ad.id || !deviceIdRef.current || ad.id === deviceIdRef.current;
      if (!isActiveDevice) return;
      if (isActiveDevice && window.electronAPI?.windowAttention) {
        window.electronAPI.windowAttention().catch(() => {});
      }
      // La navegación la aplica AQUÍ el equipo destinatario. Antes llegaba
      // sola porque el MCP escribía yMeta.activeId y todos los equipos lo
      // seguían; ahora que la nota activa es local, el puntero es lo que la
      // mueve — y como estamos detrás del guard de activeDevice, se mueve
      // solo en el equipo que el usuario está usando.
      if (p.noteId && AI_POINTER_NAVIGATES.has(p.kind)) {
        setActiveId(p.noteId);
      }
      // Canvas pointers — dispatch to the CanvasView's imperative API once
      // the target note is mounted. Retries briefly so the canvas has time
      // to mount after focusNote switches the active note.
      if (p.kind === 'canvas_focus' || p.kind === 'canvas_present' || p.kind === 'canvas_animate' || p.kind === 'canvas_slideshow' || p.kind === 'canvas_laser') {
        let retries = 30;
        const dispatch = () => {
          const views = (typeof window !== 'undefined' && window.__edinotCanvasViews) || {};
          const view = views[p.noteId];
          if (view) {
            if (p.kind === 'canvas_focus') view.focusNode(p.nodeId, p.message);
            else if (p.kind === 'canvas_present') view.presentSteps(p.steps || []);
            else if (p.kind === 'canvas_animate') view.animate(p.steps || []);
            else if (p.kind === 'canvas_slideshow' && view.presentGroups) view.presentGroups(p.steps || [], { auto: p.auto !== false });
            else if (p.kind === 'canvas_laser' && view.laserTrace) view.laserTrace(p.points || [], { durationMs: p.durationMs });
            return;
          }
          if (--retries > 0) setTimeout(dispatch, 120);
        };
        setTimeout(dispatch, 150);
        return;
      }
      // Capture a screenshot of the current view. The cli/MCP side has
      // already flipped activeId via focusNote before publishing, so by
      // the time we arrive the user is looking at the right note —
      // give the render a 280ms beat to settle layout, then capture.
      if (p.kind === 'screenshot_request') {
        setTimeout(async () => {
          let cap;
          try {
            if (window.electronAPI && window.electronAPI.windowCapture) {
              cap = await window.electronAPI.windowCapture({
                rect: p.rect || null,
                maxWidth: p.maxWidth || 1200,
              });
            } else {
              cap = { ok: false, reason: 'electronAPI.windowCapture not available' };
            }
          } catch (err) {
            cap = { ok: false, reason: String(err && err.message || err) };
          }
          try {
            // Replies that land after the requester timed out are never
            // collected; drop anything old so they don't pile up.
            const now = Date.now();
            const map = yMeta.get('screenshotResponses') || {};
            const live = Object.fromEntries(Object.entries(map).filter(([, r]) => r && now - (r.at || 0) < 2 * 60 * 1000));
            yMeta.set('screenshotResponses', { ...live, [p.requestId]: { at: now, ...cap } });
          } catch { /* yjs write failures aren't worth surfacing — caller times out */ }
        }, 280);
        return;
      }
      // Auto-reveal after AI edits — switch to the note, scroll to the
      // changed region, pulse it briefly. Sent automatically by
      // appendContent (and explicitly by `reveal_change` MCP tool) so
      // the user never has to wonder "where did the AI just write?".
      if (p.kind === 'reveal') {
        const refs = aiPointerRefs.current;
        const curActive = refs.active;
        const isAppend = p.reason === 'append';
        const apply = () => {
          const r2 = aiPointerRefs.current;
          if (!r2.active || r2.active.id !== p.noteId) return;
          if (r2.mode === 'render' || r2.mode === 'dual') {
            revealInRenderDom(r2.render, p.text, { scrollFallbackToEnd: isAppend });
          }
          if (r2.mode === 'markdown' || r2.mode === 'dual' || r2.mode === 'live') {
            revealInCm(r2.cmView, p.fromCh, p.toCh);
          }
        };
        // Single fire — revealInRenderDom retries internally up to 6×
        // when the text isn't yet in the DOM. Skip the multi-fire pile
        // up that was making the scroll target flicker between frames.
        if (curActive && curActive.id === p.noteId) {
          requestAnimationFrame(apply);
        } else {
          setTimeout(apply, 360);
        }
        return;
      }
      // Ephemeral pulse — flash without callout, auto-clears in ~2.2s.
      if (p.kind === 'pulse') {
        const refs = aiPointerRefs.current;
        const { mode: curMode, active: curActive, cmView, render } = refs;
        if (!curActive || curActive.id !== p.noteId) return;
        if (curMode === 'render' || curMode === 'dual') pulseInRenderDom(render, p.text);
        if (curMode === 'markdown' || curMode === 'dual' || curMode === 'live') pulseInCm(cmView, p.fromCh, p.toCh);
        return;
      }
      // Single passage: show callout for ~9s, then fade.
      if (p.kind === 'highlight') {
        setTimeout(() => {
          applyStep(p, p, null, null);
          calloutClearTimer = setTimeout(() => setAiCallout(null), 9000);
        }, 150);
        return;
      }
      // Presentation: walk steps locally so the cadence is deterministic.
      // The callout is repositioned + retext'd for each step; the CSS
      // transition between top/left values gives a smooth glide.
      if (p.kind === 'present' && Array.isArray(p.steps) && p.steps.length) {
        const playStep = (idx) => {
          if (idx >= p.steps.length) {
            presentTimer = null;
            // Leave the final callout up for a beat before clearing.
            calloutClearTimer = setTimeout(() => setAiCallout(null), 1200);
            return;
          }
          const step = p.steps[idx];
          const { active: curActive } = aiPointerRefs.current;
          if (!curActive || curActive.id !== p.noteId) {
            presentTimer = null;
            setAiCallout(null);
            return;
          }
          applyStep(p, step, idx + 1, p.steps.length);
          const dur = Math.max(1000, Math.min(60000, Number(step.durationMs) || 6000));
          presentTimer = setTimeout(() => playStep(idx + 1), dur);
        };
        setTimeout(() => playStep(0), 150);
      }
    });
    return () => {
      if (off) off();
      clearAll();
    };
  }, []);

  // Auto-update banner state. Subscribes to `update:status` pushed from main.
  const [updateState, setUpdateState] = useState({ state: 'idle' });
  const [updateDismissed, setUpdateDismissed] = useState(false);
  useEffect(() => {
    if (!window.electronAPI?.updateGetStatus) return;
    let off = null;
    (async () => {
      try { setUpdateState(await window.electronAPI.updateGetStatus()); } catch {}
    })();
    if (window.electronAPI.on) {
      off = window.electronAPI.on('update:status', (s) => {
        setUpdateState(s || { state: 'idle' });
        // Re-show banner when a fresh state arrives (e.g. new version found
        // after the user previously dismissed an old notification).
        if (s && (s.state === 'available' || s.state === 'downloaded')) {
          setUpdateDismissed(false);
        }
      });
    }
    return () => { if (off) off(); };
  }, []);
  const cancelUpload = useCallback((id) => {
    setUploads(prev => prev.map(u => u.id === id ? { ...u, _abort: u._abort && u._abort() } : u));
  }, []);

  // Same blob pipeline as note attachments, but returns metadata so a canvas
  // node can own the reference instead of inserting markdown at the caret.
  const uploadCanvasAttachment = useCallback(async (file) => {
    if (!file) return null;
    const isImage = file.type && file.type.startsWith('image/');
    const haveSync = !!(syncConfigState && syncConfigState.token && syncConfigState.httpUrl);
    const safeName = (file.name || (isImage ? 'imagen' : 'archivo')).replace(/[\]\[\n\r]/g, '');

    if (!haveSync) {
      if (!isImage) {
        throw new Error(t('attach.needSync'));
      }
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen.'));
        reader.readAsDataURL(file);
      });
      return { name: safeName, url, mime: file.type || '', size: file.size || 0 };
    }

    const uploadId = `canvas-upload#${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
    const controller = new AbortController();
    setUploads(prev => [...prev, {
      id: uploadId, filename: safeName, loaded: 0, total: file.size || 0,
      status: 'uploading', error: null, _abort: () => controller.abort(),
    }]);
    const finalize = (patch) => setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, ...patch } : u));
    const sweepOut = () => setTimeout(() => setUploads(prev => prev.filter(u => u.id !== uploadId)), 3000);

    try {
      const result = await apiUploadBlob(syncConfigState.httpUrl, syncConfigState.token, file, {
        signal: controller.signal,
        onProgress: (loaded, total) => finalize({ loaded, total }),
      });
      if (window.electronAPI && window.electronAPI.cacheBlobBytes) {
        try {
          const buf = await file.arrayBuffer();
          await window.electronAPI.cacheBlobBytes(result.id, file.type || result.mime || 'application/octet-stream', buf);
        } catch { /* non-fatal */ }
      }
      finalize({ status: 'done', loaded: file.size || 0 });
      sweepOut();
      return {
        name: safeName,
        sha: result.id,
        url: `edinot://blob/${result.id}`,
        mime: file.type || result.mime || '',
        size: file.size || 0,
      };
    } catch (err) {
      const aborted = err && err.message === 'aborted';
      const msg = aborted ? 'cancelado'
                : err.code === 'quota_exceeded' ? 'cuota de almacenamiento agotada'
                : err.code === 'file_too_large' ? `archivo demasiado grande (máx ${err.maxFileSize ? humanFileSize(err.maxFileSize) : '?'} en tu tier)`
                : (err.message || 'error desconocido');
      finalize({ status: aborted ? 'cancelled' : 'error', error: msg });
      sweepOut();
      throw new Error(msg);
    }
  }, [syncConfigState && syncConfigState.token, syncConfigState && syncConfigState.httpUrl]);

  // Upload a file to the sync server's blob store and insert an
  // `![name](edinot://blob/<sha>)` reference into the active note. Falls back
  // to inline base64 for images when sync isn't configured (preserves the old
  // offline behaviour); refuses non-images in offline mode.
  // Dropped Outlook/Thunderbird emails (.eml MIME or .msg OLE) become a
  // readable markdown block instead of an opaque attachment: header quote
  // (subject / from / to / date), body converted to markdown in the main
  // process, inline cid: images rewired to uploaded blobs, and remaining
  // attachments listed as links.
  const attachEmail = useCallback(async (file) => {
    if (!file || !active) return;
    const apiE = window.electronAPI;
    if (!apiE || !apiE.emailParse) { window.alert(t('email.needApp')); return; }
    const yt = activeContentText;
    if (!yt) return;
    const safeName = (file.name || 'correo').replace(/[\]\[\n\r]/g, '');
    const tag = `edinot://importing#${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const placeholder = `[${t('email.importing', { name: safeName })} ⏳](${tag})`;
    insertAtCursor(`\n${placeholder}\n`);
    // Bottom toast, same stack as file uploads. 'processing' renders an
    // indeterminate row; the note line tracks the stage (parse → adjuntos).
    setUploads(prev => [...prev, {
      id: tag, filename: safeName, loaded: 0, total: file.size || 0,
      status: 'processing', note: t('email.toast.parsing'), error: null,
    }]);
    const toast = (patch) => setUploads(prev => prev.map(u => u.id === tag ? { ...u, ...patch } : u));
    const sweepToast = () => setTimeout(() => setUploads(prev => prev.filter(u => u.id !== tag)), 3000);
    const replacePlaceholder = (replacement) => {
      const src = yt.toString();
      const i = src.indexOf(placeholder);
      if (i < 0) return;
      applyTextDiff(yt, src.slice(0, i) + replacement + src.slice(i + placeholder.length));
    };
    try {
      const parsed = await apiE.emailParse(file.name || '', new Uint8Array(await file.arrayBuffer()));
      if (!parsed || !parsed.ok) throw new Error((parsed && parsed.reason) || 'parse failed');
      let body = String(parsed.markdown || '').trim();
      const haveSync = !!(syncConfigState && syncConfigState.token && syncConfigState.httpUrl);
      const linkLines = [];
      const failLines = [];
      const attTotal = (parsed.attachments || []).length;
      let attDone = 0;
      for (const att of parsed.attachments || []) {
        attDone++;
        if (attTotal) toast({ note: t('email.toast.attachments', { i: attDone, n: attTotal }) });
        if (!haveSync) { failLines.push(`⚠ ${att.filename}: ${t('attach.needSync')}`); continue; }
        try {
          const bin = Uint8Array.from(atob(att.base64), (c) => c.charCodeAt(0));
          const f = new File([bin], att.filename, { type: att.mime || 'application/octet-stream' });
          const result = await apiUploadBlob(syncConfigState.httpUrl, syncConfigState.token, f);
          if (apiE.cacheBlobBytes) { try { await apiE.cacheBlobBytes(result.id, att.mime, bin.buffer); } catch { /* non-fatal */ } }
          const url = `edinot://blob/${result.id}`;
          if (att.cid && body.includes(`cid:${att.cid}`)) {
            body = body.split(`cid:${att.cid}`).join(url);
          } else {
            const isImg = (att.mime || '').startsWith('image/');
            const linkName = String(att.filename).replace(/[\]\[\n\r]/g, '');
            linkLines.push(isImg ? `![${linkName}](${url})` : `[📎 ${linkName}](${url})`);
          }
        } catch (err) {
          failLines.push(`⚠ ${att.filename}: ${err && err.message || 'error'}`);
        }
      }
      const dateStr = parsed.date ? new Date(parsed.date).toLocaleString() : '';
      const subject = (parsed.subject || t('email.noSubject')).replace(/\n/g, ' ');
      const metaLine = [
        parsed.from ? `**${t('email.from')}:** ${parsed.from}` : '',
        parsed.to ? `**${t('email.to')}:** ${parsed.to}` : '',
        dateStr,
      ].filter(Boolean).join(' · ');
      const parts = [`> ✉️ **${subject}**`];
      if (metaLine) parts.push(`> ${metaLine}`);
      parts.push('', body);
      if (linkLines.length) parts.push('', `**${t('email.attachments')}:**`, ...linkLines.map((l) => `- ${l}`));
      if (failLines.length) parts.push('', ...failLines);
      replacePlaceholder(parts.join('\n'));
      toast({ status: 'done', note: t('email.toast.done') });
      sweepToast();
    } catch (err) {
      replacePlaceholder(`[⚠ ${t('email.fail', { name: safeName, err: err && err.message || '?' })}]()`);
      toast({ status: 'error', error: err && err.message || '?' });
      sweepToast();
    }
  }, [active && active.id, activeContentText, syncConfigState && syncConfigState.token, syncConfigState && syncConfigState.httpUrl]);

  const attachFile = useCallback(async (file) => {
    if (!file || !active) return;
    // Emails get unpacked into markdown (desktop only — parsing lives in the
    // Electron main process). On web they fall through to a plain attachment.
    if ((/\.(eml|msg)$/i.test(file.name || '') || file.type === 'message/rfc822')
        && window.electronAPI && window.electronAPI.emailParse) {
      return attachEmail(file);
    }
    const isImage = file.type && file.type.startsWith('image/');
    const haveSync = !!(syncConfigState && syncConfigState.token && syncConfigState.httpUrl);
    const safeName = (file.name || (isImage ? 'imagen' : 'archivo')).replace(/[\]\[\n\r]/g, '');

    // If cursor sits inside a GFM table row, wrap with spaces instead of
    // newlines — a literal \n inside a cell splits the row into multiple
    // physical lines and markdown-it stops parsing the table at that point.
    const cmView = cmViewRef.current;
    const inTableRow = (() => {
      if (!cmView) return false;
      try {
        const { from } = cmView.state.selection.main;
        const line = cmView.state.doc.lineAt(from);
        return /^\s*\|.*\|/.test(line.text);
      } catch { return false; }
    })();
    const wrap = inTableRow ? ' ' : '\n';

    if (!haveSync) {
      if (!isImage) {
        window.alert(t('attach.needSync'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => insertAtCursor(`${wrap}![${safeName}](${reader.result})${wrap}`);
      reader.readAsDataURL(file);
      return;
    }

    const tag = `edinot://uploading#${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
    const placeholder = `[Subiendo ${safeName}… ⏳](${tag})`;
    const yt = activeContentText;
    if (!yt) return;
    insertAtCursor(`${wrap}${placeholder}${wrap}`);

    const replacePlaceholder = (replacement) => {
      const src = yt.toString();
      const i = src.indexOf(placeholder);
      if (i < 0) return;
      applyTextDiff(yt, src.slice(0, i) + replacement + src.slice(i + placeholder.length));
    };

    const uploadId = tag;
    const controller = new AbortController();
    setUploads(prev => [...prev, {
      id: uploadId, filename: safeName, loaded: 0, total: file.size || 0,
      status: 'uploading', error: null, _abort: () => controller.abort(),
    }]);
    const finalize = (patch) => setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, ...patch } : u));
    const sweepOut = () => setTimeout(() => setUploads(prev => prev.filter(u => u.id !== uploadId)), 3000);

    try {
      const result = await apiUploadBlob(syncConfigState.httpUrl, syncConfigState.token, file, {
        signal: controller.signal,
        onProgress: (loaded, total) => finalize({ loaded, total }),
      });
      // Mirror the bytes into the local blob cache so the first preview /
      // protocol-handler fetch is instant and doesn't depend on the network.
      // Best-effort: a failure here is non-fatal; the preview will fall back
      // to fetching from the server.
      if (window.electronAPI && window.electronAPI.cacheBlobBytes) {
        try {
          const buf = await file.arrayBuffer();
          await window.electronAPI.cacheBlobBytes(result.id, file.type || result.mime || 'application/octet-stream', buf);
        } catch { /* non-fatal */ }
      }
      replacePlaceholder(`![${safeName}](edinot://blob/${result.id})`);
      finalize({ status: 'done', loaded: file.size || 0 });
      sweepOut();
    } catch (err) {
      const aborted = err && err.message === 'aborted';
      const msg = aborted ? 'cancelado'
                : err.code === 'quota_exceeded' ? 'cuota de almacenamiento agotada'
                : err.code === 'file_too_large' ? `archivo demasiado grande (máx ${err.maxFileSize ? humanFileSize(err.maxFileSize) : '?'} en tu tier)`
                : (err.message || 'error desconocido');
      replacePlaceholder(aborted ? '' : `[⚠ Fallo subida de ${safeName}: ${msg}]()`);
      finalize({ status: aborted ? 'cancelled' : 'error', error: msg });
      sweepOut();
    }
  }, [active && active.id, activeContentText, syncConfigState && syncConfigState.token, syncConfigState && syncConfigState.httpUrl, attachEmail]);

  // Back-compat alias — callers expecting "only images" still work; the new
  // attachFile handles arbitrary files (and only-images callsites only ever
  // pass image files anyway).
  const insertImageFromFile = attachFile;

  // ── Floating companion windows bridge ─────────────────────────────────
  // The float windows (electron/main.cjs + float-window.jsx) own no data:
  // this main renderer answers their requests over the float:msg relay and
  // pushes content over float:push. floatLatestRef is refreshed every render
  // so the mount-once listener always sees current state without
  // resubscribing; floatStateRef survives across messages (present on/off,
  // quick-note target captured at open time — the Y.Text object stays valid
  // even if the user navigates away).
  const floatStateRef = useRef({ presentOn: false, noteTarget: null });
  const floatLatestRef = useRef({});
  floatLatestRef.current = { active, renderedHtml, activeContentText, syncConfigState };

  useEffect(() => {
    const apiF = window.electronAPI;
    if (!apiF || !apiF.floatPush || !apiF.on) return;

    const pushPresent = () => {
      const cur = floatLatestRef.current;
      apiF.floatPush({
        mode: 'present', kind: 'content',
        title: cur.active ? splitExt(cur.active.name).base : '',
        html: cur.renderedHtml || '',
      });
    };

    const captureAndUpload = async () => {
      const cur = floatLatestRef.current;
      const shot = await apiF.screenCapture({ hideFloat: true });
      if (!shot || !shot.ok) return { ok: false, error: (shot && shot.reason) || 'sin captura' };
      const stamp = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const name = `captura-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.png`;
      const haveSync = !!(cur.syncConfigState && cur.syncConfigState.token && cur.syncConfigState.httpUrl);
      if (!haveSync) return { ok: true, markdown: `![${name}](data:image/png;base64,${shot.base64})` };
      try {
        const bin = Uint8Array.from(atob(shot.base64), (c) => c.charCodeAt(0));
        const f = new File([bin], name, { type: 'image/png' });
        const result = await apiUploadBlob(cur.syncConfigState.httpUrl, cur.syncConfigState.token, f);
        if (apiF.cacheBlobBytes) { try { await apiF.cacheBlobBytes(result.id, 'image/png', bin.buffer); } catch { /* non-fatal */ } }
        return { ok: true, markdown: `![${name}](edinot://blob/${result.id})` };
      } catch (err) {
        return { ok: false, error: err && err.message || 'fallo de subida' };
      }
    };

    const off = apiF.on('float:msg', async (payload) => {
      const kind = payload && payload.kind;
      const cur = floatLatestRef.current;
      if (kind === 'float-ready' && payload.mode === 'present') {
        floatStateRef.current.presentOn = true;
        pushPresent();
      } else if (kind === 'float-ready' && payload.mode === 'note') {
        const ok = cur.active && !isExternalId(cur.active.id) && cur.activeContentText;
        floatStateRef.current.noteTarget = ok
          ? { ytext: cur.activeContentText, name: splitExt(cur.active.name).base }
          : null;
        apiF.floatPush({
          mode: 'note', kind: 'note-init',
          noteName: floatStateRef.current.noteTarget ? floatStateRef.current.noteTarget.name : '',
        });
      } else if (kind === 'float-capture') {
        const reply = await captureAndUpload();
        apiF.floatPush({ mode: 'note', kind: 'capture-result', reqId: payload.reqId, ...reply });
      } else if (kind === 'float-append') {
        const tgt = floatStateRef.current.noteTarget;
        if (!tgt || !tgt.ytext) {
          apiF.floatPush({ mode: 'note', kind: 'append-result', reqId: payload.reqId, ok: false, error: t('float.noTarget') });
          return;
        }
        try {
          const body = String(payload.text || '').replace(/\s+$/, '');
          const src = tgt.ytext.toString();
          const sep = src.length && !src.endsWith('\n') ? '\n' : '';
          tgt.ytext.insert(tgt.ytext.length, `${sep}${body}\n`);
          apiF.floatPush({ mode: 'note', kind: 'append-result', reqId: payload.reqId, ok: true, noteName: tgt.name });
        } catch (err) {
          apiF.floatPush({ mode: 'note', kind: 'append-result', reqId: payload.reqId, ok: false, error: err && err.message || 'error' });
        }
      } else if (kind === 'float-closed') {
        if (payload.mode === 'present') floatStateRef.current.presentOn = false;
        if (payload.mode === 'note') floatStateRef.current.noteTarget = null;
      }
    });
    return off;
  }, []);

  // Live-mirror the active note into the presentation float (throttled —
  // renderedHtml recomputes on every keystroke of the active doc).
  useEffect(() => {
    const apiF = window.electronAPI;
    if (!apiF || !apiF.floatPush) return;
    if (!floatStateRef.current.presentOn) return;
    const id = setTimeout(() => {
      if (!floatStateRef.current.presentOn) return;
      const cur = floatLatestRef.current;
      apiF.floatPush({
        mode: 'present', kind: 'content',
        title: cur.active ? splitExt(cur.active.name).base : '',
        html: cur.renderedHtml || '',
      });
    }, 300);
    return () => clearTimeout(id);
  }, [renderedHtml, active && active.id]);

  const openImagePicker = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const runAction = (kind, opts) => {
    if (kind === 'image') { openImagePicker(); return; }
    if (!active) return;
    applyActionCM(cmViewRef.current, kind, opts);
  };

  const action = (kind, opts) => {
    if (mode === 'render') {
      // Render-only mode has no editor — bounce to markdown first.
      pendingActionRef.current = { kind, opts };
      setMode('markdown');
      return;
    }
    runAction(kind, opts);
  };

  useEffect(() => {
    if (mode !== 'render' && pendingActionRef.current) {
      const pending = pendingActionRef.current;
      pendingActionRef.current = null;
      // Backwards-compat: legacy callers stored a string action.
      const kind = typeof pending === 'string' ? pending : pending.kind;
      const opts = typeof pending === 'string' ? undefined : pending.opts;
      if (kind === '__search__') {
        // Wait for editor view to mount before opening the search panel.
        requestAnimationFrame(() => {
          if (cmViewRef.current) openSearchPanel(cmViewRef.current);
        });
      } else {
        runAction(kind, opts);
      }
    }
  }, [mode]);

  const replaceImageSrc = (oldSrc, newSrc) => {
    if (!active) return;
    const t = getContent(active.id);
    const next = t.toString().split(oldSrc).join(newSrc);
    applyTextDiff(t, next);
  };

  // Custom prompt + confirm — Electron blocks the native window.prompt()
  // and the default confirm() is the ugly browser dialog.
  const [promptState, setPromptState] = useState(null);
  const askPrompt = useCallback((title, defaultValue) => new Promise((resolve) => {
    setPromptState({ title, defaultValue, resolve });
  }), []);
  const handlePromptResolve = useCallback((value) => {
    if (promptState && promptState.resolve) promptState.resolve(value);
    setPromptState(null);
  }, [promptState]);

  const [confirmState, setConfirmState] = useState(null);
  const askConfirm = useCallback((message, options = {}) => new Promise((resolve) => {
    setConfirmState({
      title: options.title || null,
      message,
      confirmLabel: options.confirmLabel || t('btn.delete'),
      cancelLabel: options.cancelLabel || t('btn.cancel'),
      danger: options.danger !== false,
      resolve,
    });
  }), []);
  const handleConfirmResolve = useCallback((value) => {
    if (confirmState && confirmState.resolve) confirmState.resolve(value);
    setConfirmState(null);
  }, [confirmState]);

  const canCommentActiveNote = !!active && !isViewer && activeNoteLevel !== 'view' && activeNoteLevel !== 'none';

  const enqueueAgentTasksForComment = useCallback((comment, sourceText) => {
    if (!active || !comment) return [];
    const tags = canonicalAgentTags(yMeta.get('taggedAgents'));
    const aliases = extractAgentMentions(sourceText || comment.text, knownAiAgents, tags);
    if (!aliases.length) return [];
    const noteComments = readNoteComments(ydoc, active.id);
    const threadRootId = commentThreadRootId(comment, noteComments);
    const onlineByAlias = new Map(aiAgents.map(a => [String(a.alias || '').toLowerCase(), a]));
    const knownByAlias = new Map(knownAiAgents.map(a => [String(a.alias || '').toLowerCase(), a]));
    const onlineKinds = new Set(aiAgents.map(a => String(a.kind || '').toLowerCase()).filter(Boolean));
    const vaultId = active.vaultId || 'default';
    const policy = yMeta.get('agentPolicy');
    const now = new Date().toISOString();
    const tasks = [];
    for (const alias of aliases) {
      const tag = tags.get(alias);
      // Canonical task: addressed to a shared kind (@Claude), claimable by any
      // online agent of that kind. Provenance is recorded on claim/complete.
      const agent = tag ? {} : (onlineByAlias.get(alias) || knownByAlias.get(alias) || {});
      const kind = tag ? tag.kind : (agent.kind || 'ai');
      // Fase 3 gate — skip agents the vault disallows.
      if (!isAgentAllowedInVault(policy, vaultId, { kind, alias })) continue;
      const online = tag ? onlineKinds.has(kind) : !!agent.online;
      tasks.push({
        id: 'agt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        targetAlias: alias,
        targetKind: kind,
        canonical: !!tag,
        targetOwnerEmail: tag ? null : (agent.ownerEmail || null),
        targetDevice: tag ? null : (agent.device || null),
        noteId: active.id,
        noteName: active.name,
        vaultId,
        commentId: comment.id,
        parentCommentId: comment.parentId || null,
        threadRootId,
        anchorText: comment.anchorText || null,
        prompt: String(sourceText || comment.text || '').slice(0, 4000),
        requestedBy: (syncConfigState && syncConfigState.email) || 'user',
        requestedAt: now,
        status: online ? 'pending' : 'pending-offline',
        history: [{ status: online ? 'pending' : 'pending-offline', ts: now }],
      });
    }
    if (tasks.length) putAgentTasks(ydoc, tasks);
    return tasks;
  }, [active && active.id, active && active.name, active && active.vaultId, aiAgents, knownAiAgents, syncConfigState && syncConfigState.email]);

  const enqueueAgentContinuationForReply = useCallback((comment, allComments) => {
    if (!active || !comment) return null;
    if (extractAgentMentions(comment.text, knownAiAgents, canonicalAgentTags(yMeta.get('taggedAgents'))).length) return null;
    const rootId = commentThreadRootId(comment, allComments || []);
    if (!rootId) return null;
    const existing = readAgentTasks(ydoc);
    const prior = existing
      .filter(t => (t.threadRootId || t.commentId) === rootId && t.targetAlias)
      .sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')))[0];
    if (!prior) return null;
    const alias = String(prior.targetAlias || '').toLowerCase();
    const agent = knownAiAgents.find(a => String(a.alias || '').toLowerCase() === alias) || {};
    const now = new Date().toISOString();
    const task = {
      id: 'agt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      targetAlias: alias,
      targetKind: prior.targetKind || agent.kind || 'ai',
      targetOwnerEmail: prior.targetOwnerEmail || agent.ownerEmail || null,
      targetDevice: prior.targetDevice || agent.device || null,
      noteId: active.id,
      noteName: active.name,
      vaultId: active.vaultId || 'default',
      commentId: comment.id,
      parentCommentId: comment.parentId || null,
      threadRootId: rootId,
      anchorText: comment.anchorText || null,
      prompt: String(comment.text || '').slice(0, 4000),
      requestedBy: (syncConfigState && syncConfigState.email) || 'user',
      requestedAt: now,
      continuationOf: prior.id,
      status: agent.online === false ? 'pending-offline' : 'pending',
      history: [{ status: agent.online === false ? 'pending-offline' : 'pending', ts: now, reason: 'thread-continuation' }],
    };
    putAgentTasks(ydoc, [task]);
    return task;
  }, [active && active.id, active && active.name, active && active.vaultId, knownAiAgents, syncConfigState && syncConfigState.email]);

  const handleThreadModalReply = useCallback((comment, allComments) => {
    const explicit = enqueueAgentTasksForComment(comment, comment && comment.text);
    if (!explicit.length) enqueueAgentContinuationForReply(comment, allComments || []);
  }, [enqueueAgentTasksForComment, enqueueAgentContinuationForReply]);

  const commentsBodyRef = useRef(null);
  const scrollCommentsToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = commentsBodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);
  // Auto-follow incoming comments only when the user is already
  // looking at the tail of the list. Avoids yanking them away if they
  // scrolled up to read an older thread while an AI reply lands.
  const commentsTailFollowRef = useRef(true);
  useEffect(() => {
    const el = commentsBodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      commentsTailFollowRef.current = gap < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [aiCommentsOpen]);
  // When new comments arrive (sync from another device or CLI reply
  // fallback), follow the tail only if the user was near the bottom.
  useEffect(() => {
    if (!aiCommentsOpen) return;
    if (commentsTailFollowRef.current) scrollCommentsToBottom();
  }, [metaV, aiCommentsOpen, scrollCommentsToBottom]);
  // Snap to bottom when the modal first opens.
  useEffect(() => {
    if (aiCommentsOpen) scrollCommentsToBottom();
  }, [aiCommentsOpen, scrollCommentsToBottom]);
  // Stable per-device id used to claim agent tasks. Survives reloads
  // (localStorage) so claims don't ping-pong every refresh.
  const deviceIdRef = useRef(null);
  if (!deviceIdRef.current) {
    let id = '';
    try { id = localStorage.getItem('edinotDeviceId') || ''; } catch {}
    if (!id) {
      id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem('edinotDeviceId', id); } catch {}
    }
    deviceIdRef.current = id;
  }
  // Claim "active device" whenever this window gains focus (and on mount), so
  // AI visual pointers (focus_note / present / canvas focus) only act on the
  // machine the user is actually using, not every logged-in device.
  useEffect(() => {
    const mark = () => {
      try {
        const cur = yMeta.get('activeDevice');
        if (!cur || cur.id !== deviceIdRef.current) {
          yMeta.set('activeDevice', { id: deviceIdRef.current, at: Date.now() });
        }
      } catch {}
    };
    mark();
    window.addEventListener('focus', mark);
    return () => window.removeEventListener('focus', mark);
  }, []);
  // Ambient/proactive sweep (Fase 2). Conservative by design: only the active
  // device sweeps, only every ~20 min, and only HIGH-severity signals (agent
  // tasks stuck `running` past the threshold) raise a nudge — surfaced via the
  // existing notifications bell (no toast). De-duped in `yMeta.ambientNotified`
  // so a signal pings once per TTL across devices/reloads. Dormant until the
  // user opts in via `set_ambient_config { enabled: true }`.
  useEffect(() => {
    const sc = syncConfigState;
    if (!sc || !sc.httpUrl || !sc.token || !sc.email) return;
    const sweep = () => {
      try {
        const cfgA = yMeta.get('ambientConfig');
        if (!cfgA || cfgA.enabled !== true) return;
        const active = yMeta.get('activeDevice');
        if (!active || active.id !== deviceIdRef.current) return; // single sweeper
        const now = Date.now();
        const stalledMins = Number.isFinite(cfgA.stalledRunningMins) ? cfgA.stalledRunningMins : 30;
        const TTL = 12 * 60 * 60 * 1000;
        const notified = (yMeta.get('ambientNotified') && typeof yMeta.get('ambientNotified') === 'object')
          ? { ...yMeta.get('ambientNotified') } : {};
        for (const k of Object.keys(notified)) if (now - notified[k] > TTL) delete notified[k];
        const tasks = readAgentTasks(ydoc);
        const fresh = [];
        for (const tk of tasks) {
          if (!tk || String(tk.status) !== 'running') continue;
          const at = Date.parse(tk.runningAt || tk.claimedAt || tk.requestedAt || '');
          if (!Number.isFinite(at)) continue;
          const ageMins = Math.floor((now - at) / 60000);
          if (ageMins < stalledMins) continue;
          const key = 'stalled-running-task:' + tk.id;
          if (notified[key]) continue;
          notified[key] = now;
          fresh.push({ tk, ageMins });
        }
        if (!fresh.length) return;
        for (const f of fresh) {
          apiDispatchNotif(sc.httpUrl, sc.token, {
            email: sc.email, workspaceId: sc.currentWorkspaceId, kind: 'ambient',
            payload: {
              signalType: 'stalled-running-task', taskId: f.tk.id, noteId: f.tk.noteId,
              noteName: f.tk.noteName || null, targetAlias: f.tk.targetAlias, ageMins: f.ageMins,
              preview: String(f.tk.prompt || '').slice(0, 160),
            },
          }).catch(() => {});
        }
        yMeta.set('ambientNotified', notified);
      } catch {}
    };
    const t0 = setTimeout(sweep, 30 * 1000);          // first sweep ~30s after load
    const id = setInterval(sweep, 20 * 60 * 1000);    // then every 20 min (conservative)
    return () => { clearTimeout(t0); clearInterval(id); };
  }, [syncConfigState && syncConfigState.httpUrl, syncConfigState && syncConfigState.token, syncConfigState && syncConfigState.email, syncConfigState && syncConfigState.currentWorkspaceId]);

  // Stable signature of the anchored, unresolved root comments for
  // the active note. Used as the dep below so the wrap effect only
  // runs when comments actually change — not on every yMeta tick
  // (awareness, presence, cursor pings would otherwise rip + rebuild
  // the marks every few hundred ms, making the render pane flicker).
  const anchorCommentsSig = useMemo(() => {
    if (!active) return '';
    const list = readNoteComments(ydoc, active.id);
    return list
      .filter(c => c && c.anchorText && !c.resolved && !c.parentId)
      .map(c => `${c.id}:${(c.anchorText || '').slice(0, 80)}:${(c.text || '').slice(0, 40)}`)
      .join('|');
  }, [metaV, active && active.id]);

  // Post-process the render pane: wrap each comment's anchorText in a
  // <mark.comment-anchor> so reviewers see who flagged what without
  // opening the panel. Click on a mark scrolls + opens its thread.
  useEffect(() => {
    if (!active) return;
    if (mode !== 'render' && mode !== 'dual') return;
    const root = renderRef.current;
    if (!root) return;
    const tick = () => {
      const r = renderRef.current;
      if (!r) return;
      // Clean any previous wraps before re-applying so re-renders
      // don't accumulate duplicates.
      r.querySelectorAll('mark.comment-anchor').forEach(m => {
        const parent = m.parentNode;
        if (!parent) return;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
        parent.normalize();
      });
      const list = readNoteComments(ydoc, active.id);
      const open = list.filter(c => c && c.anchorText && !c.resolved && !c.parentId);
      if (!open.length) return;
      // Sort by anchorText length desc so longer matches win over
      // substrings ("foo bar baz" before "bar").
      const sorted = [...open].sort((a, b) => (b.anchorText.length - a.anchorText.length));
      const used = new Set();
      for (const c of sorted) {
        // Con posiciones relativas, el texto ACTUAL del rango (aunque se haya
        // editado); si no, el texto citado al crear el comentario.
        let needle = String(c.anchorText || '').trim();
        const rr = resolveAnchor(activeContentText, c);
        if (rr) { const cur = activeContentText.toString().slice(rr.from, rr.to).replace(/[*_`~]/g, '').trim(); if (cur && !cur.includes('\n')) needle = cur; }
        if (!needle) continue;
        const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => {
            if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
            if (node.parentElement && node.parentElement.closest('mark.comment-anchor, pre, code, .table-tools, .db-host')) return NodeFilter.FILTER_REJECT;
            return node.nodeValue.includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          },
        });
        const node = walker.nextNode();
        if (!node) continue;
        const idx = node.nodeValue.indexOf(needle);
        if (idx < 0) continue;
        const before = node.nodeValue.slice(0, idx);
        const match = node.nodeValue.slice(idx, idx + needle.length);
        const after = node.nodeValue.slice(idx + needle.length);
        const parent = node.parentNode;
        if (!parent) continue;
        const mark = document.createElement('mark');
        mark.className = 'comment-anchor';
        mark.dataset.commentId = c.id;
        mark.dataset.author = c.author || 'user';
        mark.dataset.preview = String(c.text || '').slice(0, 200);
        mark.textContent = match;
        const beforeNode = before ? document.createTextNode(before) : null;
        const afterNode = after ? document.createTextNode(after) : null;
        parent.insertBefore(beforeNode || mark, node);
        if (beforeNode) parent.insertBefore(mark, node);
        if (afterNode) parent.insertBefore(afterNode, node);
        parent.removeChild(node);
        used.add(c.id);
      }
    };
    // Run after the React render commit + once more after fonts swap
    // settles, since heading metrics shift the available text nodes.
    requestAnimationFrame(tick);
    const t2 = setTimeout(tick, 240);
    return () => clearTimeout(t2);
  }, [active && active.id, active && active.content, anchorCommentsSig, mode]);

  // Selector de lenguaje de los bloques de código (Leer): reescribe la valla
  // de apertura del n-ésimo bloque ``` del fuente. Escucha nativa: React no
  // entrega el `change` de un <select> creado con innerHTML.
  useEffect(() => {
    const root = renderRef.current;
    if (!root) return undefined;
    const onChange = (e) => {
      const sel = e.target && e.target.closest && e.target.closest('[data-code-lang]');
      if (!sel) return;
      const wraps = Array.from(root.querySelectorAll('.md-codewrap'));
      const nth = wraps.indexOf(sel.closest('.md-codewrap'));
      if (nth < 0) return;
      mutateActiveSource(src => setNthFenceLang(src, nth, sel.value));
    };
    root.addEventListener('change', onChange);
    return () => root.removeEventListener('change', onChange);
  }, [active && active.id, mode, mutateActiveSource]);

  // Delegate clicks on .comment-anchor → open comments panel and scroll
  // the matching thread into view.
  useEffect(() => {
    if (!active) return;
    const root = renderRef.current;
    if (!root) return;
    const handler = (e) => {
      const m = e.target && e.target.closest && e.target.closest('mark.comment-anchor');
      if (!m) return;
      const id = m.dataset.commentId;
      if (!id) return;
      const rect = m.getBoundingClientRect();
      setAnchorPopover({ commentId: id, x: Math.round(rect.left), y: Math.round(rect.bottom + 6) });
      e.stopPropagation();
    };
    root.addEventListener('click', handler);
    return () => root.removeEventListener('click', handler);
  }, [active && active.id, mode]);

  const focusCommentAnchor = useCallback((comment) => {
    if (!active || !comment || !comment.anchorText) return;
    const text = String(comment.anchorText || '').trim();
    if (!text) return;
    setAiCommentsOpen(true);
    if (mode === 'render') {
      setTimeout(() => { try { pulseInRenderDom(renderRef.current, text); } catch {} }, 40);
      return;
    }
    const rg = commentRange(activeContentText, comment, active.content || '');
    const view = cmViewRef.current;
    if (rg && view && rg.to <= view.state.doc.length) {
      view.dispatch({
        selection: { anchor: rg.from, head: rg.to },
        effects: EditorView.scrollIntoView(rg.from, { y: 'center' }),
      });
      view.focus();
    }
  }, [active && active.id, active && active.content, mode, activeContentText]);

  // «Editar»: resaltar los comentarios abiertos anclados y abrir su hilo al
  // hacer clic (como las marcas de Leer).
  useEffect(() => {
    if (!active || mode === 'render') return undefined;
    const v = cmViewRef.current;
    if (!v) return undefined;
    const src = activeContentText ? activeContentText.toString() : (active.content || '');
    const marks = readNoteComments(ydoc, active.id)
      .filter(c => c && c.anchorText && !c.resolved && !c.parentId)
      .map(c => { const r = commentRange(activeContentText, c, src); return r ? { id: c.id, ...r } : null; })
      .filter(Boolean);
    try { v.dispatch({ effects: setCommentMarks.of(marks) }); } catch {}
    const onClick = (e) => {
      const m = e.target && e.target.closest && e.target.closest('.cm-comment-anchor');
      if (!m || !m.dataset.commentId) return;
      const rect = m.getBoundingClientRect();
      setAnchorPopover({ commentId: m.dataset.commentId, x: Math.round(rect.left), y: Math.round(rect.bottom + 6) });
    };
    v.dom.addEventListener('click', onClick);
    return () => v.dom.removeEventListener('click', onClick);
  }, [active && active.id, anchorCommentsSig, mode, activeContentText]);

  // Scroll the comments panel to a specific comment row and flash it.
  // Retries briefly because the panel / target note may still be
  // mounting after a deep-link navigation.
  const flashCommentRow = useCallback((commentId) => {
    if (!commentId) return;
    let tries = 0;
    const tick = () => {
      const body = commentsBodyRef.current;
      const el = body && body.querySelector(`[data-comment-id="${commentId}"]`);
      if (el) {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
        const prev = el.style.backgroundColor;
        el.style.transition = 'background-color .35s ease';
        el.style.backgroundColor = 'rgba(90,122,78,.28)';
        setTimeout(() => { try { el.style.backgroundColor = prev || ''; } catch {} }, 1800);
        return;
      }
      if (tries++ < 25) setTimeout(tick, 90);
    };
    requestAnimationFrame(tick);
  }, []);

  // Deep-link from a toast / notification straight to the note + comment.
  // Switches workspace first when the target lives elsewhere (the actual
  // jump then runs from the pending-ref effect once the note loads).
  const pendingCommentJumpRef = useRef(null);
  const navigateToComment = useCallback((detail) => {
    if (!detail) return;
    const { noteId, commentId, workspaceId } = detail;
    const cfg = syncCfgRef.current;
    const curWs = cfg && cfg.currentWorkspaceId;
    if (workspaceId && curWs && workspaceId !== curWs) {
      const ws = (cfg.workspaces || []).find(w => w.id === workspaceId);
      if (ws) {
        pendingCommentJumpRef.current = { noteId, commentId, at: Date.now() };
        updateSyncConfig({ ...cfg, currentWorkspaceId: workspaceId });
        return;
      }
    }
    if (noteId) setActiveId(noteId);
    setAiCommentsOpen(true);
    flashCommentRow(commentId);
  }, [setActiveId, flashCommentRow]);

  // Run a pending cross-workspace comment jump once the target note's
  // doc has loaded into `files`. Times out after 15s so a stale target
  // (deleted note, wrong device) doesn't linger.
  useEffect(() => {
    const p = pendingCommentJumpRef.current;
    if (!p) return;
    if (Date.now() - p.at > 15000) { pendingCommentJumpRef.current = null; return; }
    if (filesRef.current.some(f => f.id === p.noteId)) {
      pendingCommentJumpRef.current = null;
      setActiveId(p.noteId);
      setAiCommentsOpen(true);
      flashCommentRow(p.commentId);
    }
  }, [files, metaV, flashCommentRow]);

  // Expose the deep-link so ReplyToasts (mounted as a sibling) can call
  // it on click without prop-drilling.
  useEffect(() => {
    window.__edinotGoToComment = navigateToComment;
    return () => { try { delete window.__edinotGoToComment; } catch {} };
  }, [navigateToComment]);

  // Single source of truth for "you got a reply" toasts: watch every
  // comment in the loaded Y.Doc and pop a toast when a new one authored
  // by someone else (or an AI) appears. This covers all the ways a reply
  // can land — MCP complete_agent_task, the CLI-exit fallback, and remote
  // sync from another collaborator — without hooking each write path.
  const seenCommentIdsRef = useRef(null);
  useEffect(() => {
    const map = readCommentsMap(ydoc);
    const all = [];
    for (const nid of Object.keys(map)) {
      const arr = Array.isArray(map[nid]) ? map[nid] : [];
      for (const c of arr) if (c && c.id) all.push({ c, noteId: nid });
    }
    // First pass just records a baseline so we never replay history.
    if (!seenCommentIdsRef.current) {
      seenCommentIdsRef.current = new Set(all.map(x => x.c.id));
      return;
    }
    const seen = seenCommentIdsRef.current;
    const cfgNow = syncCfgRef.current;
    const myEmail = String((cfgNow && cfgNow.email) || '').toLowerCase();
    const now = Date.now();
    for (const { c, noteId } of all) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const rawAuthor = String(c.author || '');
      const author = rawAuthor.toLowerCase().replace(/^@/, '');
      // Skip my own messages and generic local-author placeholders.
      if (!author || author === myEmail || author === 'user' || author === 'me') continue;
      // Skip stale items pulled in by a bulk/initial sync — only toast
      // genuinely recent activity.
      const ts = Date.parse(c.ts || '') || 0;
      if (ts && now - ts > 45000) continue;
      const isAi = rawAuthor.startsWith('@') || c.viaCli || !!c.agentKind;
      const kind = isAi ? 'ai-reply' : (c.parentId ? 'reply' : 'comment');
      const noteName = (filesRef.current.find(f => f.id === noteId) || {}).name || null;
      window.dispatchEvent(new CustomEvent('edinot:reply-toast', { detail: {
        id: 'cm' + c.id,
        kind,
        alias: isAi ? rawAuthor.replace(/^@/, '') : undefined,
        author: isAi ? undefined : rawAuthor,
        noteId, noteName, commentId: c.id,
        threadRootId: c.parentId || c.id,
        workspaceId: cfgNow && cfgNow.currentWorkspaceId,
        preview: String(c.text || '').slice(0, 160),
      } }));
    }
  }, [metaV]);

  const addCommentToActiveNote = useCallback(() => {
    if (!active || !canCommentActiveNote) return;
    const sel = yMeta.get('editorSelection');
    const selected = sel && sel.fileId === active.id ? sel : null;
    const anchorText = selected && selected.text
      ? String(selected.text).trim()
      : (selected && Number.isFinite(selected.from) && Number.isFinite(selected.to)
        ? (active.content || '').slice(selected.from, selected.to).trim()
        : '');
    const range = selected && Number.isFinite(selected.from) && Number.isFinite(selected.to) && selected.to > selected.from
      ? { from: selected.from, to: selected.to } : null;
    setCommentDraft({ anchorText: anchorText || null, range });
  }, [active && active.id, active && active.content, canCommentActiveNote]);

  const submitCommentDraft = useCallback((text) => {
    if (!active) return;
    const v = String(text || '').trim();
    if (!v) return;
    const anchorText = commentDraft && commentDraft.anchorText ? commentDraft.anchorText : null;
    // Posiciones relativas de Yjs: el comentario sigue a su texto al editar.
    let anchorPos = null;
    if (anchorText && activeContentText) {
      const rg = (commentDraft && commentDraft.range) || commentRange(activeContentText, { anchorText });
      if (rg) anchorPos = makeAnchor(activeContentText, rg.from, rg.to);
    }
    const author = (syncConfigState && syncConfigState.email) || 'me';
    const rec = {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      noteId: active.id,
      kind: 'note',
      parentId: null,
      text: v,
      anchorText: anchorText || null,
      ...(anchorPos || null),
      author,
      ts: new Date().toISOString(),
      resolved: false,
      replies: [],
      awaitingReply: false,
      mentions: (v.match(/@[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).map(s => s.slice(1).toLowerCase()),
    };
    putComment(ydoc, rec);
    enqueueAgentTasksForComment(rec, rec.text);
    // Notify mentioned members.
    const wsId = syncConfigState && syncConfigState.currentWorkspaceId;
    if (wsId && rec.mentions.length && syncConfigState && syncConfigState.httpUrl && syncConfigState.token) {
      for (const email of rec.mentions) {
        apiDispatchNotif(syncConfigState.httpUrl, syncConfigState.token, {
          email, workspaceId: wsId, kind: 'mention',
          payload: { noteId: active.id, noteName: active.name, commentId: rec.id, preview: v.slice(0, 160) },
        }).catch(() => {});
      }
    }
    setCommentDraft(null);
    // Open the inline popover for the new comment if it has an anchor —
    // matches the small reader UX the user prefers over the full panel.
    // Falls back to the big panel only when no anchor is present.
    if (rec.anchorText) {
      setTimeout(() => {
        const m = renderRef.current && renderRef.current.querySelector(`mark.comment-anchor[data-comment-id="${rec.id}"]`);
        if (m) {
          const r = m.getBoundingClientRect();
          setAnchorPopover({ commentId: rec.id, x: Math.round(r.left), y: Math.round(r.bottom + 6) });
        } else {
          focusCommentAnchor(rec);
        }
      }, 120);
    } else {
      setAiCommentsOpen(true);
    }
  }, [active, commentDraft, syncConfigState, focusCommentAnchor, enqueueAgentTasksForComment]);

  useEffect(() => {
    window.__edinotPrompt = askPrompt;
    window.__edinotConfirm = askConfirm;
    return () => { delete window.__edinotPrompt; delete window.__edinotConfirm; };
  }, [askPrompt, askConfirm]);

  // Create a fresh "canvas" note — seeds with a minimal edinot-canvas block
  // so the renderer immediately switches to canvas view. The title comes
  // from the H1 above the block (auto-renames once user types one).
  // Returns the new note's id.
  // `asNote`: Página ↔ Canvas (1.2) — una nota normal que estrena su canvas,
  // con su página dentro, y abre en modo Canvas. Sin él (insertar un canvas
  // en otra nota): el tablero solo de siempre.
  const createCanvasNote = useCallback((folderId = null, asNote = false) => {
    const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const head = `# ${asNote ? t('canvas.newDocHead') : t('canvas.newCanvasHead')}\n\n`;
    const body = asNote ? addOwnCanvas(head) : head + '```edinot-canvas\n' + JSON.stringify({ nodes: [], edges: [], groups: [] }, null, 2) + '\n```\n';
    if (asNote) chooseSurfaceRef.current(id, 'canvas');
    yFiles.set(id, {
      id, name: asNote ? 'untitled.md' : t('canvas.newCanvasFile'), vaultId: activeVault,
      size: '0.0 KB', nameLocked: false, icon: '🎨',
      ...(typeof folderId === 'string' && folderId ? { folderId } : null),
    });
    seedNoteContent(id, body);
    return id;
  }, [activeVault]);
  const newCanvasFile = useCallback(() => {
    const id = createCanvasNote(null, true);
    setActiveId(id);
    setMode('render');
  }, [createCanvasNote, setActiveId]);
  // Spawned from the inline-canvas embed toolbar — create a new canvas note
  // AND drop a reference to it into the current note at the caret.
  const createAndEmbedCanvas = useCallback(() => {
    if (!cmViewRef.current) return;
    const id = createCanvasNote();
    runAction('canvasEmbed', { noteId: id });
  }, [createCanvasNote]);

  // file operations
  const newFile = useCallback((baseName) => {
    if (isViewer) return; // ACL Fase A — viewer cannot create notes
    const now = Date.now();
    if (now - lastNewFileAtRef.current < 350) return;
    lastNewFileAtRef.current = now;
    // Optional pre-named creation (quick-switcher "create note «q»" row).
    // Guarded by typeof so event objects from DOM handlers never leak in.
    const title = (typeof baseName === 'string' && baseName.trim())
      ? baseName.trim().replace(/[\\/:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').slice(0, 80)
      : null;
    const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    // nameLocked:false opts this file into the auto-title flow — the first
    // `# heading` typed in the body becomes the file name. As soon as the
    // user renames the file by hand (sidebar or inline title), we flip the
    // flag to true and stop tracking the heading. New files start with a
    // boilerplate H1 so they show up in the sidebar with a sensible name
    // immediately instead of as "untitled".
    const seed = `# ${title || t('canvas.newDocHead')}\n\n`;
    const f = {
      id, name: title ? `${title}.md` : 'untitled.md', vaultId: activeVault,
      content: '', size: '0.0 KB',
      // A user-typed name counts as a manual rename — lock it so the
      // auto-title flow doesn't overwrite it from the first heading.
      nameLocked: !!title,
    };
    pendingCreatedNoteIdsRef.current.add(id);
    const { content: _content, ...meta } = f;
    const vaultEntry = getVaultDoc(activeVault);
    if (vaultEntry && vaultEntry.yFiles) vaultEntry.yFiles.set(id, meta);
    else yFiles.set(id, meta);
    seedNoteContent(id, seed);
    setActiveId(id);
    setMode(settingsRef.current && settingsRef.current.newNoteMode === 'render' ? 'render' : 'live'); // Ajustes → Editor
  }, [activeVault, isViewer]);

  const renameFile = useCallback(async (id) => {
    if (isViewer) return; // ACL Fase A
    const f = files.find(x => x.id === id);
    if (!f) return;
    const name = await askPrompt('Nombre del archivo:', f.name);
    if (!name) return;
    setFiles(prev => prev.map(x => x.id === id ? { ...x, name, nameLocked: true } : x));
  }, [files, askPrompt, isViewer]);

  // Duplicate a note (or canvas note) into the same vault + folder. The body
  // is copied verbatim; for a migrated canvas the structured model is the
  // source of truth, so the ```edinot-canvas fence is refreshed from it
  // first — the duplicate then re-seeds its own canvas doc from that fence
  // on first open (seed-on-open is idempotent and id-independent).
  const duplicateFile = useCallback((id) => {
    if (isViewer) return; // ACL Fase A — viewer cannot create notes
    const src = files.find(x => x.id === id);
    if (!src) return;
    let body = src.content != null ? src.content : getContentString(id);
    try {
      if (isCanvasMigrated(id)) {
        const blk = firstCanvasBlock(body);
        if (blk) {
          const lines = body.split('\n');
          body = [
            ...lines.slice(0, blk.startLine + 1),
            serializeCanvasDeterministic(id),
            ...lines.slice(blk.endLine),
          ].join('\n');
        }
      }
    } catch {}
    const m = src.name.match(/^(.*?)(\.(md|markdown|txt))$/i);
    const base = m ? m[1] : src.name;
    const ext = m ? m[2] : '.md';
    const siblingNames = new Set(
      files.filter(f => (f.vaultId || 'default') === (src.vaultId || 'default')).map(f => f.name)
    );
    let name = `${base} (${t('row.copySuffix')})${ext}`;
    for (let n = 2; siblingNames.has(name) && n < 100; n++) {
      name = `${base} (${t('row.copySuffix')} ${n})${ext}`;
    }
    const newId = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const meta = {
      id: newId, name, vaultId: src.vaultId || 'default',
      size: src.size || '0.0 KB', nameLocked: true,
    };
    if (src.folderId) meta.folderId = src.folderId;
    if (src.icon) meta.icon = src.icon;
    pendingCreatedNoteIdsRef.current.add(newId);
    const vaultEntry = getVaultDoc(meta.vaultId);
    if (vaultEntry && vaultEntry.yFiles) vaultEntry.yFiles.set(newId, meta);
    else yFiles.set(newId, meta);
    seedNoteContent(newId, body);
    setActiveId(newId);
  }, [files, isViewer]);

  const splitExt = (name) => {
    const m = name.match(/^(.*?)(\.(md|markdown|txt))$/i);
    return m ? { base: m[1], ext: m[2] } : { base: name, ext: '' };
  };

  // Extract the first markdown H1 (`# Title`) from the note body. Used to
  // auto-name files that haven't been renamed by the user. Skips lines
  // inside fenced code blocks so a `# comment` in a Python snippet doesn't
  // hijack the file name. Returns null if no usable heading is present.
  const deriveTitleFromContent = (text) => {
    if (!text) return null;
    const lines = String(text).split(/\r?\n/);
    let inFence = false;
    for (const raw of lines) {
      if (/^\s*```/.test(raw)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = raw.match(/^\s*#\s+(.+?)\s*#*\s*$/);
      if (m) {
        // Drop any inline markdown that doesn't belong in a file name: bold
        // markers, links, backticks. Keep it to a single line and bounded.
        const cleaned = m[1]
          .replace(/`([^`]+)`/g, '$1')
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
          .replace(/\*+([^*]+)\*+/g, '$1')
          .replace(/_+([^_]+)_+/g, '$1')
          .replace(/[\\\/:*?"<>|]/g, '-')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120);
        return cleaned || null;
      }
    }
    return null;
  };

  const beginTitleEdit = () => {
    if (!active) return;
    setTitleDraft(splitExt(active.name).base);
    setTitleEditing(true);
  };

  const commitTitle = () => {
    if (!active) { setTitleEditing(false); return; }
    const trimmed = titleDraft.trim();
    setTitleEditing(false);
    if (!trimmed) return;
    const { ext } = splitExt(active.name);
    const finalExt = ext || '.md';
    const stripped = trimmed.replace(/\.(md|markdown|txt)$/i, '');
    const newName = stripped + finalExt;
    if (newName === active.name) return;
    // An inline title edit is an explicit rename — lock the auto-heading flow.
    setFiles(prev => prev.map(x => x.id === active.id ? { ...x, name: newName, nameLocked: true } : x));
  };

  useEffect(() => {
    if (titleEditing && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [titleEditing]);

  // Auto-title from the first `# heading` while the file isn't locked.
  // Debounced — contentV bumps once per keystroke and writing to yFiles on
  // every char would be silly. A ref keeps the last-seen derived title per
  // file id so we only mutate when the heading actually changes.
  const autoTitleLastRef = useRef(new Map());
  useEffect(() => {
    if (!active) return;
    if (active.nameLocked !== false) return; // missing/true = locked
    const timer = setTimeout(() => {
      const derived = deriveTitleFromContent(active.content);
      if (!derived) return;
      const lastSeen = autoTitleLastRef.current.get(active.id);
      if (derived === lastSeen) return;
      autoTitleLastRef.current.set(active.id, derived);
      const { ext } = splitExt(active.name);
      const finalExt = ext || '.md';
      const nextName = derived + finalExt;
      if (nextName === active.name) return;
      setFiles(prev => prev.map(x => x.id === active.id ? { ...x, name: nextName } : x));
    }, 300);
    return () => clearTimeout(timer);
  }, [active && active.id, active && active.content, active && active.nameLocked, active && active.name]);

  const moveFile = useCallback((id, vaultId, folderId = null) => {
    // Cross-vault aware. The legacy form mutated yFiles via the active-
    // vault proxy, which silently left files in the source vault with a
    // dest vaultId in their meta — the note then vanished from the
    // sidebar (folder-vault mismatch) until reload.
    moveNoteAcrossVaults(id, vaultId, folderId);
  }, []);

  const moveFileToFolder = useCallback((id, folderId) => {
    // Resolve the destination vault from the target folder regardless of
    // which vault the folder lives in. yFolders is the active-vault
    // proxy and would return null for folders in other vaults — that
    // bug was the source of cross-vault drops orphaning the file.
    const allFolders = getAllFoldersAcrossVaults();
    const target = folderId ? allFolders.find(f => f.id === folderId) : null;
    const fallback = locateFileAcrossVaults(id);
    const destVault = target ? target.vaultId : (fallback ? fallback.vaultId : activeVault);
    moveNoteAcrossVaults(id, destVault, folderId || null);
  }, [activeVault]);

  const setFileIcon = useCallback((id, icon) => {
    setFiles(prev => prev.map(x => x.id === id ? { ...x, icon } : x));
  }, []);
  // Portada de la nota (editor/blocks/cover.js): meta del fichero, como el icono.
  const setFileCover = useCallback((id, cover) => {
    setFiles(prev => prev.map(x => x.id === id ? { ...x, cover: cover || null } : x));
  }, []);

  // Adjuntos que SOLO usaba `body` (ninguna otra nota los referencia) → se
  // borran del servidor. Se llama al eliminar definitivamente de la papelera.
  const deleteOrphanBlobs = useCallback((body) => {
    try {
      const mine = new Set();
      const re = /edinot:\/\/blob\/([a-f0-9]{64})/gi;
      let m;
      while ((m = re.exec(body || '')) !== null) mine.add(m[1].toLowerCase());
      if (!mine.size) return;
      for (const f of getAllFilesAcrossVaults()) {
        if (!mine.size) break;
        const txt = getContentString(f.id);
        const re2 = /edinot:\/\/blob\/([a-f0-9]{64})/gi;
        while ((m = re2.exec(txt)) !== null) mine.delete(m[1].toLowerCase());
      }
      for (const txt of trashContents()) {
        const re3 = /edinot:\/\/blob\/([a-f0-9]{64})/gi;
        while ((m = re3.exec(txt)) !== null) mine.delete(m[1].toLowerCase());
      }
      const cfg = syncCfgRef.current;
      if (mine.size && cfg && cfg.httpUrl && cfg.token) {
        for (const sha of mine) apiDeleteBlob(cfg.httpUrl, cfg.token, sha).catch(() => {});
      }
    } catch {}
  }, []);

  // Borrar = mover a la papelera (store.js trashFile): se puede restaurar
  // durante TRASH_DAYS días desde «Papelera» en la barra lateral.
  const deleteFile = useCallback(async (id) => {
    if (!trashFile(id)) return;
    if (activeId === id) {
      const remaining = getAllFilesAcrossVaults();
      setActiveId(remaining[0] ? remaining[0].id : null);
    }
    setTrashV(v => v + 1);
  }, [activeId]);

  const [trashOpen, setTrashOpen] = useState(false);
  const [trashV, setTrashV] = useState(0);
  // Purga automática de lo que lleva más de TRASH_DAYS días.
  useEffect(() => {
    const tm = setTimeout(() => { try { purgeOldTrash().forEach(deleteOrphanBlobs); } catch {} }, 15000);
    return () => clearTimeout(tm);
  }, [deleteOrphanBlobs]);
  const trashActions = useMemo(() => ({
    list: () => listTrash(),
    restore: (id) => { const r = restoreTrashed(id); setTrashV(v => v + 1); if (r) setActiveId(r); },
    purge: async (id) => {
      const ok = await askConfirm(t('trash.purgeConfirm'), { title: t('trash.purgeTitle') });
      if (!ok) return;
      const body = purgeTrashed(id);
      if (body != null) deleteOrphanBlobs(body);
      setTrashV(v => v + 1);
    },
    empty: async () => {
      const items = listTrash();
      if (!items.length) return;
      const ok = await askConfirm(t('trash.emptyConfirm', { n: items.length }), { title: t('trash.emptyTitle') });
      if (!ok) return;
      for (const it of items) { const body = purgeTrashed(it.id); if (body != null) deleteOrphanBlobs(body); }
      setTrashV(v => v + 1);
    },
  }), [askConfirm, deleteOrphanBlobs]);

  // ─── Template operations ──────────────────────────────────────────────────
  // Ensure a top-level "Plantillas" folder exists in the given vault, create it
  // on demand, return its id. Used both for "Save as template" and "New blank
  // template" so the user never has to think about the folder.
  const ensureTemplatesFolder = useCallback((vaultId) => {
    const allFolders = Array.from(yFolders.values());
    const existing = allFolders.find(f => f.vaultId === vaultId && isRootTemplateFolder(f));
    if (existing) return existing.id;
    const id = 'fld_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    ydoc.transact(() => {
      yFolders.set(id, { id, name: templatesFolderNameForLang(), vaultId, parentId: null, icon: '🧩' });
    });
    return id;
  }, []);

  const saveAsTemplate = useCallback((id) => {
    const f = filesMeta.find(x => x.id === id);
    if (!f) return;
    const vaultId = f.vaultId || 'default';
    const folderId = ensureTemplatesFolder(vaultId);
    setFiles(prev => prev.map(x => x.id === id ? { ...x, folderId, vaultId } : x));
  }, [filesMeta, ensureTemplatesFolder]);

  const unmarkTemplate = useCallback((id) => {
    setFiles(prev => prev.map(x => x.id === id ? { ...x, folderId: null } : x));
  }, []);

  const newBlankTemplate = useCallback(() => {
    const folderId = ensureTemplatesFolder(activeVault);
    const id = 'f' + Date.now().toString(36);
    const isEn = pickSeedLang() === 'en';
    const seed = isEn
      ? '# {{title}}\n\nWrite the body. Use `{{variable}}` for fields, `{{date}}` and `{{time}}` for date/time, `{{cursor}}` to mark where the caret appears when creating the note.\n\n{{cursor}}\n'
      : '# {{titulo}}\n\nEscribe el cuerpo. Usa `{{variable}}` para campos, `{{date}}` y `{{time}}` para fecha/hora, `{{cursor}}` para marcar dónde aparece el caret al crear la nota.\n\n{{cursor}}\n';
    const f = {
      id,
      name: isEn ? 'New template.md' : 'Nueva plantilla.md',
      vaultId: activeVault, folderId,
      content: '',
      size: '0.0 KB',
      nameLocked: true,
    };
    setFiles(prev => [...prev, f]);
    seedNoteContent(id, seed);
    setActiveId(id);
    setMode('live'); // «Editar» en el rediseño
  }, [activeVault, ensureTemplatesFolder]);

  // Drops 4 starter templates into the active vault's Plantillas folder.
  // Idempotent on name: skips any that already exist so re-clicks don't dupe.
  // Rename (or delete) a user variable across the whole template body.
  // newName === null → remove every `{{old[|default]}}` occurrence.
  const renameTemplateVar = useCallback((oldName, newName) => {
    if (!active) return;
    const t = getContent(active.id);
    const src = t.toString();
    // Match `{{oldName}}` or `{{oldName|...}}` / `{{oldName:...}}` capturing the args.
    const re = new RegExp(`\\{\\{\\s*${oldName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(\\s*[:|][^}]*)?\\s*\\}\\}`, 'g');
    const next = newName == null
      ? src.replace(re, '')
      : src.replace(re, (_, args) => `{{${newName}${args || ''}}}`);
    if (next === src) return;
    ydoc.transact(() => {
      if (t.length > 0) t.delete(0, t.length);
      t.insert(0, next);
    });
  }, [active, getContent]);

  const seedTemplates = useCallback(() => {
    const folderId = ensureTemplatesFolder(activeVault);
    const existing = new Set(filesMeta
      .filter(f => f.folderId === folderId)
      .map(f => f.name.toLowerCase().replace(/\.md$/, '')));
    const seeds = getTemplateSeeds();
    const created = [];
    ydoc.transact(() => {
      for (const s of seeds) {
        const base = s.name.toLowerCase().replace(/\.md$/, '');
        if (existing.has(base)) continue;
        const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const meta = { id, name: s.name, vaultId: activeVault, folderId, nameLocked: true };
        yFiles.set(id, meta);
        const t = getContent(id);
        if (t.length > 0) t.delete(0, t.length);
        t.insert(0, s.content);
        created.push(id);
      }
    });
    return created.length;
  }, [activeVault, filesMeta, ensureTemplatesFolder, getContent]);

  // Cuántas plantillas de ejemplo faltan en el vault activo (para ofrecer
  // «Añadir las plantillas nuevas» a quien ya tenía las anteriores).
  const missingTemplateSeeds = useCallback(() => {
    const root = Array.from(yFolders.values()).find(f => f.vaultId === activeVault && isRootTemplateFolder(f));
    const have = new Set(filesMeta
      .filter(f => root && f.folderId === root.id)
      .map(f => f.name.toLowerCase().replace(/\.md$/, '')));
    return getTemplateSeeds().filter(s => !have.has(s.name.toLowerCase().replace(/\.md$/, ''))).length;
  }, [activeVault, filesMeta]);

  const openApplyTemplate = useCallback((template, opts) => {
    // Snapshot current content so the modal's parseTemplateVars sees the
    // latest body rather than a stale meta entry without `content`.
    const content = getContent(template.id).toString();
    // insertHere: menú «/» → Plantilla. Mismo modal (variables), pero el
    // resultado se inserta en el cursor de la nota activa.
    setApplyTplState({ template: { ...template, content }, defaults: { vaultId: activeVault }, insertHere: !!(opts && opts.insertHere) });
  }, [activeVault, getContent]);

  const createFromTemplate = useCallback(async ({ name, vaultId, folderId, vars }) => {
    if (!applyTplState) return;
    const tpl = applyTplState.template;
    const vault = vaults.find(v => v.id === vaultId);
    const folder = folderId ? Array.from(yFolders.values()).find(f => f.id === folderId) : null;
    // Build folderpath walking up the parents (e.g. "Proyectos/Edinot").
    let folderPath = '';
    if (folder) {
      const segs = [folder.name];
      let cur = folder.parentId ? yFolders.get(folder.parentId) : null;
      while (cur) { segs.unshift(cur.name); cur = cur.parentId ? yFolders.get(cur.parentId) : null; }
      folderPath = segs.join('/');
    }
    // Best-effort clipboard read — wrapped in try so missing perm doesn't break apply.
    let clipboard = '';
    try { if (navigator.clipboard && navigator.clipboard.readText) clipboard = await navigator.clipboard.readText(); }
    catch {}
    // Pull persistent counters from yMeta so {{counter:name}} survives across runs.
    const counters = (yMeta.get('templateCounters') && typeof yMeta.get('templateCounters') === 'object')
      ? { ...yMeta.get('templateCounters') }
      : {};
    const noteCountInVault = filesMeta.filter(f => (f.vaultId || 'default') === vaultId && !isTemplateFile(f, folders)).length;
    // Build a notes snapshot for dashboard generators (tasksopen, notesindex,
    // tableof). Reads live content + resolves folderPath per note.
    const notesForCtx = filesMeta
      .filter(f => !isTemplateFile(f, folders))
      .map(f => {
        const v = vaults.find(vv => vv.id === (f.vaultId || 'default'));
        let folderPath = '';
        if (f.folderId) {
          const segs = [];
          let cur = yFolders.get(f.folderId);
          while (cur) { segs.unshift(cur.name); cur = cur.parentId ? yFolders.get(cur.parentId) : null; }
          folderPath = segs.join('/');
        }
        return {
          id: f.id, name: f.name,
          vaultId: f.vaultId || 'default',
          vaultName: v ? v.name : (f.vaultId || 'default'),
          folderId: f.folderId || null,
          folderPath,
          content: getContent(f.id).toString(),
        };
      });
    const ctx = {
      vaultName: vault ? vault.name : vaultId,
      folderName: folder ? folder.name : '',
      folderPath,
      templateName: tpl.name.replace(/\.(md|markdown|txt)$/i, ''),
      noteCount: noteCountInVault,
      userName: syncConfigState && syncConfigState.email ? syncConfigState.email.split('@')[0] : '',
      userEmail: (syncConfigState && syncConfigState.email) || '',
      clipboard,
      counters,
      notes: notesForCtx,
    };
    const { body, cursorPos } = applyTemplate(tpl.content || '', vars, ctx);
    // Persist counters if any bump happened.
    if (Object.keys(ctx.counters).length) yMeta.set('templateCounters', ctx.counters);
    if (applyTplState.insertHere) {
      setApplyTplState(null);
      const v = cmViewRef.current;
      if (v) insertAtCursorCM(v, body.replace(/^\n+/, ''));
      else mutateActiveSource(src => src.replace(/\s*$/, '') + '\n\n' + body);
      return;
    }
    const id = 'f' + Date.now().toString(36);
    const finalName = /\.(md|markdown|txt)$/i.test(name) ? name : name + '.md';
    const f = {
      id, name: finalName, vaultId, folderId: folderId || null,
      content: '', size: '0.0 KB', nameLocked: true,
    };
    setFiles(prev => [...prev, f]);
    seedNoteContent(id, body);
    setActiveId(id);
    setMode(settingsRef.current && settingsRef.current.newNoteMode === 'render' ? 'render' : 'live'); // Ajustes → Editor
    setApplyTplState(null);
    if (cursorPos != null) {
      // Defer one tick so CodeMirror has mounted with the new content.
      setTimeout(() => {
        const view = cmViewRef.current;
        if (!view) return;
        try {
          const pos = Math.min(cursorPos, view.state.doc.length);
          view.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true });
          view.focus();
        } catch {}
      }, 60);
    }
  }, [applyTplState, vaults, folders, filesMeta, syncConfigState]);

  // ─── Web Clipper bridge ───────────────────────────────────────────────────
  // Exposed on window so clipper-renderer.js can satisfy HTTP requests
  // forwarded from the Electron main process (ClipperServer in
  // electron/clipper.cjs). Lookup is by id OR name so the extension can pass
  // either; defaults to the active vault when no target is given.
  useEffect(() => {
    const resolveFolderPath = (folderId) => {
      if (!folderId) return '';
      const segs = [];
      let cur = yFolders.get(folderId);
      while (cur) { segs.unshift(cur.name); cur = cur.parentId ? yFolders.get(cur.parentId) : null; }
      return segs.join('/');
    };

    const listDirectory = () => {
      const vaultList = vaults.map(v => ({ id: v.id, name: v.name }));
      const folderList = Array.from(yFolders.values()).map(f => ({
        id: f.id,
        name: f.name,
        vaultId: f.vaultId || 'default',
        parentId: f.parentId || null,
        path: resolveFolderPath(f.id),
      }));
      const templates = filesMeta
        .filter(f => isTemplateFile(f, folders))
        .map(f => ({ id: f.id, name: f.name.replace(/\.(md|markdown|txt)$/i, ''), vaultId: f.vaultId || 'default' }));
      return { vaults: vaultList, folders: folderList, templates };
    };

    const resolveVaultId = (vaultRef) => {
      if (!vaultRef) return activeVault;
      if (vaults.find(v => v.id === vaultRef)) return vaultRef;
      const byName = vaults.find(v => v.name === vaultRef);
      return byName ? byName.id : activeVault;
    };

    const resolveFolderId = (folderRef, vaultId) => {
      if (!folderRef) return null;
      const all = Array.from(yFolders.values()).filter(f => (f.vaultId || 'default') === vaultId);
      if (all.find(f => f.id === folderRef)) return folderRef;
      const byPath = all.find(f => resolveFolderPath(f.id) === folderRef);
      if (byPath) return byPath.id;
      const byName = all.find(f => f.name === folderRef);
      return byName ? byName.id : null;
    };

    // Resolve a template the popup offered (by id, or by display name with or
    // without extension). Templates are notes flagged via isTemplateFile.
    const resolveTemplateId = (tplRef) => {
      if (!tplRef) return null;
      const tpls = filesMeta.filter(f => isTemplateFile(f, folders));
      if (tpls.find(f => f.id === tplRef)) return tplRef;
      const stripExt = (s) => String(s).replace(/\.(md|markdown|txt)$/i, '');
      const byName = tpls.find(f => stripExt(f.name) === stripExt(tplRef) || f.name === tplRef);
      return byName ? byName.id : null;
    };

    const createClipNote = async (payload) => {
      if (isViewer) throw new Error('vault_readonly');
      const title = (payload?.title || 'Clipped').trim() || 'Clipped';
      const body = String(payload?.body || '');
      const vaultId = resolveVaultId(payload?.target?.vault);
      const folderId = resolveFolderId(payload?.target?.folder, vaultId);

      // Optional template wrapper: expand the chosen template note (resolving
      // {{date}}, {{vault}}, … like normal template-apply) and prepend it.
      let finalBody = body;
      const templateId = resolveTemplateId(payload?.target?.template);
      if (templateId) {
        try {
          const cfgNow = syncCfgRef.current;
          const { body: tplBody } = applyTemplate(getContent(templateId).toString(), {}, {
            vaultName: (vaults.find(v => v.id === vaultId) || {}).name || vaultId,
            folderName: '', folderPath: resolveFolderPath(folderId),
            templateName: '', noteCount: 0,
            userName: cfgNow && cfgNow.email ? cfgNow.email.split('@')[0] : '',
            userEmail: (cfgNow && cfgNow.email) || '',
            clipboard: '', counters: {}, notes: [],
          });
          if (tplBody && tplBody.trim()) finalBody = tplBody.replace(/\s*$/, '') + '\n\n' + body;
        } catch {}
      }

      // Inline hashtags for tags chosen in the popup — searchable plain text
      // (Edinot has no dedicated tag store, so this keeps them visible + findable).
      const tags = Array.isArray(payload?.meta?.tags) ? payload.meta.tags.filter(Boolean) : [];
      if (tags.length) {
        const line = tags.map(t => '#' + String(t).trim().replace(/\s+/g, '-')).join(' ');
        finalBody = finalBody.replace(/\s*$/, '') + '\n\n' + line + '\n';
      }

      const safeBase = title.replace(/[/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Clipped';
      let candidate = `${safeBase}.md`;
      const existing = new Set(filesMeta
        .filter(f => (f.vaultId || 'default') === vaultId && (f.folderId || null) === (folderId || null))
        .map(f => f.name.toLowerCase()));
      if (existing.has(candidate.toLowerCase())) {
        let i = 2;
        while (existing.has(`${safeBase} (${i}).md`.toLowerCase())) i++;
        candidate = `${safeBase} (${i}).md`;
      }

      const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const f = {
        id,
        name: candidate,
        vaultId,
        folderId: folderId || null,
        content: '',
        size: '0.0 KB',
        nameLocked: true,
      };
      setFiles(prev => [...prev, f]);
      seedNoteContent(id, finalBody);

      try {
        const editLog = yMeta.get('editLog');
        if (Array.isArray(editLog)) {
          editLog.push({
            id,
            kind: 'clip',
            at: Date.now(),
            name: candidate,
            vaultId,
            folderId: folderId || null,
            source: payload?.meta?.url || null,
          });
          while (editLog.length > 200) editLog.shift();
          yMeta.set('editLog', editLog);
        }
      } catch {}

      return {
        id,
        name: candidate,
        vaultId,
        folderId: folderId || null,
        folderPath: resolveFolderPath(folderId),
        deepLink: `edinot://open?vault=${encodeURIComponent(vaultId)}&note=${encodeURIComponent(id)}`,
      };
    };

    window.__edinotClipper = { listDirectory, createClipNote };
    return () => {
      if (window.__edinotClipper && window.__edinotClipper.listDirectory === listDirectory) {
        delete window.__edinotClipper;
      }
    };
  }, [vaults, folders, filesMeta, activeVault, isViewer]);

  // ─── Reconnect kick on resume / network return ─────────────────────────────
  // Every doc shares one sync socket (see store.getSharedWs). After an OS
  // suspend/resume or a network flap the socket is stale and hocuspocus only
  // notices after ~30s, stalling all sync. Kick it immediately on `online`
  // (network) and on the main-forwarded `power:resume` (suspend wake).
  useEffect(() => {
    const kick = () => { try { reconnectSync(); } catch {} };
    window.addEventListener('online', kick);
    let offResume = () => {};
    if (window.electronAPI && window.electronAPI.on) offResume = window.electronAPI.on('power:resume', kick);
    return () => { window.removeEventListener('online', kick); offResume(); };
  }, []);

  // ─── Sync watchdog ─────────────────────────────────────────────────────────
  // Sync must never *stay* disconnected. While the badge is anything but
  // 'connected' this keeps escalating recovery until it comes back:
  //   1st tick — cheap socket kick (reconnectSync), enough for a transient drop.
  //   later    — full teardown + reconnect (resetSyncForReconnect), preceded by
  //              a token refresh while the token is still valid, so a soon-to-
  //              expire token can't strand us and a provider that gave up after
  //              an auth failure (shouldConnect=false) is rebuilt from scratch.
  // Dormant (and clears its timers) the moment status is 'connected', so it
  // never churns a healthy connection. An already-EXPIRED token can't be
  // refreshed server-side (needs re-login) — we skip the loop then to avoid
  // hammering the server with 401s.
  useEffect(() => {
    if (syncStatus === 'connected') return;
    const decodeExp = (tk) => {
      try {
        const p = String(tk).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const j = JSON.parse(atob(p.length % 4 ? p + '='.repeat(4 - (p.length % 4)) : p));
        return typeof j.exp === 'number' ? j.exp * 1000 : null;
      } catch { return null; }
    };
    const cfg0 = syncCfgRef.current;
    if (!cfg0 || !cfg0.wsUrl || !cfg0.token || !cfg0.currentWorkspaceId) return;
    const exp0 = decodeExp(cfg0.token);
    if (exp0 && exp0 <= Date.now()) return; // expired → re-login required; don't hammer
    let cancelled = false;
    let attempts = 0;
    const deepRecover = async () => {
      let cfg = syncCfgRef.current;
      if (!cfg || cancelled) return;
      const exp = decodeExp(cfg.token);
      if (exp && exp <= Date.now()) return; // expired mid-loop — stop
      let refreshed = false;
      try {
        const r = await apiRefresh(cfg.httpUrl, cfg.token);
        if (!cancelled && r && r.token) {
          cfg = {
            ...cfg, token: r.token,
            tier: r.tier || cfg.tier, tierLabel: r.tierLabel || cfg.tierLabel,
            expiresAt: r.expiresAt != null ? r.expiresAt : cfg.expiresAt,
            workspaces: r.workspaces || cfg.workspaces, limits: r.limits || cfg.limits,
          };
          refreshed = true;
        }
      } catch { /* offline / transient — fall through with current token */ }
      if (cancelled) return;
      // Notas que ya tenían proveedor: sólo esas se reconectan. Reconectar
      // todo filesMeta creaba N Y.Docs + N IndexedDB + N handshakes de golpe
      // cada 10 s mientras el servidor no respondía (la "tormenta").
      const liveNoteIds = new Set(listNoteRegistryEntries().filter(e => e && e.provider).map(e => e.noteId));
      resetSyncForReconnect();
      if (refreshed) {
        // Token changed → the connect effects (shell + vaults + notes, all
        // keyed on token) recreate every provider with the fresh token.
        updateSyncConfig(cfg);
      } else {
        // Token unchanged → effects won't refire; reconnect explicitly.
        try {
          connectSync(cfg);
          ensureActiveVaultProvider(cfg);
          for (const f of filesMeta) if (f && f.id && liveNoteIds.has(f.id)) connectNoteProvider(f.id, f.vaultId || 'default', cfg);
        } catch { /* keep retrying next tick */ }
      }
    };
    const tick = () => {
      if (cancelled) return;
      attempts += 1;
      if (attempts <= 1) { try { reconnectSync(); } catch {} }
      else deepRecover();
    };
    const first = setTimeout(tick, 5000);
    const id = setInterval(tick, 10000);
    return () => { cancelled = true; clearTimeout(first); clearInterval(id); };
  }, [syncStatus, filesMeta.length]);

  // ─── Deep links (edinot://open?vault=&note=) ───────────────────────────────
  // Main forwards an `edinot://` URL the OS handed us (e.g. clicking the
  // deepLink a Web Clipper note returns). Switch to its vault and open it.
  // The note's per-note provider is already booted by the preload effect, so
  // setActiveId is enough for the body to hydrate.
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.on) return;
    return window.electronAPI.on('deeplink:open', ({ url }) => {
      try {
        const u = new URL(url);
        if (u.host && u.host !== 'open') return; // only edinot://open
        const note = u.searchParams.get('note');
        if (!note) return;
        const vault = u.searchParams.get('vault');
        if (vault) setActiveVault(vault);
        setActiveId(note);
      } catch {}
    });
  }, [setActiveVault]);

  // ─── Folder operations ────────────────────────────────────────────────────
  // Cross-vault aware: target vault's doc owns the entry (not the active
  // vault proxy). Without this, creating/renaming/icon-ing a folder in a
  // non-active vault wrote the meta into the wrong vault doc — sidebar
  // saw it (cross-vault aggregate) but yFolders.get(id) from the proxy
  // returned undefined, breaking drag-drop targets, renames, etc.
  const locateFolderAcrossVaults = useCallback((id) => {
    for (const e of listVaultRegistryEntries()) {
      const m = e.yFolders.get(id);
      if (m) return { entry: e, meta: m };
    }
    return null;
  }, []);

  const newFolder = useCallback(async (vaultId, parentId = null) => {
    const name = await askPrompt(t('tree.folderName'), t('tree.newFolderDefault'));
    if (!name) return;
    const id = 'fld_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const entry = getVaultDoc(vaultId);
    if (!entry) return;
    entry.ydoc.transact(() => {
      entry.yFolders.set(id, { id, name, vaultId, parentId, icon: '📁' });
    });
  }, [askPrompt]);

  const renameFolder = useCallback(async (id) => {
    const located = locateFolderAcrossVaults(id);
    if (!located) return;
    const { entry, meta } = located;
    const name = await askPrompt(t('dlg.renameFolder'), meta.name);
    if (!name) return;
    entry.ydoc.transact(() => {
      entry.yFolders.set(id, { ...meta, name });
    });
  }, [askPrompt, locateFolderAcrossVaults]);

  const setFolderIcon = useCallback((id, icon) => {
    const located = locateFolderAcrossVaults(id);
    if (!located) return;
    const { entry, meta } = located;
    entry.ydoc.transact(() => {
      entry.yFolders.set(id, { ...meta, icon });
    });
  }, [locateFolderAcrossVaults]);

  const deleteFolder = useCallback(async (id) => {
    const ok = await askConfirm(t('dlg.deleteFolder'), { title: t('dlg.deleteFolderTitle') });
    if (!ok) return;
    // Cross-vault aware: locate the owning vault doc and walk its
    // descendants there. The legacy form used active-vault proxies and
    // silently no-op'd when the folder lived in another vault.
    const located = locateFolderAcrossVaults(id);
    if (!located) return;
    const { entry } = located;
    const toDelete = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of entry.yFolders.values()) {
        if (f.parentId && toDelete.has(f.parentId) && !toDelete.has(f.id)) {
          toDelete.add(f.id); grew = true;
        }
      }
    }
    let fallbackActive = null;
    entry.ydoc.transact(() => {
      for (const fid of toDelete) entry.yFolders.delete(fid);
      const remainingFiles = [];
      const removeFileIds = new Set();
      for (const file of entry.yFiles.values()) {
        if (file.folderId && toDelete.has(file.folderId)) removeFileIds.add(file.id);
        else remainingFiles.push(file);
      }
      // Las notas de la carpeta van a la papelera (restaurables a la raíz).
      const trash = entry.ydoc.getMap('trash');
      const now = new Date().toISOString();
      for (const fid of removeFileIds) {
        const meta = entry.yFiles.get(fid);
        const ct = entry.ydoc.getText('content:' + fid);
        let body = '';
        try { body = getContent(fid).toString(); } catch {}
        if (meta) trash.set(fid, { meta: { ...meta }, content: body || ct.toString(), deletedAt: now });
        entry.yFiles.delete(fid);
        if (ct.length > 0) ct.delete(0, ct.length);
      }
      if (removeFileIds.has(activeId)) {
        fallbackActive = remainingFiles[0] ? remainingFiles[0].id : null;
      }
    });
    if (fallbackActive !== null) {
      const cross = getAllFilesAcrossVaults();
      setActiveId(fallbackActive || (cross[0] ? cross[0].id : null));
    }
  }, [activeId, locateFolderAcrossVaults]);

  const moveFolder = useCallback((id, newVaultId, newParentId) => {
    // Cross-vault aware (see moveFolderAcrossVaults). The previous form
    // used the active-vault yFolders / yFiles proxies and broke whenever
    // the source folder lived in a non-active vault.
    moveFolderAcrossVaults(id, newVaultId, newParentId || null);
  }, []);

  const handleDropOnFolder = useCallback((folderId, item) => {
    if (!item) return;
    if (item.type === 'file') {
      moveFileToFolder(item.id, folderId);
    } else if (item.type === 'folder' && item.id !== folderId) {
      const allFolders = getAllFoldersAcrossVaults();
      const target = allFolders.find(f => f.id === folderId);
      if (!target) return;
      moveFolder(item.id, target.vaultId, folderId);
    }
  }, [moveFileToFolder, moveFolder]);

  const handleDropOnVault = useCallback((vaultId, item) => {
    if (!item) return;
    if (item.type === 'file') {
      moveFile(item.id, vaultId, null);
    } else if (item.type === 'folder') {
      moveFolder(item.id, vaultId, null);
    }
  }, [moveFile, moveFolder]);

  const newFileInFolder = useCallback((vaultId, folderId) => {
    const id = 'f' + Date.now().toString(36);
    const seed = '# Nuevo documento\n\n';
    const f = { id, name: 'untitled.md', vaultId, folderId: folderId || null, content: '', size: '0.0 KB', icon: '📄' };
    setFiles(prev => [...prev, f]);
    seedNoteContent(id, seed);
    setActiveId(id);
    setMode(settingsRef.current && settingsRef.current.newNoteMode === 'render' ? 'render' : 'live'); // Ajustes → Editor
  }, []);

  const importFiles = useCallback(async () => {
    if (!window.electronAPI || !window.electronAPI.openImportDialog) return;
    const res = await window.electronAPI.openImportDialog();
    if (res.canceled || !res.files || !res.files.length) return;
    const errors = [];
    let lastId = null;
    const seeds = [];
    const created = res.files.filter(f => f && f.content && !f.error).map(f => {
      const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      lastId = id;
      const size = (f.content.length / 1024).toFixed(1) + ' KB';
      seeds.push({ id, content: f.content });
      return { id, name: f.name, vaultId: activeVault, content: '', size };
    });
    for (const f of res.files) if (f && f.error) errors.push(`${f.name}: ${f.error}`);
    if (created.length) {
      setFiles(prev => [...prev, ...created]);
      for (const s of seeds) seedNoteContent(s.id, s.content);
      if (lastId) setActiveId(lastId);
    }
    if (errors.length) {
      console.warn('[import] errors:\n' + errors.join('\n'));
      alert(`Algunos archivos fallaron:\n\n${errors.join('\n')}`);
    }
  }, [activeVault]);

  // External file open — both File→Open menu and OS file association land here.
  // Adds (or refreshes) an in-memory entry, NOT in yFiles. User can edit it
  // (changes write back to disk debounced), or click "Importar" to move it
  // into a vault (then it becomes a real synced note).
  const openExternalFile = useCallback((filePath, content) => {
    if (!filePath) return;
    const name = filePath.split(/[\\/]/).pop();
    const extId = 'ext:' + btoa(unescape(encodeURIComponent(filePath))).replace(/=/g, '');
    const existing = externalFiles.find(f => f.id === extId);
    if (existing) {
      // refresh in-memory ytext to match on-disk content
      const cached = externalDocsRef.current.get(extId);
      if (cached) {
        const cur = cached.ytext.toString();
        if (cur !== (content || '')) {
          cached.ydoc.transact(() => {
            if (cached.ytext.length > 0) cached.ytext.delete(0, cached.ytext.length);
            if (content) cached.ytext.insert(0, content);
          });
        }
      }
    } else {
      getOrCreateExternalYText(extId, content || '');
      setExternalFiles(prev => [{ id: extId, name, path: filePath }, ...prev]);
    }
    setActiveId(extId);
    setMode('markdown');
  }, [externalFiles, getOrCreateExternalYText]);

  // Auto-save external files to disk on edit (debounced).
  useEffect(() => {
    if (!externalFiles.length) return;
    const timers = new Map();
    const subs = [];
    for (const ef of externalFiles) {
      const entry = externalDocsRef.current.get(ef.id);
      if (!entry) continue;
      const onChange = () => {
        if (timers.has(ef.id)) clearTimeout(timers.get(ef.id));
        const t = setTimeout(async () => {
          try {
            await window.electronAPI.writeExternal(ef.path, entry.ytext.toString());
          } catch (err) { console.warn('[external] save failed', ef.path, err); }
        }, 600);
        timers.set(ef.id, t);
      };
      entry.ytext.observe(onChange);
      subs.push(() => entry.ytext.unobserve(onChange));
    }
    return () => {
      subs.forEach(fn => fn());
      timers.forEach(t => clearTimeout(t));
    };
  }, [externalFiles]);

  const importExternal = useCallback((extId) => {
    const ef = externalFiles.find(f => f.id === extId);
    if (!ef) return;
    const entry = externalDocsRef.current.get(extId);
    const content = entry ? entry.ytext.toString() : '';
    const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const size = (content.length / 1024).toFixed(1) + ' KB';
    setFiles(prev => [...prev, { id, name: ef.name, vaultId: activeVault, content: '', size, icon: '📄' }]);
    seedNoteContent(id, content);
    setActiveId(id);
    setExternalFiles(prev => prev.filter(f => f.id !== extId));
    if (entry) { entry.ydoc.destroy(); externalDocsRef.current.delete(extId); }
  }, [externalFiles, activeVault]);

  const closeExternal = useCallback((extId) => {
    const entry = externalDocsRef.current.get(extId);
    if (entry) { entry.ydoc.destroy(); externalDocsRef.current.delete(extId); }
    setExternalFiles(prev => prev.filter(f => f.id !== extId));
    if (activeId === extId) {
      setActiveId(filesMeta[0] ? filesMeta[0].id : null);
    }
  }, [activeId, filesMeta]);

  // Listen to Electron menu events
  useEffect(() => {
    const onNew = () => newFile();
    const onOpen = (e) => {
      const { path: filePath, content } = e.detail || {};
      openExternalFile(filePath, content);
    };
    const onExternal = (e) => {
      const { path: filePath, content } = e.detail || {};
      openExternalFile(filePath, content);
    };
    const onImport = () => importFiles();
    window.addEventListener('edinot:new', onNew);
    window.addEventListener('edinot:open', onOpen);
    window.addEventListener('edinot:externalOpen', onExternal);
    window.addEventListener('edinot:import', onImport);
    return () => {
      window.removeEventListener('edinot:new', onNew);
      window.removeEventListener('edinot:open', onOpen);
      window.removeEventListener('edinot:externalOpen', onExternal);
      window.removeEventListener('edinot:import', onImport);
    };
  }, [newFile, openExternalFile, importFiles]);

  // Expose active note + save callback to ipc-glue.js (used by File→Save/As).
  // Keeps the legacy menu wiring working post-CodeMirror migration.
  useEffect(() => {
    window.__edinotIO = {
      getActive: () => active ? {
        name: active.name,
        // Read live from Y.Text, not the paced `activeContent` snapshot, so a
        // disk save fired within the throttle window can't drop the last keys.
        content: activeContentText ? activeContentText.toString() : activeContent,
        path: active.__path,
      } : null,
      onSaved: (path) => {
        if (!active) return;
        setFiles(prev => prev.map(x => x.id === active.id ? { ...x, __path: path } : x));
      },
    };
    return () => { delete window.__edinotIO; };
  }, [active, activeContent]);

  const NOTE_ONLY_SHORTCUTS = useMemo(() => new Set(['bold', 'italic', 'underline', 'toggleRender', 'toggleLive', 'surface', 'localSearch', 'history', 'share', 'tplBuilder']), []);
  // keyboard shortcuts — los reasignables salen del registro
  // (ui/shared/shortcuts.js + Ajustes → Atajos); Esc, «i», deshacer/rehacer
  // siguen fijos aquí.
  useEffect(() => {
    // Ejecuta un atajo por id. Devuelve false si no aplica (se deja pasar).
    const runShortcut = (id, e) => {
      const pd = () => { if (e) e.preventDefault(); };
      switch (id) {
        case 'localSearch': {
          // (1.2) Ctrl/⌘ F busca DENTRO de lo que está abierto. El canvas y el
          // editor (su keymap de búsqueda) ya lo atienden si tienen el foco.
          if (e && e.defaultPrevented) return;
          if (!active || view === 'home') return false;
          pd();
          if (activeSurfaceRef.current === 'canvas' && document.querySelector('.docwrap-canvas .canvas-root')) {
            window.dispatchEvent(new CustomEvent('edinot:canvas-find'));
          } else if (mode === 'render') {
            const sel = String((window.getSelection && window.getSelection()) || '').trim();
            setReadFind(f => ({ key: ((f && f.key) || 0) + 1, initial: sel && sel.length < 120 && !sel.includes('\n') ? sel : (f ? f.initial : '') }));
          } else if (cmViewRef.current) {
            openSearchPanel(cmViewRef.current);
          } else {
            pendingActionRef.current = '__search__';
            setMode('markdown');
          }
          return;
        }
        case 'calendar': pd(); setCalendarOpen(o => !o); return; // calendario del vault (toggle)
        case 'sidebar': pd(); toggleSidebar(); return; // barra lateral / carril
        case 'panel': pd(); setCtxPanelOpen(v => !v); return;
        // En «Editar» el editor de bloques ya conmuta negrita/cursiva (y marca
        // el evento): no envolver dos veces.
        case 'bold': if (e.defaultPrevented) return; pd(); action('bold'); return;
        case 'italic': if (e.defaultPrevented) return; pd(); action('italic'); return;
        case 'underline': pd(); action('underline'); return;
        case 'palette': {
          // Ctrl K → buscador/comandos. Con texto seleccionado en el editor
          // conserva el atajo de siempre: insertar enlace.
          pd();
          const v = cmViewRef.current;
          if (v && v.hasFocus && !v.state.selection.main.empty) action('link');
          else openPalette('all');
          return;
        }
        case 'toggleLive': pd(); setMode(m => m === 'live' ? 'render' : 'live'); return;
        case 'surface': pd(); switchSurfaceRef.current(activeSurfaceRef.current === 'canvas' ? 'page' : 'canvas'); return;
        case 'toggleRender': pd(); setMode(m => m === 'markdown' ? 'render' : 'markdown'); return;
        case 'newNote': pd(); newFile(); return;
        // ⌘T / ⌘P → paleta (Notas). ⌘⇧T va aparte (constructor de plantillas).
        case 'finder': case 'finderAlt': pd(); openPalette('notes'); return;
        // ⌘⇧H → historial de versiones del workspace (por nota activa).
        case 'history': pd(); if (active) setHistoryOpen(true); return;
        // ⌘⇧L → compartir nota actual (link público token-based). ⌘⇧S queda
        // para «Guardar como…» del menú de Electron.
        case 'share': pd(); if (active) setShareNoteOpen(true); return;
        // ⌘⇧F → Ctrl K con el filtro «Contenido» (⌘F busca en la nota).
        case 'globalSearch': if (e && e.defaultPrevented) return; pd(); openPalette('content'); return;
        case 'tplBuilder':
          // ⌘⇧T → toggle template builder panel (only when editing a template).
          if (active && isTemplateFile(active, folders)) { pd(); setTplBuilderClosed(v => !v); }
          return;
        default:
          // Atajos del menú de Electron (guardar, abrir…): los atiende el menú.
          return false;
      }
    };
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = (e.key || '').toLowerCase();

      // Mode toggles without modifiers
      if (!mod && !e.altKey) {
        // Esc in markdown → render (only if no menu open and not editing in a popover input)
        if (e.key === 'Escape') {
          // Ya lo ha consumido el editor (menú «/», barra flotante, popover).
          if (e.defaultPrevented) return;
          // La página Calendario gestiona su propio Esc (cierra el popover).
          if (calendarOpen) return;
          const anyMenu = palette || settingsOpen || imageModal;
          if (anyMenu) return; // let the menu handle its own Esc
          // CodeMirror's in-note search panel handles its own Esc to close
          // itself — don't also exit edit mode in that case.
          if (document.querySelector('.edinot-search')) return;
          if (mode === 'markdown' || mode === 'live') { e.preventDefault(); setMode('render'); return; }
        }
        // «E» o Enter en Leer → Editar (sin un campo de texto con el foco).
        if ((k === 'e' || e.key === 'Enter') && !e.shiftKey && !e.defaultPrevented && mode === 'render' && view !== 'home' && !allOpen && active) {
          const t = document.activeElement;
          const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
            || t.tagName === 'BUTTON' || t.tagName === 'A' || t.isContentEditable || (t.closest && t.closest('[role="menu"], [role="dialog"], .blk-pop')));
          const overlay = palette || settingsOpen || imageModal || calendarOpen;
          if (!typing && !overlay) { e.preventDefault(); setMode('live'); return; }
        }
      }

      const bindings = shortcutBindingsRef.current;
      const id = matchShortcut(e, bindings);
      // En la página de Ajustes la nota está oculta: nada que la edite.
      if (id && settingsOpen && NOTE_ONLY_SHORTCUTS.has(id)) return;
      if (id) {
        // Un atajo de tecla suelta (sin Ctrl/Alt) no se dispara escribiendo.
        if (isBareTypingCombo(bindings[id])) {
          const el = document.activeElement;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        }
        if (runShortcut(id, e) !== false) return;
      }

      if (!mod) return;
      // When CodeMirror has focus, let its yUndoManagerKeymap handle undo/redo
      // (same shared manager) so we don't undo twice. Outside the editor
      // (render mode, canvas) the window handler drives it.
      if (k === 'z' && !e.shiftKey) { if (cmViewRef.current && cmViewRef.current.hasFocus) return; e.preventDefault(); doUndo(); }
      else if (k === 'z' && e.shiftKey) { if (cmViewRef.current && cmViewRef.current.hasFocus) return; e.preventDefault(); doRedo(); }
      else if (k === 'y') { if (cmViewRef.current && cmViewRef.current.hasFocus) return; e.preventDefault(); doRedo(); }
    };
    // El menú de Electron (Ver → Alternar render…) pide el atajo por id.
    const onShortcutEvt = (ev) => { const id = ev && ev.detail && ev.detail.id; if (id) runShortcut(id, null); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('edinot:shortcut', onShortcutEvt);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('edinot:shortcut', onShortcutEvt); };
  }, [active, mode, newFile, palette, settingsOpen, imageModal, calendarOpen, allOpen, openPalette, toggleSidebar, setCtxPanelOpen, view]);

  const fontFamily = settings.editorFont === 'serif'
    ? `'Iowan Old Style', 'Apple Garamond', 'Palatino', Georgia, serif`
    : settings.editorFont === 'sans'
    ? `'Inter', 'Instrument Sans', -apple-system, 'Helvetica Neue', sans-serif`
    : `'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, monospace`;

  // Columna de lectura (ui/shared/readWidth.js): un solo ancho para el texto y
  // las tablas; «medio» = 992 px de contenido (+96 de márgenes), «estrecho» 680
  // y «completo» 1224. Se cambia en Ajustes → Apariencia → Ancho de lectura.
  const maxWidth = readMaxWidth(settings.width);
  const activeCanvasBlock = active ? firstCanvasBlock(active.content) : null;
  // Página ↔ Canvas: el canvas de la nota ocupa el panel cuando su modo es Canvas.
  const activeCanvasPrimary = active && activeSurface === 'canvas' && activeCanvasBlock;
  // Una nota-canvas es solo el tablero: sin Leer/Editar ni panel lateral
  // (diseño). Markdown sigue a mano con su atajo para tocar el bloque crudo.
  const showingPrimaryCanvas = !!activeCanvasPrimary && mode !== 'markdown';

  // make container CSS variables reflect theme
  const cssVars = {
    '--bg': theme.bg,
    '--toolbar': theme.toolbar,
    '--fg': theme.fg,
    '--muted': theme.muted,
    '--accent': effectiveAccent,
    // Shell: sólo los temas del rediseño traen tokens propios; para los demás
    // ui/shell.css los deriva de --bg/--fg/--accent.
    ...(theme.side ? { '--side': theme.side } : null),
    ...(theme.panel ? { '--panel': theme.panel } : null),
    ...(theme.line ? { '--line': theme.line } : null),
    ...(theme.hover ? { '--hover': theme.hover } : null),
    ...(theme.accentSoft && !settings.accentOverride ? { '--accent-soft': theme.accentSoft } : null),
    ...(theme.faint ? { '--faint': theme.faint } : null),
    ...(theme.hl ? { '--hl': theme.hl } : null),
    // Las ventanas flotantes (cabecera oscura) siguen usando estas.
    '--titlebar': dark ? '#0d0f0d' : '#1c1d1c',
    '--titlebar-fg': '#e7e7e3',
    '--titlebar-pill': 'rgba(255,255,255,0.07)',
    '--titlebar-pill-hover': 'rgba(255,255,255,0.12)',
    // = sideRail (declarado más abajo): calendario → carril salvo que se despliegue.
    '--side-w': (sidebarCollapsed || (!calendarOpen && settingsOpen) || (calendarOpen && !calSideExpanded)) ? '56px' : '264px',
  };

  // ─── Shell: datos y acciones de barra lateral, barra superior, panel,
  // Inicio y Ctrl K ─────────────────────────────────────────────────────
  // Comentario raíz en la nota activa (lo usan la pestaña Comentarios y la
  // caja «Pregunta a un agente» de la pestaña IA: una @mención en el texto
  // crea la agentTask igual que siempre).
  const composeRootComment = (text) => {
    if (!active) return null;
    const v = (text || '').trim();
    if (!v) return;
    const myEmail = (syncConfigState && syncConfigState.email) || 'user';
    const rec = {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
      noteId: active.id,
      kind: 'note',
      parentId: null,
      text: v,
      anchorText: null,
      author: myEmail,
      ts: new Date().toISOString(),
      resolved: false,
      replies: [],
      awaitingReply: false,
      mentions: (v.match(/@[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).map(s => s.slice(1).toLowerCase()),
    };
    putComment(ydoc, rec);
    // New root comment lands at the bottom of the timeline →
    // scroll the panel down so the user sees their own message.
    scrollCommentsToBottom();
    enqueueAgentTasksForComment(rec, rec.text);
    const wsId = syncConfigState && syncConfigState.currentWorkspaceId;
    if (wsId && rec.mentions && rec.mentions.length && syncConfigState.httpUrl && syncConfigState.token) {
      for (const email of rec.mentions) {
        apiDispatchNotif(syncConfigState.httpUrl, syncConfigState.token, {
          email, workspaceId: wsId, kind: 'mention',
          payload: { noteId: active.id, noteName: active.name, commentId: rec.id, preview: v.slice(0, 160) },
        }).catch(() => {});
      }
    }
    return rec;
  };

  // Acciones estables para la barra lateral / Inicio / comandos / panel: un
  // Proxy que llama siempre a la versión más reciente (shellActsRef se
  // rellena más abajo), así sus `memo` no se invalidan con cada handler.
  const shellActsRef = useRef({});
  const shellActions = useMemo(() => {
    const cache = {};
    return new Proxy({}, {
      get: (_, k) => cache[k] || (cache[k] = (...args) => {
        const fn = shellActsRef.current[k];
        return typeof fn === 'function' ? fn(...args) : undefined;
      }),
    });
  }, []);

  const routeView = calendarOpen ? 'calendar' : settingsOpen ? 'settings' : allOpen ? 'all' : (view || 'note');
  const onCalendarPage = routeView === 'calendar';
  const onSettingsPage = routeView === 'settings';
  const onAllPage = routeView === 'all';
  calRailRef.current = onCalendarPage && !sidebarCollapsed;
  useEffect(() => { if (!onCalendarPage) setCalSideExpanded(false); }, [onCalendarPage]);
  const sideRail = sidebarCollapsed || onSettingsPage || (onCalendarPage && !calSideExpanded);
  // Navegar a otra nota o a Inicio (barra lateral, Ctrl K, MCP…) sale de la
  // página Calendario.
  const calNavSigRef = useRef(null);
  useEffect(() => {
    const sig = `${view}|${activeId}`;
    if (calNavSigRef.current !== null && calNavSigRef.current !== sig) { setCalendarOpen(false); setAllOpen(false); }
    calNavSigRef.current = sig;
  }, [view, activeId]);
  const shellWorkspace = useMemo(() => {
    const cfg = syncConfigState;
    if (!cfg || !cfg.token) return null;
    const list = Array.isArray(cfg.workspaces) ? cfg.workspaces : [];
    const cur = list.find(w => w.id === cfg.currentWorkspaceId);
    return { name: cur ? cur.name : null, currentId: cfg.currentWorkspaceId || null, list };
  }, [syncConfigState]);
  const tplFolderIdSet = useMemo(() => templateFolderIds(folders), [folders]);
  const canvasIdSig = useMemo(() => canvasNotes.map(f => f.id).join(','), [canvasNotes]);
  const canvasIdSet = useMemo(() => new Set(canvasIdSig ? canvasIdSig.split(',') : []), [canvasIdSig]);
  const favoriteFiles = useMemo(
    () => filesMeta.filter(f => f.pinned).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [filesMeta],
  );
  const notesById = useMemo(() => new Map(filesMeta.map(f => [f.id, f])), [filesMeta]);
  const agentTasksAll = useMemo(() => readAgentTasks(ydoc), [metaV]);
  // Identidad estable (stabilizeList) para no re-renderizar la barra lateral
  // con cada escritura en yMeta (selección, modo…) que no toca las tareas.
  const pendingTasksRef = useRef(null);
  const pendingAgentTasks = useMemo(
    () => (pendingTasksRef.current = stabilizeList(pendingTasksRef.current, agentTasksAll
      .filter(tk => ['pending', 'pending-offline', 'running'].includes(String(tk.status || 'pending')))
      .sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || ''))))),
    [agentTasksAll],
  );
  const agentsSig = knownAiAgents.map(a => `${a.alias}:${a.online ? 1 : 0}`).join('|');
  const sidebarAgents = useMemo(() => knownAiAgents, [agentsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const editLogList = useMemo(() => (Array.isArray(yMeta.get('editLog')) ? yMeta.get('editLog') : []), [metaV]);
  const todayShortLabel = todayShortLabelCached(getLang());
  // El inicio muestra SOLO el vault en el que estás: sus eventos, notas recientes,
  // nota de hoy, tareas y actividad de agentes. Cambiar de vault cambia el inicio.
  const homeVaultIds = useMemo(() => [activeVault], [activeVault]);
  const activeVaultFiles = useMemo(
    () => filesMeta.filter(f => (f.vaultId || 'default') === activeVault),
    [filesMeta, activeVault],
  );
  const homeFiles = useMemo(() => activeVaultFiles.filter(f => !tplFolderIdSet.has(f.folderId)), [activeVaultFiles, tplFolderIdSet]);
  const homeNotesById = useMemo(() => new Map(activeVaultFiles.map(f => [f.id, f])), [activeVaultFiles]);
  const homeEditLog = useMemo(
    () => editLogList.filter(e => e && homeNotesById.has(e.noteId)),
    [editLogList, homeNotesById],
  );
  const activeVaultTemplates = useMemo(
    () => filesMeta.filter(f => f.folderId && tplFolderIdSet.has(f.folderId) && (f.vaultId || 'default') === activeVault),
    [filesMeta, tplFolderIdSet, activeVault],
  );

  // ─── Editor de bloques («Editar»): datos de cabecera y acciones para la
  // capa React (editor/blocks/BlockUI.jsx). Reutiliza los flujos de siempre
  // (barra de formato, Inicio, comentarios, plantillas) — no los duplica.
  // El bloque de página dentro del canvas: el editor de siempre («Editar»),
  // sobre el mismo Y.Text de la nota y sin la valla del canvas.
  const renderPageBlock = useCallback(() => (active ? (
    <CodeMirrorEditor
      key={'page::' + active.id}
      ytext={activeContentText}
      awareness={isExternalId(active.id) ? null : (getNoteAwareness(active.id) || awareness)}
      fontFamily="var(--font-ui)"
      fontSize={settings.fontSize + 1}
      pageMeta={livePageMetaRef.current}
      vimMode={!!settings.vim}
      spellcheck={settings.spellcheck !== false}
      onPasteImage={insertImageFromFile}
      livePreview
      hideOwnCanvas
      renderMdRef={renderMdRef}
      liveTableCtxRef={liveTableCtxRef}
      undoManager={activeUndoManager}
      readOnly={isViewer || activeNoteReadOnly}
    />
  ) : null), [active && active.id, activeContentText, settings.fontSize, settings.vim, settings.spellcheck, activeUndoManager, isViewer, activeNoteReadOnly]);

  const livePageMeta = useMemo(() => (active ? {
    icon: active.icon || '',
    cover: active.cover || '',
    title: splitExt(active.name || '').base,
    editable: !isViewer && !activeNoteReadOnly && !isExternalId(active.id),
    header: !isExternalId(active.id),
  } : null), [active && active.id, active && active.icon, active && active.cover, active && active.name, isViewer, activeNoteReadOnly]);
  const livePageMetaRef = useRef(livePageMeta);
  livePageMetaRef.current = livePageMeta;
  const getCmView = useCallback(() => cmViewRef.current, []);
  const blockUiActions = {
    icon: active ? active.icon || null : null,
    getContent: () => { const yt = activeYTextRef.current; return yt ? yt.toString() : ((active && active.content) || ''); },
    setProps: (fn) => mutateActiveSource(src => writeProps(src, fn(parseProps(src).props))),
    setIcon: (emoji) => { if (active && !isExternalId(active.id)) setFileIcon(active.id, emoji || null); },
    cover: active ? active.cover || null : null,
    setCover: (v) => { if (active && !isExternalId(active.id)) setFileCover(active.id, v || null); },
    // Imagen de portada: al servidor si hay sincronización; si no, reducida y en local.
    uploadCover: async (file) => {
      if (!active || isExternalId(active.id) || !file) return;
      const id = active.id;
      try {
        if (syncConfigState && syncConfigState.httpUrl && syncConfigState.token) {
          const res = await apiUploadBlob(syncConfigState.httpUrl, syncConfigState.token, file);
          if (window.electronAPI && window.electronAPI.cacheBlobBytes) {
            try { await window.electronAPI.cacheBlobBytes(res.id, file.type || 'image/jpeg', await file.arrayBuffer()); } catch {}
          }
          setFileCover(id, 'i:edinot://blob/' + res.id);
        } else {
          setFileCover(id, 'i:' + await imageFileToDataUrl(file));
        }
      } catch (err) { window.alert(t('blk.cover.uploadError') + ': ' + (err && err.message ? err.message : err)); }
    },
    // Base de datos en línea: la misma tabla tipada que «Nueva base de datos».
    buildDatabaseMarkdown: () => {
      const cols = [t('home.db.colName'), t('home.db.colStatus'), t('home.db.colDate')];
      let md = tplTable(cols, [['', '', '']]);
      md = setTableColumnTypeInSource(md, 0, cols[1], { type: 'status', options: [t('home.db.st1'), t('home.db.st2'), t('home.db.st3')] });
      md = setTableColumnTypeInSource(md, 0, cols[2], { type: 'date' });
      return md.replace(/^\n+|\n+$/g, '');
    },
    // «Extraer a nota nueva»: crea la nota (misma bóveda y carpeta) con el
    // fragmento y devuelve su nombre para dejar [[enlace]] en su lugar.
    extractToNote: (isViewer || activeNoteReadOnly || !active || isExternalId(active.id)) ? null : (text) => {
      let all;
      try { all = getAllFilesAcrossVaults(); } catch { all = files; }
      const taken = new Set((all || files || []).map(f => String(f.name || '').replace(/\.(md|markdown|txt)$/i, '').toLowerCase()));
      const name = uniqueName(extractTitle(text), taken);
      const body = /^\s{0,3}#\s/.test(text) ? text.replace(/^\s+/, '') + '\n' : `# ${name}\n\n${text.replace(/^\n+/, '')}\n`;
      const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const vaultId = active.vaultId || activeVault;
      const meta = {
        id, name: `${name}.md`, vaultId, size: '0.0 KB', nameLocked: true,
        ...(active.folderId ? { folderId: active.folderId } : null),
      };
      pendingCreatedNoteIdsRef.current.add(id);
      const vaultEntry = getVaultDoc(vaultId);
      if (vaultEntry && vaultEntry.yFiles) vaultEntry.yFiles.set(id, meta);
      else yFiles.set(id, meta);
      seedNoteContent(id, body);
      return name;
    },
    // «Convertir en base de datos»: cada elemento → fila; tareas → «Hecho».
    linesToDatabase: (text) => {
      const { hasTasks, rows } = linesToDbRows(text);
      if (!rows.length) return null;
      const colName = t('home.db.colName');
      const colDone = t('blk.db.colDone');
      const cols = hasTasks ? [colName, colDone] : [colName];
      let md = tplTable(cols, rows.map(r => (hasTasks ? [r.name, r.done ? '✓' : ''] : [r.name])));
      if (hasTasks) md = setTableColumnTypeInSource(md, 0, colDone, { type: 'checkbox' });
      return md.replace(/^\n+|\n+$/g, '');
    },
    openImagePicker,
    attachFile,
    canvases: canvasNotes,
    // Sin pasar por createAndEmbedCanvas: su useCallback guarda un runAction
    // de un render antiguo (con `active` nulo al arrancar) y no insertaba.
    createCanvasEmbed: () => { const id = createCanvasNote(); if (id) runAction('canvasEmbed', { noteId: id }); },
    embedCanvas: (noteId) => runAction('canvasEmbed', { noteId }),
    createReminder: createReminderFromSelection,
    openFormBuilder: () => setFormBuilder({ mode: 'create' }),
    templates: activeVaultTemplates,
    insertTemplate: (tpl) => openApplyTemplate(tpl, { insertHere: true }),
    commentOn: canCommentActiveNote ? (anchorText) => {
      const v = cmViewRef.current;
      const sm = v ? v.state.selection.main : null;
      setCommentDraft({ anchorText: anchorText || null, range: sm && !sm.empty ? { from: sm.from, to: sm.to } : null });
    } : null,
    members: workspaceMemberEmails,
    noteNames: () => tableNoteNames,
    noteId: active ? active.id : null,
    databases: tableEntries,
    allTags: tagNames,
    openTag: (tag) => openPalette('all', '#' + tag),
  };
  const todayFile = useMemo(() => findDailyNote(activeVaultFiles), [activeVaultFiles]);
  const homeToday = useMemo(() => {
    if (view !== 'home' || !todayFile) return null;
    const txt = getContentString(todayFile.id) || '';
    const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^#{1,6}\s/.test(l) && !/^>/.test(l));
    const preview = lines.slice(0, 3)
      .map(l => l.replace(/^([-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+)/, ''))
      .join(' · ').replace(/[*_`]+/g, '').slice(0, 220);
    return { file: todayFile, preview };
  }, [view, todayFile, allDocsV, contentVDebounced]);

  // Ruta de la barra superior: vault (si hay varios) / carpetas / título.
  const topCrumbs = useMemo(() => {
    if (view === 'home' || !active) return [];
    const out = [];
    if (vaults.length > 1) {
      const v = vaults.find(x => x.id === (active.vaultId || 'default'));
      if (v) out.push({ label: v.name });
    }
    const byId = new Map(folders.map(f => [f.id, f]));
    const chain = [];
    let fid = active.folderId || null;
    for (let g = 0; fid && g < 20; g++) { const fd = byId.get(fid); if (!fd) break; chain.unshift(fd); fid = fd.parentId || null; }
    for (const fd of chain) out.push({ label: fd.name });
    return out;
  }, [view, active && active.id, active && active.folderId, active && active.vaultId, folders, vaults]);

  const topSaveLabel = saveStatus === 'saved'
    ? t('shell.saving')
    : (syncConfigState && syncConfigState.token && syncStatus !== 'connected' ? t('shell.savedLocal') : t('shell.saved'));

  // Última edición por nota (este equipo + ediciones de IA del editLog).
  const lastEditRef = useRef(null);
  if (lastEditRef.current === null) {
    try { lastEditRef.current = JSON.parse(localStorage.getItem('edinot.lastEdit.v1') || '{}') || {}; } catch { lastEditRef.current = {}; }
  }
  useEffect(() => {
    const yt = activeContentText;
    const id = activeId;
    if (!yt || !id || isExternalId(id)) return;
    let saveT = null;
    const fn = (_ev, tr) => {
      if (tr && !tr.local) return; // sincronización/hidratación remota no cuenta
      lastEditRef.current[id] = Date.now();
      if (saveT) return;
      saveT = setTimeout(() => {
        saveT = null;
        try { localStorage.setItem('edinot.lastEdit.v1', JSON.stringify(lastEditRef.current)); } catch {}
        // La fecha de modificación viaja con la ficha de la nota («Todas las notas», MCP): se
        // apunta como mucho cada 10 min por nota, para no remover el índice a cada pausa al teclear.
        try {
          const loc = locateFileAcrossVaults(id);
          if (loc && !isViewer && Date.now() - (Number(loc.meta.updatedAt) || 0) > 600000) patchFileMeta(id, { updatedAt: Date.now() });
        } catch {}
      }, 2000);
    };
    yt.observe(fn);
    return () => { yt.unobserve(fn); if (saveT) clearTimeout(saveT); };
  }, [activeContentText, activeId]);

  const ctxInfo = useMemo(() => {
    // Las palabras de la página: sin el JSON de su canvas propio.
    const txt = pageText(activeContentDebounced || '');
    const words = txt.split(/\s+/).filter(Boolean).length;
    let aiAt = 0;
    if (active) for (const e of editLogList) if (e && e.noteId === active.id) { const ts = Date.parse(e.ts); if (ts > aiAt) aiAt = ts; }
    const localAt = active ? (lastEditRef.current[active.id] || 0) : 0;
    const v = active ? vaults.find(x => x.id === (active.vaultId || 'default')) : null;
    const st = active ? ((yMeta.get('fileStats') || {})[active.id] || {}) : {};
    return {
      words, chars: txt.length,
      editedAt: Math.max(aiAt, localAt) || null,
      openedAt: st.t || null,
      vault: v ? v.name : (active ? active.vaultId || 'default' : ''),
      folder: topCrumbs.filter((_, i) => !(vaults.length > 1 && i === 0)).map(c => c.label).join(' / '),
    };
  }, [activeContentDebounced, active && active.id, editLogList, vaults, topCrumbs, metaV]);

  // «Enlazan aquí» con la línea donde se cita la nota.
  // También al pie de la nota (NoteBacklinks), con el panel cerrado.
  const backlinkItems = useMemo(() => {
    if (!active || view === 'home') return [];
    const myKey = normalizeNoteName(active.name || '');
    const ids = backIndex.get(myKey) || [];
    if (!ids.length) return [];
    const byId = new Map(files.map(f => [f.id, f]));
    const out = [];
    for (const id of ids) {
      if (id === active.id || out.length >= 20) continue;
      const f = byId.get(id);
      if (!f) continue;
      let snippet = '';
      const lines = String(f.content || '').split('\n');
      for (const line of lines) {
        const re = /\[\[([^\[\]\n|#]+)/g;
        let m, hit = false;
        while ((m = re.exec(line))) { if (normalizeNoteName(m[1]) === myKey) { hit = true; break; } }
        if (!hit) continue;
        const plain = line.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, x, __, y) => y || x)
          .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+)/, '').replace(/[*_`]+/g, '').trim();
        snippet = plain.length > 120 ? plain.slice(0, 117) + '…' : plain;
        break;
      }
      out.push({ file: f, snippet });
    }
    return out;
  }, [active && active.id, active && active.name, view, backIndex, files]);

  // Salta a un encabezado del esquema (render y/o CodeMirror).
  const jumpToHeading = useCallback((o) => {
    if (mode === 'render' || mode === 'dual') {
      const root = renderRef.current;
      if (root) {
        const hs = Array.from(root.querySelectorAll('h1, h2, h3'));
        const clean = (x) => String(x.textContent || '').replace(/¶$/, '').trim();
        const el = hs[o.n] && clean(hs[o.n]) === o.text ? hs[o.n] : (hs.find(h => clean(h) === o.text) || hs[o.n]);
        if (el) {
          const sc = findScrollableAncestor(el) || document.scrollingElement;
          const top = sc.scrollTop + (el.getBoundingClientRect().top - sc.getBoundingClientRect().top) - 24;
          sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        }
      }
    }
    if (mode !== 'render' && cmViewRef.current) {
      const v = cmViewRef.current;
      const ln = Math.min(o.line + 1, v.state.doc.lines);
      const pos = v.state.doc.line(ln).from;
      v.dispatch({ selection: { anchor: pos, head: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }) });
      v.focus();
    }
  }, [mode]);

  // Ir a un ancla de wikilink ([[Nota#Título]], [[#Título]], [[Nota#^id]]).
  useEffect(() => {
    if (!anchorReq || anchorReq.noteId !== activeId) return undefined;
    const tm = setTimeout(() => {
      setAnchorReq(null);
      const anchor = anchorReq.anchor;
      const src = activeContentText ? activeContentText.toString() : '';
      const line = findAnchorLine(src, anchor);
      if (line < 0) return;
      const flash = (el) => { el.classList.add('md-fn-flash'); setTimeout(() => el.classList.remove('md-fn-flash'), 1400); };
      if (mode === 'render' || mode === 'dual') {
        const root = renderRef.current;
        let el = null;
        if (root) {
          if (anchor.startsWith('^')) el = root.querySelector(`[data-block-id="${CSS.escape(anchor.slice(1))}"]`);
          else {
            const want = normHeading(anchor.split('#').pop());
            el = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).find(h => normHeading(String(h.textContent || '').replace(/¶$/, '')) === want) || null;
          }
        }
        if (el) {
          const sc = findScrollableAncestor(el) || document.scrollingElement;
          const top = sc.scrollTop + (el.getBoundingClientRect().top - sc.getBoundingClientRect().top) - 24;
          sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
          flash(el);
        }
      }
      if (mode !== 'render' && cmViewRef.current) {
        const v = cmViewRef.current;
        const ln = Math.min(line + 1, v.state.doc.lines);
        const pos = v.state.doc.line(ln).from;
        v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }) });
        v.focus();
      }
    }, 180);
    return () => clearTimeout(tm);
  }, [anchorReq, activeId, mode, activeContentText]);

  // Encabezado que se está leyendo (para resaltarlo en el esquema).
  const getActiveHeading = useCallback(() => {
    if (mode === 'render') {
      const root = renderRef.current;
      if (!root) return null;
      const sc = findScrollableAncestor(root) || document.scrollingElement;
      const top = (sc && sc.getBoundingClientRect ? sc.getBoundingClientRect().top : 0) + 90;
      const hs = root.querySelectorAll('h1, h2, h3');
      let n = -1;
      for (let i = 0; i < hs.length; i++) { if (hs[i].getBoundingClientRect().top <= top) n = i; else break; }
      return { n: Math.max(n, hs.length ? 0 : -1) };
    }
    const v = cmViewRef.current;
    if (!v) return null;
    const rect = v.dom.getBoundingClientRect();
    const sc = findScrollableAncestor(v.dom);
    const topY = Math.max(rect.top, sc && sc.getBoundingClientRect ? sc.getBoundingClientRect().top : 0) + 90;
    const pos = v.posAtCoords({ x: rect.left + Math.min(80, rect.width / 2), y: topY }, false);
    return pos == null ? null : { line: v.state.doc.lineAt(pos).number - 1 };
  }, [mode]);

  // ── Acciones nuevas ────────────────────────────────────────────────────
  const patchFileMeta = useCallback((id, patch) => {
    const loc = locateFileAcrossVaults(id);
    if (!loc) return;
    const map = loc.doc.getMap('files');
    const cur = map.get(id) || loc.meta;
    loc.doc.transact(() => map.set(id, { ...cur, ...patch }));
  }, []);
  const togglePin = useCallback((id) => {
    const loc = locateFileAcrossVaults(id);
    if (!loc) return;
    patchFileMeta(id, { pinned: !loc.meta.pinned });
  }, [patchFileMeta]);

  // Nota diaria: mismo nombre/ubicación que get_or_create_daily_note del
  // MCP (YYYY-MM-DD en la raíz del vault); usa la «Plantilla Diario» /
  // «Daily Template» del vault si existe.
  // `d` (opcional): otro día — la página Calendario abre/crea la nota de
  // cualquier fecha; la plantilla diaria sólo se aplica a la de hoy.
  const getOrCreateDailyNote = useCallback((d) => {
    const day = d instanceof Date ? d : new Date();
    const forToday = dailyNoteName(day) === dailyNoteName();
    // La nota diaria es de cada vault: se busca (y se crea) en el vault activo.
    let all;
    try { all = getAllFilesAcrossVaults(); } catch { all = filesMeta; }
    const existing = findDailyNote(all.filter(f => (f.vaultId || 'default') === activeVault), day);
    if (existing) return { id: existing.id, created: false };
    if (isViewer) return null;
    const vid = activeVault;
    const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const meta = { id, name: dailyNoteName(day) + '.md', vaultId: vid, folderId: null, size: '0.0 KB', nameLocked: true };
    pendingCreatedNoteIdsRef.current.add(id);
    const ve = getVaultDoc(vid);
    if (ve && ve.yFiles) ve.yFiles.set(id, meta); else yFiles.set(id, meta);
    let body = defaultDailyBody(day);
    const tpl = forToday && findDailyTemplate(filesMeta.filter(f => f.folderId && tplFolderIdSet.has(f.folderId)), vid);
    if (tpl) {
      try {
        const counters = (yMeta.get('templateCounters') && typeof yMeta.get('templateCounters') === 'object') ? { ...yMeta.get('templateCounters') } : {};
        const v = vaults.find(x => x.id === vid);
        const cfg = syncCfgRef.current;
        const ctx = {
          vaultName: v ? v.name : vid, folderName: '', folderPath: '',
          templateName: splitExt(tpl.name).base, noteCount: 0,
          userName: cfg && cfg.email ? cfg.email.split('@')[0] : '', userEmail: (cfg && cfg.email) || '',
          clipboard: '', counters, notes: [],
        };
        const r = applyTemplate(getContent(tpl.id).toString(), {}, ctx);
        if (r && r.body && r.body.trim()) body = r.body;
        if (Object.keys(ctx.counters).length) yMeta.set('templateCounters', ctx.counters);
      } catch (err) { console.warn('[daily] plantilla', err && err.message); }
    }
    seedNoteContent(id, body);
    return { id, created: true };
  }, [filesMeta, isViewer, activeVault, tplFolderIdSet, vaults]);
  const openToday = useCallback(() => {
    const r = getOrCreateDailyNote();
    if (r) { setCalendarOpen(false); setActiveId(r.id); }
  }, [getOrCreateDailyNote, setActiveId]);
  // Página Calendario: saltar a una nota / abrir la nota de un día cierran
  // la página (el editor vuelve a ser la vista principal).
  const clearCalendarDraft = useCallback(() => setCalendarDraft(null), []);
  const calendarJump = useCallback((noteId, snippet) => {
    if (!noteId) return;
    setCalendarOpen(false); setCalendarDraft(null); setView('note');
    jumpToMatch(noteId, 0, snippet);
  }, [jumpToMatch]);
  const calendarOpenDaily = useCallback((d) => {
    const r = getOrCreateDailyNote(d);
    if (!r) return;
    setCalendarOpen(false); setView('note');
    setActiveId(r.id);
  }, [getOrCreateDailyNote, setActiveId]);
  const openExternalUrl = useCallback((url) => {
    try {
      if (window.electronAPI && window.electronAPI.openExternal) window.electronAPI.openExternal(url);
      else window.open(url, '_blank', 'noopener');
    } catch {}
  }, []);
  const appendToToday = useCallback(async (text) => {
    const r = getOrCreateDailyNote();
    if (!r) return;
    const cur = getContent(r.id).toString();
    const base = cur.replace(/\s+$/, '');
    const sep = /\n\s*[-*] [^\n]*$/.test(base) ? '\n' : '\n\n';
    updateNoteContentById(r.id, `${base}${sep}- ${String(text).trim()}\n`);
  }, [getOrCreateDailyNote, updateNoteContentById]);

  // «Base de datos»: una nota con una tabla tipada (vista tabla).
  const newDatabaseFile = useCallback(() => {
    if (isViewer) return;
    const title = t('home.db.title');
    const cols = [t('home.db.colName'), t('home.db.colStatus'), t('home.db.colDate')];
    let body = `# ${title}\n\n` + tplTable(cols, [['', '', '']]) + '\n';
    body = setTableColumnTypeInSource(body, 0, cols[1], { type: 'status', options: [t('home.db.st1'), t('home.db.st2'), t('home.db.st3')] });
    body = setTableColumnTypeInSource(body, 0, cols[2], { type: 'date' });
    const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const meta = { id, name: title + '.md', vaultId: activeVault, size: '0.0 KB', nameLocked: false, kind: 'database' };
    pendingCreatedNoteIdsRef.current.add(id);
    const ve = getVaultDoc(activeVault);
    if (ve && ve.yFiles) ve.yFiles.set(id, meta); else yFiles.set(id, meta);
    seedNoteContent(id, body);
    setActiveId(id);
    setMode('render');
  }, [isViewer, activeVault, setActiveId]);

  // Marca como hecha una tarea con fecha desde Inicio (cambia `[ ]` → `[x]`).
  const completeTask = useCallback((ev) => {
    if (!ev || !ev.noteId || isViewer) return;
    const src = getContent(ev.noteId).toString();
    const lines = src.split('\n');
    let i = ev.anchor && Number.isFinite(ev.anchor.line) ? ev.anchor.line : -1;
    const snip = ev.anchor && ev.anchor.snippet;
    if (!(i >= 0 && lines[i] != null && (!snip || lines[i].trim().slice(0, 160) === snip))) {
      i = snip ? lines.findIndex(l => l.trim().slice(0, 160) === snip) : -1;
    }
    if (i < 0 || !/^\s*[-*]\s+\[ \]/.test(lines[i])) return;
    lines[i] = lines[i].replace(/^(\s*[-*]\s+\[) \]/, '$1x]');
    updateNoteContentById(ev.noteId, lines.join('\n'));
  }, [isViewer, updateNoteContentById]);

  const openAgentTask = useCallback((task) => {
    if (!task) return;
    if (task.noteId) setActiveId(task.noteId);
    setCtxTab('comments');   // la tarea de un agente es un hilo de comentarios de la nota
    setCtxPanelOpen(true);
  }, [setActiveId, setCtxPanelOpen]);

  const toggleThemeLightDark = useCallback(() => {
    setThemeKey(theme.dark ? 'edinot' : 'edinotDark');
  }, [theme, setThemeKey]);

  // Al abrir Ctrl K: precalienta la caché de plegado por trozos y pide el
  // texto extraído de los adjuntos (lo que hacía el antiguo buscador global).
  const paletteWarmup = useCallback((onAttachLoaded) => {
    let cancelled = false;
    const list = filesRef.current || [];
    let i = 0;
    const slice = () => {
      if (cancelled) return;
      const t0 = performance.now();
      while (i < list.length && performance.now() - t0 < 6) gsFoldedSearchable(list[i++]);
      if (i < list.length) schedule();
    };
    const schedule = () => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(slice, { timeout: 200 });
      else setTimeout(slice, 16);
    };
    // Con el índice en worker listo el hilo principal no pliega nada: sólo
    // hace falta el plegado local como respaldo si el índice no está.
    if (!searchIndex.ready) schedule();
    const cfg = syncCfgRef.current;
    if (cfg && cfg.httpUrl && cfg.token) {
      const allShas = new Set();
      for (const f of list) for (const sha of fileBlobShas(f)) {
        if (!__blobTextCache.has(sha) && !__blobTextNegative.has(sha)) allShas.add(sha);
      }
      const ids = [...allShas];
      if (ids.length) (async () => {
        for (let k = 0; k < ids.length && !cancelled; k += 500) {
          const chunk = ids.slice(k, k + 500);
          try {
            const r = await apiBlobTextBatch(cfg.httpUrl, cfg.token, chunk);
            if (cancelled) return;
            const seen = new Set();
            for (const row of (r.blobs || [])) {
              seen.add(row.id);
              if (row.text) setCachedBlobText(row.id, row.text); else __blobTextNegative.add(row.id);
            }
            for (const sha of chunk) if (!seen.has(sha)) __blobTextNegative.add(sha);
            onAttachLoaded && onAttachLoaded();
          } catch { return; }
        }
      })();
    }
    return () => { cancelled = true; };
  }, []);

  shellActsRef.current = {
    composeRootComment,
    openPalette: () => openPalette('all'),
    openDatabases: () => openPalette('db'),
    openTag: (tag) => openPalette('all', '#' + tag),
    openTable: (d) => { if (d && d.noteId) jumpToMatch(d.noteId, d.pos || 0); },
    goHome: () => { setCalendarOpen(false); setSettingsOpen(false); setAllOpen(false); setView('home'); },
    openAllNotes: (req) => { setCalendarOpen(false); setSettingsOpen(false); setAllRequest({ ...(req || {}), seq: Date.now() + Math.random() }); setAllOpen(true); },
    openToday: (...a) => { setCalendarOpen(false); setSettingsOpen(false); setAllOpen(false); return openToday(...a); }, appendToToday,
    openCalendar: () => { setSettingsOpen(false); setAllOpen(false); setCalendarOpen(true); },
    openSettings: (tab) => { setCalendarOpen(false); setAllOpen(false); setSettingsInitialTab(tab || null); setSettingsOpen(true); },
    openNote: (id) => { setCalendarOpen(false); setSettingsOpen(false); setAllOpen(false); setActiveId(id); },
    jumpTo: (id, snippet) => jumpToMatch(id, 0, snippet || undefined),
    newNote: () => newFile(),
    newCanvas: () => newCanvasFile(),
    newDatabase: newDatabaseFile,
    newFolder: (vaultId, parentId) => newFolder(vaultId || activeVault, parentId || null),
    newNoteIn: (vaultId, folderId) => (folderId ? newFileInFolder(vaultId || activeVault, folderId) : newFile()),
    newCanvasIn: (vaultId, folderId) => { const id = createCanvasNote(folderId || null, true); setActiveId(id); setMode('render'); },
    importFiles,
    renameFile, duplicateFile, deleteFile, setFileIcon, togglePin,
    openTrash: () => setTrashOpen(true),
    setDefault: (id) => { try { yMeta.set('defaultNoteId', defaultNoteId === id ? null : id); } catch {} },
    saveAsTemplate,
    moveToFolder: moveFileToFolder,
    moveToVault: (id, vaultId) => moveFile(id, vaultId, null),
    shareNote: (id) => { if (id !== activeId) setActiveId(id); setShareNoteOpen(true); },
    renameFolder, deleteFolder, setFolderIcon,
    shareFolder: (fd) => setShareFolder(fd),
    shareVault: (v) => setShareVault(v),
    dropOnFolder: handleDropOnFolder,
    dropOnVault: handleDropOnVault,
    applyTemplate: openApplyTemplate,
    unmarkTemplate, newBlankTemplate,
    seedTemplates: () => { seedTemplates(); },
    missingTemplateSeeds: () => missingTemplateSeeds(),
    importExternal, closeExternal,
    switchWorkspace: (wsId) => {
      const cfg = syncConfigState;
      if (!cfg || wsId === cfg.currentWorkspaceId) return;
      updateSyncConfig({ ...cfg, currentWorkspaceId: wsId });
    },
    switchVault: (vid) => {
      if (vid === activeVault) return;
      setActiveVault(vid);
      // Abre la nota más reciente de ese vault (o se queda en Inicio).
      const st = yMeta.get('fileStats') || {};
      const inV = filesMeta.filter(f => (f.vaultId || 'default') === vid && !tplFolderIdSet.has(f.folderId));
      inV.sort((a, b) => ((st[b.id] || {}).t || 0) - ((st[a.id] || {}).t || 0));
      if (inV[0] && view !== 'home') setActiveId(inV[0].id);
    },
    openAgentTask,
    completeTask,
    setMode, toggleSidebar,
    togglePanel: () => setCtxPanelOpen(v => !v),
    toggleTheme: toggleThemeLightDark,
    exportNote: doExportNote,
    history: () => setHistoryOpen(true),
    share: () => setShareNoteOpen(true),
    openComments: () => setAiCommentsOpen(true),
    rename: () => beginTitleEdit(),
    floatOpen: (m) => window.electronAPI && window.electronAPI.floatOpen && window.electronAPI.floatOpen(m),
    fromTemplate: () => openPalette('commands'),
  };

  const activeIsPinned = !!(active && active.pinned);
  const paletteCommands = useMemo(() => {
    if (!palette) return [];
    const A = shellActions;
    const base = buildCommands({
      isMac: isMacOS, dark: !!theme.dark,
      canEdit: !isViewer, hasNote: !!active && view !== 'home',
      canEditNote: !!active && !isViewer && !activeNoteReadOnly,
      canShare: !!active && !isExternalId(active.id),
      canHistory: !!active && !isExternalId(active.id),
      canExport: !!active && !isExternalId(active.id) && !!(window.electronAPI && window.electronAPI.noteExport),
      canFloat: !!(window.electronAPI && window.electronAPI.floatOpen),
      canImport: !!(window.electronAPI && window.electronAPI.openImportDialog),
      isCanvas: vmIsCanvasNote(active),
      isPinned: activeIsPinned, hasTemplates: false,
      newNote: A.newNote, newCanvas: A.newCanvas, newDatabase: A.newDatabase,
      surface: activeSurface, setSurface: (s) => switchSurfaceRef.current(s),
      newFolder: () => A.newFolder(activeVault, null),
      openToday: A.openToday, goHome: A.goHome, openCalendar: A.openCalendar,
      openSettings: () => A.openSettings(), toggleTheme: A.toggleTheme,
      toggleSidebar: A.toggleSidebar, togglePanel: A.togglePanel, importFiles: A.importFiles,
      setMode: A.setMode, share: A.share, history: A.history, openComments: A.openComments,
      togglePin: () => active && A.togglePin(active.id), rename: A.rename,
      exportNote: A.exportNote, floatOpen: A.floatOpen,
    });
    // Plantillas del vault como comandos («Nueva nota desde plantilla: …»).
    for (const tp of activeVaultTemplates) {
      base.push({ id: 'tpl:' + tp.id, label: t('cmd.fromTemplateNamed', { name: splitExt(tp.name).base }), icon: 'template', keywords: 'plantilla template', run: () => A.applyTemplate(tp) });
    }
    return base;
  }, [palette, isMacOS, theme, isViewer, active && active.id, view, activeNoteReadOnly, activeIsPinned, activeSurface, activeVault, activeVaultTemplates, shellActions]);

  // Menú ⋯ de la barra superior: todo lo que antes vivía en las píldoras
  // «Acciones» e «Info» del titlebar.
  const buildMoreMenuItems = () => {
    if (!active) return [];
    const ext = isExternalId(active.id);
    const isCanvasNote = vmIsCanvasNote(active);
    const canEditNote = !isViewer && !activeNoteReadOnly;
    const isTpl = isTemplateFile(active, folders);
    const items = [];
    if (!ext) items.push({ label: t('tb.share'), icon: 'share', kbd: kbdHint('share', isMacOS), onSelect: () => setShareNoteOpen(true) });
    items.push({ label: activeIsPinned ? t('shell.fav.remove') : t('shell.fav.add'), icon: 'star', onSelect: () => togglePin(active.id) });
    if (window.electronAPI && window.electronAPI.floatOpen) {
      if (!isCanvasNote) items.push({ label: t('tb.present'), icon: 'present', onSelect: () => window.electronAPI.floatOpen('present') });
      items.push({ label: t('tb.quicknote'), icon: 'quick', onSelect: () => window.electronAPI.floatOpen('note') });
    }
    if (!ext && window.electronAPI && window.electronAPI.noteExport) {
      items.push({ label: t('shell.more.export'), icon: 'download', submenu: () => [
        { label: 'PDF', onSelect: () => doExportNote('pdf') },
        { label: 'Word (.docx)', onSelect: () => doExportNote('docx') },
        { label: 'HTML', onSelect: () => doExportNote('html') },
        { label: 'Markdown', onSelect: () => doExportNote('md') },
      ] });
    }
    if (!ext) items.push({ label: t('shell.more.history'), icon: 'history', kbd: kbdHint('history', isMacOS), onSelect: () => setHistoryOpen(true) });
    items.push({ type: 'sep' });
    if (!ext) items.push({ label: t('tb.comments') + (activeCommentsSummary.unresolved ? ` (${activeCommentsSummary.unresolved})` : ''), icon: 'comment', onSelect: () => setAiCommentsOpen(true) });
    if (!isCanvasNote) items.push({ label: t('shell.more.outline'), icon: 'link', hint: wikiNavCounts.total ? `${wikiNavCounts.outgoing}↗ ${wikiNavCounts.backlinks}↘` : null, onSelect: () => { setCtxTab('context'); setCtxPanelOpen(true); } });
    if (!ext && canEditNote) items.push({ label: t('cal.remFromSel'), icon: 'clock', onSelect: () => createReminderForNote(active) });
    if (!ext && canEditNote) {
      items.push({ type: 'sep' });
      if (isTpl) {
        items.push({ label: t('shell.more.useTemplate'), icon: 'template', onSelect: () => openApplyTemplate(active) });
        items.push({ label: tplBuilderClosed ? t('shell.more.showTplBuilder') : t('shell.more.hideTplBuilder'), icon: 'template', kbd: kbdHint('tplBuilder', isMacOS), onSelect: () => setTplBuilderClosed(v => !v) });
        items.push({ label: t('tpl.convertNote'), icon: 'note', onSelect: () => unmarkTemplate(active.id) });
      } else {
        items.push({ label: t('tree.saveAsTemplate'), icon: 'template', onSelect: () => saveAsTemplate(active.id) });
      }
      items.push({ label: defaultNoteId === active.id ? t('row.unsetDefault') : t('row.setDefault'), icon: 'home', onSelect: () => { try { yMeta.set('defaultNoteId', defaultNoteId === active.id ? null : active.id); } catch {} } });
      items.push({ type: 'sep' });
      items.push({ label: t('btn.rename'), icon: 'edit', onSelect: () => beginTitleEdit() });
      items.push({ label: t('btn.duplicate'), icon: 'copy', onSelect: () => duplicateFile(active.id) });
      items.push({ label: t('btn.delete'), icon: 'trash', danger: true, onSelect: () => deleteFile(active.id) });
    }
    if (ext) {
      items.push({ label: t('tree.importToActive'), icon: 'import', onSelect: () => importExternal(active.id) });
      items.push({ label: t('tree.closeExternal'), icon: 'close', onSelect: () => closeExternal(active.id) });
    }
    return items;
  };

  // Pestaña «Comentarios» del panel de contexto (antes, un modal).
  const commentsSlot = (active && aiCommentsOpen) ? (() => {
        const list = readNoteComments(ydoc, active.id);
        const visible = aiCommentsShowResolved ? list : list.filter(c => !c.resolved);
        const resolve = (id) => {
          patchComment(ydoc, id, { resolved: true, resolvedAt: new Date().toISOString() });
        };
        const remove = (id) => {
          // Cascade: also remove any threaded descendants of this comment.
          const all = readNoteComments(ydoc, active.id);
          const targets = new Set([id]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const c of all) {
              if (c.parentId && targets.has(c.parentId) && !targets.has(c.id)) {
                targets.add(c.id);
                changed = true;
              }
            }
          }
          deleteComments(ydoc, Array.from(targets));
        };
        // Quick-reply for the legacy `replies[]` inline model (questions).
        const reply = (id, text) => {
          if (!text || !text.trim()) return;
          addCommentReply(ydoc, id, { text: text.trim(), author: 'user' });
        };
        // Threaded reply — pushes a new top-level comment with parentId
        // pointing at the comment being replied to.
        const postReply = (parentId, text) => {
          if (!text || !text.trim()) return;
          const all = readNoteComments(ydoc, active.id);
          const myEmail = (syncConfigState && syncConfigState.email) || 'user';
          const rec = {
            id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
            noteId: active.id,
            kind: 'note',
            parentId,
            text: text.trim(),
            anchorText: null,
            author: myEmail,
            ts: new Date().toISOString(),
            resolved: false,
            replies: [],
            awaitingReply: false,
            mentions: (text.match(/@[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).map(s => s.slice(1).toLowerCase()),
          };
          const updated = [...all, rec];
          putComment(ydoc, rec);
          const explicit = enqueueAgentTasksForComment(rec, rec.text);
          if (!explicit.length) enqueueAgentContinuationForReply(rec, updated);
          // Fire-and-forget mention notifications to each mentioned
          // email — server gates them to workspace members so a bad
          // email or external user produces a 403/404 we just swallow.
          const wsId = syncConfigState && syncConfigState.currentWorkspaceId;
          const canNotify = wsId && syncConfigState && syncConfigState.httpUrl && syncConfigState.token;
          if (canNotify && rec.mentions && rec.mentions.length) {
            for (const email of rec.mentions) {
              apiDispatchNotif(syncConfigState.httpUrl, syncConfigState.token, {
                email, workspaceId: wsId, kind: 'mention',
                payload: { noteId: active.id, noteName: active.name, commentId: rec.id, preview: rec.text.slice(0, 160) },
              }).catch(() => {});
            }
          }
          // Notify the original thread author (and any prior
          // human-author in the chain) that someone replied. Skip self
          // and skip emails we already notified via @mention to avoid
          // duplicate pings.
          if (canNotify) {
            const rootId = commentThreadRootId(rec, updated) || parentId;
            const chain = collectCommentThread(updated, rootId);
            const notified = new Set([myEmail.toLowerCase(), ...(rec.mentions || []).map(s => String(s).toLowerCase())]);
            const targets = new Set();
            for (const c of chain) {
              if (c.id === rec.id) continue;
              const author = String(c.author || '').toLowerCase().replace(/^@/, '');
              if (!author || author === 'user' || author === 'me' || author === 'ai' || author === 'sistema') continue;
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author)) continue;
              if (notified.has(author)) continue;
              targets.add(author);
            }
            for (const email of targets) {
              apiDispatchNotif(syncConfigState.httpUrl, syncConfigState.token, {
                email, workspaceId: wsId, kind: 'reply',
                payload: {
                  noteId: active.id,
                  noteName: active.name,
                  commentId: rec.id,
                  threadRootId: rootId,
                  preview: rec.text.slice(0, 160),
                },
              }).catch(() => {});
            }
          }
        };

        // Build parent→children index so each top-level comment can
        // render its sub-thread inline. Only roots (parentId=null) go
        // through the top-level map.
        const byParent = new Map();
        for (const c of visible) {
          if (!c.parentId) continue;
          if (!byParent.has(c.parentId)) byParent.set(c.parentId, []);
          byParent.get(c.parentId).push(c);
        }
        const remoteRunningTasks = readAgentTasks(ydoc)
          .filter(t => t.noteId === active.id && ['running', 'pending', 'pending-offline'].includes(String(t.status || 'pending')));
        const remoteAliasesByRoot = new Map();
        for (const t of remoteRunningTasks) {
          const rid = t.threadRootId || t.commentId;
          if (!rid) continue;
          const set = remoteAliasesByRoot.get(rid) || new Set();
          if (t.targetAlias) set.add(String(t.targetAlias));
          remoteAliasesByRoot.set(rid, set);
        }
        const renderTree = (c, depth, threadRootId) => {
          const kids = byParent.get(c.id) || [];
          const rootId = threadRootId || c.id;
          const remoteAliases = Array.from(remoteAliasesByRoot.get(rootId) || []);
          const liveAliases = remoteAliases;
          return (
            <AiCommentItem key={c.id} comment={c} depth={depth}
              onResolve={() => resolve(c.id)}
              onDelete={() => remove(c.id)}
              onReply={(text) => reply(c.id, text)}
              onPostReply={(text) => postReply(c.id, text)}
              memberEmails={workspaceMemberEmails}
              aiAgents={knownAiAgents}
              onFocusAnchor={focusCommentAnchor}
              onOpenThread={!c.parentId ? () => setThreadRoot(c.id) : undefined}
              liveAliases={!c.parentId ? liveAliases : []}>
              {kids.map(k => renderTree(k, depth + 1, rootId))}
            </AiCommentItem>
          );
        };
        const roots = visible.filter(c => !c.parentId);
        // Count open comments including replies (mirror activeCommentsSummary):
        // a reply belongs to an open thread while its root is unresolved.
        const byIdAll = new Map(list.map(c => [c.id, c]));
        const resolvedRootIds = new Set(list.filter(c => !c.parentId && c.resolved).map(c => c.id));
        const rootIdOf = (c) => {
          let cur = c, guard = 0;
          while (cur && cur.parentId && byIdAll.has(cur.parentId) && guard++ < 60) cur = byIdAll.get(cur.parentId);
          return cur ? cur.id : c.id;
        };
        const unresolvedCount = list.filter(c => !resolvedRootIds.has(rootIdOf(c))).length;
        const resolvedCount = list.filter(c => c.resolved).length;

        return (
          <>
            <div className="ai-comments-panel ai-comments-inline" data-count={unresolvedCount}>
              <div className="ai-comments-head">
                <span className="ai-comments-glyph"><span className="ic">{I.comment}</span></span>
                <span className="ai-comments-title">
                  {t('cmt.panel.title')}
                  {active && active.name ? ` · ${active.name.replace(/\.(md|markdown|txt)$/i, '')}` : ''}
                </span>
                <span className="ai-comments-count">{unresolvedCount}</span>
                <button
                  className="ai-comments-add"
                  disabled={!canCommentActiveNote}
                  title={canCommentActiveNote ? t('cmt.panel.addTip.ok') : t('cmt.panel.addTip.noPerm')}
                  onClick={addCommentToActiveNote}>
                  <VIcon name="plus" />
                </button>
                {resolvedCount > 0 && (
                  <button
                    className={`ai-comments-toggle${aiCommentsShowResolved ? ' on' : ''}`}
                    title={aiCommentsShowResolved ? t('comments.hideResolved') : t('comments.showResolved', { n: resolvedCount })}
                    onClick={() => setAiCommentsShowResolved(v => !v)}>
                    <VIcon name="eye" />
                  </button>
                )}
              </div>
              <div className="ai-comments-body" ref={commentsBodyRef}>
                {!roots.length && (
                  <div className="ai-comments-empty">
                    {list.length
                      ? t('cmt.panel.empty.hasResolved')
                      : t('cmt.panel.empty.none')}
                  </div>
                )}
                {roots.map(r => renderTree(r, 0))}
              </div>
              {canCommentActiveNote && (
                <ChatComposer
                  placeholder={t('cmt.panel.composer.ph')}
                  memberEmails={workspaceMemberEmails}
                  aiAgents={knownAiAgents}
                  onSend={composeRootComment} />
              )}
            </div>
          </>
        );
        })() : null;

  // Props estables para las piezas memo del shell (ver useStableCallback).
  const onCancelTitleEditStable = useStableCallback(() => setTitleEditing(false));
  const onBeginTitleEditStable = useStableCallback(beginTitleEdit);
  const onCommitTitleStable = useStableCallback(commitTitle);
  const onShareNoteStable = useStableCallback(() => setShareNoteOpen(true));
  const onTogglePanelStable = useStableCallback(() => setCtxPanelOpen(v => !v));
  const onSurfaceStable = useStableCallback((next) => switchSurfaceRef.current(next));
  const buildMoreMenuItemsStable = useStableCallback(buildMoreMenuItems);
  const onOpenWorkspaceStable = useStableCallback((wsId) => {
    const ws = (syncConfigState && syncConfigState.workspaces || []).find(w => w.id === wsId);
    if (ws) updateSyncConfig({ ...syncConfigState, currentWorkspaceId: wsId });
  });
  const bellEl = useMemo(
    () => <NotificationsBell syncConfig={syncConfigState} onOpenWorkspace={onOpenWorkspaceStable} />,
    [syncConfigState, onOpenWorkspaceStable],
  );
  // La barra de bloques lee sus acciones en el momento de usarlas: un proxy
  // estable sobre las del último render le permite ser memo.
  const blockUiActionsRef = useRef(null);
  blockUiActionsRef.current = blockUiActions;
  const blockUiActionsStable = useMemo(() => new Proxy({}, {
    get: (_, k) => (blockUiActionsRef.current ? blockUiActionsRef.current[k] : undefined),
    has: (_, k) => !!blockUiActionsRef.current && k in blockUiActionsRef.current,
  }), []);

  return (
    <div className={`macwin${dark ? ' dark' : ''}${isMacOS ? ' is-mac' : ' is-non-mac'}${isWindows ? ' is-win' : ''}${mode === 'dual' ? ' mode-dual' : ''}${showingPrimaryCanvas ? ' mode-canvas' : ''}${isViewer ? ' is-viewer' : ''}${view !== 'home' && !onCalendarPage && !onSettingsPage && !onAllPage && active && ctxPanelOpen && !showingPrimaryCanvas ? ' ctx-open' : ''}${sideRail ? ' side-rail' : ''}${settings.compactUi ? ' ui-compact' : ''}${reduceMotion ? ' reduce-motion' : ''}`} style={cssVars}>
      {/* Boot veil: covers the tree until local hydration lands (see the
          whenIndexedDbReady boot effect). Takes over seamlessly from the
          static .boot-splash markup that index.html paints pre-React. */}
      {!bootVeilGone && (
        <div className={`boot-veil${booted ? ' off' : ''}`}>
          <div className="boot-mark">Edinot</div>
        </div>
      )}
      <div className="shell">
        <Sidebar
          collapsed={sideRail}
          compact={!!settings.compactUi}
          onToggleCollapsed={toggleSidebar}
          routeView={routeView}
          isMac={isMacOS}
          workspace={shellWorkspace}
          vaults={vaults}
          activeVault={activeVault}
          activeId={activeId}
          filesMeta={filesMeta}
          folders={folders}
          templateFolderIds={tplFolderIdSet}
          canvasIds={canvasIdSet}
          favorites={favoriteFiles}
          databases={tableEntries}
          tags={tagList}
          externalFiles={externalFiles}
          todayLabel={todayShortLabel}
          dueCount={dueReminderCount}
          agentTasks={pendingAgentTasks}
          knownAgents={sidebarAgents}
          syncStatus={(syncConfigState && syncConfigState.token && !syncConfigState.hub) ? syncStatus : 'idle'}
          loggedIn={!!(syncConfigState && syncConfigState.token && !syncConfigState.hub)}
          defaultNoteId={defaultNoteId}
          readOnly={isViewer}
          isWorkspaceOwner={isWorkspaceOwner}
          updateState={updateState}
          actions={shellActions} />
        <div className="shell-main">
          <Topbar
            view={onSettingsPage ? 'settings' : onCalendarPage ? 'calendar' : (view === 'home' || onAllPage) ? 'home' : 'note'}
            isMac={isMacOS}
            platform={platform}
            sidebarCollapsed={sideRail}
            onToggleSidebar={onSettingsPage ? null : toggleSidebar}
            canGoBack={navHistoryLen > 0}
            canGoForward={navForwardLen > 0}
            onBack={goBack}
            onForward={goForward}
            crumbs={onSettingsPage || onCalendarPage || onAllPage ? EMPTY_CRUMBS : topCrumbs}
            title={onSettingsPage || onCalendarPage ? '' : onAllPage ? t('shell.nav.all') : view === 'home' ? t('shell.nav.home') : (active ? splitExt(active.name).base : (activeId ? t('title.loadingNote') : t('shell.untitled')))}
            titleLoading={view !== 'home' && !onCalendarPage && !onSettingsPage && !onAllPage && !active && !!activeId}
            editableTitle={view !== 'home' && !onCalendarPage && !onSettingsPage && !onAllPage && !!active && !isViewer && !activeNoteReadOnly}
            titleEditing={titleEditing}
            titleDraft={titleDraft}
            setTitleDraft={setTitleDraft}
            onBeginTitleEdit={onBeginTitleEditStable}
            onCommitTitle={onCommitTitleStable}
            onCancelTitleEdit={onCancelTitleEditStable}
            titleInputRef={titleInputRef}
            saveLabel={active ? topSaveLabel : null}
            mode={mode}
            setMode={setMode}
            modeDisabled={isViewer || activeNoteReadOnly}
            showMode={!showingPrimaryCanvas}
            surface={activeSurface}
            onSurface={active && !isExternalId(active.id) ? onSurfaceStable : null}
            presence={presence}
            canShare={!!active && !isExternalId(active.id)}
            onShare={onShareNoteStable}
            getMoreItems={active ? buildMoreMenuItemsStable : null}
            bell={bellEl}
            showPanelToggle={view !== 'home' && !onCalendarPage && !onSettingsPage && !onAllPage && !!active && !showingPrimaryCanvas}
            panelOpen={ctxPanelOpen}
            onTogglePanel={onTogglePanelStable} />
          <div className="shell-content">
            {onSettingsPage && (
              <SettingsPage
                initialTab={settingsInitialTab}
                onClose={closeSettings}
                settings={settings} setSettings={setSettings}
                vaults={vaults} setVaults={setVaults}
                activeVault={activeVault} setActiveVault={setActiveVault}
                files={files} setFiles={setFiles}
                syncConfig={syncConfigState} setSyncConfig={updateSyncConfig}
                syncStatus={syncStatus}
                themeKey={themeKeyRaw} effectiveThemeKey={themeKey} setThemeKey={setThemeKey}
                knownAiAgents={knownAiAgents}
                aiAgents={aiAgents}
                onGoogleSync={googleSync}
                onOpenAudit={(wsId) => { closeSettings(); setAuditWorkspaceId(wsId); }} />
            )}
            {onCalendarPage && (
              <CalendarPage
                vaults={vaults}
                vaultIds={homeVaultIds}
                activeVault={activeVault}
                version={allDocsV}
                notes={homeFiles}
                readOnly={isViewer}
                initialDraft={calendarDraft}
                onDraftConsumed={clearCalendarDraft}
                onJump={calendarJump}
                onOpenDaily={calendarOpenDaily}
                onWriteNote={updateNoteContentById}
                onOpenSettings={shellActions.openSettings}
                onOpenExternal={openExternalUrl} />
            )}
            {onAllPage && (
              <AllNotesPage
                vaultId={activeVault}
                notes={homeFiles}
                folders={folders}
                templateFolderIds={tplFolderIdSet}
                tags={tagList}
                canvasIds={canvasIdSet}
                dbIds={dbNoteIds}
                fileStats={yMeta.get('fileStats') || EMPTY_FILE_STATS}
                editLog={editLogList}
                editStamps={lastEditRef.current}
                getText={getContentString}
                activeId={activeId}
                readOnly={isViewer}
                request={allRequest}
                actions={shellActions} />
            )}
            {view === 'home' && !onCalendarPage && !onSettingsPage && !onAllPage && (
              <HomePage
                vaultIds={homeVaultIds}
                eventsVersion={allDocsV}
                filesMeta={homeFiles}
                fileStats={yMeta.get('fileStats') || EMPTY_FILE_STATS}
                canvasIds={canvasIdSet}
                dbIds={dbNoteIds}
                editLog={homeEditLog}
                notesById={homeNotesById}
                vaultName={vaults.length > 1 ? ((vaults.find(v => v.id === activeVault) || {}).name || '') : ''}
                today={homeToday}
                todayName={dailyNoteName()}
                templates={activeVaultTemplates}
                readOnly={isViewer}
                syncServer={!!(syncConfigState && syncConfigState.token && !syncConfigState.hub)}
                actions={shellActions} />
            )}
      <div className={`body${view === 'home' || onCalendarPage || onSettingsPage || onAllPage ? ' shell-hidden' : ''}`}>
        <FormatToolbar onAction={action} theme={theme} hidden={mode === 'render' || mode === 'live' || isViewer} entering={enteringRef.current} onUndo={doUndo} onRedo={doRedo} onInsertText={(text) => cmViewRef.current && insertAtCursorCM(cmViewRef.current, text)}
          onReminderFromSelection={createReminderFromSelection}
          canvases={canvasNotes} onCreateAndEmbedCanvas={createAndEmbedCanvas} />
        {active && isTemplateFile(active, folders) && !tplBuilderClosed && (
          <TemplateBuilderPanel
            active={active}
            content={active.content || ''}
            folders={folders}
            cmViewRef={cmViewRef}
            askPrompt={askPrompt}
            askConfirm={askConfirm}
            onRenameVar={renameTemplateVar}
            onShowPreview={(c) => setTplPreviewState({ content: c })}
            onClose={() => setTplBuilderClosed(true)} />
        )}

        {(() => {
          const editorPane = active ? (
            <CodeMirrorEditor
              key={active.id + '::' + (getNoteAwareness(active.id) ? 'note' : 'shell') + '::' + activeSurface}
              ytext={activeContentText}
              awareness={isExternalId(active.id) ? null : (getNoteAwareness(active.id) || awareness)}
              fontFamily={mode === 'live' ? 'var(--font-ui)' : fontFamily}
              fontSize={mode === 'live' ? settings.fontSize + 1 : settings.fontSize}
              pageMeta={mode === 'live' ? livePageMeta : null}
              vimMode={!!settings.vim}
              spellcheck={settings.spellcheck !== false}
              onPasteImage={insertImageFromFile}
              onSelectionChange={({ from, to }) => {
                if (!active) return;
                if (from === to) {
                  const cur = yMeta.get('editorSelection');
                  if (cur && cur.fileId === active.id) yMeta.delete('editorSelection');
                  setCommentFab(null);
                  return;
                }
                yMeta.set('editorSelection', { fileId: active.id, from, to });
                if (!canCommentActiveNote) { setCommentFab(null); return; }
                requestAnimationFrame(() => {
                  const v = cmViewRef.current;
                  if (!v) return;
                  try {
                    const c = v.coordsAtPos(to);
                    if (!c) return;
                    setCommentFab({ x: Math.round(c.right + 6), y: Math.round(c.top - 28) });
                  } catch { setCommentFab(null); }
                });
              }}
              viewRef={cmViewRef}
              focusOnMount={mode === 'markdown' || mode === 'live'}
              livePreview={mode === 'live'}
              hideOwnCanvas={mode === 'live' && activeSurface === 'page'}
              renderMdRef={renderMdRef}
              liveTableCtxRef={liveTableCtxRef}
              undoManager={activeUndoManager}
              readOnly={isViewer || activeNoteReadOnly}
              wikiTargets={Object.assign(() => {
                let list;
                try { list = getAllFilesAcrossVaults(); } catch { list = files; }
                return (list || files || []).map(f => (f.name || '').replace(/\.(md|markdown|txt)$/i, '')).filter(Boolean);
              }, {
                // Contenido de una nota por nombre (títulos para [[Nota#…).
                contentOf: (name) => {
                  let list;
                  try { list = getAllFilesAcrossVaults(); } catch { list = files; }
                  const norm = normalizeNoteName(name);
                  const f = (list || files || []).find(x => normalizeNoteName(x.name) === norm);
                  return f ? String(f.content || '') : null;
                },
              })}
            />
          ) : <div className="md-editor-empty">Sin nota seleccionada</div>;

          const canvasBlock = activeCanvasBlock;
          const canvasPrimary = activeCanvasPrimary;
          const canvasPane = canvasPrimary ? (
            <CanvasView
              key={active.id}
              json={(CANVAS_STRUCTURED && structuredCanvasJson) ? structuredCanvasJson : canvasBlock.json}
              notes={files}
              vaults={vaults}
              activeNoteId={active.id}
              syncConfig={syncConfigState}
              onChange={(updater) => {
                if (!active) return;
                // Structured path: apply the desired snapshot to the Yjs types
                // (granular, co-edition-safe). The mirror effect regenerates the
                // fence. Falls back to the legacy text rewrite until migrated.
                if (CANVAS_STRUCTURED && isCanvasMigrated(active.id)) {
                  const prev = readCanvasSnapshot(active.id);
                  const next = typeof updater === 'function' ? updater(prev) : updater;
                  applyCanvasSnapshot(active.id, next);
                  return;
                }
                mutateActiveSource(src => {
                  const cur = firstCanvasBlock(src);
                  if (!cur) return null;
                  const next = typeof updater === 'function' ? updater(cur.json) : updater;
                  return writeCanvasBlock(src, next, cur);
                });
              }}
              onOpenNote={setActiveId}
              onUploadAttachment={uploadCanvasAttachment}
              onUpdateNoteContent={updateNoteContentById}
              onCreateReminder={createReminderForNote}
              askPrompt={askPrompt}
              askConfirm={askConfirm}
              pageTitle={splitExt(active.name || '').base}
              renderPage={renderPageBlock}
              pageSource={pageSourceForFind}
              // La entrada animada, sólo para el canvas que se monta justo después de
              // cambiar (el canvas la marca como usada; el módulo puede tardar en cargar).
              intro={surfaceIntroRef.current && surfaceIntroRef.current.noteId === active.id && !surfaceIntroRef.current.used && Date.now() - surfaceIntroRef.current.at < 3000 ? surfaceIntroRef.current : null}
              transitionRef={canvasTransitionRef}
            />
          ) : null;

          const renderPane = canvasPane || (
            <div className="md-render"
              ref={renderRef}
              style={{ fontSize: settings.fontSize + 1, lineHeight: 1.65 }}
              onDoubleClick={(e) => {
                // Doble clic en el texto (fuera de tablas, enlaces, adjuntos,
                // canvas, formularios y cabecera) → «Editar» con el cursor ahí.
                if (!active) return;
                const tgt = e.target;
                if (isViewer || activeNoteReadOnly || !tgt.closest) return;
                if (tgt.closest('table, a, button, input, select, textarea, summary, .md-attach-wrap, .md-attach-card, .md-canvas-host, .md-canvas-embed-host, .md-form-host, .db-mount, .blk-page-head, .blk-props, .md-codewrap')) return;
                const blockEl = tgt.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, .md-callout-body, .md-toggle-body');
                if (!blockEl) return;
                pendingCaretRef.current = { word: String(window.getSelection ? window.getSelection() : '').trim(), context: blockEl.textContent || '' };
                setMode('live');
              }}
              onContextMenu={(e) => {
                // Right-click on any rendered blob → remove from current note
                // (and the server, via the reconciler). We look up the SHA on
                // every plausible carrier: <img>/<video>/<audio>/<iframe>/<a>.
                const el = e.target.closest && e.target.closest('[src*="edinot://blob/"], [href*="edinot://blob/"], [data-attach-sha]');
                if (!el || !active) return;
                let sha = el.getAttribute && el.getAttribute('data-attach-sha');
                if (!sha) {
                  const raw = (el.getAttribute('src') || el.getAttribute('href') || '');
                  const m = raw.match(/edinot:\/\/blob\/([a-f0-9]{64})/i);
                  sha = m ? m[1].toLowerCase() : null;
                }
                if (!sha) return;
                e.preventDefault();
                if (!window.confirm(t('attach.confirmDelete'))) return;
                const yt = activeContentText;
                if (!yt) return;
                const src = yt.toString();
                // Strip every markdown link/image whose URL contains this sha.
                const stripped = src.replace(new RegExp(`!?\\[[^\\]\\n]*\\]\\(edinot:\\/\\/blob\\/${sha}[^)]*\\)`, 'gi'), '');
                applyTextDiff(yt, stripped);
                // Reconciler debounce is 1.5s — fire DELETE immediately for snappy feedback.
                const cfg = syncCfgRef.current;
                if (cfg && cfg.httpUrl && cfg.token) {
                  apiDeleteBlob(cfg.httpUrl, cfg.token, sha).catch(() => {});
                }
              }}
              onMouseOver={(e) => {
                // Vista previa de la nota al pie al pasar el ratón (title perezoso).
                const a = e.target && e.target.closest && e.target.closest('.footnote-ref a');
                if (!a || a.title || !renderRef.current) return;
                const id = (a.getAttribute('href') || '').slice(1);
                const li = id && renderRef.current.querySelector(`[id="${CSS.escape(id)}"]`);
                if (li) a.title = (li.textContent || '').replace(/↩︎?/g, '').trim().slice(0, 400);
              }}
              onClick={(e) => {
                const tgt = e.target;
                if (!tgt) return;

                // Notas al pie: [^1] ↔ su definición, dentro de ESTA vista
                // (los id #fn1 se repiten entre ventanas/notas).
                const fnA = tgt.closest && tgt.closest('.footnote-ref a, a.footnote-backref');
                if (fnA && renderRef.current) {
                  e.preventDefault();
                  const id = (fnA.getAttribute('href') || '').slice(1);
                  const dest = id && renderRef.current.querySelector(`[id="${CSS.escape(id)}"]`);
                  if (dest) {
                    dest.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    dest.classList.add('md-fn-flash');
                    setTimeout(() => dest.classList.remove('md-fn-flash'), 1200);
                  }
                  return;
                }

                // Copy code block (📋 button on top-right of every rendered
                // <pre> in render mode).
                const copyBtn = tgt.closest && tgt.closest('[data-code-copy]');
                if (copyBtn) {
                  e.preventDefault();
                  const wrap = copyBtn.closest('.md-codewrap');
                  const code = wrap && wrap.querySelector('pre > code');
                  if (!code) return;
                  const text = code.textContent || '';
                  try {
                    navigator.clipboard.writeText(text).then(() => {
                      const prev = copyBtn.textContent;
                      copyBtn.textContent = t('img.copied');
                      copyBtn.classList.add('on');
                      setTimeout(() => {
                        if (!copyBtn.isConnected) return;
                        copyBtn.textContent = prev || t('btn.copy');
                        copyBtn.classList.remove('on');
                      }, 1400);
                    });
                  } catch { /* clipboard may be unavailable; silent */ }
                  return;
                }

                // Checkbox toggle (rendered task list).
                if (tgt.matches && tgt.matches('input[type="checkbox"]') && tgt.closest('li.task-list-item')) {
                  e.preventDefault();
                  const all = Array.from(renderRef.current.querySelectorAll('li.task-list-item > input[type="checkbox"], li.task-list-item input[type="checkbox"]'));
                  const n = all.indexOf(tgt);
                  if (n >= 0 && active) {
                    mutateActiveSource(src => toggleNthChecklistInSource(src, n));
                  }
                  return;
                }

                // Attachment actions (↗ Abrir, 📥 Descargar). The button itself
                // doesn't carry the sha; we walk up to the nearest ancestor
                // that does. Falls back to looking at any sibling .md-attach-actions
                // for kinds that wrap actions inline (office/code).
                const actionBtn = tgt.closest && tgt.closest('[data-attach-action]');
                if (actionBtn) {
                  const carrier = actionBtn.closest('[data-attach-sha]');
                  const sha = carrier && carrier.getAttribute('data-attach-sha');
                  const name = carrier && (carrier.getAttribute('data-attach-name') || '');
                  if (sha && window.electronAPI) {
                    e.preventDefault();
                    const auth = syncCfgRef.current
                      ? { httpUrl: syncCfgRef.current.httpUrl, token: syncCfgRef.current.token }
                      : null;
                    const action = actionBtn.getAttribute('data-attach-action');
                    const handler = action === 'open'
                      ? window.electronAPI.openBlobWith
                      : window.electronAPI.saveBlobToFile;
                    if (handler) {
                      handler(sha, name, auth).then((res) => {
                        if (res && !res.canceled && !res.ok && res.error) {
                          window.alert(t(action === 'open' ? 'attach.openFail' : 'attach.saveFail', { err: res.error }));
                        }
                      }).catch((err) => window.alert(String(err.message || err)));
                    }
                    return;
                  }
                }

                if (tgt.tagName === 'IMG' && tgt.classList.contains('md-img-real')) {
                  // Carry the blob sha/name (when this is an edinot://blob
                  // attachment) so the lightbox can save through the native
                  // dialog instead of letting <a download> navigate the window.
                  const wrap = tgt.closest && tgt.closest('.md-attach-wrap');
                  const acts = wrap && wrap.querySelector('.md-attach-actions[data-attach-sha]');
                  const sha = acts ? (acts.getAttribute('data-attach-sha') || '') : '';
                  const name = acts ? (acts.getAttribute('data-attach-name') || '') : '';
                  const auth = syncCfgRef.current
                    ? { httpUrl: syncCfgRef.current.httpUrl, token: syncCfgRef.current.token }
                    : null;
                  setImageModal({ src: tgt.getAttribute('src'), sha, name, auth });
                  return;
                }
                const wikiEl = tgt.closest && tgt.closest('a.wikilink[data-wikilink]');
                if (wikiEl) {
                  e.preventDefault();
                  const toId = wikiEl.getAttribute('data-wikilink');
                  const anchor = wikiEl.getAttribute('data-anchor');
                  if (anchor) setAnchorReq({ noteId: toId || activeId, anchor, at: Date.now() });
                  if (toId && toId !== activeId) navigateTo(toId);
                  return;
                }
              }}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          );

          const hasFiles = (dt) => {
            if (!dt) return false;
            const types = dt.types;
            if (!types) return false;
            // `types` is an array-like in some browsers, a DOMStringList in
            // others. `Array.from` normalises both.
            return Array.from(types).some(t => t === 'Files' || t === 'application/x-moz-file');
          };
          const onDragEnter = (e) => {
            if (!hasFiles(e.dataTransfer)) return;
            e.preventDefault();
            dragDepthRef.current += 1;
            if (dragDepthRef.current === 1) setDragHover(true);
          };
          const onDragOver = (e) => {
            // Some Linux DEs fire dragover without dragenter, and some leave
            // `types` empty until drop — prevent default unconditionally so a
            // drop event always follows.
            e.preventDefault();
            if (e.dataTransfer && hasFiles(e.dataTransfer)) {
              e.dataTransfer.dropEffect = 'copy';
            }
          };
          const onDragLeave = (e) => {
            if (!hasFiles(e.dataTransfer)) return;
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setDragHover(false);
          };
          const clearDragHover = () => {
            dragDepthRef.current = 0;
            setDragHover(false);
          };
          const onDrop = (e) => {
            clearDragHover();
            const fs = Array.from(e.dataTransfer.files || []);
            if (!fs.length) return;
            // If CodeMirror's dom drop handler already consumed it, the event
            // is marked defaultPrevented — bail so we don't double-insert.
            if (e.defaultPrevented) return;
            e.preventDefault();
            if (mode === 'render') setMode('markdown');
            // Sequential upload preserves cursor order — parallel uploads
            // would race when replacing placeholders.
            (async () => { for (const f of fs) await attachFile(f); })();
          };

          const overlay = dragHover ? (
            <div className="drop-overlay" aria-hidden="true">
              <div className="drop-overlay-card">
                <span className="drop-overlay-icon">⬇</span>
                <span className="drop-overlay-text">
                  {mode === 'render'
                    ? 'Suelta para adjuntar — la nota cambiará a Markdown'
                    : 'Suelta donde quieras insertar el archivo'}
                </span>
              </div>
            </div>
          ) : null;

          if (mode === 'dual' && !showingPrimaryCanvas) {
            return (
              <div className="docwrap docwrap-dual"
                onDragEnter={onDragEnter}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}>
                <div className="docwrap-pane docwrap-pane-md">{editorPane}</div>
                <div className="docwrap-pane docwrap-pane-render">{renderPane}</div>
                {overlay}
              </div>
            );
          }
          return (
            <div className={`docwrap${showingPrimaryCanvas ? ' docwrap-canvas' : ''}`}
              style={canvasPane ? undefined : { maxWidth }}
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}>
              {readFind && !showingPrimaryCanvas && mode === 'render' && (
                <ReadFind key={active.id} focusKey={readFind.key} initial={readFind.initial || ''}
                  getRoot={getReadRoot} onClose={() => setReadFind(null)} />
              )}
              {!showingPrimaryCanvas && (mode === 'markdown' || mode === 'live') ? editorPane : renderPane}
              {!showingPrimaryCanvas && mode !== 'markdown' && <NoteBacklinks items={backlinkItems} onOpen={navigateTo} />}
              {overlay}
            </div>
          );
        })()}
        <input ref={fileInputRef} type="file" accept="image/*" multiple
               style={{ display: 'none' }}
               onChange={(e) => {
                 const files = Array.from(e.target.files || []);
                 files.forEach(insertImageFromFile);
                 e.target.value = '';
               }} />

        {settings.ruler && <div className="ruler" style={{ left: `calc(50% + ${maxWidth / 2 - 60}px)` }} />}
      </div>

            {view !== 'home' && !onCalendarPage && !onSettingsPage && !onAllPage && active && !ctxPanelOpen && !showingPrimaryCanvas && (
              <FloatingOutline content={activeContentDebounced} onJump={jumpToHeading} getActiveHeading={getActiveHeading} />
            )}
            {view !== 'home' && !onCalendarPage && !onSettingsPage && !onAllPage && active && ctxPanelOpen && !showingPrimaryCanvas && (
              <ContextPanel
                tab={ctxTab}
                setTab={setCtxTab}
                content={activeContentDebounced}
                isCanvas={!!activeCanvasPrimary}
                onJumpHeading={jumpToHeading}
                getActiveHeading={getActiveHeading}
                backlinks={backlinkItems}
                outgoingCount={wikiNavCounts.outgoing}
                onOpenNote={navigateTo}
                info={ctxInfo}
                commentsSlot={ctxTab === 'comments' ? commentsSlot : null}
                commentsCount={activeCommentsSummary.unresolved} />
            )}
          </div>
        </div>
      </div>

        {/* Editor de bloques: menú «/», asas, barra flotante, propiedades. */}
        <BlockUI getView={getCmView} actions={blockUiActionsStable} readOnly={isViewer || activeNoteReadOnly || !active} />
        <TrashModal open={trashOpen} version={trashV} actions={trashActions} onClose={() => setTrashOpen(false)}
          vaultName={(vid) => { const v = (vaults || []).find(x => x.id === vid); return v ? v.name : ''; }} />
        <ApplyTemplateModal state={applyTplState} vaults={vaults} folders={folders}
          onCancel={() => setApplyTplState(null)}
          onCreate={createFromTemplate} />
        <TemplatePreviewModal state={tplPreviewState} vaults={vaults} activeVault={activeVault}
          onClose={() => setTplPreviewState(null)} />
        <ReminderBanner
          state={activeReminder}
          onSnooze={(minutes) => {
            if (!activeReminder) return;
            const { id, item } = activeReminder;
            const until = new Date(Date.now() + minutes * 60000).toISOString();
            const fallback = { kind: 'reminder', title: item.title, start: item.fireAt ? new Date(item.fireAt).toISOString() : null, remindAt: item.fireAt ? new Date(item.fireAt).toISOString() : null, noteId: item.noteId, anchor: item.anchor };
            snoozeEvent(item.vaultId, id, until, fallback);
            try { window.electronAPI && window.electronAPI.remindersAction(id, 'snoozed', { until }); } catch {}
            setReminderQueue(q => q.filter(r => r.id !== id));
          }}
          onDismiss={() => {
            if (!activeReminder) return;
            const { id, item } = activeReminder;
            if (item && item.recurring) {
              // Whole-series v1: "Descartar" acknowledges just THIS occurrence,
              // never the series. The fired occurrence is past; re-syncing arms
              // the next one. (Deleting the series is done from the calendar.)
              setReminderResyncTick(t => t + 1);
              setReminderQueue(q => q.filter(r => r.id !== id));
              return;
            }
            const fallback = { kind: 'reminder', title: item.title, start: item.fireAt ? new Date(item.fireAt).toISOString() : null, remindAt: item.fireAt ? new Date(item.fireAt).toISOString() : null, noteId: item.noteId, anchor: item.anchor };
            dismissEvent(item.vaultId, id, fallback);
            try { window.electronAPI && window.electronAPI.remindersAction(id, 'dismiss'); } catch {}
            setReminderQueue(q => q.filter(r => r.id !== id));
          }}
          onClose={() => setReminderQueue(q => q.slice(1))} />
        <ReplyToasts />
        <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)}
          active={active} syncConfig={syncConfigState} isViewer={isViewer} />
        <VaultShareModal vault={shareVault} onClose={() => setShareVault(null)}
          syncConfig={syncConfigState} isOwner={isWorkspaceOwner} />
        <AuditModal workspaceId={auditWorkspaceId} onClose={() => setAuditWorkspaceId(null)}
          syncConfig={syncConfigState} />
        <NoteShareModal open={shareNoteOpen && !!active} onClose={() => setShareNoteOpen(false)}
          note={active} syncConfig={syncConfigState} />
        <FolderShareModal folder={shareFolder} onClose={() => setShareFolder(null)}
          syncConfig={syncConfigState} />
        <ConversationModal rootId={threadRoot} onClose={() => setThreadRoot(null)}
          noteId={active && active.id} memberEmails={workspaceMemberEmails}
          aiAgents={knownAiAgents}
          onPostReply={handleThreadModalReply} />
        {(workspaceMemberEmails.length > 0 || knownAiAgents.length > 0) && (
          <datalist id="mention-list">
            {workspaceMemberEmails.map(e => (
              <option key={e} value={'@' + e} />
            ))}
            {knownAiAgents.map(a => (
              <option key={'agent-' + a.alias} value={'@' + a.alias} label={`${a.kind || 'ai'} · ${a.online ? 'online' : 'offline'} · ${a.device || ''}`} />
            ))}
          </datalist>
        )}
        <PromptModal state={promptState} onResolve={handlePromptResolve} />
        <ConfirmModal state={confirmState} onResolve={handleConfirmResolve} />
      <CommandPalette
        open={!!palette}
        initialFilter={palette ? palette.filter : 'all'}
        initialQuery={palette ? palette.query || '' : ''}
        openedAt={palette ? palette.at : 0}
        tables={tableEntries}
        tagIndex={tagIndex}
        onOpenTable={(d) => jumpToMatch(d.noteId, d.pos || 0)}
        onClose={() => setPalette(null)}
        files={files}
        folders={folders}
        vaults={vaults}
        fileStats={yMeta.get('fileStats') || EMPTY_FILE_STATS}
        scopeVaultId={settings.searchAllVaults !== false ? null : activeVault}
        showVault={vaults.length > 1 && settings.searchAllVaults !== false}
        allVaults={settings.searchAllVaults !== false}
        search={PALETTE_SEARCH}
        commands={paletteCommands}
        onOpenNote={setActiveId}
        onJump={jumpToMatch}
        onCreateNote={newFile}
        canCreate={!isViewer}
        warmup={paletteWarmup} />

      {imageModal && (
        <ImageModal src={imageModal.src} sha={imageModal.sha} name={imageModal.name} auth={imageModal.auth}
          onClose={() => setImageModal(null)}
          onReplace={(newSrc) => { replaceImageSrc(imageModal.src, newSrc); setImageModal({ src: newSrc }); }} />
      )}
      {pdfModal && (
        <PdfModal src={pdfModal.src} name={pdfModal.name} onClose={() => setPdfModal(null)} />
      )}

      <FormBuilderModal
        state={formBuilder}
        activeId={active && active.id}
        activeContent={active && active.content}
        files={files}
        onClose={() => setFormBuilder(null)}
        onSave={(cfg, mode, blockIdx) => {
          if (!active) { setFormBuilder(null); return; }
          if (mode === 'edit' && Number.isFinite(blockIdx)) {
            mutateActiveSource(src => writeFormBlockConfig(src, blockIdx, cfg));
          } else {
            const anchor = formBuilder && Number.isFinite(formBuilder.anchorTableIdx) ? formBuilder.anchorTableIdx : 0;
            mutateActiveSource(src => insertFormBlockBeforeTable(src, anchor, cfg));
          }
          setFormBuilder(null);
        }} />

      {!updateDismissed && !settingsOpen && (updateState.state === 'available' || updateState.state === 'downloading' || updateState.state === 'downloaded') && (
        <div className="update-banner" role="status" aria-live="polite">
          <div className="update-banner-body">
            <span className="update-banner-icon"><span className="ic">{I.arrowUp}</span></span>
            <div className="update-banner-text">
              {updateState.state === 'available' && (
                <>
                  <strong>{updateState.info?.version ? t('upd.banner.availV', { v: updateState.info.version }) : t('upd.banner.avail')}</strong>
                  <span>{t('upd.banner.availSub')}</span>
                </>
              )}
              {updateState.state === 'downloading' && (
                <>
                  <strong>{t('upd.banner.dl')}</strong>
                  <span>
                    {updateState.progress
                      ? `${humanFileSize(updateState.progress.transferred)} / ${humanFileSize(updateState.progress.total)} · ${Math.round(updateState.progress.percent)}%`
                      : t('connect.toServer')}
                  </span>
                </>
              )}
              {updateState.state === 'downloaded' && (
                <>
                  <strong>{t('upd.banner.ready')}</strong>
                  <span>{t('upd.banner.restartSub')}</span>
                </>
              )}
            </div>
            <div className="update-banner-actions">
              {updateState.state === 'available' && (
                <button onClick={() => {
                  // Optimistic state flip — main may take a moment to emit
                  // the first `download-progress`, especially on Linux. Without
                  // this the user clicks once and sees nothing happen.
                  setUpdateState({ state: 'downloading', progress: null });
                  window.electronAPI.updateDownload();
                }}>{t('upd.banner.download')}</button>
              )}
              {updateState.state === 'downloading' && (
                <button disabled style={{ opacity: 0.6, cursor: 'wait' }}>{t('upd.banner.downloading')}</button>
              )}
              {updateState.state === 'downloaded' && (
                <button onClick={() => window.electronAPI.updateInstall()}>{t('upd.banner.restart')}</button>
              )}
              <button className="update-banner-close" onClick={() => setUpdateDismissed(true)} title={t('upd.banner.hide')}>×</button>
            </div>
          </div>
          {updateState.state === 'downloading' && (
            <div className={`update-banner-bar ${!updateState.progress ? 'indeterminate' : ''}`}>
              <div className="update-banner-fill" style={updateState.progress ? { width: `${Math.round(updateState.progress.percent)}%` } : undefined} />
            </div>
          )}
        </div>
      )}

      {uploads.length > 0 && (
        <div className="upload-stack">
          {uploads.map(u => {
            const pct = u.total ? Math.round((u.loaded / u.total) * 100) : 0;
            return (
              <div key={u.id} className={`upload-toast upload-${u.status}`}>
                <div className="upload-head">
                  <span className="upload-icon">
                    <VIcon name={u.status === 'done' ? 'check' : u.status === 'error' ? 'warn' : u.status === 'cancelled' ? 'close' : u.status === 'processing' ? 'refresh' : 'upload'} />
                  </span>
                  <span className="upload-name" title={u.filename}>{u.filename}</span>
                  {u.status === 'uploading' && (
                    <button className="upload-cancel" onClick={() => cancelUpload(u.id)} title={t('btn.cancel')}><VIcon name="close" /></button>
                  )}
                </div>
                {u.status === 'uploading' && (
                  <>
                    <div className="upload-bar"><div className="upload-fill" style={{ width: `${pct}%` }} /></div>
                    <div className="upload-meta">{humanFileSize(u.loaded)} / {humanFileSize(u.total)} · {pct}%</div>
                  </>
                )}
                {u.status === 'processing' && (
                  <>
                    <div className="upload-bar upload-bar-indeterminate"><div className="upload-fill" /></div>
                    <div className="upload-meta">{u.note || '…'}</div>
                  </>
                )}
                {u.status === 'done' && <div className="upload-meta">{u.note || t('upload.done', { size: humanFileSize(u.total) })}</div>}
                {u.status === 'error' && <div className="upload-meta upload-err">{u.error}</div>}
                {u.status === 'cancelled' && <div className="upload-meta">{t('upload.cancelled')}</div>}
              </div>
            );
          })}
        </div>
      )}

      <AiPeerChip />
      {isViewer && (
        <div className="viewer-banner" title={t('viewer.readonlyTip')}>
          <span className="viewer-banner-icon"><VIcon name="eye" /></span>
          <span className="viewer-banner-text">{t('viewer.readonly')}</span>
        </div>
      )}
      {!isViewer && activeNoteReadOnly && (
        <div className="viewer-banner" title={`ACL grant: ${activeNoteLevel}`}>
          <span className="viewer-banner-icon"><VIcon name={activeNoteLevel === 'comment' ? 'comment' : 'eye'} /></span>
          <span className="viewer-banner-text">
            {activeNoteLevel === 'comment' ? t('viewer.commentOnly') : t('viewer.readonlyGrant')}
          </span>
        </div>
      )}
      {commentFab && canCommentActiveNote && (mode === 'markdown' || mode === 'dual') && (
        <button
          className="comment-fab"
          style={{ left: commentFab.x, top: commentFab.y }}
          title={t('cmt.fab.tip')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { addCommentToActiveNote(); setCommentFab(null); }}>
          <span className="ic">{I.comment}</span>
          <span>{t('cmt.fab.label')}</span>
        </button>
      )}
      {commentDraft && (
        <CommentDraftModal
          anchorText={commentDraft.anchorText}
          memberEmails={workspaceMemberEmails}
          aiAgents={knownAiAgents}
          onCancel={() => setCommentDraft(null)}
          onSubmit={submitCommentDraft} />
      )}
      {anchorPopover && active && (() => {
        const list = readNoteComments(ydoc, active.id);
        const root = list.find(c => c.id === anchorPopover.commentId);
        if (!root) return null;
        const thread = collectCommentThread(list, root.id);
        const onReply = (text) => {
          const v = String(text || '').trim();
          if (!v) return;
          const author = (syncConfigState && syncConfigState.email) || 'me';
          const rec = {
            id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            noteId: active.id,
            kind: 'note',
            parentId: root.id,
            text: v,
            anchorText: null,
            author,
            ts: new Date().toISOString(),
            resolved: false,
            replies: [],
            awaitingReply: false,
            mentions: (v.match(/@[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).map(s => s.slice(1).toLowerCase()),
          };
          putComment(ydoc, rec);
          enqueueAgentTasksForComment(rec, rec.text);
        };
        const onResolve = () => {
          patchComment(ydoc, root.id, { resolved: true, resolvedAt: new Date().toISOString() });
          setAnchorPopover(null);
        };
        return (
          <AnchorCommentPopover
            x={anchorPopover.x}
            y={anchorPopover.y}
            thread={thread}
            memberEmails={workspaceMemberEmails}
            aiAgents={knownAiAgents}
            onReply={onReply}
            onResolve={onResolve}
            onClose={() => setAnchorPopover(null)} />
        );
      })()}

      {aiCallout && (
        <div
          ref={aiCalloutDomRef}
          className={`ai-callout ai-callout-${aiCallout.side}${aiCallout.offscreen ? ' ai-callout-offscreen' : ''}`}
          style={aiCallout.style}
          key={aiCallout.key}
        >
          <div className="ai-callout-head">
            IA
            {aiCallout.stepIdx && aiCallout.stepCount ? ` · paso ${aiCallout.stepIdx}/${aiCallout.stepCount}` : ''}
            {aiCallout.note ? ` · en "${aiCallout.note}"` : ''}
          </div>
          <div className="ai-callout-msg">{aiCallout.message}</div>
          <button className="ai-callout-close" onClick={dismissAiCallout} title="Cerrar (Esc)">×</button>
        </div>
      )}
    </div>
  );
}

window.EdinotApp = EdinotApp;
