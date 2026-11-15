// Canvas templates — SHARED between the renderer (editor.jsx gallery) and the
// MCP server (apply_canvas_template), same spirit as canvas-model.js: one
// source so both writers produce identical structures.
//
// Each template is pure data + a build(ctx) function. `ctx` supplies id
// generators and the language, so builders stay deterministic and never touch
// Date.now()/Math.random() themselves.

const STICKY = 180;
const STICKY_COLORS = ['#FCE8C9', '#FADDE4', '#D4F1DE', '#D9ECFB', '#E7DFFA', '#D9DDFA', '#EFEBE3'];
const GROUP_COLORS = ['rgba(125,169,90,0.10)', 'rgba(234,88,12,0.10)', 'rgba(59,130,246,0.10)', 'rgba(168,85,247,0.10)', 'rgba(220,38,38,0.08)', 'rgba(107,114,128,0.10)'];

const L = {
  es: {
    brainstorm: { name: 'Brainstorm', desc: 'Tema central con stickies alrededor', topic: 'Tema central', idea: 'Idea…' },
    retro: { name: 'Retrospectiva', desc: 'Qué fue bien / qué mejorar / acciones', good: '✅ Qué fue bien', improve: '⚠️ Qué mejorar', actions: '🚀 Acciones', seed: 'Añade una nota…' },
    kanban: { name: 'Kanban', desc: 'Por hacer / En curso / Hecho', todo: 'Por hacer', doing: 'En curso', done: 'Hecho', card: 'Tarea…' },
    mindmap: { name: 'Mapa mental', desc: 'Nodo raíz con ramas conectadas', root: 'Idea central', branch: 'Rama' },
    timeline: { name: 'Línea de tiempo', desc: 'Hitos sobre una flecha temporal', milestone: 'Hito', date: 'Fecha' },
    moodboard: { name: 'Moodboard', desc: 'Marco para pegar imágenes e inspiración', title: 'Inspiración', hint: 'Pega imágenes aquí (Ctrl+V) o arrastra archivos' },
    weekly: { name: 'Plan semanal', desc: 'Un marco por día laborable', days: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'], task: 'Tarea…' },
    dafo: { name: 'DAFO', desc: 'Fortalezas, debilidades, oportunidades y amenazas', title: 'Análisis DAFO', helps: 'Ayudan a lograr el objetivo', hurts: 'Pueden perjudicar el objetivo',
      s: 'Fortalezas (interno)', w: 'Debilidades (interno)', o: 'Oportunidades (externo)', t: 'Amenazas (externo)', ph: { s: ['Ventaja…', 'Recurso…'], w: ['Carencia…', 'Riesgo…'], o: ['Tendencia…', 'Nicho…'], t: ['Rival…', 'Cambio…'] } },
    journey: { name: 'Recorrido del cliente', desc: 'Fases, acciones, puntos de dolor y oportunidades', title: 'Mapa de recorrido del cliente',
      phases: ['Descubrimiento', 'Consideración', 'Compra', 'Uso', 'Fidelización'], rows: ['Acciones', 'Puntos de dolor', 'Oportunidades'], action: 'Acción…', pain: 'Fricción…', opp: 'Mejora…', mood: 'Experiencia' },
    okr: { name: 'OKR', desc: 'Objetivo, resultados clave e iniciativas', objective: 'Objetivo\n(inspirador y cualitativo)', kr: 'Resultado clave', krHint: 'de X a Y · 0 %', init: 'Iniciativa…', tag: 'Trimestre' },
    eisenhower: { name: 'Matriz de Eisenhower', desc: 'Urgente / importante: qué hacer, planificar, delegar o eliminar', title: 'Matriz de Eisenhower', urgent: 'Urgente', notUrgent: 'No urgente', important: 'Importante', notImportant: 'No importante',
      q1: 'Hacer ya', q2: 'Planificar', q3: 'Delegar', q4: 'Eliminar', task: 'Tarea…' },
    lean: { name: 'Lean Canvas', desc: 'Modelo de negocio en una página (9 bloques)', problem: 'Problema', solution: 'Solución', uvp: 'Propuesta de valor única', unfair: 'Ventaja injusta', segments: 'Segmentos de clientes', metrics: 'Métricas clave', channels: 'Canales', costs: 'Estructura de costes', revenue: 'Fuentes de ingresos',
      hProblem: 'Top 3 problemas', hSolution: 'Top 3 funciones', hUvp: 'Mensaje único y convincente', hUnfair: 'Lo que no se copia fácilmente', hSegments: 'Clientes objetivo y early adopters', hMetrics: 'Cómo medís el progreso', hChannels: 'Cómo llegáis a los clientes', hCosts: 'Costes fijos y variables', hRevenue: 'Modelo de ingresos y precios' },
    sprint: { name: 'Planificación de sprint', desc: 'Objetivo, backlog, sprint backlog, en curso y hecho', title: 'Sprint', goal: 'Objetivo del sprint', goalHint: 'Qué valor entregamos al final del sprint…', backlog: 'Backlog del producto', sprintBacklog: 'Sprint backlog', doing: 'En curso', done: 'Hecho', story: 'Historia…', capacity: 'Capacidad: __ puntos' },
    org: { name: 'Organigrama', desc: 'Dirección, áreas y equipos conectados', ceo: 'Dirección general', area: ['Operaciones', 'Comercial', 'Tecnología'], person: 'Equipo / persona' },
    flow: { name: 'Diagrama de flujo', desc: 'Inicio, procesos, decisión y fin con conectores', start: 'Inicio', step1: 'Recibir solicitud', decision: '¿Es válida?', yes: 'Sí', no: 'No', step2: 'Procesar y registrar', alt: 'Pedir más datos', end: 'Fin', db: 'Base de datos', note: 'Añade aquí\nlas reglas' },
    impact: { name: 'Impacto / esfuerzo', desc: 'Prioriza ideas: victorias rápidas, proyectos grandes, rellenos y a evitar', title: 'Matriz impacto / esfuerzo', impact: 'Impacto', effort: 'Esfuerzo', quick: 'Victorias rápidas', big: 'Proyectos grandes', fill: 'Rellenos', avoid: 'Evitar', hi: 'alto', lo: 'bajo', idea: 'Idea…' },
    storymap: { name: 'Mapa de historias', desc: 'Actividades, historias de usuario y releases', title: 'Mapa de historias de usuario', activities: ['Descubrir', 'Elegir', 'Comprar', 'Recibir'], story: 'Historia…', releases: ['Release 1 · MVP', 'Release 2', 'Más adelante'] },
  },
  en: {
    brainstorm: { name: 'Brainstorm', desc: 'Central topic with stickies around it', topic: 'Central topic', idea: 'Idea…' },
    retro: { name: 'Retrospective', desc: 'What went well / what to improve / actions', good: '✅ What went well', improve: '⚠️ What to improve', actions: '🚀 Actions', seed: 'Add a note…' },
    kanban: { name: 'Kanban', desc: 'To do / Doing / Done', todo: 'To do', doing: 'Doing', done: 'Done', card: 'Task…' },
    mindmap: { name: 'Mind map', desc: 'Root node with connected branches', root: 'Central idea', branch: 'Branch' },
    timeline: { name: 'Timeline', desc: 'Milestones over a time arrow', milestone: 'Milestone', date: 'Date' },
    moodboard: { name: 'Moodboard', desc: 'A frame to paste images and inspiration', title: 'Inspiration', hint: 'Paste images here (Ctrl+V) or drop files' },
    weekly: { name: 'Weekly plan', desc: 'One frame per weekday', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], task: 'Task…' },
    dafo: { name: 'SWOT', desc: 'Strengths, weaknesses, opportunities and threats', title: 'SWOT analysis', helps: 'Help achieve the goal', hurts: 'Can hurt the goal',
      s: 'Strengths (internal)', w: 'Weaknesses (internal)', o: 'Opportunities (external)', t: 'Threats (external)', ph: { s: ['Edge…', 'Asset…'], w: ['Gap…', 'Risk…'], o: ['Trend…', 'Niche…'], t: ['Rival…', 'Change…'] } },
    journey: { name: 'Customer journey', desc: 'Phases, actions, pain points and opportunities', title: 'Customer journey map',
      phases: ['Awareness', 'Consideration', 'Purchase', 'Use', 'Loyalty'], rows: ['Actions', 'Pain points', 'Opportunities'], action: 'Action…', pain: 'Friction…', opp: 'Fix…', mood: 'Experience' },
    okr: { name: 'OKR', desc: 'Objective, key results and initiatives', objective: 'Objective\n(inspiring, qualitative)', kr: 'Key result', krHint: 'from X to Y · 0 %', init: 'Initiative…', tag: 'Quarter' },
    eisenhower: { name: 'Eisenhower matrix', desc: 'Urgent / important: do, plan, delegate or drop', title: 'Eisenhower matrix', urgent: 'Urgent', notUrgent: 'Not urgent', important: 'Important', notImportant: 'Not important',
      q1: 'Do now', q2: 'Schedule', q3: 'Delegate', q4: 'Eliminate', task: 'Task…' },
    lean: { name: 'Lean Canvas', desc: 'One-page business model (9 blocks)', problem: 'Problem', solution: 'Solution', uvp: 'Unique value proposition', unfair: 'Unfair advantage', segments: 'Customer segments', metrics: 'Key metrics', channels: 'Channels', costs: 'Cost structure', revenue: 'Revenue streams',
      hProblem: 'Top 3 problems', hSolution: 'Top 3 features', hUvp: 'Single, clear, compelling message', hUnfair: 'Cannot be easily copied', hSegments: 'Target customers and early adopters', hMetrics: 'How you measure progress', hChannels: 'How you reach customers', hCosts: 'Fixed and variable costs', hRevenue: 'Revenue model and pricing' },
    sprint: { name: 'Sprint planning', desc: 'Goal, backlog, sprint backlog, doing and done', title: 'Sprint', goal: 'Sprint goal', goalHint: 'What value do we deliver at the end of the sprint…', backlog: 'Product backlog', sprintBacklog: 'Sprint backlog', doing: 'Doing', done: 'Done', story: 'Story…', capacity: 'Capacity: __ points' },
    org: { name: 'Org chart', desc: 'Leadership, areas and teams connected', ceo: 'General management', area: ['Operations', 'Sales', 'Technology'], person: 'Team / person' },
    flow: { name: 'Flowchart', desc: 'Start, steps, decision and end with connectors', start: 'Start', step1: 'Receive request', decision: 'Is it valid?', yes: 'Yes', no: 'No', step2: 'Process and record', alt: 'Ask for more data', end: 'End', db: 'Database', note: 'Add the\nrules here' },
    impact: { name: 'Impact / effort', desc: 'Prioritise ideas: quick wins, big projects, fill-ins and avoid', title: 'Impact / effort matrix', impact: 'Impact', effort: 'Effort', quick: 'Quick wins', big: 'Big projects', fill: 'Fill-ins', avoid: 'Avoid', hi: 'high', lo: 'low', idea: 'Idea…' },
    storymap: { name: 'Story map', desc: 'Activities, user stories and releases', title: 'User story map', activities: ['Discover', 'Choose', 'Buy', 'Receive'], story: 'Story…', releases: ['Release 1 · MVP', 'Release 2', 'Later'] },
  },
};

