// «Enlazan aquí» al final de la nota (Leer y Editar): las notas que la citan
// con [[…]], como chips. El panel lateral conserva la lista con el contexto
// de cada cita; esto es para verlas sin abrirlo.

import { memo } from 'react';
import { t, useI18n } from '../../i18n.js';
import { Icon } from './icons.jsx';

const baseName = (n) => String(n || '').replace(/\.(md|markdown|txt)$/i, '');

export const NoteBacklinks = memo(function NoteBacklinks({ items, onOpen }) {
  useI18n();
  if (!items || !items.length) return null;
  return (
    <nav className="note-backlinks" aria-label={t('nb.label')}>
      <span className="nb-label">{t('nb.label')}</span>
      {items.map(b => (
        <button type="button" key={b.file.id} className="nb-chip" title={b.snippet || undefined} onClick={() => onOpen(b.file.id)}>
          {b.file.icon ? <span className="nb-emoji">{b.file.icon}</span> : <Icon name="note" size={13} />}
          <span className="nb-name">{baseName(b.file.name)}</span>
        </button>
      ))}
    </nav>
  );
});
