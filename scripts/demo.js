'use strict';

/**
 * Prueba el motor desde la terminal, sin n8n, sin modelo y sin credenciales.
 *
 *   node scripts/demo.js                   corre casos de ejemplo
 *   node scripts/demo.js --ejemplo         imprime una extracción de ejemplo para que la edites
 *   node scripts/demo.js mi-oferta.json    evalúa tu propia extracción (el JSON que produciría el modelo)
 *
 * Los casos de ejemplo usan entidades ficticias. Con tu propio archivo se usa la tabla real de
 * datos/procesado/sipres_entidades.json, que hoy está vacía: toda entidad sale como "sin verificar".
 */

const fs = require('node:fs');
const { procesar } = require('../motor/flujo/procesar');
const { buscarEntidad } = require('../motor/sipres/sipres');
const { elegirRespuesta, mensajes } = require('../motor/respuesta/respuesta');
const { leerTabla } = require('./empaquetar');

const HOY = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric' });

// Entidades ficticias: ninguna corresponde a una empresa real.
const TABLA_DEMO = [
  { nombre_comercial: 'Zafiro', razon_social: null, estado: 'registrada', terminos_buscados: ['Zafiro', 'Zafiro Soluciones'], fecha_consulta: HOY },
  { nombre_comercial: 'Nimbo Express', razon_social: null, estado: 'no_registrada_confirmada', terminos_buscados: ['Nimbo Express', 'Nimbo'], fecha_consulta: HOY },
];

const SENALES = {
  pide_anticipo: false,
  pide_permiso_contactos: false,
  pide_permiso_fotos_archivos: false,
  presion_urgencia: false,
  texto_evidencia: [],
};

const extraccion = (tipo, credito = {}, extra = {}) => ({
  tipo_entrada: tipo,
  confianza_extraccion: 0.9,
  producto: tipo === 'etiqueta_tienda' ? { descripcion: 'Televisión de ejemplo', precio_contado: 10000, tienda: 'Tienda de ejemplo' } : { descripcion: null, precio_contado: null, tienda: null },
  credito: {
    otorgante_nombre_comercial: null,
    otorgante_razon_social: null,
    monto_ofrecido: null,
    monto_depositado: null,
    enganche: tipo === 'etiqueta_tienda' ? 0 : null,
    abono: 1000,
    periodicidad: 'mensual',
    numero_pagos: 12,
    plazo_dias: null,
    monto_total_a_pagar: null,
    comisiones: [],
    seguros: [],
    cat_publicado: null,
    ...credito,
  },
  senales_riesgo: SENALES,
  datos_faltantes: [],
  ...extra,
});

const prestamo = (entidad, credito = {}) => extraccion('oferta_credito', { otorgante_nombre_comercial: entidad, monto_ofrecido: 10000, monto_depositado: 10000, ...credito });

const CASOS = [
  ['Etiqueta de tienda con sobrecosto bajo (11 pagos de $1,000 por algo de $10,000)', extraccion('etiqueta_tienda', { numero_pagos: 11 })],
  ['Etiqueta de tienda con sobrecosto alto (18 pagos de $1,000)', extraccion('etiqueta_tienda', { numero_pagos: 18 })],
  ['Préstamo de una entidad registrada (ficticia)', prestamo('Zafiro')],
  ['Préstamo de una entidad no registrada confirmada (ficticia)', prestamo('Nimbo Express')],
  ['Préstamo de una entidad que no está en la tabla', prestamo('Entidad Desconocida')],
  ['A la oferta le falta un dato (no dice de cuánto es cada pago)', extraccion('etiqueta_tienda', { abono: null })],
  ['El mensaje es una cobranza', extraccion('cobranza')],
];

const linea = (texto) => `\n${'='.repeat(78)}\n${texto}\n${'-'.repeat(78)}`;

function mostrar(titulo, entrada, tabla) {
  console.log(linea(titulo));
  const r = procesar({ extraccion: entrada, tablaSipres: tabla, hoy: HOY });
  if (r.accion === 'responder') {
    console.log(r.texto);
    console.log(`\n[sin modelo: responde el código · motivo: ${r.motivo}]`);
    return null;
  }
  console.log(r.plantilla);
  console.log(`\n[semáforo: ${r.ctx.color} · SIPRES: ${r.ctx.estado_sipres || 'no aplica'}]`);
  return r;
}

function correrCasos() {
  console.log('Motor de Crédito Claro: casos de ejemplo (entidades ficticias, sin modelo ni n8n)');
  let ejemplo = null;
  for (const [titulo, entrada] of CASOS) {
    const r = mostrar(titulo, entrada, TABLA_DEMO);
    if (r && !ejemplo) ejemplo = r;
  }

  console.log(linea('Verificar una entidad: /verificar Zafiro y /verificar Otra Cosa'));
  for (const nombre of ['Zafiro', 'Otra Cosa']) {
    console.log(`> ${nombre}\n${mensajes.verificacion(buscarEntidad(TABLA_DEMO, { nombre_comercial: nombre }))}\n`);
  }

  console.log(linea('El verificador: el modelo agrega una cifra que no sale del cálculo ($99,999)'));
  const r = elegirRespuesta(`${ejemplo.plantilla}\nTe cobrarán $99,999.`, ejemplo.ctx);
  console.log(r.texto);
  console.log(`\n[se envió: ${r.origen} · motivo: ${r.motivo} · fallas: ${r.fallas.join(', ')}]`);
}

function correrArchivo(ruta) {
  const texto = fs.readFileSync(ruta, 'utf8');
  mostrar(`Tu oferta (${ruta})`, texto, leerTabla());
}

const argumento = process.argv[2];
try {
  if (argumento === '--ejemplo') console.log(JSON.stringify(extraccion('etiqueta_tienda', { numero_pagos: 11 }), null, 2));
  else if (argumento) correrArchivo(argumento);
  else correrCasos();
} catch (error) {
  console.error(error.code === 'ENOENT' ? `No encuentro el archivo: ${argumento}` : error.message);
  process.exitCode = 1;
}