function sticky(ctx, text, color, x, y) {
  return { id: ctx.nodeId(), kind: 'text', sticky: true, text, color, x, y, w: STICKY, h: STICKY };
}
function label(ctx, text, x, y, fontSize = 26, w = 320) {
  return { id: ctx.nodeId(), kind: 'label', text, x, y, w, h: 48, fontSize };
}
function frame(ctx, title, color, x, y, w, h) {
  return { id: ctx.groupId(), title, color, x, y, w, h };
}

const BUILDERS = {
  brainstorm(ctx, s) {
    const cx = 560, cy = 420;
    const topic = { id: ctx.nodeId(), kind: 'text', text: s.topic, color: '#FCE8C9', x: cx - 130, y: cy - 70, w: 260, h: 140 };
    const nodes = [topic];
    const R = 320;
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI * 2 * i) / 6 - Math.PI / 2;
      nodes.push(sticky(ctx, s.idea, STICKY_COLORS[(i + 1) % STICKY_COLORS.length],
        Math.round(cx + Math.cos(ang) * R - STICKY / 2),
        Math.round(cy + Math.sin(ang) * R - STICKY / 2)));
    }
    return { nodes, edges: [], groups: [], annotations: [] };
  },
  retro(ctx, s) {
    const W = 380, H = 560, GAP = 40, X0 = 60, Y0 = 60;
    const cols = [
      { title: s.good, color: GROUP_COLORS[0], sticky: STICKY_COLORS[2] },
      { title: s.improve, color: GROUP_COLORS[1], sticky: STICKY_COLORS[0] },
      { title: s.actions, color: GROUP_COLORS[2], sticky: STICKY_COLORS[3] },
    ];
    const groups = [], nodes = [];
    cols.forEach((c, i) => {
      const x = X0 + i * (W + GAP);
      groups.push(frame(ctx, c.title, c.color, x, Y0, W, H));
      nodes.push(sticky(ctx, s.seed, c.sticky, x + (W - STICKY) / 2, Y0 + 60));
    });
    return { nodes, edges: [], groups, annotations: [] };
  },
  kanban(ctx, s) {
    const W = 360, H = 640, GAP = 36, X0 = 60, Y0 = 60;
    const cols = [
      { title: `📋 ${s.todo}`, color: GROUP_COLORS[5] },
      { title: `🔨 ${s.doing}`, color: GROUP_COLORS[2] },
      { title: `✅ ${s.done}`, color: GROUP_COLORS[0] },
    ];
    const groups = [], nodes = [];
    cols.forEach((c, i) => {
      const x = X0 + i * (W + GAP);
      groups.push(frame(ctx, c.title, c.color, x, Y0, W, H));
      if (i === 0) {
        nodes.push(sticky(ctx, s.card, STICKY_COLORS[0], x + (W - STICKY) / 2, Y0 + 60));
        nodes.push(sticky(ctx, s.card, STICKY_COLORS[3], x + (W - STICKY) / 2, Y0 + 60 + STICKY + 24));
      }
    });
    return { nodes, edges: [], groups, annotations: [] };
  },
  mindmap(ctx, s) {
    const cx = 620, cy = 420;
    const root = { id: ctx.nodeId(), kind: 'text', text: s.root, color: '#FCE8C9', x: cx - 120, y: cy - 60, w: 240, h: 120 };
    const nodes = [root];
    const edges = [];
    const offsets = [
      { x: 420, y: -190 }, { x: 420, y: 70 },
      { x: -420 - 200, y: -190 }, { x: -420 - 200, y: 70 },
    ];
    offsets.forEach((o, i) => {
      const n = { id: ctx.nodeId(), kind: 'text', text: `${s.branch} ${i + 1}`, x: cx + o.x, y: cy + o.y, w: 200, h: 100 };
      nodes.push(n);
      edges.push({ id: ctx.edgeId ? ctx.edgeId() : ctx.nodeId(), from: root.id, to: n.id, kind: 'manual' });
    });
    return { nodes, edges, groups: [], annotations: [] };
  },
  timeline(ctx, s) {
    const X0 = 80, XW = 1200, Y = 480;
    const annotations = [{
      id: ctx.annoId(), kind: 'shape', shape: 'arrow',
      x1: X0, y1: Y, x2: X0 + XW, y2: Y,
      color: '#6b7280', strokeWidth: 3,
      bbox: { x: X0, y: Y - 2, w: XW, h: 4 },
    }];
    const nodes = [];
    for (let i = 0; i < 4; i++) {
      const x = X0 + 140 + i * 280;
      nodes.push(sticky(ctx, `${s.milestone} ${i + 1}`, STICKY_COLORS[i % STICKY_COLORS.length], x, Y - STICKY - 40));
      nodes.push(label(ctx, `${s.date}`, x + 30, Y + 24, 16));
    }
    return { nodes, edges: [], groups: [], annotations };
  },
  moodboard(ctx, s) {
    const groups = [frame(ctx, `🎨 ${s.title}`, GROUP_COLORS[3], 60, 60, 980, 660)];
    const nodes = [label(ctx, s.hint, 320, 340, 18)];
    return { nodes, edges: [], groups, annotations: [] };
  },
  weekly(ctx, s) {
    const W = 300, H = 520, GAP = 28, X0 = 40, Y0 = 60;
    const groups = [], nodes = [];
    s.days.forEach((d, i) => {
      const x = X0 + i * (W + GAP);
      groups.push(frame(ctx, d, GROUP_COLORS[i % GROUP_COLORS.length], x, Y0, W, H));
      if (i === 0) nodes.push(sticky(ctx, s.task, STICKY_COLORS[0], x + (W - STICKY) / 2, Y0 + 56));
    });
    return { nodes, edges: [], groups, annotations: [] };
  },
};

