// Barra superior del shell (52px): ruta (carpeta / título, doble clic para
// renombrar), estado de guardado, modo Leer · Editar (+ Dividido/Markdown en
// el chevron), presencia, Compartir, menú ⋯, campana, panel lateral y los
// controles de ventana en Windows/Linux.
//
// Toda la barra es región de arrastre de la ventana (-webkit-app-region:
// drag); los controles interactivos se excluyen en shell.css.

import { useState, memo } from 'react';
import { t, useI18n } from '../../i18n.js';
import { perfCountRender } from '../../perf.js';
import { Icon } from './icons.jsx';
import { Menu } from './Menu.jsx';
import { kbdHint, withKbd } from '../shared/shortcuts.js';

const MODE_LABEL = {
  render: () => t('shell.mode.read'),
  live: () => t('shell.mode.edit'),
  dual: () => t('shell.mode.split'),
  markdown: () => t('shell.mode.markdown'),
};

function ModeSwitch({ mode, setMode, disabled, isMac }) {
  const [menu, setMenu] = useState(null);
  const extra = mode === 'dual' || mode === 'markdown';
  return (
    <div role="group" aria-label={t('shell.mode.label')} className="sh-seg">
      <button type="button" className={`sh-seg-btn${mode === 'render' ? ' on' : ''}`}
        aria-pressed={mode === 'render'} onClick={() => setMode('render')}
        title={t('mode.render.tip')}>{t('shell.mode.read')}</button>
      <button type="button" className={`sh-seg-btn${mode === 'live' ? ' on' : ''}`}
        aria-pressed={mode === 'live'} disabled={disabled} onClick={() => setMode('live')}
        title={t('mode.live.tip')}>{t('shell.mode.edit')}</button>
      <button type="button" className={`sh-seg-btn sh-seg-more${extra ? ' on' : ''}`}
        aria-haspopup="menu" aria-label={t('shell.mode.more')}
        onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}>
        {extra && <span className="sh-seg-extra">{MODE_LABEL[mode]()}</span>}
        <Icon name="chevSel" size={14} stroke={2} />
      </button>
      {menu && (
        <Menu anchor={menu} align="end" minWidth={200} onClose={() => setMenu(null)} label={t('shell.mode.label')}
          items={[
            { label: t('shell.mode.read'), icon: 'eye', checked: mode === 'render', kbd: 'Esc', onSelect: () => setMode('render') },
            { label: t('shell.mode.edit'), icon: 'edit', checked: mode === 'live', kbd: kbdHint('toggleLive', isMac), disabled, onSelect: () => setMode('live') },
            { type: 'sep' },
            { label: t('shell.mode.split'), icon: 'split', checked: mode === 'dual', disabled, onSelect: () => setMode('dual') },
            { label: t('shell.mode.markdown'), icon: 'code', checked: mode === 'markdown', kbd: kbdHint('toggleRender', isMac), disabled, onSelect: () => setMode('markdown') },
          ]} />
      )}
    </div>
  );
}

function TitleCrumb({ crumbs, title, editable, editing, draft, setDraft, onBeginEdit, onCommit, onCancel, inputRef, loading }) {
  return (
    <nav aria-label={t('shell.crumb')} className="sh-crumb">
      {crumbs.map((c, i) => (
        <span key={i} className="sh-crumb-part">
          {c.onClick
            ? <button type="button" className="sh-crumb-link" onClick={c.onClick}>{c.label}</button>
            : <span className="sh-crumb-muted">{c.label}</span>}
          <span aria-hidden="true" className="sh-crumb-sep">/</span>
        </span>
      ))}
      {editing ? (
        <input ref={inputRef} className="sh-title-input" value={draft}
          aria-label={t('shell.rename')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onCommit(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
          }} />
      ) : (
        <span className={`sh-crumb-title${editable ? ' editable' : ''}${loading ? ' loading' : ''}`}
          onDoubleClick={editable ? onBeginEdit : undefined}
          title={editable ? t('title.renameTip') : undefined}
          aria-current="page">{title}</span>
      )}
    </nav>
  );
}

// Página ↔ Canvas, junto al título (como el interruptor de AFFiNE): la misma
// nota como documento o como pizarra.
function SurfaceSwitch({ surface, onSurface, isMac }) {
  return (
    <div role="radiogroup" aria-label={t('shell.surface.label')} className="sh-seg sh-surface">
      <button type="button" role="radio" className={`sh-seg-btn sh-surface-btn${surface === 'page' ? ' on' : ''}`}
        aria-checked={surface === 'page'} aria-label={t('shell.surface.page')} onClick={() => onSurface('page')}
        title={withKbd(t('shell.surface.page'), 'surface', isMac)}>
        <Icon name="note" size={15} stroke={1.8} />
      </button>
      <button type="button" role="radio" className={`sh-seg-btn sh-surface-btn${surface === 'canvas' ? ' on' : ''}`}
        aria-checked={surface === 'canvas'} aria-label={t('shell.surface.canvas')} onClick={() => onSurface('canvas')}
        title={withKbd(t('shell.surface.canvas'), 'surface', isMac)}>
        <Icon name="canvas" size={15} stroke={1.8} />
      </button>
    </div>
  );
}

