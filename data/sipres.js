'use strict';

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * Consulta el padrón público de SIPRES (CONDUSEF).
 *
 * La extracción incluye instituciones en sectores relacionados con crédito y con
 * estatus "Autorizada" o "En operación". SIPRES confirma el registro y estatus de
 * la institución; no confirma la autorización ni las condiciones de un producto
 * de crédito específico.
 */

const ESTADOS = ['registrada', 'no_registrada_confirmada'];
const MIN_TERMINOS_CONFIRMACION = 2;
const MIN_CARACTERES_SUBCONJUNTO = 5;
const SIPRES_BASE = 'https://webapps.condusef.gob.mx/SIPRES/jsp/pub/';
const ESTATUS_INCLUIDOS = ['1', '60']; // Autorizada, En operación
const SECTORES_CREDITICIOS = [
  { id: '37', nombre: 'Instituciones de banca de desarrollo' },
  { id: '40', nombre: 'Instituciones de banca múltiple' },
  { id: '68', nombre: 'Sociedades Financieras de Objeto Múltiple, E.R.' },
  { id: '69', nombre: 'Sociedades Financieras de Objeto Múltiple, E.N.R.' },
  { id: '27', nombre: 'Sociedades Financieras Populares (SOFIPO)' },
  { id: '29', nombre: 'Sociedades Cooperativas de Ahorro y Préstamo (SOCAP)' },
  { id: '26', nombre: 'Sociedades Financieras Comunitarias (SOFINCO)' },
  { id: '85', nombre: 'Uniones de crédito' },
  { id: '65', nombre: 'Instituciones de Financiamiento Colectivo (IFC)' },
];

const ENTIDADES_HTML = Object.freeze({
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  uuml: 'ü',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  Uuml: 'Ü',
});

// Sufijos legales y palabras demasiado comunes: no identifican a una empresa.
const IGNORAR = new Set([
  'sa', 'de', 'cv', 'sapi', 'sofom', 'enr', 'er', 'sofipo', 'sas', 'rl', 'sociedad', 'anonima', 'capital',
  'variable', 'promotora', 'inversion', 'institucion', 'banca', 'multiple', 'la', 'el', 'los', 'las', 'del',
  'app', 'mx', 'mexico', 'credito', 'creditos', 'prestamo', 'prestamos', 'financiera', 'financiero', 'pay',
  'dinero', 'efectivo', 'rapido', 'movil', 'digital', 'servicios', 'grupo', 'soluciones',
]);

function tokens(texto) {
  if (typeof texto !== 'string') return [];
  const limpio = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!limpio) return [];
  return Array.from(new Set(limpio.split(' ').filter((p) => p.length >= 2 && !IGNORAR.has(p))));
}

/** Coinciden si tienen los mismos términos, o si el nombre más corto está completo dentro del más largo. */
function coincide(a, b) {
  if (!a.length || !b.length) return false;
  const [chico, grande] = a.length <= b.length ? [a, b] : [b, a];
  const conjunto = new Set(grande);
  if (!chico.every((t) => conjunto.has(t))) return false;
  if (chico.length === grande.length) return true;
  return chico.join('').length >= MIN_CARACTERES_SUBCONJUNTO;
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

/**
 * La búsqueda permanece conservadora:
 * - Una entidad ausente de la tabla queda como "sin_verificar".
 * - Un nombre genérico o abreviado que no identifique una entidad no genera coincidencia.
 * - Las coincidencias contradictorias también quedan como "sin_verificar".
 */
function buscarEntidad(tabla, consulta = {}) {
  const nombres = [consulta && consulta.nombre_comercial, consulta && consulta.razon_social]
    .map(tokens)
    .filter((t) => t.length > 0);
  if (nombres.length === 0) return sinVerificar('sin_nombre_utilizable');
  if (!Array.isArray(tabla)) return sinVerificar('tabla_invalida');

  const coincidencias = tabla.filter((fila) => {
    if (!fila || typeof fila !== 'object') return false;
    const propios = [fila.nombre_comercial, fila.razon_social].map(tokens);
    return propios.some((p) => nombres.some((n) => coincide(n, p)));
  });
  if (coincidencias.length === 0) return sinVerificar('no_esta_en_tabla');

  const estados = new Set(coincidencias.map((f) => f.estado));
  if (estados.size !== 1 || !ESTADOS.includes(Array.from(estados)[0])) {
    return sinVerificar('coincidencias_contradictorias', { advertencias: ['coincidencias_ambiguas'] });
  }

  const fila = coincidencias[0];
  const fecha = typeof fila.fecha_consulta === 'string' && fila.fecha_consulta.trim() ? fila.fecha_consulta.trim() : null;
  const terminos = Array.isArray(fila.terminos_buscados)
    ? fila.terminos_buscados.filter((t) => typeof t === 'string' && t.trim())
    : [];
  const entidad = fila.nombre_comercial || fila.razon_social || null;
  const advertencias = [];

  if (fila.estado === 'no_registrada_confirmada' && (!fecha || terminos.length < MIN_TERMINOS_CONFIRMACION)) {
    return sinVerificar('confirmacion_insuficiente', { entidad, advertencias: ['confirmacion_insuficiente'] });
  }
  if (!fecha) advertencias.push('sin_fecha');
  return {
    estado: fila.estado,
    fecha_consulta: fecha,
    terminos_buscados: terminos,
    entidad,
    motivo: 'ok',
    advertencias,
  };
}

/** Revisa la tabla capturada y lista los problemas, para correrlo una vez al terminar la captura. */
function validarTabla(tabla) {
  if (!Array.isArray(tabla)) return ['La tabla no es una lista.'];
  const problemas = [];
  tabla.forEach((fila, i) => {
    const n = 'Fila ' + (i + 1);
    if (!fila || typeof fila !== 'object') return problemas.push(n + ': no es un objeto.');
    if (!tokens(fila.nombre_comercial).length && !tokens(fila.razon_social).length) {
      problemas.push(n + ': sin nombre comercial ni razón social utilizable.');
    }
    if (!ESTADOS.includes(fila.estado)) problemas.push(n + ': estado inválido (' + fila.estado + ').');
    if (!(typeof fila.fecha_consulta === 'string' && fila.fecha_consulta.trim())) {
      problemas.push(n + ': falta la fecha de consulta.');
    }
    if (fila.estado === 'no_registrada_confirmada') {
      const t = Array.isArray(fila.terminos_buscados) ? fila.terminos_buscados.filter(Boolean) : [];
      if (t.length < MIN_TERMINOS_CONFIRMACION) problemas.push(n + ': confirmar "no registrada" exige al menos 2 términos buscados.');
    }
  });
  return problemas;
}

function decodificarHtml(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entidad) => {
    if (entidad[0] === '#') {
      const hexadecimal = entidad[1].toLowerCase() === 'x';
      const codigo = Number.parseInt(entidad.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : match;
    }
    return Object.hasOwn(ENTIDADES_HTML, entidad) ? ENTIDADES_HTML[entidad] : match;
  });
}

