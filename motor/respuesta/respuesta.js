'use strict';

/**
 * Respuesta al usuario: contexto para el modelo, plantillas deterministas, verificador y elección.
 *
 *   armarContexto({ calculo, semaforo, fuentes, config })  -> ctx (JSON para el modelo de redacción) o null
 *   plantillaDesdeContexto(ctx)                           -> texto determinista, sin modelo
 *   verificarRespuesta(texto, ctx)                        -> { ok, fallas }
 *   elegirRespuesta(textoDelModelo, ctx)                  -> { texto, origen, motivo, fallas }
 *       origen 'llm' si el texto pasa el verificador; si no, 'plantilla' con las mismas cifras.
 *
 * Principios: el modelo solo redacta; cada cifra y cada fecha salen del cálculo y de las fuentes;
 * nunca se recomienda contratar ni se califica a una empresa; no se inventan enlaces.
 * La plantilla pasa siempre su propio verificador.
 *
 * Solo se verifican cifras en pesos y porcentajes, y fechas DD/MM/AAAA. Los conteos ("12 pagos") no.
 */

const AVISO_CAT = 'CAT estimado con fines informativos, sin IVA; puede diferir del CAT oficial.';
const AVISO_RAG = 'Información general tomada de documentos; no es una evaluación de tu oferta.';
const AVISO_RECA = 'Texto de contratos públicos del RECA (Condusef); es evidencia candidata, pendiente de validación.';
const AVISO_SIE = 'La referencia de Banxico es un promedio de mercado; no es el CAT ni la tasa de este producto.';
const MAX_CONTRATOS_LISTA = 10;
const MAX_LINEAS = 10;
const MAX_CARACTERES = 3500;
const MAX_HECHOS = 3;
const MAX_PREGUNTAS = 2;

const EMOJI = { verde: '🟢', amarillo: '🟡', rojo: '🔴', gris: '⚪' };
const EMOJI_NIVEL = { rojo: '❌', amarillo: '⚠️', gris: '❔', verde: '✅', info: 'ℹ️' };

// Normalizadas (minúsculas y sin acentos): el verificador las busca en el texto normalizado.
const PROHIBIDAS = [
  /\bfraud\w*/,
  /\bestaf\w*/,
  /\bilegal\w*/,
  /\bdelincuen\w*/,
  /\bladron\w*/,
  /\bno uses\b/,
  /\bno contrates\b/,
  /\bte conviene\b/,
  /\b(te )?recomiend(o|a|an)\b/,
  /\brecomendamos\b/,
  /\brecomendaria(mos)?\b/,
  /\brecomendable\b/,
];

const patronPesos = () => /\$\s?(\d[\d,]*(?:\.\d+)?)/g;
const patronPorcentaje = () => /(\d[\d,]*(?:\.\d+)?)\s?%/g;
const patronFecha = () => /\b\d{2}\/\d{2}\/\d{4}\b/g;
const patronEnlace = () => /(?:https?:\/\/|www\.)\S+/gi;
const TOLERANCIA = 0.006;

const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);
const textoUtil = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const normalizar = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const valorDe = (cadena) => parseFloat(cadena.replace(/,/g, ''));

function cifrasEnTexto(texto) {
  const pesos = Array.from(texto.matchAll(patronPesos()), (m) => valorDe(m[1]));
  const porcentajes = Array.from(texto.matchAll(patronPorcentaje()), (m) => valorDe(m[1]));
  return { pesos, porcentajes };
}

/** Todos los números que aparecen en un texto, con o sin "$" ni "%". */
function numerosEnTexto(texto) {
  return Array.from(texto.matchAll(/\d[\d,]*(?:\.\d+)?/g), (m) => valorDe(m[0]));
}

/** Todas las cifras que el cálculo, las razones y la evidencia citada permiten decir. */
function reunirCifras(calculo, hechos, razones) {
  const pesos = new Set();
  const porcentajes = new Set();
  const agregar = (clave, valor) => {
    if (esNumero(valor)) (/pct|porcentaje/.test(clave) ? porcentajes : pesos).add(valor);
  };
  const recorrer = (obj) =>
    Object.entries(obj || {}).forEach(([clave, valor]) => (valor && typeof valor === 'object' ? recorrer(valor) : agregar(clave, valor)));
  recorrer(calculo.metricas);
  razones.forEach((r) => recorrer(r.datos));

  const cat = calculo.cat || {};
  if (esNumero(cat.porcentaje)) porcentajes.add(cat.porcentaje);
  const citados = [cat.texto, ...hechos.flatMap((h) => h.evidencia)].filter((t) => typeof t === 'string');
  for (const texto of citados) {
    const { pesos: p, porcentajes: q } = cifrasEnTexto(texto);
    p.forEach((v) => pesos.add(v));
    q.forEach((v) => porcentajes.add(v));
  }
  const ordenar = (conjunto) => Array.from(conjunto).sort((a, b) => a - b);
  return { pesos: ordenar(pesos), porcentajes: ordenar(porcentajes) };
}

