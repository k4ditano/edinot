// Plantillas de bases de datos listas para usar (texto de una nota con la
// directiva `<!-- edinot:view=… -->` y la tabla). Puro: lo usa la plantilla
// «Gestor de tareas» de editor.jsx y los tests.
//
// Las fechas llevan variables de plantilla ({{date+N}}), que se rellenan al
// crear la nota desde la plantilla; {{user}} es el nombre de quien la crea.

const enc = encodeURIComponent;
const colsClause = (cols) => Object.entries(cols).map(([k, v]) => enc(`${k}=${v}`)).join(';');
const tableMd = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '-------').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');

const TEXT = {
  es: {
    title: 'Gestor de tareas',
    intro: 'Añade tareas con **+ Nueva fila**. Cambia entre **Tabla** y **Kanban** arriba; en el Kanban arrastra cada tarjeta a su estado. Con **Filtro** y **Orden** ves solo lo que te interesa.',
    head: ['Tarea', 'Responsable', 'Prioridad', 'Progreso', 'Estado', 'Fecha límite'],
    states: ['Por hacer', 'En curso', 'Bloqueada', 'Hecha'],
    views: ['Tabla', 'Kanban'],
    rows: [
      ['Definir el alcance del proyecto', '{{user}}', '4', '100', 'Hecha', '{{date-3}}'],
      ['Preparar el plan de trabajo', '{{user}}', '3', '60', 'En curso', '{{date+2}}'],
      ['Resolver dependencias externas', '', '5', '20', 'Bloqueada', '{{date+4}}'],
      ['Revisar el presupuesto', '', '2', '0', 'Por hacer', '{{date+7}}'],
    ],
  },
  en: {
    title: 'Task manager',
    intro: 'Add tasks with **+ New row**. Switch between **Table** and **Kanban** above; in Kanban drag each card to its status. Use **Filter** and **Sort** to see only what matters.',
    head: ['Task', 'Owner', 'Priority', 'Progress', 'Status', 'Deadline'],
    states: ['To do', 'In progress', 'Blocked', 'Done'],
    views: ['Table', 'Kanban'],
    rows: [
      ['Define the project scope', '{{user}}', '4', '100', 'Done', '{{date-3}}'],
      ['Prepare the work plan', '{{user}}', '3', '60', 'In progress', '{{date+2}}'],
      ['Resolve external dependencies', '', '5', '20', 'Blocked', '{{date+4}}'],
      ['Review the budget', '', '2', '0', 'To do', '{{date+7}}'],
    ],
  },
};

// Contenido de la nota-plantilla «Gestor de tareas» (lang: 'es' | 'en').
export function taskManagerTemplate(lang) {
  const L = TEXT[lang] || TEXT.es;
  const [task, owner, prio, prog, status, due] = L.head;
  const cols = { [owner]: 'person', [prio]: 'rating', [prog]: 'progress', [status]: `status:${L.states.join('|')}`, [due]: 'date' };
  const views = { list: [{ n: L.views[0], v: 'table' }, { n: L.views[1], v: 'kanban', by: status }], act: 0 };
  const directive = `<!-- edinot:view=table:cols=${colsClause(cols)}:widths=${enc(task)}=300:views=${enc(JSON.stringify(views))} -->`;
  return `# ${L.title}\n\n${L.intro}\n\n${directive}\n${tableMd(L.head, L.rows)}\n`;
}
export const TASK_TEMPLATE_NAMES = { es: 'Plantilla Gestor de tareas.md', en: 'Task Manager Template.md' };