// ─── Plantillas nuevas: paleta neutra con acento azul ─────────────────────────
const ACCENT = '#2383E2';
const INK = '#1f2937';
const NEU_FRAME = 'rgba(107,114,128,0.07)';
const BLUE_FRAME = 'rgba(35,131,226,0.08)';
const BLUE_FRAME_2 = 'rgba(35,131,226,0.14)';
const SOFT = ['#dbeafe', '#e5e7eb', '#fef3c7', '#e0f2fe', '#fde2e2'];   // azul, gris, ámbar, celeste, rosa
const eid = (ctx) => (ctx.edgeId ? ctx.edgeId() : ctx.nodeId());

// Nota (cuadrada o rectangular) y tarjeta de la plantilla.
// Nota adhesiva de la plantilla (textos guía cortos: la nota autoajusta la fuente al cuadro).
function note(ctx, text, color, x, y, w = 180, h = 110) {
  return { id: ctx.nodeId(), kind: 'text', sticky: true, text, color, x, y, w, h };
}
function card(ctx, text, x, y, w, h, color) {
  const n = { id: ctx.nodeId(), kind: 'text', text, x, y, w, h };
  if (color) n.color = color;
  return n;
}
// Forma cerrada dibujada (anotación): conectable como cualquier ficha.
function shapeAnno(ctx, shape, x, y, w, h, text, opts = {}) {
  return {
    id: ctx.annoId(), kind: 'shape', shape, x, y, w, h,
    color: opts.color || ACCENT, strokeWidth: 2, fill: opts.fill || 'rgba(35,131,226,0.10)',
    ...(text ? { text } : {}), bbox: { x, y, w, h },
  };
}
function arrowAnno(ctx, x1, y1, x2, y2, color = '#6b7280') {
  return { id: ctx.annoId(), kind: 'shape', shape: 'arrow', x1, y1, x2, y2, color, strokeWidth: 2.5,
    bbox: { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) } };
}
function link(ctx, from, to, o = {}) {
  return { id: eid(ctx), from, to, kind: 'manual', route: 'ortho', ...o };
}

