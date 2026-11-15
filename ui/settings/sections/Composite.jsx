// Secciones compuestas: reúnen lo que antes eran páginas sueltas de pocas filas.
//   General     = Editor + Idioma y región
//   Conexiones  = MCP + Web Clipper + Google Calendar (+ opciones para asistentes MCP, plegadas)
//   Acerca de   = Versión y actualizaciones + Diagnóstico y datos

import { useRef, useLayoutEffect } from 'react';
import { t, useI18n } from '../../../i18n.js';
import { Group } from '../controls.jsx';
import { EditorSection, LanguageSection } from './App.jsx';
import { IntegrationsSection } from './Integrations.jsx';
import { CalendarSection } from './Data.jsx';
import { AssistantOptions } from './Agents.jsx';
import { AboutSection } from './About.jsx';
import { AdvancedSection } from './Advanced.jsx';

export function GeneralSection({ ctx }) {
  useI18n();
  return (
    <>
      <Group title={t('st.grp.editor')}><EditorSection ctx={ctx} /></Group>
      <Group title={t('st.grp.language')}><LanguageSection ctx={ctx} /></Group>
    </>
  );
}

export function ConnectionsSection({ ctx }) {
  useI18n();
  const ref = useRef(null);
  // Si un enlace o el buscador apunta a una fila de las opciones plegadas, se despliegan antes de
  // que Ajustes intente llevar la vista hasta ella.
  useLayoutEffect(() => {
    if (ctx.target && /^agents\./.test(ctx.target) && ref.current) ref.current.open = true;
  }, [ctx.target]);
  return (
    <>
      <IntegrationsSection ctx={ctx} />
      <Group title={t('st.grp.calendar')}><CalendarSection ctx={ctx} /></Group>
      <Group title={t('st.grp.assistantOpts')}>
        <details className="st-details" ref={ref}>
          <summary>{t('st.connections.assistantHint')}</summary>
          <AssistantOptions ctx={ctx} />
        </details>
      </Group>
    </>
  );
}

export function AboutSystemSection({ ctx }) {
  useI18n();
  return (
    <>
      <Group title={t('st.grp.updates')}><AboutSection /></Group>
      <Group title={t('st.grp.diag')}><AdvancedSection ctx={ctx} /></Group>
    </>
  );
}