function normalizarFuentes(fuentes) {
  const f = fuentes && typeof fuentes === 'object' ? fuentes : {};
  return {
    cetes:
      f.cetes && typeof f.cetes === 'object'
        ? { fecha: textoUtil(f.cetes.fecha), descripcion: textoUtil(f.cetes.descripcion), respaldo: f.cetes.respaldo === true }
        : null,
    sipres: f.sipres && typeof f.sipres === 'object' ? { fecha: textoUtil(f.sipres.fecha) } : null,
  };
}

function armarContexto({ calculo, semaforo, fuentes, config } = {}) {
  if (!calculo || calculo.estado !== 'ok' || !semaforo || !EMOJI[semaforo.color]) return null;
  const razones = Array.isArray(semaforo.razones) ? semaforo.razones.filter((r) => r && typeof r === 'object') : [];
  const hechos = razones
    .filter((r) => r.nivel !== 'info')
    .slice(0, MAX_HECHOS)
    .map((r) => ({ codigo: r.codigo, nivel: r.nivel, hecho: r.hecho, evidencia: Array.isArray(r.evidencia) ? r.evidencia : [] }));
  const fuentesNormalizadas = normalizarFuentes(fuentes);

  const fechas = new Set([fuentesNormalizadas.cetes && fuentesNormalizadas.cetes.fecha, fuentesNormalizadas.sipres && fuentesNormalizadas.sipres.fecha].filter(Boolean));
  for (const h of hechos) [h.hecho, ...h.evidencia].forEach((t) => Array.from(String(t).matchAll(patronFecha()), (m) => fechas.add(m[0])));

  const cat = calculo.cat || {};
  return {
    tipo: calculo.tipo,
    color: semaforo.color,
    leyenda: semaforo.leyenda,
    estado_sipres: semaforo.estado_sipres === undefined ? null : semaforo.estado_sipres,
    hechos,
    metricas: calculo.metricas,
    cat_texto: typeof cat.texto === 'string' ? cat.texto : null,
    cifras: reunirCifras(calculo, hechos, razones),
    fuentes: fuentesNormalizadas,
    fechas: Array.from(fechas),
    enlaces: config && Array.isArray(config.enlaces) ? config.enlaces.filter((e) => typeof e === 'string') : [],
    aviso_cat: AVISO_CAT,
    advertencias: [...(calculo.advertencias || []), ...(semaforo.advertencias || [])],
  };
}

function plantillaDesdeContexto(ctx) {
  const lineas = [`${EMOJI[ctx.color]} ${ctx.leyenda}`];
  for (const h of ctx.hechos) {
    const evidencia = h.evidencia.length ? ` (${h.evidencia.join('; ')})` : '';
    lineas.push(`${EMOJI_NIVEL[h.nivel] || '•'} ${h.hecho}${evidencia}`);
  }
  if (ctx.cat_texto) {
    lineas.push(`CAT estimado: ${ctx.cat_texto}`);
    lineas.push(AVISO_CAT);
  }
  const fuentes = [];
  const { sipres, cetes } = ctx.fuentes;
  if (sipres && sipres.fecha) fuentes.push(`SIPRES de Condusef, consulta del ${sipres.fecha}`);
  if (cetes && cetes.fecha) fuentes.push(`${cetes.descripcion || 'CETES'} del ${cetes.fecha}${cetes.respaldo ? ' (dato de respaldo)' : ''}`);
  if (fuentes.length) lineas.push(`Fuentes: ${fuentes.join('; ')}.`);
  return lineas.join('\n');
}

function cifraPermitida(valor, permitidas) {
  return permitidas.some((p) => Math.abs(p - valor) < TOLERANCIA);
}

