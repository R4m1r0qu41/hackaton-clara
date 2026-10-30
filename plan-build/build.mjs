// Genera plan-build.html (artefacto v3: sobre el repo cuentasClaras, dos equipos de dos, PRs). Uso: node build.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'plan-build.html');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CW = 6.3;
const warnings = [];

/* ---------- diagramas de secuencia ---------- */
function seq({ id, parts, steps, W = 1000 }) {
  const n = parts.length, left = 10, gap = (W - 2 * left) / n;
  const X = {};
  parts.forEach((p, i) => (X[p.k] = left + gap * (i + 0.5)));
  const bw = Math.min(gap - 16, 150);
  const frames = [], arrows = [], stack = [];
  let y = 72;
  const check = (text, avail, where) => {
    if (text.length * CW > avail) warnings.push(`${id}: "${text}" (${where}) ~${Math.round(text.length * CW)}px > ${Math.round(avail)}px`);
  };
  for (const s of steps) {
    if (s.alt) { stack.push({ y0: y - 8, label: s.alt, seps: [] }); y += 24; continue; }
    if (s.else) { stack[stack.length - 1].seps.push({ y: y - 6, label: s.else }); y += 22; continue; }
    if (s.end) {
      const f = stack.pop(), y1 = y - 4;
      frames.push(`<rect class="sq-frame" x="6" y="${f.y0}" width="${W - 12}" height="${y1 - f.y0}" rx="4"/>`);
      frames.push(`<text class="sq-t sq-fl" x="14" y="${f.y0 + 14}">alt · ${esc(f.label)}</text>`);
      for (const sp of f.seps) {
        frames.push(`<line class="sq-sep" x1="6" y1="${sp.y}" x2="${W - 6}" y2="${sp.y}"/>`);
        frames.push(`<text class="sq-t sq-fl" x="14" y="${sp.y + 14}">si no · ${esc(sp.label)}</text>`);
      }
      y += 8;
      continue;
    }
    if (s.note) {
      const x1 = X[s.over[0]] - 70, x2 = X[s.over[s.over.length - 1]] + 70;
      check(s.note, x2 - x1 - 12, 'nota');
      arrows.push(`<rect class="sq-note" x="${x1}" y="${y - 12}" width="${x2 - x1}" height="24" rx="4"/>`);
      arrows.push(`<text class="sq-t sq-nt" x="${(x1 + x2) / 2}" y="${y + 4}" text-anchor="middle">${esc(s.note)}</text>`);
      y += 36;
      continue;
    }
    if (s.self) {
      const x = X[s.self];
      arrows.push(`<path class="sq-arrow" d="M${x} ${y - 4} h30 v18 h-30" marker-end="url(#${id}-a)"/>`);
      arrows.push(`<text class="sq-t" x="${x + 38}" y="${y + 9}">${esc(s.text)}</text>`);
      check(s.text, W - (x + 38) - 8, 'auto');
      y += 40;
      continue;
    }
    const x1 = X[s.f], x2 = X[s.t];
    arrows.push(`<line class="${s.ret ? 'sq-arrow sq-ret' : 'sq-arrow'}" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" marker-end="url(#${id}-a)"/>`);
    arrows.push(`<text class="sq-t" x="${(x1 + x2) / 2}" y="${y - 6}" text-anchor="middle">${esc(s.text)}</text>`);
    check(s.text, Math.abs(x2 - x1) - 10, 'flecha');
    y += 34;
  }
  const H = y + 6;
  const heads = parts.map((p) => {
    const cx = X[p.k];
    check(p.name, bw - 6, 'participante');
    return `<rect class="sq-box" x="${cx - bw / 2}" y="8" width="${bw}" height="40" rx="6"/>` +
      `<text class="sq-h" x="${cx}" y="25" text-anchor="middle">${esc(p.name)}</text>` +
      `<text class="sq-sub" x="${cx}" y="39" text-anchor="middle">${esc(p.sub || '')}</text>`;
  }).join('');
  const lives = parts.map((p) => `<line class="sq-life" x1="${X[p.k]}" y1="48" x2="${X[p.k]}" y2="${H - 6}"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Diagrama de secuencia">` +
    `<defs><marker id="${id}-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>` +
    frames.join('') + lives + heads + arrows.join('') + `</svg>`;
}
function figure(svg, caption, label) {
  return `<figure class="diagram"><div class="scroll">${svg.replace('role="img" aria-label="Diagrama de secuencia"', `role="img" aria-label="${esc(label)}"`)}</div><figcaption>${caption}</figcaption></figure>`;
}

/* ---------- arquitectura ---------- */
function box(x, y, w, h, lines, cls = 'sq-box') {
  const lh = 15, top = y + h / 2 - ((lines.length - 1) * lh) / 2 + 4;
  const t = lines.map((l, i) => `<text class="${i === 0 ? 'sq-h' : 'sq-sub2'}" x="${x + w / 2}" y="${top + i * lh}" text-anchor="middle">${esc(l)}</text>`).join('');
  return `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>${t}`;
}
function arrow(x1, y1, x2, y2, label, opts = {}) {
  const lx = opts.lx ?? (x1 + x2) / 2, ly = opts.ly ?? (y1 + y2) / 2 - 6;
  return `<line class="${opts.dashed ? 'sq-arrow sq-ret' : 'sq-arrow'}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ar-a)"/>` +
    (label ? `<text class="sq-t" x="${lx}" y="${ly}" text-anchor="middle">${esc(label)}</text>` : '');
}
const archSvg = (() => {
  const p = [];
  p.push(`<rect class="sq-zone" x="640" y="14" width="420" height="372" rx="10"/>`);
  p.push(`<text class="sq-zt" x="656" y="36">Servidor Node.js (nuevo, CommonJS)</text>`);
  p.push(box(20, 60, 100, 50, ['Usuario', 'Telegram']));
  p.push(box(150, 60, 100, 50, ['Telegram', 'Bot API']));
  p.push(box(290, 40, 160, 100, ['n8n', 'Telegram y extracción', 'CETES y redacción'], 'sq-box sq-n8n'));
  p.push(box(290, 230, 110, 46, ['Banxico SIE', 'CETES']));
  p.push(box(420, 230, 120, 46, ['OpenRouter', 'DeepSeek']));
  p.push(box(20, 270, 110, 50, ['Usuario', 'navegador móvil']));
  p.push(box(660, 110, 150, 190, ['server/http', '/api/procesar', '/api/elegir-respuesta', '/api/verificar', '/api/consulta', '/api/acceso*']));
  p.push(box(840, 100, 200, 130, ['Módulos que ya existen', 'flujo/procesar · respuesta', 'sipres · calculo · semaforo', 'banxico · extraccion'], 'sq-box sq-core'));
  p.push(box(840, 290, 200, 56, ['datos/procesado/*.json', 'SIPRES y acceso por estado']));
  p.push(arrow(120, 85, 150, 85, ''));
  p.push(arrow(250, 85, 290, 85, ''));
  p.push(arrow(450, 72, 660, 72, 'POST /api/procesar', { lx: 555, ly: 64 }));
  p.push(arrow(450, 98, 660, 98, 'POST /api/elegir-respuesta', { lx: 555, ly: 114 }));
  p.push(arrow(345, 140, 345, 230, 'CETES', { lx: 372, ly: 190 }));
  p.push(arrow(480, 140, 480, 230, 'extraer y redactar', { lx: 480, ly: 185 }));
  p.push(arrow(660, 253, 540, 253, 'consulta', { lx: 600, ly: 245 }));
  p.push(arrow(130, 295, 660, 295, 'HTTP', { lx: 395, ly: 287 }));
  p.push(arrow(810, 165, 840, 165, ''));
  p.push(arrow(940, 230, 940, 290, 'lee', { lx: 956, ly: 263 }));
  return `<svg viewBox="0 0 1080 400" width="1080" height="400" role="img" aria-label="Arquitectura: n8n conserva Telegram, extracción, CETES y redacción, y llama al servidor solo en los dos nodos de cálculo; la página usa el endpoint de consulta; todo reutiliza los módulos existentes">` +
    `<defs><marker id="ar-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>` +
    p.join('') + `</svg>`;
})();

/* ---------- secuencias ---------- */
const S1 = seq({
  id: 's1',
  parts: [
    { k: 'u', name: 'Usuario', sub: 'Telegram' },
    { k: 't', name: 'Telegram', sub: 'Bot API' },
    { k: 'n', name: 'n8n', sub: 'flujo de GUIA-N8N' },
    { k: 'o', name: 'OpenRouter', sub: 'DeepSeek' },
    { k: 'h', name: 'server/http', sub: 'nuevo' },
    { k: 'm', name: 'Módulos', sub: 'procesar · respuesta' },
  ],
  steps: [
    { f: 'u', t: 't', text: 'texto de la oferta' },
    { f: 't', t: 'n', text: 'webhook' },
    { f: 'n', t: 'o', text: 'extraer (LLM)' },
    { f: 'o', t: 'n', text: 'JSON de extracción', ret: true },
    { f: 'n', t: 'h', text: 'POST /api/procesar' },
    { f: 'h', t: 'm', text: 'procesar()' },
    { f: 'm', t: 'h', text: 'responder o redactar', ret: true },
    { alt: 'accion = redactar' },
    { f: 'h', t: 'n', text: 'ctx y plantilla', ret: true },
    { f: 'n', t: 'o', text: 'redactar (LLM)' },
    { f: 'o', t: 'n', text: 'texto', ret: true },
    { f: 'n', t: 'h', text: 'POST /api/elegir-respuesta' },
    { f: 'h', t: 'n', text: 'texto + origen', ret: true },
    { else: 'accion = responder' },
    { f: 'h', t: 'n', text: 'texto final', ret: true },
    { end: true },
    { f: 'n', t: 't', text: 'sendMessage' },
    { f: 't', t: 'u', text: 'respuesta con fuente', ret: true },
  ],
});
const S2 = seq({
  id: 's2',
  parts: [
    { k: 'n', name: 'Navegador', sub: 'web/' },
    { k: 'h', name: 'server/http', sub: '/api/consulta' },
    { k: 'm', name: 'Módulos', sub: 'procesar · respuesta' },
    { k: 'o', name: 'OpenRouter', sub: 'DeepSeek' },
  ],
  steps: [
    { f: 'n', t: 'h', text: 'POST /api/consulta {texto}' },
    { f: 'h', t: 'o', text: 'extraer (LLM)' },
    { f: 'o', t: 'h', text: 'JSON de extracción', ret: true },
    { f: 'h', t: 'm', text: 'procesar()' },
    { f: 'm', t: 'h', text: 'responder o redactar', ret: true },
    { alt: 'accion = redactar' },
    { f: 'h', t: 'o', text: 'redactar (LLM)' },
    { f: 'o', t: 'h', text: 'texto', ret: true },
    { f: 'h', t: 'm', text: 'elegirRespuesta()' },
    { end: true },
    { f: 'h', t: 'n', text: '200 texto, color, origen', ret: true },
    { note: 'Sin clave o con falla del modelo, la respuesta sale con plantilla y lo dice (origen: plantilla).', over: ['n', 'o'] },
  ],
});
const S3 = seq({
  id: 's3',
  W: 900,
  parts: [
    { k: 'c', name: 'Cliente', sub: 'página o n8n' },
    { k: 'h', name: 'server/http', sub: 'verificar y acceso' },
    { k: 'd', name: 'datos/procesado', sub: 'JSON en memoria' },
  ],
  steps: [
    { f: 'c', t: 'h', text: 'GET /api/verificar?q=nombre' },
    { f: 'h', t: 'd', text: 'buscarEntidad(tabla, q)' },
    { f: 'd', t: 'h', text: 'estado y fecha', ret: true },
    { f: 'h', t: 'c', text: 'estado, fecha y términos buscados', ret: true },
    { note: 'Que no esté en la tabla da sin_verificar, nunca "no registrada".', over: ['c', 'h'] },
    { f: 'c', t: 'h', text: 'GET /api/acceso/estados' },
    { f: 'h', t: 'd', text: 'lee acceso_estados.json' },
    { f: 'h', t: 'c', text: 'valor, periodo y fuente', ret: true },
    { note: 'La página pinta el mapa (SVG) o barras. Sin dato oficial por estado, solo barras.', over: ['c', 'd'] },
  ],
});

/* ---------- ejemplos ---------- */
const procReq = `// n8n envía lo que ya tiene; el servidor agrega la tabla SIPRES, la config y la fecha
{
  "salidaLLM": { "…": "salida del nodo de extracción (texto o JSON)" },
  "cetesRespuesta": { "…": "respuesta de Banxico, o null si falló" }
}`;
const procRes = `// accion "responder": ya hay texto final (pregunta, cobranza, error)
{ "accion": "responder", "texto": "…", "motivo": "cobranza",
  "log": { "fecha": "…", "tipo_entrada": "cobranza", "semaforo": "n.a.", "estado_sipres": "n.a." },
  "advertencias": [] }

// accion "redactar": n8n pasa ctx al modelo de redacción
{ "accion": "redactar", "ctx": { "…": "contexto para el LLM" }, "plantilla": "…",
  "log": { "fecha": "…", "tipo_entrada": "oferta_credito", "semaforo": "gris", "estado_sipres": "sin_verificar" },
  "advertencias": ["sipres:no_esta_en_tabla"] }`;
const elegReq = `{ "textoLLM": "texto del modelo de redacción, o null si falló", "ctx": { "…": "el ctx de /api/procesar" } }`;
const elegRes = `{ "texto": "…", "origen": "llm",        // "llm" | "plantilla"
  "motivo": "ok",                                       // "verificacion_fallida" cuando cae a plantilla
  "fallas": [] }`;
const consReq = `{ "texto": "Préstamo de $5,000, me depositan $4,200, 4 pagos quincenales de $1,600" }`;
const consRes = `{ "texto": "…", "origen": "llm",       // "llm" | "plantilla" | "ejemplo" (stub inicial)
  "color": "amarillo",                                   // de log.semaforo; "n.a." si no hubo cálculo
  "estado_sipres": "sin_verificar",
  "motivo": "ok", "advertencias": [] }`;
const verRes = `GET /api/verificar?q=entidad%20de%20ejemplo
{ "estado": "registrada", "fecha_consulta": "30/10/2026", "terminos_buscados": ["…"],
  "entidad": "Entidad de Ejemplo", "motivo": "ok", "advertencias": [] }
// sin coincidencia: { "estado": "sin_verificar", "motivo": "no_esta_en_tabla", … }`;
const accRes = `GET /api/acceso/estados
{ "indicador": "…", "unidad": "…", "periodo": "…", "fuente_url": "…",
  "estados": [{ "estado_id": "…", "nombre": "…", "valor": null }] }   // null = desconocido, nunca 0

GET /api/acceso?estado=<estado_id>
{ "estado_id": "…", "nombre": "…", "indicador": "…", "valor": null, "periodo": "…", "fuente_url": "…" }`;
const saludRes = `{ "ok": true, "ia": false, "datos_al": "30/10/2026" }   // ia: hay clave de OpenRouter configurada`;
const errRes = `{ "error": { "codigo": "entrada_invalida", "mensaje": "Falta el campo texto." } }
// 400 entrada inválida · 401 clave del bot (X-Bot-Key) · 500 error propio
// Una falla del modelo NO es un error: responde 200 con origen "plantilla".`;
const swapCode = `// Nodo "Procesar" (antes Code con ~71 mil caracteres pegados) → HTTP Request
POST {BACKEND_URL}/api/procesar        cabecera X-Bot-Key (credencial)
cuerpo: salidaLLM = la salida de "Extraer foto" o "Extraer texto"
        cetesRespuesta = la salida de "Leer CETES"
// Nodo "Elegir respuesta" (antes Code) → HTTP Request
POST {BACKEND_URL}/api/elegir-respuesta
cuerpo: textoLLM = la salida de "Redactar (LLM)", ctx = el ctx del paso anterior
// Los nombres de nodo y las expresiones exactas: por verificar en el primer flujo real.`;

const FOLDERS = `cuentasClaras/                     (ya existe)
├─ extraccion/ · calculo/ · semaforo/ · sipres/ · banxico/ · respuesta/ · flujo/   módulos con pruebas
├─ n8n/
│  ├─ GUIA-N8N.md · nodos/   (ya existen; nodos/ se genera con scripts/empaquetar.js)
│  ├─ workflow-respaldo.json         NUEVO · flujo actual con los dos nodos empaquetados        [Equipo 2]
│  └─ workflow.json                  NUEVO · mismo flujo con dos nodos HTTP al servidor         [Equipo 2]
├─ server/                           NUEVO · node:http, CommonJS, sin dependencias              [Equipo 1]
│  ├─ index.js · config.js           arranque, carga de datos, claves desde el entorno
│  ├─ http/                          handlers de /api/*
│  ├─ ia/openrouter.js               extraer y redactar con los prompts de los .md
│  └─ test/                          node --test
├─ web/                              NUEVO · index.html · app.js · styles.css · mapa-estados.svg [Equipo 2]
├─ datos/procesado/                  NUEVO en esta carpeta                                       [Equipos 1 y 2]
│  ├─ sipres_entidades.json          capturada a mano; JR verifica                               [Equipo 1]
│  └─ acceso_estados.json            indicador oficial por estado; JR verifica                   [Equipo 2]
└─ scripts/empaquetar.js             ya existe; regenera n8n/nodos/`;

/* ---------- tablas ---------- */
const tr = (cells, tag = 'td') => `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
const table = (head, rows, cls = '') => `<div class="scroll"><table class="${cls}"><thead>${tr(head, 'th')}</thead><tbody>${rows.map((r) => tr(r)).join('')}</tbody></table></div>`;
const c = (s) => `<code>${esc(s)}</code>`;
const pre = (s) => `<pre><code>${esc(s)}</code></pre>`;
const ul = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

const existeRows = [
  [c('extraccion/'), 'Esquema JSON, prompt de extracción y ' + c('validarExtraccion()') + '. Normaliza números, detecta faltantes y pide aclaraciones.', c('validar-extraccion.test.js')],
  [c('calculo/'), c('calcular()') + ': costo total, sobrecosto y CAT implícito estimado; alternativa de ahorro en CETES.', c('calculo.test.js')],
  [c('semaforo/'), c('semaforo()') + ': color y razones con hechos. Umbrales propuestos: tienda 15% y 50%, préstamo costo desde 50%. Sin SIPRES verificado da gris, nunca rojo.', c('semaforo.test.js')],
  [c('sipres/'), c('buscarEntidad()') + ' y ' + c('validarTabla()') + ' con los tres estados. La tabla se captura a mano.', c('sipres.test.js')],
  [c('banxico/'), c('tasaCetes()') + ' con respaldo local (6.22 al 29/10/2026) si la API falla.', c('banxico.test.js')],
  [c('respuesta/'), 'Contexto para el modelo, plantillas, ' + c('verificarRespuesta()') + ' y ' + c('elegirRespuesta()') + ' (modelo o plantilla).', c('respuesta.test.js')],
  [c('flujo/procesar.js'), 'Orquesta todo el cálculo. Devuelve ' + c('accion: "responder"') + ' o ' + c('"redactar"') + '.', c('procesar.test.js') + ', ' + c('empaquetado.test.js')],
  [c('n8n/'), 'Guía para armar el flujo y dos nodos Code generados con ' + c('scripts/empaquetar.js') + '.', '—'],
];
const nuevoRows = [
  ['Servidor Node.js', 'Envuelve los módulos con ' + c('require') + '. Unas 50 líneas para los dos endpoints de n8n; más para consulta, verificar y acceso.', 'Equipo 1'],
  [c('/api/verificar'), 'Búsqueda de entidad con ' + c('sipres.js') + ' para la página y para el comando ' + c('/verificar') + ' del bot.', 'Equipo 1'],
  [c('/api/consulta'), 'La misma cadena del flujo, pero orquestada en el servidor con OpenRouter, para que la página no dependa de n8n.', 'Equipo 1'],
  ['Página HTML', 'Pegar una oferta, ver color, texto y fuente; buscar una entidad; mapa.', 'Equipo 2'],
  ['Mapa por estado', 'Indicador oficial con periodo y fuente; sin dato, gráfico de barras.', 'Equipo 2'],
  ['Cambio en n8n', 'Dos nodos Code pasan a HTTP Request; se agrega la rama ' + c('/verificar') + '. El flujo actual queda como respaldo.', 'Equipo 2'],
  ['Datos', c('sipres_entidades.json') + ' y ' + c('acceso_estados.json') + ', verificados por JR.', 'Equipos 1 y 2'],
];
const endpointRows = [
  [c('GET /api/salud'), 'Estado, si hay clave de IA y la fecha de los datos.', 'Página y n8n'],
  [c('POST /api/procesar'), 'Envuelve ' + c('flujo/procesar.js') + '. Sustituye al nodo Code "Procesar".', 'n8n'],
  [c('POST /api/elegir-respuesta'), 'Envuelve ' + c('respuesta.elegirRespuesta') + '. Sustituye al nodo Code "Elegir respuesta".', 'n8n'],
  [c('POST /api/consulta'), 'Cadena completa con OpenRouter. En el primer PR devuelve una respuesta fija de ejemplo para desbloquear a la página.', 'Página (n8n opcional)'],
  [c('GET /api/verificar?q='), 'Estado SIPRES de una entidad, con fecha.', 'Página y n8n'],
  [c('GET /api/acceso/estados') + ', ' + c('GET /api/acceso?estado='), 'Indicador oficial por estado, periodo y fuente.', 'Página'],
];
const n8nSwapRows = [
  ['Telegram Trigger, Tipo de mensaje, Preparar foto, Descargar foto', 'Sin cambio', 'Se agrega una salida ' + c('/verificar') + ' en el Switch.'],
  ['Extraer foto, Extraer texto, Redactar (LLM)', 'Sin cambio', 'Siguen en n8n con los prompts de los .md. La foto exige un modelo con visión (por verificar); el texto funciona con DeepSeek.'],
  ['Leer CETES', 'Sin cambio', 'Si Banxico falla, el servidor usa el respaldo.'],
  ['Procesar (Code)', 'HTTP Request ' + c('/api/procesar'), 'Quita ~71 mil caracteres pegados en el nodo.'],
  ['Elegir respuesta (Code)', 'HTTP Request ' + c('/api/elegir-respuesta'), 'Con ' + c('Continue on error') + ': si el servidor falla, la rama de error envía un mensaje fijo.'],
  ['Enviar respuesta, Log anónimo', 'Sin cambio', 'Los ajustes de privacidad de la guía (no guardar ejecuciones) siguen siendo obligatorios.'],
];

const errRows = [
  ['El servidor no responde o la clave del bot es incorrecta', 'El nodo HTTP tiene timeout de 10 s y una rama de error con un mensaje fijo. Además, ' + c('n8n/workflow-respaldo.json') + ' sigue funcionando sin servidor.'],
  ['El modelo de redacción falla o el verificador lo rechaza', c('elegirRespuesta') + ' envía la plantilla con las mismas cifras; ' + c('origen: "plantilla"') + '.'],
  ['El modelo de extracción devuelve algo ilegible', c('procesar') + ' responde ' + c('error_formato') + ' o pide aclaración; no calcula nada.'],
  ['Banxico falla', 'Respaldo local con fecha y la respuesta dice que es dato de respaldo.'],
  ['La entidad no está en la tabla', c('sin_verificar') + ': gris con enlace a SIPRES. Nunca rojo.'],
  ['Falta el dato del mapa', 'Gráfico de barras con lo que sí hay; los desconocidos son ' + c('null') + '.'],
  ['Dos n8n con el mismo bot', 'Telegram entrega a un solo webhook por token: el último n8n que activa el Trigger se queda con los mensajes. Un n8n para la demo y un bot de prueba de BotFather para cada persona.'],
  ['n8n guarda el texto de las conversaciones', 'Desactivar el guardado de ejecuciones y activar Redact (sección 4 de la guía). Probarlo con un mensaje de prueba.'],
  ['Una sola clave de OpenRouter para todos', 'Cada participante tiene su propia clave (crédito por persona, no compartido). Decidir cuál usa el servidor y cuál usa n8n.'],
  ['Sin internet en el lugar', 'La página y el servidor corren en local con los datos capturados. Telegram, n8n y el modelo necesitan red.'],
];

const e1Rows = [
  ['1A · Persona 1', c('server/index.js') + ' con ' + c('node:http') + ' y CommonJS: ' + c('/api/salud') + ', ' + c('/api/procesar') + ', ' + c('/api/elegir-respuesta') + ' y un ' + c('/api/consulta') + ' que devuelve un ejemplo fijo. Carga la tabla SIPRES y la config al arrancar. <b>Es el primer PR: desbloquea al Equipo 2.</b>', 'Con una salida de extracción de ejemplo, el endpoint devuelve lo mismo que ' + c('procesar()') + ' directo. ' + c('node --test') + ' verde.'],
  ['1B · Persona 2', c('datos/procesado/sipres_entidades.json') + ' (8 a 10 entidades, formato de ' + c('sipres.js') + ') y ' + c('GET /api/verificar') + '. JR verifica cada fila.', c('validarTabla()') + ' devuelve lista vacía; el endpoint responde los tres estados.'],
  ['1C · Persona 1', c('server/ia/openrouter.js') + ' y el ' + c('/api/consulta') + ' real: extraer, ' + c('procesar') + ', redactar, ' + c('elegirRespuesta') + '. Sin clave: plantilla visible.', 'Un texto de oferta de ejemplo devuelve color y texto; sin clave devuelve ' + c('origen: "plantilla"') + '.'],
  ['1D · Persona 2', c('GET /api/acceso/estados') + ' y ' + c('/api/acceso?estado=') + ' sobre ' + c('acceso_estados.json') + ', con pruebas.', 'Responde los datos que captura el Equipo 2; ' + c('null') + ' donde se desconoce.'],
  ['1E · Ambas', 'Revisar los PR del Equipo 2 y mantener el servidor sin dependencias de npm.', 'Cada PR del Equipo 2 tiene una revisión de este equipo.'],
];
const e2Rows = [
  ['2A · Persona 1', 'Levantar el flujo de ' + c('GUIA-N8N.md') + ' con su propio bot de prueba, privacidad y túnel. Exportar ' + c('n8n/workflow-respaldo.json') + ' sin credenciales. <b>No depende del servidor.</b>', 'Un mensaje de texto recibe respuesta; las ejecuciones no guardan datos.'],
  ['2B · Persona 1', c('n8n/workflow.json') + ': dos nodos HTTP en lugar de los Code, timeout y rama de error, salida ' + c('/verificar') + '.', 'Misma respuesta que el respaldo; con el servidor apagado, llega el mensaje fijo.'],
  ['2C · Persona 2', c('web/') + ': caja para pegar una oferta, buscador de entidad, resultado con color, texto, fuente y fecha, y el origen (modelo o plantilla). Contra el ' + c('/api/consulta') + ' de ejemplo primero.', 'Tres textos de ejemplo en celular; ' + c('null') + ' visible como dato faltante.'],
  ['2D · Persona 2', c('datos/procesado/acceso_estados.json') + ' (JR verifica) y el mapa por estado o barras.', 'Muestra indicador, periodo y fuente; no sugiere acceso personal.'],
  ['2E · Ambas', 'Prueba de punta a punta en celular: Telegram → n8n → servidor, página, servidor apagado y sin IA.', 'Los cuatro casos pasan; el enlace del bot abre la página.'],
];
const tasksTable = (rows) => table(['Tarea', 'Qué se hace', 'Hecho cuando'], rows, 'wrapfirst');

const openRows = [
  ['JR', 'Reglas del Hub sobre código previo', 'El repo se creó hoy pero su primer commit trae módulos y pruebas ya hechos. Confirmar en las reglas si se permite usar preparación previa y, si piden declararla, hacerlo en el README.'],
  ['Julio + Equipo 2', 'Dónde corre n8n y cómo llega al servidor', 'El Telegram Trigger necesita una URL HTTPS pública para n8n (lo dice la guía). Si n8n y el servidor corren en la misma máquina, el servidor basta con ' + c('localhost') + '; si n8n es remoto, el servidor necesita un túnel. Por eso el flujo de respaldo se conserva.'],
  ['Julio', 'Quién hace merge y qué reglas de PR', 'Propuesta abajo. Falta confirmar quién integra y si hay protección de ' + c('main') + '.'],
  ['JR + Equipo 2', 'Modelo con visión', 'La foto necesita un modelo con visión (por verificar). El texto funciona con ' + c('deepseek/deepseek-v4.1-flash') + '. P0 es texto; la foto entra si hay visión confirmada.'],
  ['JR + Equipo 1', 'Clave de OpenRouter para el servidor y para n8n', 'El crédito es por participante, no compartido. Decidir qué clave usa el servidor y cuál n8n; nunca en el repo ni en el JSON exportado.'],
  ['JR', 'Umbrales del semáforo', 'Son propuestas de Julio (tienda 15% y 50%, préstamo costo desde 50%). JR los valida; el amarillo por comparación con referencia de categoría queda fuera de P0.'],
  ['JR', 'Selección guiada con productos reales', 'Queda como P1 si P0 está estable. Exige un adaptador nuevo (unos 30 min) que calcule el pago desde la tasa del producto, porque ' + c('calcular()') + ' espera pagos y no tasas, más productos verificados.'],
  ['Equipo', 'Tarjetas con pago mínimo', 'No hay fórmula verificada; no se inventa.'],
];

const nav = [
  ['resumen', 'Resumen'], ['existe', 'Qué existe y qué se agrega'], ['arquitectura', 'Arquitectura'], ['endpoints', 'Endpoints'],
  ['n8n', 'Cambio en n8n'], ['flujos', 'Secuencias'], ['datos', 'Datos y carpetas'], ['equipo-1', 'Equipo 1'], ['equipo-2', 'Equipo 2'],
  ['prs', 'Reglas de PR'], ['errores', 'Errores y respaldos'], ['abiertas', 'Decisiones abiertas'],
];

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plan de build de Crédito Claro</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
/* Plan: documento técnico de equipo. Índice fijo a la izquierda, texto a 72ch, diagramas anchos con scroll propio. */
:root{
  --bg:#f2f6f5; --surface:#ffffff; --ink:#13201e; --muted:#4d5f5b; --line:#d3dedb; --line-strong:#9db1ac;
  --accent:#0b6e5f; --accent-wash:#e1f2ee; --warn-wash:#fff3d1; --code-bg:#eaf0ee; --warn:#a96a00;
  --font-display:'Familjen Grotesk',system-ui,sans-serif; --font-body:'IBM Plex Sans',system-ui,sans-serif; --font-mono:'IBM Plex Mono',ui-monospace,monospace;
  color-scheme:light;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#0d1514; --surface:#14201e; --ink:#e4eeec; --muted:#9db1ad; --line:#243633; --line-strong:#41584f;
    --accent:#45c8b0; --accent-wash:#10332d; --warn-wash:#3a3115; --code-bg:#1a2927; --warn:#e0a63b; color-scheme:dark;
  }
}
:root[data-theme="dark"]{
  --bg:#0d1514; --surface:#14201e; --ink:#e4eeec; --muted:#9db1ad; --line:#243633; --line-strong:#41584f;
  --accent:#45c8b0; --accent-wash:#10332d; --warn-wash:#3a3115; --code-bg:#1a2927; --warn:#e0a63b; color-scheme:dark;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.6 var(--font-body)}
a{color:var(--accent)}
.shell{display:grid;grid-template-columns:210px minmax(0,1fr);gap:40px;max-width:1240px;margin:0 auto;padding:32px 20px 80px}
nav.toc{position:sticky;top:24px;align-self:start;font-size:14px}
nav.toc p{margin:0 0 10px;font:600 12px var(--font-display);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
nav.toc a{display:block;padding:5px 0 5px 12px;border-left:2px solid var(--line);color:var(--muted);text-decoration:none}
nav.toc a:hover,nav.toc a:focus-visible{color:var(--ink);border-left-color:var(--accent)}
main{min-width:0}
header.top{padding:4px 0 28px;border-bottom:1px solid var(--line);margin-bottom:8px}
header.top .tag{display:inline-block;font:600 12px var(--font-display);letter-spacing:.06em;text-transform:uppercase;color:var(--accent);background:var(--accent-wash);padding:3px 10px;border-radius:999px}
h1{font:700 clamp(30px,5vw,44px)/1.1 var(--font-display);margin:14px 0 10px;text-wrap:balance}
header.top p{margin:0;max-width:72ch;color:var(--muted)}
h2{font:600 26px/1.2 var(--font-display);margin:0 0 14px;text-wrap:balance}
h3{font:600 18px/1.3 var(--font-display);margin:26px 0 8px}
section{padding:36px 0 8px;border-top:1px solid var(--line);margin-top:28px;scroll-margin-top:12px}
header.top + section{border-top:0;margin-top:0}
p,li{max-width:72ch}
ul,ol{padding-left:22px}
li{margin:4px 0}
code{font:400 .88em var(--font-mono);background:var(--code-bg);padding:1px 6px;border-radius:4px}
pre{background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow-x:auto;margin:10px 0 18px;font-size:13px;line-height:1.55}
pre code{background:none;padding:0;font-size:inherit}
.scroll{overflow-x:auto;max-width:100%}
table{border-collapse:collapse;width:100%;font-size:14.5px;background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:10px 0 18px}
th,td{text-align:left;vertical-align:top;padding:9px 12px;border-bottom:1px solid var(--line)}
th{font:600 12px var(--font-display);letter-spacing:.05em;text-transform:uppercase;color:var(--muted);background:var(--code-bg);white-space:nowrap}
tr:last-child td{border-bottom:0}
td:first-child{white-space:nowrap}
table.wrapfirst td:first-child{white-space:normal}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin:14px 0}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.card h3{margin:0 0 6px;font-size:16px}
.card p{margin:0;font-size:14.5px;color:var(--muted)}
.callout{background:var(--warn-wash);border-left:4px solid var(--warn);border-radius:6px;padding:12px 16px;margin:16px 0;max-width:76ch}
.callout.ok{background:var(--accent-wash);border-left-color:var(--accent)}
.callout p{margin:0}
.ep{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:16px 0}
.ep h3{margin:0 0 4px;font:500 16px var(--font-mono)}
.ep h3 span{display:inline-block;font:600 12px var(--font-display);letter-spacing:.05em;background:var(--accent);color:var(--bg);padding:2px 8px;border-radius:4px;margin-right:8px;vertical-align:1px}
.ep p{margin:4px 0 8px;color:var(--muted);font-size:14.5px}
.ep pre{margin:6px 0 8px}
.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.pair > div{min-width:0}
.pair b{font:600 12px var(--font-display);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
figure.diagram{margin:18px 0 26px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px}
figure.diagram svg{display:block;width:100%;min-width:760px;height:auto;max-width:none;color:var(--ink)}
figcaption{margin-top:10px;font-size:14px;color:var(--muted);max-width:80ch}
.note-ill{font-size:13.5px;color:var(--muted)}
.sq-box{fill:var(--surface);stroke:currentColor;stroke-width:1.2}
.sq-core{fill:var(--accent-wash);stroke:var(--accent);stroke-width:1.6}
.sq-n8n{fill:var(--warn-wash);stroke:var(--warn);stroke-width:1.4}
.sq-zone{fill:none;stroke:var(--line-strong);stroke-width:1.4;stroke-dasharray:6 5}
.sq-zt{font:600 12px var(--font-display);fill:var(--muted);letter-spacing:.04em}
.sq-life{stroke:var(--line-strong);stroke-width:1;stroke-dasharray:3 5}
.sq-arrow{stroke:currentColor;stroke-width:1.3;fill:none}
.sq-ret{stroke-dasharray:6 3}
.sq-sep{stroke:var(--accent);stroke-width:1;stroke-dasharray:5 4}
.sq-frame{fill:var(--accent-wash);stroke:var(--accent);stroke-width:1;opacity:.6}
.sq-note{fill:var(--warn-wash);stroke:var(--line-strong);stroke-width:1}
.sq-t{font:400 11.5px var(--font-body);fill:currentColor;paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round}
.sq-fl{font-weight:600;fill:var(--accent);font-size:11px}
.sq-nt{font-style:italic}
.sq-h{font:600 12.5px var(--font-display);fill:currentColor}
.sq-sub,.sq-sub2{font:400 10px var(--font-body);fill:var(--muted)}
@media (max-width:900px){
  .shell{grid-template-columns:minmax(0,1fr);gap:0;padding:20px 16px 60px}
  nav.toc{position:static;margin-bottom:20px;display:flex;flex-wrap:wrap;gap:4px 14px}
  nav.toc p{width:100%}
  nav.toc a{border-left:0;padding:2px 0}
  td:first-child{white-space:normal}
}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}}
a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style>
</head>
<body>
<div class="shell">
<nav class="toc" aria-label="Índice"><p>Plan de build</p>${nav.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</nav>
<main>

<header class="top">
  <span class="tag">Propuesta para aprobar · v3 · 30/10/2026</span>
  <h1>Plan de build de Crédito Claro</h1>
  <p>El trabajo ocurre en <b>Julio-Cuellar/cuentasClaras</b>, por pull requests, con cuatro personas en dos equipos de dos. El repo ya tiene el motor: extracción, cálculo, semáforo, SIPRES, Banxico y respuesta con verificador. El plan agrega un servidor pequeño en Node.js, la página, el mapa y un cambio de dos nodos en n8n.</p>
</header>

<section id="resumen">
  <h2>Resumen</h2>
  <div class="cards">
    <div class="card"><h3>Se reutiliza el motor</h3><p>No se reescribe nada. El servidor hace ${c('require')} de los módulos que ya tienen pruebas. Todo el repo es CommonJS y el servidor también.</p></div>
    <div class="card"><h3>n8n cambia solo dos nodos</h3><p>Los nodos Code "Procesar" y "Elegir respuesta" pasan a HTTP Request hacia el servidor. El resto del flujo de ${c('GUIA-N8N.md')} sigue igual, y el flujo actual queda como respaldo.</p></div>
    <div class="card"><h3>La página usa el mismo motor</h3><p>${c('/api/consulta')} corre la misma cadena en el servidor, así que la página no depende de n8n.</p></div>
    <div class="card"><h3>Sin base de datos</h3><p>Dos archivos JSON capturados a mano en ${c('datos/procesado/')}. Python no entra: el repo es Node.js de punta a punta.</p></div>
  </div>
  <div class="callout ok"><p><b>Entrada de P0:</b> una persona pega el texto de una oferta o etiqueta; el modelo lo extrae y ${c('procesar()')} calcula, asigna el semáforo y verifica la entidad. Además: verificar una entidad por nombre, la página y el mapa. La selección guiada por productos reales queda como P1.</p></div>
  <p class="note-ill">Este plan sustituye a las versiones anteriores del artefacto. La documentación de ${c('credito_claro')} (por ejemplo ${c('plan-equipo.md')} y ${c('scope-equipo.md')}) quedó desactualizada.</p>
</section>

<section id="existe">
  <h2>Qué existe y qué se agrega</h2>
  <h3>Ya está en el repo</h3>
  ${table(['Carpeta', 'Qué hace', 'Pruebas'], existeRows, 'wrapfirst')}
  <p class="note-ill">La guía de n8n menciona 157 pruebas en verde. No las ejecuté.</p>
  <h3>Se agrega</h3>
  ${table(['Pieza', 'Qué es', 'Quién'], nuevoRows, 'wrapfirst')}
</section>

<section id="arquitectura">
  <h2>Arquitectura</h2>
  ${figure(archSvg, 'n8n conserva Telegram, la extracción, CETES y la redacción, y llama al servidor solo en los dos nodos de cálculo. La página llama a ' + c('/api/consulta') + ', que repite la cadena en el servidor. Todo reutiliza los módulos que ya existen.', 'Arquitectura: n8n conserva Telegram, extracción, CETES y redacción, y llama al servidor solo en los dos nodos de cálculo; la página usa el endpoint de consulta')}
</section>

<section id="endpoints">
  <h2>Endpoints</h2>
  <p>JSON en español. Las formas salen de lo que devuelven los módulos hoy: ${c('procesar()')} y ${c('elegirRespuesta()')}. Los ejemplos son ilustrativos y no son datos reales.</p>
  ${table(['Ruta', 'Qué hace', 'La consume'], endpointRows, 'wrapfirst')}
  <div class="ep"><h3><span>POST</span>/api/procesar</h3><p>Sustituye al nodo Code "Procesar". El servidor agrega la tabla SIPRES, la configuración y la fecha de hoy (formato por verificar en ${c('flujo/procesar.test.js')}).</p>
    <div class="pair"><div><b>Entrada</b>${pre(procReq)}</div><div><b>Salida 200</b>${pre(procRes)}</div></div></div>
  <div class="ep"><h3><span>POST</span>/api/elegir-respuesta</h3><p>Sustituye al nodo Code "Elegir respuesta".</p>
    <div class="pair"><div><b>Entrada</b>${pre(elegReq)}</div><div><b>Salida 200</b>${pre(elegRes)}</div></div></div>
  <div class="ep"><h3><span>POST</span>/api/consulta</h3><p>Para la página. Extrae, calcula, redacta y verifica en el servidor. En el primer PR devuelve una respuesta fija con ${c('origen: "ejemplo"')}.</p>
    <div class="pair"><div><b>Entrada</b>${pre(consReq)}</div><div><b>Salida 200</b>${pre(consRes)}</div></div></div>
  <div class="ep"><h3><span>GET</span>/api/verificar</h3><p>La tabla se carga de ${c('datos/procesado/sipres_entidades.json')}.</p>${pre(verRes)}</div>
  <div class="ep"><h3><span>GET</span>/api/acceso/estados · /api/acceso?estado=</h3><p>Siempre indicador, periodo y fuente. Nunca cobertura por domicilio.</p>${pre(accRes)}</div>
  <div class="ep"><h3><span>GET</span>/api/salud · errores</h3>${pre(saludRes + '\n\n' + errRes)}</div>
  <p>Los endpoints de n8n llevan una clave compartida en la cabecera ${c('X-Bot-Key')}, guardada como credencial de n8n y como variable de entorno del servidor, porque quedan expuestos por un túnel si n8n es remoto.</p>
</section>

<section id="n8n">
  <h2>Cambio en n8n</h2>
  <p>Se parte del flujo de ${c('n8n/GUIA-N8N.md')}. Solo cambian dos nodos y se agrega una rama.</p>
  ${table(['Nodos del flujo', 'Cambio', 'Nota'], n8nSwapRows, 'wrapfirst')}
  ${pre(swapCode)}
  <div class="callout"><p>El flujo actual, con los dos nodos empaquetados, se exporta como ${c('n8n/workflow-respaldo.json')} y queda inactivo. Si el servidor o el túnel fallan durante la demo, se activa ese y el bot responde igual.</p></div>
</section>

<section id="flujos">
  <h2>Secuencias</h2>
  <h3>1 · Bot de Telegram con n8n</h3>
  ${figure(S1, 'El flujo es el de la guía; solo los dos pasos de cálculo van al servidor. Si el modelo de redacción falla, ' + c('elegirRespuesta') + ' envía la plantilla.', 'Secuencia: bot de Telegram con n8n')}
  <h3>2 · Página con /api/consulta</h3>
  ${figure(S2, 'La página recibe el texto final, el color del semáforo y de dónde salió la respuesta.', 'Secuencia: página con consulta')}
  <h3>3 · Verificar entidad y mapa</h3>
  ${figure(S3, 'La verificación usa la tabla capturada a mano. El mapa muestra solo lo que dice la fuente oficial.', 'Secuencia: verificar entidad y mapa')}
</section>

<section id="datos">
  <h2>Datos y carpetas</h2>
  <p><b>No usamos base de datos.</b> Son pocas filas de solo lectura, capturadas a mano y cargadas en memoria al arrancar.</p>
  ${table(['Archivo', 'Contenido', 'Lo captura', 'Lo verifica'], [
    [c('datos/procesado/sipres_entidades.json'), 'Filas con ' + c('nombre_comercial') + ', ' + c('razon_social') + ', ' + c('estado') + ', ' + c('terminos_buscados') + ' y ' + c('fecha_consulta') + ' (formato de ' + c('sipres.js') + '). "No registrada" exige fecha y al menos 2 términos buscados.', 'Equipo 1', 'JR'],
    [c('datos/procesado/acceso_estados.json'), 'Indicador oficial por estado con periodo y URL de la fuente. Desconocido es ' + c('null') + '.', 'Equipo 2', 'JR'],
    ['Respaldo de CETES', 'Ya está en ' + c('banxico/banxico.js') + ' (6.22 al 29/10/2026).', 'Existe', 'JR'],
  ], 'wrapfirst')}
  ${pre(FOLDERS)}
</section>

<section id="equipo-1">
  <h2>Equipo 1 · Servidor y verificación</h2>
  <p>Dos personas, dos pistas. Rutas: ${c('server/')} y ${c('datos/procesado/sipres_entidades.json')}. La tarea 1A va primero y en un PR pequeño, porque desbloquea a la página y al n8n nuevo.</p>
  ${tasksTable(e1Rows)}
  <p>No tocar: ${c('web/')} y ${c('n8n/')} (Equipo 2) ni los módulos existentes sin un PR propio que regenere ${c('n8n/nodos/')} (ver reglas de PR).</p>
</section>

<section id="equipo-2">
  <h2>Equipo 2 · n8n, página y mapa</h2>
  <p>Dos personas, dos pistas. Rutas: ${c('n8n/')}, ${c('web/')} y ${c('datos/procesado/acceso_estados.json')}. La tarea 2A no depende del servidor y se puede empezar ya.</p>
  ${tasksTable(e2Rows)}
  <p>No tocar: ${c('server/')} (Equipo 1). Si necesitas otra forma de respuesta, abre un comentario en el PR del endpoint.</p>
</section>

<section id="prs">
  <h2>Reglas de PR</h2>
  <p>Propuesta para confirmar con Julio. Los nombres de las personas y la pareja de cada equipo los define JR.</p>
  ${ul([
    'Una rama por tarea, con prefijo del equipo: ' + c('eq1/servidor-base') + ', ' + c('eq2/n8n-respaldo') + '. PR pequeño hacia ' + c('main') + '; nada de commits directos a ' + c('main') + '.',
    'La revisión la hace una persona del otro equipo. Se revisa que lo desconocido sea ' + c('null') + ', que cada dato lleve fuente y fecha, y que no haya claves.',
    c('node --test') + ' en verde antes de pedir revisión.',
    'Si un PR cambia un módulo existente, se corre ' + c('node scripts/empaquetar.js') + ' y se incluyen los ' + c('n8n/nodos/*') + ' regenerados, para que el flujo de respaldo siga válido. ' + c('flujo/empaquetado.test.js') + ' debería avisar si faltan (por verificar).',
    'Ninguna clave en el repo ni en los JSON exportados de n8n. Las credenciales se crean en n8n y en ' + c('.env') + ' (ya ignorado por ' + c('.gitignore') + ').',
    'Cada PR dice qué cambia, qué prueba lo cubre y qué decide el servidor frente a n8n.',
  ])}
  <p class="note-ill">Claude solo lee ese repo. Clonar, crear ramas o abrir PR requiere la autorización de JR.</p>
</section>

<section id="errores">
  <h2>Errores y respaldos</h2>
  <p>La demo no debe quedarse en silencio.</p>
  ${table(['Falla', 'Qué hace el sistema'], errRows, 'wrapfirst')}
</section>

<section id="abiertas">
  <h2>Decisiones abiertas</h2>
  ${table(['Quién decide', 'Decisión', 'Recomendación'], openRows, 'wrapfirst')}
</section>

</main>
</div>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log('OK', OUT, html.length, 'bytes');
if (warnings.length) { console.log('ANCHO:'); warnings.forEach((w) => console.log(' -', w)); }