Object.assign(BUILDERS, {
  dafo(ctx, s) {
    const W = 560, H = 380, GAP = 24, X0 = 80, Y0 = 130;
    const groups = [], nodes = [];
    const cell = (i, key, title, color, noteColor) => {
      const x = X0 + (i % 2) * (W + GAP), y = Y0 + Math.floor(i / 2) * (H + GAP);
      groups.push(frame(ctx, title, color, x, y, W, H));
      s.ph[key].forEach((ph, k) => nodes.push(note(ctx, ph, noteColor, x + 40 + k * 250, y + 70, 220, 120)));
    };
    cell(0, 's', s.s, BLUE_FRAME_2, SOFT[0]); cell(1, 'w', s.w, NEU_FRAME, SOFT[1]);
    cell(2, 'o', s.o, BLUE_FRAME, SOFT[3]); cell(3, 't', s.t, NEU_FRAME, SOFT[4]);
    nodes.push(label(ctx, s.title, X0, 40, 28));
    nodes.push(label(ctx, s.helps, X0, 96, 15));
    nodes.push(label(ctx, s.hurts, X0 + W + GAP, 96, 15));
    return { nodes, edges: [], groups, annotations: [] };
  },
  journey(ctx, s) {
    const X0 = 220, Y0 = 130, W = 300, GAP = 16, H = 640;
    const groups = [], nodes = [];
    s.phases.forEach((ph, i) => groups.push(frame(ctx, ph, i % 2 ? NEU_FRAME : BLUE_FRAME, X0 + i * (W + GAP), Y0, W, H)));
    const rowY = [Y0 + 70, Y0 + 270, Y0 + 470];
    const rowText = [s.action, s.pain, s.opp], rowColor = [SOFT[0], SOFT[4], SOFT[3]];
    s.rows.forEach((r, k) => nodes.push(label(ctx, r, 40, rowY[k] + 36, 18, 170)));
    s.phases.forEach((_, i) => rowY.forEach((y, k) => nodes.push(note(ctx, rowText[k], rowColor[k], X0 + i * (W + GAP) + 50, y, 200, 120))));
    nodes.push(label(ctx, s.title, 40, 6, 28, 640));
    // curva de experiencia (flecha de lado a lado)
    const annotations = [arrowAnno(ctx, X0, Y0 - 12, X0 + 5 * (W + GAP) - GAP, Y0 - 12)];
    nodes.push(label(ctx, s.mood, X0, Y0 - 66, 14, 200));
    return { nodes, edges: [], groups, annotations };
  },
  okr(ctx, s) {
    const nodes = [], edges = [], annotations = [];
    const obj = shapeAnno(ctx, 'rect', 470, 70, 460, 130, s.objective, { fill: 'rgba(35,131,226,0.16)' });
    annotations.push(obj);
    nodes.push(label(ctx, s.tag, 470, 16, 14, 200));
    [100, 530, 960].forEach((x, i) => {
      const kr = shapeAnno(ctx, 'rect', x, 300, 340, 120, `${s.kr} ${i + 1}\n${s.krHint}`, { fill: 'rgba(35,131,226,0.08)' });
      const ini = note(ctx, s.init, SOFT[3], x + 80, 520, 180, 110);
      annotations.push(kr);
      nodes.push(ini);
      edges.push(link(ctx, obj.id, kr.id, { fromSide: 'b', toSide: 't', endHead: 'arrow' }));
      edges.push(link(ctx, kr.id, ini.id, { fromSide: 'b', toSide: 't', endHead: 'arrow', style: 'dashed' }));
    });
    return { nodes, edges, groups: [], annotations };
  },
  eisenhower(ctx, s) {
    const W = 540, H = 360, GAP = 20, X0 = 150, Y0 = 130;
    const groups = [], nodes = [];
    const q = [
      [s.q1, BLUE_FRAME_2, SOFT[0]], [s.q2, BLUE_FRAME, SOFT[3]],
      [s.q3, NEU_FRAME, SOFT[2]], [s.q4, NEU_FRAME, SOFT[1]],
    ];
    q.forEach(([title, col, nc], i) => {
      const x = X0 + (i % 2) * (W + GAP), y = Y0 + Math.floor(i / 2) * (H + GAP);
      groups.push(frame(ctx, title, col, x, y, W, H));
      nodes.push(note(ctx, s.task, nc, x + 40, y + 70, 200, 110));
    });
    nodes.push(label(ctx, s.title, X0, 30, 28, 640));
    nodes.push(label(ctx, s.urgent, X0 + 150, 82, 16, 200));
    nodes.push(label(ctx, s.notUrgent, X0 + W + GAP + 150, 82, 16, 200));
    nodes.push(label(ctx, s.important, 6, Y0 + 160, 16, 140));
    nodes.push(label(ctx, s.notImportant, 6, Y0 + H + GAP + 160, 16, 140));
    return { nodes, edges: [], groups, annotations: [] };
  },
  lean(ctx, s) {
    const C = 290, G = 10, X0 = 60, Y0 = 100, R = 250;
    const groups = [], nodes = [];
    const block = (title, hint, col, row, cs, rs, color) => {
      const x = X0 + col * (C + G), y = Y0 + row * (R + G), w = cs * C + (cs - 1) * G, h = rs * R + (rs - 1) * G;
      groups.push(frame(ctx, title, color, x, y, w, h));
      nodes.push(label(ctx, hint, x + 16, y + 56, 14, Math.min(w - 32, 560)));
    };
    block(s.problem, s.hProblem, 0, 0, 1, 2, BLUE_FRAME);
    block(s.solution, s.hSolution, 1, 0, 1, 1, NEU_FRAME);
    block(s.metrics, s.hMetrics, 1, 1, 1, 1, NEU_FRAME);
    block(s.uvp, s.hUvp, 2, 0, 1, 2, BLUE_FRAME_2);
    block(s.unfair, s.hUnfair, 3, 0, 1, 1, NEU_FRAME);
    block(s.channels, s.hChannels, 3, 1, 1, 1, NEU_FRAME);
    block(s.segments, s.hSegments, 4, 0, 1, 2, BLUE_FRAME);
    block(s.costs, s.hCosts, 0, 2, 3, 1, NEU_FRAME);
    block(s.revenue, s.hRevenue, 3, 2, 2, 1, NEU_FRAME);
    return { nodes, edges: [], groups, annotations: [] };
  },
  sprint(ctx, s) {
    const nodes = [], groups = [];
    groups.push(frame(ctx, s.goal, BLUE_FRAME_2, 60, 110, 1440, 150));
    nodes.push(label(ctx, s.title, 60, 36, 28, 640));
    const annotations = [shapeAnno(ctx, 'rect', 100, 160, 760, 80, s.goalHint, { fill: 'rgba(35,131,226,0.10)' })];
    nodes.push(label(ctx, s.capacity, 1160, 176, 18));
    const cols = [[s.backlog, NEU_FRAME, 2], [s.sprintBacklog, BLUE_FRAME, 1], [s.doing, BLUE_FRAME_2, 0], [s.done, NEU_FRAME, 0]];
    cols.forEach(([title, col, seeds], i) => {
      const x = 60 + i * 366, y = 290, w = 342, h = 560;
      groups.push(frame(ctx, title, col, x, y, w, h));
      for (let k = 0; k < seeds; k++) nodes.push(note(ctx, s.story, [SOFT[2], SOFT[3]][k % 2], x + (w - 200) / 2, y + 64 + k * 130, 200, 110));
    });
    return { nodes, edges: [], groups, annotations };
  },
  org(ctx, s) {
    const edges = [], annotations = [];
    const ceo = shapeAnno(ctx, 'rect', 640, 60, 260, 100, s.ceo, { fill: 'rgba(35,131,226,0.20)' });
    annotations.push(ceo);
    s.area.forEach((a, i) => {
      const ax = 120 + i * 480;
      const area = shapeAnno(ctx, 'rect', ax + 40, 290, 260, 90, a, { fill: 'rgba(35,131,226,0.10)' });
      annotations.push(area);
      edges.push(link(ctx, ceo.id, area.id, { fromSide: 'b', toSide: 't', endHead: 'none' }));
      [0, 1].forEach(k => {
        const p = shapeAnno(ctx, 'rect', ax + k * 210 - 10, 520, 190, 80, s.person, { fill: 'rgba(107,114,128,0.08)', color: '#6b7280' });
        annotations.push(p);
        edges.push(link(ctx, area.id, p.id, { fromSide: 'b', toSide: 't', endHead: 'none' }));
      });
    });
    return { nodes: [], edges, groups: [], annotations };
  },
  flow(ctx, s) {
    const start = shapeAnno(ctx, 'ellipse', 560, 50, 200, 80, s.start, { fill: 'rgba(35,131,226,0.18)' });
    const st1 = shapeAnno(ctx, 'rect', 550, 200, 220, 90, s.step1);
    const dec = shapeAnno(ctx, 'diamond', 530, 360, 260, 170, s.decision, { fill: 'rgba(107,114,128,0.12)', color: '#6b7280' });
    const st2 = shapeAnno(ctx, 'rect', 550, 610, 220, 90, s.step2);
    const end = shapeAnno(ctx, 'ellipse', 560, 780, 200, 80, s.end, { fill: 'rgba(35,131,226,0.18)' });
    const alt = shapeAnno(ctx, 'rect', 940, 400, 220, 90, s.alt);
    const db = shapeAnno(ctx, 'cylinder', 160, 190, 170, 110, s.db, { fill: 'rgba(107,114,128,0.12)', color: '#6b7280' });
    const nt = shapeAnno(ctx, 'callout', 90, 440, 220, 130, s.note, { fill: 'rgba(254,243,199,0.7)', color: '#b45309' });
    const edges = [
      link(ctx, start.id, st1.id, { fromSide: 'b', toSide: 't' }),
      link(ctx, st1.id, dec.id, { fromSide: 'b', toSide: 't' }),
      link(ctx, dec.id, st2.id, { fromSide: 'b', toSide: 't', label: s.yes }),
      link(ctx, dec.id, alt.id, { fromSide: 'r', toSide: 'l', label: s.no }),
      link(ctx, alt.id, st2.id, { fromSide: 'b', toSide: 'r' }),
      link(ctx, st2.id, end.id, { fromSide: 'b', toSide: 't' }),
      link(ctx, st1.id, db.id, { fromSide: 'l', toSide: 'r', style: 'dashed', route: 'straight' }),
    ];
    return { nodes: [], edges, groups: [], annotations: [start, st1, dec, st2, end, alt, db, nt] };
  },
  impact(ctx, s) {
    const W = 540, H = 340, GAP = 20, X0 = 150, Y0 = 130;
    const groups = [], nodes = [];
    const q = [[s.quick, BLUE_FRAME_2, SOFT[0]], [s.big, BLUE_FRAME, SOFT[3]], [s.fill, NEU_FRAME, SOFT[1]], [s.avoid, NEU_FRAME, SOFT[4]]];
    q.forEach(([title, col, nc], i) => {
      const x = X0 + (i % 2) * (W + GAP), y = Y0 + Math.floor(i / 2) * (H + GAP);
      groups.push(frame(ctx, title, col, x, y, W, H));
      nodes.push(note(ctx, s.idea, nc, x + 40, y + 70, 190, 100));
    });
    nodes.push(label(ctx, s.title, X0, 40, 28, 640));
    nodes.push(label(ctx, `${s.effort}  →  (${s.lo} · ${s.hi})`, X0 + 300, Y0 + 2 * H + GAP + 24, 16));
    nodes.push(label(ctx, `${s.impact}`, 30, Y0 + 20, 16));
    const annotations = [
      arrowAnno(ctx, X0 - 24, Y0 + 2 * H + GAP, X0 - 24, Y0),
      arrowAnno(ctx, X0, Y0 + 2 * H + GAP + 20, X0 + 2 * W + GAP, Y0 + 2 * H + GAP + 20),
    ];
    return { nodes, edges: [], groups, annotations };
  },
  storymap(ctx, s) {
    const nodes = [], groups = [];
    const X0 = 200, STEP = 280;
    nodes.push(label(ctx, s.title, 40, 30, 28, 640));
    const annotations = s.activities.map((a, i) => shapeAnno(ctx, 'rect', X0 + i * STEP, 110, 240, 80, a, { fill: 'rgba(35,131,226,0.16)' }));
    s.releases.forEach((r, k) => {
      const y = 230 + k * 250;
      groups.push(frame(ctx, r, k === 0 ? BLUE_FRAME_2 : NEU_FRAME, 40, y, X0 + s.activities.length * STEP - 20, 220));
      s.activities.forEach((_, i) => nodes.push(note(ctx, s.story, k === 0 ? SOFT[3] : SOFT[1], X0 + i * STEP + 30, y + 60, 180, 120)));
    });
    return { nodes, edges: [], groups, annotations };
  },
});