function verificarRespuesta(texto, ctx) {
  if (!ctx || typeof ctx !== 'object') return { ok: false, fallas: ['sin_contexto'] };
  if (typeof texto !== 'string' || !texto.trim()) return { ok: false, fallas: ['texto_vacio'] };

  const fallas = new Set();
  if (texto.length > MAX_CARACTERES) fallas.add('demasiado_largo');
  if (texto.split('\n').filter((l) => l.trim()).length > MAX_LINEAS) fallas.add('demasiadas_lineas');
  if (PROHIBIDAS.some((re) => re.test(normalizar(texto)))) fallas.add('palabra_prohibida');

  const cifras = ctx.cifras || { pesos: [], porcentajes: [] };
  for (const m of texto.matchAll(patronPesos())) {
    if (!cifraPermitida(valorDe(m[1]), cifras.pesos)) fallas.add(`cifra_no_permitida:${m[0].trim()}`);
  }
  for (const m of texto.matchAll(patronPorcentaje())) {
    if (!cifraPermitida(valorDe(m[1]), cifras.porcentajes)) fallas.add(`cifra_no_permitida:${m[0].trim()}`);
  }

  const presentes = Object.values(EMOJI).filter((e) => texto.includes(e));
  const esperado = EMOJI[ctx.color];
  if (!presentes.includes(esperado)) fallas.add('falta_color');
  if (presentes.some((e) => e !== esperado)) fallas.add('color_distinto');

  if (ctx.cat_texto && !normalizar(texto).includes(normalizar(AVISO_CAT))) fallas.add('falta_aviso_cat');

  const permitidos = ctx.enlaces || [];
  for (const m of texto.matchAll(patronEnlace())) {
    if (!permitidos.some((e) => m[0].startsWith(e))) fallas.add('enlace_no_permitido');
  }

  const fechas = ctx.fechas || [];
  for (const m of texto.matchAll(patronFecha())) {
    if (!fechas.includes(m[0])) fallas.add(`fecha_no_permitida:${m[0]}`);
  }
  const fechaSipres = ctx.fuentes && ctx.fuentes.sipres && ctx.fuentes.sipres.fecha;
  if (fechaSipres && !texto.includes(fechaSipres)) fallas.add('falta_fecha_fuente');

  return { ok: fallas.size === 0, fallas: Array.from(fallas) };
}

/**
 * Verificación ligera de un texto que no viene de un cálculo (una pregunta, un saludo): sin cifras, sin
 * colores de semáforo, sin enlaces ni palabras prohibidas. Lo que solo un cálculo puede decir se rechaza.
 *
 * Con `fuentes` (textos recuperados de documentos), una cifra se acepta solo si aparece en alguna de ellas.
 */
function verificarConversacion(texto, fuentes) {
  if (typeof texto !== 'string' || !texto.trim()) return { ok: false, fallas: ['texto_vacio'] };
  const fallas = new Set();
  if (texto.length > MAX_CARACTERES) fallas.add('demasiado_largo');
  if (texto.split('\n').filter((l) => l.trim()).length > MAX_LINEAS) fallas.add('demasiadas_lineas');
  if (PROHIBIDAS.some((re) => re.test(normalizar(texto)))) fallas.add('palabra_prohibida');

  const dichas = cifrasEnTexto(texto);
  const textosFuente = Array.isArray(fuentes) ? fuentes.filter((f) => typeof f === 'string') : [];
  if (textosFuente.length === 0) {
    if (dichas.pesos.length || dichas.porcentajes.length) fallas.add('cifra_sin_calculo');
  } else {
    // Una cifra del modelo vale si ese número aparece en los fragmentos, con o sin símbolo: las tablas de los
    // documentos traen los montos y los porcentajes sin "$" ni "%".
    const enFuentes = numerosEnTexto(textosFuente.join('\n'));
    const fuera = [...dichas.pesos, ...dichas.porcentajes].some((v) => !cifraPermitida(v, enFuentes));
    if (fuera) fallas.add('cifra_fuera_de_la_fuente');
  }
  if (Object.values(EMOJI).some((e) => texto.includes(e))) fallas.add('color_sin_calculo');
  if (patronEnlace().test(texto)) fallas.add('enlace_no_permitido');
  return { ok: fallas.size === 0, fallas: Array.from(fallas) };
}

function elegirRespuesta(textoDelModelo, ctx) {
  if (!ctx) return { texto: mensajes.error(), origen: 'plantilla', motivo: 'sin_contexto', fallas: [] };
  const plantilla = plantillaDesdeContexto(ctx);
  if (typeof textoDelModelo !== 'string' || !textoDelModelo.trim()) {
    return { texto: plantilla, origen: 'plantilla', motivo: 'sin_texto_llm', fallas: [] };
  }
  const texto = textoDelModelo.trim();
  const { ok, fallas } = verificarRespuesta(texto, ctx);
  if (ok) return { texto, origen: 'llm', motivo: 'ok', fallas: [] };
  return { texto: plantilla, origen: 'plantilla', motivo: 'verificador_rechazo', fallas };
}

