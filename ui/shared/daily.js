// Nota diaria («Hoy»). Mismo contrato que la herramienta MCP
// get_or_create_daily_note (mcp/server.mjs): el nombre es la fecha ISO
// YYYY-MM-DD (fecha LOCAL), se busca por nombre en todos los vaults sin
// distinguir mayúsculas ni la extensión .md, y si no existe se crea en la
// raíz del vault. Así la app y los agentes abren siempre la misma nota.

export function localIsoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dailyNoteName(d = new Date()) {
  return localIsoDate(d);
}

const norm = (n) => String(n || '').toLowerCase().replace(/\.md$/, '');

export function findDailyNote(files, d = new Date()) {
  const target = norm(dailyNoteName(d));
  for (const f of files || []) if (f && norm(f.name) === target) return f;
  return null;
}

// Plantilla diaria sembrada por «Cargar plantillas de ejemplo» («Plantilla
// Diario» en español, «Daily Template» en inglés). Se usa si existe en el
// vault de destino; si no, el cuerpo es el mismo que crea el MCP.
const DAILY_TEMPLATE_NAMES = new Set(['plantilla diario', 'daily template']);
export function findDailyTemplate(templates, vaultId) {
  const inVault = (templates || []).filter(f => (f.vaultId || 'default') === vaultId);
  return inVault.find(f => DAILY_TEMPLATE_NAMES.has(norm(f.name))) || null;
}

export function defaultDailyBody(d = new Date()) {
  return `# ${dailyNoteName(d)}\n\n`;
}
