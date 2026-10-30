'use strict';

/**
 * Búsqueda en la tabla de SIPRES (Condusef), capturada a mano con fecha de consulta.
 *
 * Cada fila de la tabla:
 *   { nombre_comercial, razon_social, estado: 'registrada' | 'no_registrada_confirmada',
 *     terminos_buscados: [..], fecha_consulta: 'DD/MM/AAAA', verificado_por? }
 *
 * buscarEntidad(tabla, { nombre_comercial, razon_social }) devuelve SIEMPRE un objeto:
 *   { estado, fecha_consulta, terminos_buscados, entidad, motivo, advertencias }
 *   estado: 'registrada' | 'no_registrada_confirmada' | 'sin_verificar'
 *
 * Para no acusar sin base:
 *  - Lo que no está en la tabla es 'sin_verificar', nunca "no registrada".
 *  - 'no_registrada_confirmada' exige fecha y al menos 2 términos buscados; si no, baja a 'sin_verificar'.
 *  - Coincidencias con estados contradictorios no se adivinan: 'sin_verificar'.
 *  - Los nombres genéricos no coinciden con nada.
 */

const ESTADOS = ['registrada', 'no_registrada_confirmada'];
const MIN_TERMINOS_CONFIRMACION = 2;
const MIN_CARACTERES_PARCIAL = 5;
const MAX_CANDIDATAS = 5;

// Sufijos legales y palabras comunes: no identifican a una empresa.
const IGNORAR = new Set([
  'sa', 'de', 'del', 'la', 'las', 'el', 'los', 'cv', 'sapi', 'sas', 'rl', 'sofom', 'sofipo', 'enr', 'er',
  'sociedad', 'anonima', 'capital', 'variable', 'promotora', 'inversion', 'institucion', 'banca', 'multiple',
  'app', 'mx', 'mexico', 'grupo', 'pay', 'express', 'digital', 'movil', 'rapido', 'dinero', 'efectivo',
  'credito', 'creditos', 'prestamo', 'prestamos', 'financiera', 'financieras', 'financiero', 'financieros',
  'soluciones', 'servicios',
]);

function terminos(texto) {
  if (typeof texto !== 'string') return [];
  const palabras = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ');
  return Array.from(new Set(palabras.filter((p) => p.length >= 2 && !IGNORAR.has(p))));
}

/** Coinciden si tienen los mismos términos, o si el nombre más corto cabe completo en el más largo. */
function coincide(a, b) {
  if (!a.length || !b.length) return false;
  const [chico, grande] = a.length <= b.length ? [a, b] : [b, a];
  const enGrande = new Set(grande);
  if (!chico.every((t) => enGrande.has(t))) return false;
  return chico.length === grande.length || chico.join('').length >= MIN_CARACTERES_PARCIAL;
}

/** Mismos términos, sin importar el orden. */
function iguales(a, b) {
  return a.length > 0 && a.length === b.length && a.every((t) => b.includes(t));
}

function textoUtil(valor) {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

function sinVerificar(motivo, extra = {}) {
  return {
    estado: 'sin_verificar',
    fecha_consulta: null,
    terminos_buscados: [],
    entidad: null,
    motivo,
    advertencias: [],
    ...extra,
  };
}

function buscarEntidad(tabla, consulta = {}) {
  const nombres = [consulta && consulta.nombre_comercial, consulta && consulta.razon_social]
    .map(terminos)
    .filter((t) => t.length > 0);
  if (nombres.length === 0) return sinVerificar('sin_nombre_utilizable');
  if (!Array.isArray(tabla)) return sinVerificar('tabla_invalida');

  const evaluadas = [];
  for (const candidata of tabla) {
    if (!candidata || typeof candidata !== 'object') continue;
    const pares = [candidata.nombre_comercial, candidata.razon_social].map(terminos).flatMap((p) => nombres.map((n) => [n, p]));
    if (pares.some(([n, p]) => coincide(n, p))) evaluadas.push({ fila: candidata, exacta: pares.some(([n, p]) => iguales(n, p)) });
  }
  if (evaluadas.length === 0) return sinVerificar('no_esta_en_tabla');

  const coincidencias = evaluadas.map((e) => e.fila);
  const estados = new Set(coincidencias.map((f) => f.estado));
  if (estados.size !== 1 || !ESTADOS.includes(coincidencias[0].estado)) {
    return sinVerificar('coincidencias_contradictorias', { advertencias: ['coincidencias_ambiguas'] });
  }

  // Una coincidencia exacta gana sobre las parciales. Si aun así quedan varias entidades distintas, no se elige una.
  const exactas = evaluadas.filter((e) => e.exacta);
  const distintas = new Map();
  for (const { fila: f } of exactas.length ? exactas : evaluadas) {
    const clave = `${terminos(f.nombre_comercial).join(' ')}|${terminos(f.razon_social).join(' ')}`;
    if (!distintas.has(clave)) distintas.set(clave, f);
  }
  if (distintas.size > 1) {
    const nombresCandidatas = Array.from(distintas.values(), (f) => textoUtil(f.nombre_comercial) || textoUtil(f.razon_social)).filter(Boolean);
    return sinVerificar('varias_coincidencias', {
      advertencias: ['coincidencias_ambiguas'],
      coincidencias: nombresCandidatas.slice(0, MAX_CANDIDATAS),
      total_coincidencias: distintas.size,
    });
  }

  const fila = distintas.values().next().value;
  const fecha = textoUtil(fila.fecha_consulta);
  const buscados = Array.isArray(fila.terminos_buscados) ? fila.terminos_buscados.map(textoUtil).filter(Boolean) : [];
  const entidad = textoUtil(fila.nombre_comercial) || textoUtil(fila.razon_social);

  if (fila.estado === 'no_registrada_confirmada' && (!fecha || buscados.length < MIN_TERMINOS_CONFIRMACION)) {
    return sinVerificar('confirmacion_insuficiente', { entidad, advertencias: ['confirmacion_insuficiente'] });
  }
  return {
    estado: fila.estado,
    fecha_consulta: fecha,
    terminos_buscados: buscados,
    entidad,
    motivo: 'ok',
    advertencias: fecha ? [] : ['sin_fecha'],
    sector: textoUtil(fila.sector),
    estatus: textoUtil(fila.estatus),
  };
}

/** Revisa la tabla capturada y lista los problemas; se corre una vez al terminar la captura. */
function validarTabla(tabla) {
  if (!Array.isArray(tabla)) return ['La tabla no es una lista.'];
  const problemas = [];
  tabla.forEach((fila, i) => {
    const n = `Fila ${i + 1}`;
    if (!fila || typeof fila !== 'object') {
      problemas.push(`${n}: no es un objeto.`);
      return;
    }
    if (!terminos(fila.nombre_comercial).length && !terminos(fila.razon_social).length) {
      problemas.push(`${n}: sin nombre comercial ni razón social utilizable.`);
    }
    if (!ESTADOS.includes(fila.estado)) problemas.push(`${n}: estado inválido (${fila.estado}).`);
    if (!textoUtil(fila.fecha_consulta)) problemas.push(`${n}: falta la fecha de consulta.`);
    if (fila.estado === 'no_registrada_confirmada') {
      const buscados = Array.isArray(fila.terminos_buscados) ? fila.terminos_buscados.filter(Boolean) : [];
      if (buscados.length < MIN_TERMINOS_CONFIRMACION) {
        problemas.push(`${n}: confirmar "no registrada" exige al menos 2 términos buscados.`);
      }
    }
  });
  return problemas;
}

module.exports = { buscarEntidad, validarTabla };