const mensajes = {
  bienvenida: () =>
    [
      'Hola. Te ayudo a entender el costo real de una oferta de crédito o de una compra a abonos.',
      '• Pega el texto de la oferta o de la etiqueta y te digo el costo y qué revisar.',
      '• /verificar nombre de la entidad: reviso si aparece en el SIPRES de Condusef.',
      'Esto no es una recomendación de contratar: son datos con su fuente y fecha.',
    ].join('\n'),
  soloTexto: () => 'Por ahora solo leo texto. Pega el texto de tu oferta.',
  servicioNoDisponible: () => 'No pude analizar tu mensaje ahora. Puedes usar /verificar nombre de la entidad.',
  error: () => 'No pude procesar tu mensaje. Intenta de nuevo con el texto completo de la oferta.',
  cobranza: () => 'Parece un mensaje de cobranza. Por ahora solo reviso ofertas de crédito y etiquetas de tienda.',
  verificarSinNombre: () => 'Escribe /verificar y el nombre de la entidad, por ejemplo: /verificar Nombre de la entidad.',
  ragSinResultados: () => 'No encontré información sobre eso en los documentos que tengo.',
  ragNoDisponible: () => 'No pude consultar mis documentos ahora. Intenta de nuevo en un rato.',
  recaLista: (productos) => {
    const limpio = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : '');
    const filas = (Array.isArray(productos) ? productos : [])
      .filter((p) => p && typeof p === 'object' && limpio(p.nombre))
      .slice(0, MAX_CONTRATOS_LISTA)
      .map((p) => `• ${limpio(p.nombre)} — ${limpio(p.institucion) || 'institución no indicada'} (registro ${limpio(p.registroReca)})`);
    if (filas.length === 0) return 'No tengo contratos del RECA para consultar.';
    return ['Contratos del RECA (Condusef) que puedo consultar:', ...filas, 'Dime de cuál quieres saber, por ejemplo por el nombre del producto.'].join('\n');
  },
  aclaracion: (preguntas) => {
    const lista = (Array.isArray(preguntas) ? preguntas : []).filter((p) => typeof p === 'string' && p.trim()).slice(0, MAX_PREGUNTAS);
    if (lista.length === 0) return 'Necesito un poco más de información para calcular. ¿Me compartes el texto completo de la oferta?';
    return ['Para calcular necesito:', ...lista.map((p) => `• ${p}`)].join('\n');
  },
  verificacion: (resultado) => {
    const r = resultado && typeof resultado === 'object' ? resultado : {};
    const fecha = textoUtil(r.fecha_consulta);
    const entidad = textoUtil(r.entidad);
    if (r.estado === 'registrada') {
      const datos = [textoUtil(r.sector) && `Sector: ${textoUtil(r.sector)}.`, textoUtil(r.estatus) && `Estatus en SIPRES: ${textoUtil(r.estatus)}.`].filter(Boolean).join(' ');
      return [
        `✅ ${entidad ? `${entidad}: aparece` : 'Aparece'} registrada en el SIPRES de Condusef${fecha ? ` (consulta del ${fecha})` : ''}.`,
        ...(datos ? [datos] : []),
        'SIPRES confirma el registro de la entidad, no que un producto de crédito esté autorizado.',
      ].join('\n');
    }
    if (r.estado === 'sin_verificar' && r.motivo === 'varias_coincidencias') {
      const nombres = (Array.isArray(r.coincidencias) ? r.coincidencias : []).map(textoUtil).filter(Boolean).slice(0, 5);
      const total = Number.isInteger(r.total_coincidencias) ? ` (${r.total_coincidencias})` : '';
      return `❔ Hay varias entidades con un nombre parecido${total}${nombres.length ? `: ${nombres.join('; ')}` : ''}. Escribe el nombre completo o la razón social.`;
    }
    if (r.estado === 'no_registrada_confirmada') {
      const buscados = Array.isArray(r.terminos_buscados) ? r.terminos_buscados.filter((t) => typeof t === 'string' && t.trim()) : [];
      return [
        `❌ ${entidad ? `${entidad}: no` : 'No'} la encontramos en el SIPRES de Condusef (búsqueda manual${fecha ? ` del ${fecha}` : ''}).`,
        ...(buscados.length ? [`Términos buscados: ${buscados.join(', ')}.`] : []),
        'Verifícalo por tu cuenta antes de dar tus datos.',
      ].join('\n');
    }
    return '❔ No la tenemos en nuestra base; hay que verificarla en el SIPRES.';
  },
};

module.exports = {
  armarContexto,
  plantillaDesdeContexto,
  verificarRespuesta,
  verificarConversacion,
  elegirRespuesta,
  mensajes,
  AVISO_CAT,
  AVISO_RAG,
  AVISO_RECA,
  AVISO_SIE,
  MAX_LINEAS,
  MAX_CARACTERES,
  PROHIBIDAS,
};