export const CANVAS_TEMPLATE_KEYS = ['brainstorm', 'retro', 'kanban', 'mindmap', 'timeline', 'moodboard', 'weekly',
  'dafo', 'journey', 'okr', 'eisenhower', 'lean', 'sprint', 'org', 'flow', 'impact', 'storymap'];

export const CANVAS_TEMPLATE_ICONS = {
  brainstorm: '💡', retro: '🔄', kanban: '📋', mindmap: '🧠',
  timeline: '📆', moodboard: '🎨', weekly: '🗓️',
  dafo: '🧭', journey: '🛤️', okr: '🎯', eisenhower: '⏱️', lean: '🧱', sprint: '🏃', org: '🏢', flow: '🔀', impact: '⚖️', storymap: '🗺️',
};

export function canvasTemplateInfo(lang) {
  const strings = L[lang] || L.es;
  return CANVAS_TEMPLATE_KEYS.map(key => ({
    key,
    icon: CANVAS_TEMPLATE_ICONS[key],
    name: strings[key].name,
    desc: strings[key].desc,
  }));
}

// ctx = { nodeId(), groupId(), annoId(), edgeId()? } — supplied by the caller so id
// formats stay consistent with each writer (app vs MCP).
export function buildCanvasTemplate(key, lang, ctx) {
  const builder = BUILDERS[key];
  if (!builder) throw new Error(`unknown canvas template: ${key}`);
  const strings = (L[lang] || L.es)[key];
  return builder(ctx, strings);
}
