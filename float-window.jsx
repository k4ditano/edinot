// Edinot — floating companion window renderer.
//
// Mounted by build/entry.jsx instead of the full EdinotApp when the window
// URL carries a `#float=<mode>` hash (see electron/main.cjs createFloatWindow).
// This component owns NO data: the main window's renderer keeps being the
// single source of truth (Yjs, sync, blob uploads) and we talk to it through
// the float:send / float:data IPC relays. That keeps this window booting
// instantly and avoids a second Yjs/IndexedDB client on the same origin.
//
// Modes:
//   present — read-only live render of the note active in the main window
//             (meeting mode: small, always on top, font zoom).
//   note    — quick-capture pad bound to the note that was active when the
//             window opened. Append on demand + screen capture button that
//             inserts the screenshot (uploaded by the main window) at the
//             caret.
import { useCallback, useEffect, useRef, useState } from 'react';
import { t, useI18n } from './i18n.js';
import { Icon } from './ui/shell/icons.jsx';

const api = typeof window !== 'undefined' ? window.electronAPI : null;

function closeSelf() {
  if (api && api.floatCloseSelf) api.floatCloseSelf();
  else window.close();
}

function FloatHeader({ icon, title, children }) {
  return (
    <div className="float-head">
      <span className="float-head-icon">{icon}</span>
      <span className="float-head-title" title={title}>{title}</span>
      <div className="float-head-actions">{children}</div>
    </div>
  );
}

