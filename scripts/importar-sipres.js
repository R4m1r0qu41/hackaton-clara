'use strict';

/**
 * Convierte el JSON de SIPRES de la rama Eugenio (data/sipres-entidades.json) a la tabla del bot.
 *
 *   node scripts/importar-sipres.js <sipres-entidades.json> [<salida.json>]
 *
 * La salida por defecto es datos/procesado/sipres_entidades.json. Después hay que correr
 * `node scripts/empaquetar.js` para que la tabla viaje dentro de los nodos de n8n.
 *
 * Solo pasa lo que la tabla puede usar: filas `registrada` con nombre utilizable y fecha de consulta válida.
 * Lo demás se omite y se cuenta, con su motivo. El conjunto de Eugenio solo trae entidades autorizadas o en
 * operación, así que una entidad que no esté aquí sigue siendo "sin verificar", nunca "no registrada".
 */

const fs = require('node:fs');
const path = require('node:path');
const { validarTabla } = require('../motor/sipres/sipres');

const RAIZ = path.resolve(__dirname, '..');
const RUTA_TABLA = path.join(RAIZ, 'datos', 'procesado', 'sipres_entidades.json');

const textoUtil = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** 2026-10-30 -> 30/10/2026; una fecha que ya viene en DD/MM/AAAA se deja igual. */
function aFecha(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return /^\d{2}\/\d{2}\/\d{4}$/.test(texto) ? texto : null;
}

function convertir(entrada) {
  if (!entrada || typeof entrada !== 'object' || !Array.isArray(entrada.entidades)) {
    throw new Error('El archivo no trae la lista "entidades".');
  }
  const tabla = [];
  const omitidas = [];
  entrada.entidades.forEach((e, indice) => {
    if (!e || typeof e !== 'object') return omitidas.push({ indice, motivo: 'la fila no es un objeto' });
    if (e.estado !== 'registrada') return omitidas.push({ indice, motivo: `estado no soportado (${e.estado})` });
    const fecha = aFecha(e.fecha_consulta);
    if (!fecha) return omitidas.push({ indice, motivo: 'sin fecha de consulta válida' });
    const fila = {
      nombre_comercial: textoUtil(e.nombre_comercial),
      razon_social: textoUtil(e.razon_social),
      estado: 'registrada',
      terminos_buscados: [],
      fecha_consulta: fecha,
      sector: textoUtil(e.sector),
      estatus: textoUtil(e.estado_sipres),
    };
    const problemas = validarTabla([fila]);
    if (problemas.length > 0) return omitidas.push({ indice, motivo: problemas[0].replace(/^Fila 1: /, '') });
    return tabla.push(fila);
  });
  return { tabla, omitidas };
}

/** Una fila por línea: los cambios se ven bien en git. */
function escribirTabla(ruta, tabla) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const cuerpo = tabla.length ? `[\n${tabla.map((f) => `  ${JSON.stringify(f)}`).join(',\n')}\n]\n` : '[]\n';
  fs.writeFileSync(ruta, cuerpo);
}

function principal(argumentos) {
  const [entrada, salida = RUTA_TABLA] = argumentos;
  if (!entrada) {
    console.error('Uso: node scripts/importar-sipres.js <sipres-entidades.json> [<salida.json>]');
    return 1;
  }
  let datos;
  try {
    datos = JSON.parse(fs.readFileSync(entrada, 'utf8'));
  } catch (error) {
    console.error(error.code === 'ENOENT' ? `No encuentro el archivo: ${entrada}` : `El archivo no es JSON válido: ${entrada}`);
    return 1;
  }
  const { tabla, omitidas } = convertir(datos);
  escribirTabla(salida, tabla);
  console.log(`Tabla de SIPRES escrita en ${path.relative(RAIZ, path.resolve(salida))}: ${tabla.length} convertidas, ${omitidas.length} omitidas.`);
  for (const o of omitidas.slice(0, 5)) console.log(`  omitida fila ${o.indice}: ${o.motivo}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = principal(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { convertir, escribirTabla, RUTA_TABLA };
