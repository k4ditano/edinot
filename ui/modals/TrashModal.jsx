// Papelera: notas borradas (store.js trashFile) con Restaurar, Eliminar
// definitivamente y Vaciar. Se purgan solas a los TRASH_DAYS días.

import { useMemo } from 'react';
import { t, useI18n } from '../../i18n.js';
import { TRASH_DAYS } from '../../store.js';
import { relTime } from '../shell/ContextPanel.jsx';

const baseName = (n) => String(n || '').replace(/\.(md|markdown|txt)$/i, '');

export function TrashModal({ open, version, actions, vaultName, onClose }) {
  useI18n();
  const items = useMemo(() => (open ? actions.list() : []), [open, version, actions]);
  if (!open) return null;
  return (
    <div className="modal-backdrop trash-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="trash-modal" role="dialog" aria-label={t('trash.title')}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <div className="trash-head">
          <div>
            <div className="trash-title">{t('trash.title')}</div>
            <div className="trash-sub">{t('trash.sub', { n: TRASH_DAYS })}</div>
          </div>
          <button type="button" className="trash-close" onClick={onClose} aria-label={t('btn.close')}>×</button>
        </div>
        {items.length === 0
          ? <div className="trash-empty">{t('trash.empty')}</div>
          : (
            <ul className="trash-list">
              {items.map(it => (
                <li key={it.id} className="trash-row">
                  <span className="trash-ic" aria-hidden="true">{it.icon || '📄'}</span>
                  <span className="trash-main">
                    <span className="trash-name">{baseName(it.name)}</span>
                    <span className="trash-meta">{(vaultName && vaultName(it.vaultId)) ? vaultName(it.vaultId) + ' · ' : ''}{t('trash.deleted', { when: relTime(Date.parse(it.deletedAt)) })}</span>
                  </span>
                  <button type="button" className="trash-btn" onClick={() => actions.restore(it.id)}>{t('trash.restore')}</button>
                  <button type="button" className="trash-btn danger" onClick={() => actions.purge(it.id)}>{t('trash.purge')}</button>
                </li>
              ))}
            </ul>
          )}
        {items.length > 0 && (
          <div className="trash-foot">
            <button type="button" className="trash-btn danger" onClick={() => actions.empty()}>{t('trash.emptyBtn')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