export const Topbar = memo(function Topbar({
  view, isMac, platform, sidebarCollapsed, onToggleSidebar,
  canGoBack, canGoForward, onBack, onForward,
  crumbs, title, titleLoading, editableTitle, titleEditing, titleDraft, setTitleDraft, onBeginTitleEdit, onCommitTitle, onCancelTitleEdit, titleInputRef,
  saveLabel, mode, setMode, modeDisabled, showMode = true, presence, surface, onSurface,
  canShare, onShare, getMoreItems, bell, panelOpen, onTogglePanel, showPanelToggle,
}) {
  perfCountRender('Topbar');
  useI18n();
  const [moreMenu, setMoreMenu] = useState(null);
  const isNote = view === 'note';
  return (
    <header className={`sh-top${isMac ? ' is-mac' : ''}${sidebarCollapsed ? ' rail' : ''}${view === 'settings' || view === 'calendar' ? ' sh-top-bare' : ''}`}>
      {onToggleSidebar && (
        <button type="button" className="sh-iconbtn sh-top-side" onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
          aria-pressed={!sidebarCollapsed}
          title={withKbd(sidebarCollapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse'), 'sidebar', isMac)}>
          <Icon name="sidebar" size={16} />
        </button>
      )}
      {isNote && (canGoBack || canGoForward) && (
        <span className="sh-navarrows">
          <button type="button" className="sh-iconbtn sh-iconbtn-sm" disabled={!canGoBack} onClick={onBack} aria-label={t('btn.back')} title={t('btn.back')}>
            <Icon name="back" size={15} />
          </button>
          <button type="button" className="sh-iconbtn sh-iconbtn-sm" disabled={!canGoForward} onClick={onForward} aria-label={t('wnav.forward')} title={t('wnav.forward')}>
            <Icon name="forward" size={15} />
          </button>
        </span>
      )}
      {isNote && onSurface && <SurfaceSwitch surface={surface} onSurface={onSurface} isMac={isMac} />}
      <TitleCrumb crumbs={crumbs} title={title} loading={titleLoading}
        editable={editableTitle} editing={titleEditing}
        draft={titleDraft} setDraft={setTitleDraft} onBeginEdit={onBeginTitleEdit}
        onCommit={onCommitTitle} onCancel={onCancelTitleEdit} inputRef={titleInputRef} />
      {isNote && saveLabel && <span className="sh-save" role="status" aria-live="polite">{saveLabel}</span>}

      <div className="sh-top-right">
        {isNote && showMode && <ModeSwitch mode={mode} setMode={setMode} disabled={modeDisabled} isMac={isMac} />}
        {isNote && presence && presence.length > 1 && (
          <div className="sh-presence" aria-label={t('shell.presence', { names: presence.map(p => p.email || '?').join(', ') })}
            title={presence.map(p => `${p.email}${p.isSelf ? ' ' + t('presence.self') : ''}`).join('\n')}>
            {presence.slice(0, 4).map(p => (
              <span key={p.clientId} className={`sh-avatar${p.isSelf ? ' self' : ''}`} style={{ background: p.color || '#888' }}>
                {(p.email || '?').slice(0, 1).toUpperCase()}
              </span>
            ))}
            {presence.length > 4 && <span className="sh-avatar sh-avatar-more">+{presence.length - 4}</span>}
          </div>
        )}
        {isNote && canShare && (
          <button type="button" className="sh-btn" onClick={onShare} title={withKbd(t('shell.share'), 'share', isMac)} aria-label={t('shell.share')}>
            <Icon name="share" size={14} stroke={1.8} /><span className="sh-btn-label">{t('shell.share')}</span>
          </button>
        )}
        {isNote && getMoreItems && (
          <button type="button" className="sh-iconbtn" aria-label={t('shell.more')} aria-haspopup="menu" title={t('shell.more')}
            onClick={(e) => setMoreMenu({ anchor: e.currentTarget.getBoundingClientRect(), items: getMoreItems() })}>
            <Icon name="more" size={16} />
          </button>
        )}
        {bell}
        {showPanelToggle && (
          <button type="button" className={`sh-iconbtn sh-panel-toggle${panelOpen ? ' on' : ''}`} onClick={onTogglePanel}
            aria-pressed={!!panelOpen} aria-label={t('shell.panel.toggle')} title={withKbd(t('shell.panel.toggle'), 'panel', isMac)}>
            <Icon name="panel" size={16} />
          </button>
        )}
        {(platform === 'linux' || platform === 'win32') && (
          <div className="winctl sh-winctl">
            <button type="button" className="winctl-btn" aria-label={t('menu.minimize')} title={t('menu.minimize')}
              onClick={() => window.electronAPI && window.electronAPI.windowMinimize && window.electronAPI.windowMinimize()}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
            </button>
            <button type="button" className="winctl-btn" aria-label={t('menu.zoom')} title={t('menu.zoom')}
              onClick={() => window.electronAPI && window.electronAPI.windowToggleMaximize && window.electronAPI.windowToggleMaximize()}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="2" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
            </button>
            <button type="button" className="winctl-btn winctl-close" aria-label={t('btn.close')} title={t('btn.close')}
              onClick={() => window.electronAPI && window.electronAPI.windowClose && window.electronAPI.windowClose()}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}
      </div>
      {moreMenu && (
        <Menu anchor={moreMenu.anchor} align="end" minWidth={250} items={moreMenu.items} label={t('shell.more')} onClose={() => setMoreMenu(null)} />
      )}
    </header>
  );
});