function textoCelda(html) {
  return decodificarHtml(
    html
      .replace(/<br\s*\/?>/gi, ' | ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ).replace(/\s+/g, ' ').trim();
}

function leerConteo(html) {
  const match = html.match(/<span[^>]*>\s*([\d,]+)\s*<\/span>\s*resultados buscando/i);
  if (!match) throw new Error('SIPRES no devolvió el conteo esperado.');
  return Number.parseInt(match[1].replace(/,/g, ''), 10);
}

function parsearFilas(html, fechaConsulta) {
  const tbody = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbody) {
    if (leerConteo(html) === 0) return [];
    throw new Error('No se encontró la tabla de resultados SIPRES.');
  }

  const entidades = [];
  for (const filaMatch of tbody[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const filaHtml = filaMatch[1];
    const celdas = Array.from(filaHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), (m) => m[1]);
    if (celdas.length < 6) continue;

    const valores = celdas.map(textoCelda);
    const claveRegistro = valores[0];
    if (!/^\d+$/.test(claveRegistro)) continue;

    const razonSocial = valores[1];
    const nombreComercial = valores[2];
    const estadoSipres = valores[3];
    const sector = valores[4];
    const idMatch = filaHtml.match(/(?:idins=|href=["']#)(\d+)/i);
    if (!razonSocial && !nombreComercial) throw new Error('SIPRES devolvió una entidad sin nombre.');
    if (!ESTATUS_SIPRES_VALIDOS.has(estadoSipres)) {
      throw new Error('Estatus SIPRES inesperado: ' + estadoSipres + '.');
    }

    const idSipres = idMatch ? idMatch[1] : null;
    entidades.push({
      clave_registro: claveRegistro,
      id_sipres: idSipres,
      nombre_comercial: nombreComercial || razonSocial,
      razon_social: razonSocial || null,
      estado: 'registrada',
      estado_sipres: estadoSipres,
      sector,
      sectores: [sector],
      buscable: Boolean(tokens(nombreComercial).length || tokens(razonSocial).length),
      entidad_federativa: valores[5] || null,
      ultima_seccion_actualizada: valores[6] || null,
      fecha_consulta: fechaConsulta,
      terminos_buscados: [],
      url_ficha: idSipres ? SIPRES_BASE + '../../jsp/home_publico.jsp?idins=' + idSipres : null,
    });
  }

  return entidades;
}

const ESTATUS_SIPRES_VALIDOS = new Set(['Autorizada', 'En operación']);

async function consultarSector(sector, cookie, fechaConsulta) {
  const formulario = new URLSearchParams({
    tipo: '1',
    pnom: '',
    pedo: '',
    psec: sector.id,
    psta: ESTATUS_INCLUIDOS.join(','),
  });
  const respuesta = await fetch(SIPRES_BASE + 'resulbusq.jsp', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      cookie,
      referer: SIPRES_BASE + 'index.jsp',
      'user-agent': 'Mozilla/5.0',
    },
    body: formulario,
    signal: AbortSignal.timeout(30000),
  });
  if (!respuesta.ok) throw new Error('La consulta SIPRES falló para ' + sector.nombre + ': HTTP ' + respuesta.status + '.');

  const html = new TextDecoder('iso-8859-1').decode(await respuesta.arrayBuffer());
  const totalEsperado = leerConteo(html);
  const entidades = parsearFilas(html, fechaConsulta);
  if (entidades.length !== totalEsperado) {
    throw new Error('SIPRES reportó ' + totalEsperado + ' resultados para ' + sector.nombre + ', pero se leyeron ' + entidades.length + '.');
  }
  return { entidades, totalEsperado };
}

async function extraerEntidadesSipres() {
  const respuestaInicio = await fetch(SIPRES_BASE + 'index.jsp', {
    headers: { 'user-agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(30000),
  });
  if (!respuestaInicio.ok) throw new Error('No se pudo abrir SIPRES: HTTP ' + respuestaInicio.status + '.');

  const cookie = respuestaInicio.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie) throw new Error('SIPRES no inició la sesión pública esperada.');
  const fechaConsulta = new Date().toISOString().slice(0, 10);
  const entidadesPorClave = new Map();
  const resumenSectores = [];

  for (const [indice, sector] of SECTORES_CREDITICIOS.entries()) {
    const resultado = await consultarSector(sector, cookie, fechaConsulta);
    resumenSectores.push({
      id: sector.id,
      nombre: sector.nombre,
      registros_sipres: resultado.totalEsperado,
    });
    for (const entidad of resultado.entidades) {
      const existente = entidadesPorClave.get(entidad.clave_registro);
      if (existente) {
        if (existente.razon_social !== entidad.razon_social || existente.estado_sipres !== entidad.estado_sipres) {
          throw new Error('Clave de registro duplicada con datos contradictorios: ' + entidad.clave_registro + '.');
        }
        if (!existente.sectores.includes(entidad.sector)) existente.sectores.push(entidad.sector);
      } else {
        entidadesPorClave.set(entidad.clave_registro, entidad);
      }
    }
    if (indice < SECTORES_CREDITICIOS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  const entidades = Array.from(entidadesPorClave.values()).sort((a, b) => {
    const diferencia = Number(a.clave_registro) - Number(b.clave_registro);
    return diferencia || a.nombre_comercial.localeCompare(b.nombre_comercial, 'es');
  });
  const indexables = entidades.filter((entidad) => entidad.buscable);
  const problemas = validarTabla(indexables);
  const problemasEstructurales = entidades.filter((entidad) =>
    !/^\d+$/.test(entidad.clave_registro) ||
    !(entidad.nombre_comercial || entidad.razon_social) ||
    !ESTATUS_SIPRES_VALIDOS.has(entidad.estado_sipres) ||
    !entidad.sector ||
    !entidad.fecha_consulta
  );
  if (!entidades.length || problemasEstructurales.length) {
    throw new Error('La extracción contiene registros incompletos o inválidos.');
  }
  if (problemas.length) throw new Error('La tabla buscable no pasó validación: ' + problemas.slice(0, 5).join(' '));

  const resultado = {
    fuente: {
      nombre: 'Sistema de Registro de Prestadores de Servicios Financieros (SIPRES)',
      organismo: 'CONDUSEF',
      url: SIPRES_BASE + 'index.jsp',
      url_consulta: SIPRES_BASE + 'resulbusq.jsp',
    },
    fecha_consulta: fechaConsulta,
    estatus_incluidos: ['Autorizada', 'En operación'],
    sectores: resumenSectores,
    total_registros_sipres: resumenSectores.reduce((suma, sector) => suma + sector.registros_sipres, 0),
    total_entidades: entidades.length,
    entidades_no_indexables_en_busqueda: entidades.length - indexables.length,
    nota: 'SIPRES muestra el registro y estatus de la institución. Esto no confirma la disponibilidad ni la autorización regulatoria de un producto de crédito específico.',
    entidades,
  };

  const rutaSalida = fileURLToPath(new URL('./sipres-entidades.json', import.meta.url));
  await writeFile(rutaSalida, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
  return { rutaSalida, total: entidades.length, resumenSectores };
}

const ejecutadoDirectamente =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (ejecutadoDirectamente) {
  extraerEntidadesSipres()
    .then((resultado) => {
      console.log('Archivo generado: ' + resultado.rutaSalida);
      console.log('Entidades únicas extraídas: ' + resultado.total);
      console.log('Conteo por sector: ' + JSON.stringify(resultado.resumenSectores));
    })
    .catch((error) => {
      console.error('No se pudo generar el padrón SIPRES: ' + error.message);
      process.exitCode = 1;
    });
}

export { buscarEntidad, validarTabla, tokens, coincide, extraerEntidadesSipres };