function PresentFloat() {
  const [doc, setDoc] = useState(null); // { title, html }
  const [fontSize, setFontSize] = useState(14);
  // Teleprompter: auto-scroll the render downward at a steady, adjustable
  // pace. scrollTop assignments get rounded by the engine, so we keep our
  // own fractional position in a ref and re-sync from the DOM whenever the
  // user scrolls by hand (wheel/drag) while paused.
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30); // px per second
  const bodyRef = useRef(null);
  const posRef = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (!api) return;
    const off = api.on('float:data', (payload) => {
      if (!payload || payload.mode !== 'present') return;
      if (payload.kind === 'content') setDoc({ title: payload.title || '', html: payload.html || '' });
    });
    api.floatSend({ kind: 'float-ready', mode: 'present' });
    return off;
  }, []);

  useEffect(() => {
    if (!playing) return;
    const el = bodyRef.current;
    if (!el) return;
    posRef.current = el.scrollTop;
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(100, now - last);
      last = now;
      posRef.current += (speedRef.current * dt) / 1000;
      const max = el.scrollHeight - el.clientHeight;
      if (posRef.current >= max) {
        el.scrollTop = max;
        setPlaying(false);
        return;
      }
      el.scrollTop = posRef.current;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Manual wheel/touch while playing = the user wants to reposition; pick
  // up the new position instead of fighting it on the next frame.
  const onUserScroll = () => {
    const el = bodyRef.current;
    if (el && Math.abs(el.scrollTop - posRef.current) > 4) posRef.current = el.scrollTop;
  };

  const restart = () => {
    const el = bodyRef.current;
    if (el) el.scrollTop = 0;
    posRef.current = 0;
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { closeSelf(); return; }
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSpeed((s) => Math.min(200, Math.round(s * 1.25))); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSpeed((s) => Math.max(5, Math.round(s / 1.25))); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="float-root float-present">
      <FloatHeader icon={<Icon name="present" size={14} />} title={doc ? doc.title : t('float.present.title')}>
        <button className="float-btn" title={t('float.prompter.restart')} onClick={restart}>⏮</button>
        <button className={`float-btn${playing ? ' float-primary' : ''}`}
          title={playing ? t('float.prompter.pause') : t('float.prompter.play')}
          onClick={() => setPlaying((p) => !p)}>{playing ? '⏸' : '▶'}</button>
        <button className="float-btn" title={t('float.prompter.slower')}
          onClick={() => setSpeed((s) => Math.max(5, Math.round(s / 1.25)))}>−</button>
        <span className="float-speed" title={t('float.prompter.speed')}>{speed}</span>
        <button className="float-btn" title={t('float.prompter.faster')}
          onClick={() => setSpeed((s) => Math.min(200, Math.round(s * 1.25)))}>+</button>
        <button className="float-btn" title={t('float.font.smaller')}
          onClick={() => setFontSize((s) => Math.max(10, s - 1))}>A−</button>
        <button className="float-btn" title={t('float.font.bigger')}
          onClick={() => setFontSize((s) => Math.min(28, s + 1))}>A+</button>
        <button className="float-btn float-close" title={t('float.close')} onClick={closeSelf} aria-label={t('float.close')}><Icon name="close" size={14} /></button>
      </FloatHeader>
      {doc ? (
        <div ref={bodyRef} onScroll={onUserScroll}
          className={`float-body md-render${playing ? ' float-prompting' : ''}`}
          style={{ fontSize: `${fontSize}px` }}
          dangerouslySetInnerHTML={{ __html: doc.html }} />
      ) : (
        <div className="float-body float-empty">{t('float.present.waiting')}</div>
      )}
    </div>
  );
}

function NoteFloat() {
  const [noteName, setNoteName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(null); // 'capture' | 'save' | null
  const [status, setStatus] = useState(null); // { ok, msg }
  const taRef = useRef(null);
  const reqRef = useRef(0);

  const insertAtCaret = useCallback((snippet) => {
    const ta = taRef.current;
    setText((prev) => {
      const pos = ta ? ta.selectionStart : prev.length;
      const next = prev.slice(0, pos) + snippet + prev.slice(ta ? ta.selectionEnd : pos);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.selectionStart = ta.selectionEnd = pos + snippet.length;
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!api) return;
    const off = api.on('float:data', (payload) => {
      if (!payload || payload.mode !== 'note') return;
      if (payload.kind === 'note-init') setNoteName(payload.noteName || '');
      if (payload.kind === 'capture-result') {
        setBusy(null);
        if (payload.ok && payload.markdown) {
          insertAtCaret(`\n${payload.markdown}\n`);
          setStatus({ ok: true, msg: t('float.capture.ok') });
        } else {
          setStatus({ ok: false, msg: t('float.capture.fail', { err: payload.error || '?' }) });
        }
      }
      if (payload.kind === 'append-result') {
        setBusy(null);
        if (payload.ok) {
          setText('');
          setStatus({ ok: true, msg: t('float.saved', { name: payload.noteName || '' }) });
        } else {
          setStatus({ ok: false, msg: payload.error || t('float.save.fail') });
        }
      }
    });
    api.floatSend({ kind: 'float-ready', mode: 'note' });
    return off;
  }, [insertAtCaret]);

  useEffect(() => {
    if (!status || !status.ok) return;
    const id = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(id);
  }, [status]);

  const doCapture = () => {
    if (!api || busy) return;
    setBusy('capture');
    setStatus(null);
    api.floatSend({ kind: 'float-capture', reqId: ++reqRef.current });
  };
  const doSave = () => {
    if (!api || busy || !text.trim()) return;
    setBusy('save');
    setStatus(null);
    api.floatSend({ kind: 'float-append', reqId: ++reqRef.current, text });
  };
  const doClose = () => {
    if (text.trim() && !window.confirm(t('float.unsaved.confirm'))) return;
    closeSelf();
  };

  return (
    <div className="float-root float-note">
      <FloatHeader icon={<Icon name="quick" size={14} />} title={noteName ? t('float.note.target', { name: noteName }) : t('float.note.title')}>
        <button className="float-btn float-close" title={t('float.close')} onClick={doClose} aria-label={t('float.close')}><Icon name="close" size={14} /></button>
      </FloatHeader>
      <textarea
        ref={taRef}
        className="float-textarea"
        placeholder={t('float.note.ph')}
        value={text}
        spellCheck={false}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doSave(); }
        }}
      />
      <div className="float-foot">
        <button className="float-btn" onClick={doCapture} disabled={!!busy} aria-busy={busy === 'capture' || undefined}
          title={t('float.capture.tip')}>
          {t('float.capture')}
        </button>
        <button className="float-btn float-primary" onClick={doSave} disabled={!!busy || !text.trim()} aria-busy={busy === 'save' || undefined}
          title={t('float.save.tip')}>
          {t('float.save')}
        </button>
        {status && (
          <span className={`float-status ${status.ok ? 'ok' : 'err'}`}>{status.msg}</span>
        )}
      </div>
    </div>
  );
}

export function EdinotFloat({ mode }) {
  useI18n();
  return mode === 'note' ? <NoteFloat /> : <PresentFloat />;
}
