/**
 * projects.js
 * Workspace multi-proyecto: guardar / cargar / listar / borrar análisis
 * en localStorage.
 *
 * Estructura de un proyecto guardado:
 * {
 *   id: 'p_<timestamp>_<rand>',
 *   name: 'string',           // nombre dado por el usuario
 *   client: 'string',
 *   notes: 'string',
 *   createdAt: ms,
 *   updatedAt: ms,
 *   status: 'cotizado' | 'cerrado' | 'en_curso' | 'archivado',
 *   inputs: { ...todos los campos del UI },
 *   metaSummary: { ...métricas clave para mostrar en lista },
 * }
 *
 * Nota: NO guardamos el array completo `state.results` porque es grande
 * (KB por punto × N puntos). Sólo los inputs + meta. Al cargar el proyecto,
 * el usuario debe re-correr "Analizar" — los resultados se rehidratan
 * desde cache de PVGIS/ERA5 (transparente al usuario).
 */

const PREFIX = 'solar-projects:v1:';
const INDEX_KEY = PREFIX + 'index';

/**
 * Lee el índice de proyectos.
 */
export function listProjects() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveIndex(list) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    if (e?.name === 'QuotaExceededError') {
      console.warn('[projects] localStorage quota exceeded');
    }
    return false;
  }
}

/**
 * Genera un ID único para un proyecto nuevo.
 */
function newId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

/**
 * Guarda un proyecto nuevo o actualiza uno existente.
 *
 * @param {object} project - { id?, name, client, notes, status, inputs, metaSummary }
 * @returns {string} id del proyecto
 */
export function saveProject(project) {
  const id = project.id || newId();
  const now = Date.now();
  const fullProject = {
    ...project,
    id,
    updatedAt: now,
    createdAt: project.createdAt || now,
  };
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify(fullProject));
  } catch (e) {
    console.error('[projects] cannot save project:', e);
    return null;
  }
  // Actualizar índice
  const idx = listProjects();
  const existing = idx.findIndex(p => p.id === id);
  const indexEntry = {
    id, name: project.name, client: project.client,
    status: project.status || 'cotizado',
    createdAt: fullProject.createdAt, updatedAt: now,
    metaSummary: project.metaSummary,
  };
  if (existing >= 0) idx[existing] = indexEntry;
  else idx.unshift(indexEntry);
  saveIndex(idx);
  return id;
}

/**
 * Carga un proyecto por ID.
 */
export function loadProject(id) {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Borra un proyecto.
 */
export function deleteProject(id) {
  localStorage.removeItem(PREFIX + id);
  const idx = listProjects().filter(p => p.id !== id);
  saveIndex(idx);
}

/**
 * Borra todos los proyectos (con confirmación del caller).
 */
export function clearAllProjects() {
  const idx = listProjects();
  for (const p of idx) localStorage.removeItem(PREFIX + p.id);
  localStorage.removeItem(INDEX_KEY);
  return idx.length;
}

/**
 * Estadísticas del workspace.
 */
export function workspaceStats() {
  const idx = listProjects();
  let bytes = 0;
  for (const p of idx) {
    const raw = localStorage.getItem(PREFIX + p.id);
    if (raw) bytes += (raw.length + (PREFIX + p.id).length) * 2;
  }
  bytes += (localStorage.getItem(INDEX_KEY)?.length || 0) * 2;
  return {
    count: idx.length,
    bytes,
    byStatus: idx.reduce((acc, p) => {
      acc[p.status || 'sin status'] = (acc[p.status || 'sin status'] || 0) + 1;
      return acc;
    }, {}),
  };
}

/**
 * Export del workspace a JSON (descarga).
 */
export function exportWorkspace() {
  const idx = listProjects();
  const projects = idx.map(p => loadProject(p.id)).filter(Boolean);
  return JSON.stringify({
    exported: new Date().toISOString(),
    version: 1,
    count: projects.length,
    projects,
  }, null, 2);
}

/**
 * Import desde un JSON exportado previamente.
 * Estrategia: re-genera IDs para evitar colisión con proyectos existentes.
 */
export function importWorkspace(jsonString) {
  let data;
  try { data = JSON.parse(jsonString); } catch { return { ok: false, error: 'JSON inválido' }; }
  if (!Array.isArray(data.projects)) return { ok: false, error: 'Estructura inválida (falta projects[])' };
  let imported = 0;
  for (const p of data.projects) {
    const newProject = { ...p, id: undefined, createdAt: Date.now(), updatedAt: Date.now() };
    const newProjectId = saveProject(newProject);
    if (newProjectId) imported++;
  }
  return { ok: true, imported, total: data.projects.length };
}

/**
 * Construye el metaSummary de un proyecto desde el state actual.
 */
export function buildMetaSummary(state) {
  const top = state.results?.[0];
  if (!top) return null;
  return {
    bestScore: top.score,
    bestYield: top.irr,
    region: state.regionInfo?.region,
    confidence: state.regionInfo?.confidence,
    hasEconomics: !!state.economics,
    hasPumping: !!state.pumping,
    hasBattery: !!state.battery,
    hasDiesel: !!state.diesel,
    hasWind: !!state.windResult,
    payback: state.economics?.simplePaybackYears,
    npv: state.economics?.npv,
  };
}
