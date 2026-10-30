'use strict';

/**
 * Costo real y CAT implícito de una etiqueta de tienda o de una oferta de préstamo.
 *
 * calcular(datos) recibe el objeto `datos` de la extracción validada
 *   { tipo_entrada, producto, credito } y devuelve SIEMPRE un objeto:
 *   { estado: 'ok', motivo, tipo, metricas, cat, advertencias }
 *   o { estado: 'error', motivo, campos, advertencias } si los datos no sirven.
 *
 * Determinístico: sin red, sin modelo, sin estado. No modifica la entrada.
 * El CAT es una estimación informativa, sin IVA, que puede diferir del CAT oficial.
 *
 * Cargos (comisiones y seguros), según su momento:
 *   tienda    inicial y enganche restan del principal; periódico suma al pago; final entra al costo, no al CAT.
 *   préstamo  el monto depositado ya refleja lo descontado; periódico suma al pago; final entra al costo.
 */

const PERIODOS_POR_ANIO = { semanal: 52, quincenal: 24, mensual: 12, diario: 365 };
const MOMENTOS = ['inicial', 'periodico', 'final'];
const R_MIN = 0;
const R_MAX = 10; // tasa periódica máxima: 1,000% por periodo
const ITERACIONES = 200;
const EPS = 1e-12;
const CAT_MAS_DE_1000 = 10;
const TEXTO_MAS_DE_1000 = 'más de 1,000%';

const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);
const esEntero = (v) => Number.isInteger(v) && v >= 1;
const positivo = (v) => esNumero(v) && v > 0;
const redondear = (n, decimales = 2) => {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Valor presente de n pagos iguales; protege el caso r cercano a 0. */
function valorPresente(r, pago, n) {
  if (Math.abs(r) < EPS) return pago * n;
  return (pago * (1 - Math.pow(1 + r, -n))) / r;
}

/** Tasa periódica que iguala el principal con el valor presente de n pagos, por bisección. */
function tasaPeriodica(principal, pago, n) {
  if (!positivo(principal) || !positivo(pago) || !(n >= 1)) return { r: null, motivo: 'datos_invalidos' };
  const total = pago * n;
  if (Math.abs(total - principal) < 0.005) return { r: 0, motivo: 'sin_costo' };
  if (total < principal) return { r: null, motivo: 'pagos_menores_al_principal' };
  if (valorPresente(R_MAX, pago, n) > principal) return { r: R_MAX, motivo: 'fuera_de_rango' };
  let bajo = R_MIN;
  let alto = R_MAX;
  for (let i = 0; i < ITERACIONES; i++) {
    const medio = (bajo + alto) / 2;
    if (valorPresente(medio, pago, n) > principal) bajo = medio;
    else alto = medio;
  }
  return { r: (bajo + alto) / 2, motivo: 'ok' };
}

function catPeriodico(principal, pago, n, periodosPorAnio) {
  const { r, motivo } = tasaPeriodica(principal, pago, n);
  if (r === null) return { cat: null, r: null, motivo };
  if (motivo === 'fuera_de_rango') return { cat: null, r: null, motivo };
  return { cat: Math.pow(1 + r, periodosPorAnio) - 1, r, motivo };
}

function catPagoUnico(recibes, pagas, plazoDias) {
  if (!positivo(recibes) || !positivo(pagas) || !(plazoDias >= 1)) return { cat: null, r: null, motivo: 'datos_invalidos' };
  if (pagas < recibes) return { cat: null, r: null, motivo: 'pagos_menores_al_principal' };
  const r = pagas / recibes - 1;
  const cat = Math.pow(1 + r, 365 / plazoDias) - 1;
  if (!Number.isFinite(cat)) return { cat: null, r: null, motivo: 'fuera_de_rango' };
  return { cat, r, motivo: r === 0 ? 'sin_costo' : 'ok' };
}

function resumenCat({ cat, r, motivo }) {
  if (motivo === 'fuera_de_rango') {
    return { valor: null, porcentaje: null, texto: TEXTO_MAS_DE_1000, tasa_periodica: null, motivo };
  }
  if (cat === null) return { valor: null, porcentaje: null, texto: null, tasa_periodica: null, motivo };
  return {
    valor: cat,
    porcentaje: Math.round(cat * 1000) / 10,
    texto: cat > CAT_MAS_DE_1000 ? TEXTO_MAS_DE_1000 : `${(cat * 100).toFixed(1)}%`,
    tasa_periodica: r,
    motivo,
  };
}

/** Suma los cargos por momento. Un cargo sin monto o sin momento válido se ignora con advertencia. */
function sumarCargos(credito, advertencias) {
  const suma = { inicial: 0, periodico: 0, final: 0 };
  const lista = [...(Array.isArray(credito.comisiones) ? credito.comisiones : []), ...(Array.isArray(credito.seguros) ? credito.seguros : [])];
  for (const cargo of lista) {
    const nombre = cargo && typeof cargo.concepto === 'string' ? cargo.concepto : 'sin_nombre';
    if (!cargo || !esNumero(cargo.monto)) {
      advertencias.push(`cargo_sin_monto:${nombre}`);
    } else if (!MOMENTOS.includes(cargo.momento)) {
      advertencias.push(`cargo_sin_momento:${nombre}`);
    } else {
      suma[cargo.momento] += cargo.monto;
    }
  }
  return suma;
}

function error(motivo, campos = [], advertencias = []) {
  return { estado: 'error', motivo, campos, advertencias };
}

function camposFaltantes(tipo, producto, credito) {
  const faltan = [];
  const pedir = (cumple, campo) => {
    if (!cumple) faltan.push(campo);
  };
  if (tipo === 'tienda') {
    pedir(positivo(producto.precio_contado), 'producto.precio_contado');
  } else {
    pedir(positivo(credito.monto_depositado), 'credito.monto_depositado');
  }
  if (tipo === 'prestamo' && credito.periodicidad === 'unico') {
    pedir(positivo(credito.monto_total_a_pagar), 'credito.monto_total_a_pagar');
    pedir(esEntero(credito.plazo_dias), 'credito.plazo_dias');
  } else {
    pedir(positivo(credito.abono), 'credito.abono');
    pedir(esEntero(credito.numero_pagos), 'credito.numero_pagos');
    pedir(credito.periodicidad in PERIODOS_POR_ANIO, 'credito.periodicidad');
  }
  return faltan;
}

function calcularTienda(producto, credito, advertencias) {
  if (!esNumero(credito.enganche)) advertencias.push('enganche_no_declarado');
  const enganche = esNumero(credito.enganche) ? credito.enganche : 0;
  const cargos = sumarCargos(credito, advertencias);
  const iniciales = enganche + cargos.inicial;
  const pagoPeriodico = credito.abono + cargos.periodico;
  const costoTotal = iniciales + pagoPeriodico * credito.numero_pagos + cargos.final;
  const precio = producto.precio_contado;
  const sobrecosto = costoTotal - precio;
  const principal = precio - iniciales;
  const cat = catPeriodico(principal, pagoPeriodico, credito.numero_pagos, PERIODOS_POR_ANIO[credito.periodicidad]);
  return {
    metricas: {
      precio_contado: redondear(precio),
      costo_total: redondear(costoTotal),
      sobrecosto_pesos: redondear(sobrecosto),
      sobrecosto_pct: redondear((sobrecosto / precio) * 100, 1),
      pago_periodico: redondear(pagoPeriodico),
      principal_cat: redondear(principal),
    },
    cat: resumenCat(cat),
  };
}

function calcularPrestamo(credito, advertencias) {
  const cargos = sumarCargos(credito, advertencias);
  const recibes = credito.monto_depositado;
  let pagas;
  let cat;
  if (credito.periodicidad === 'unico') {
    pagas = credito.monto_total_a_pagar;
    cat = catPagoUnico(recibes, pagas, credito.plazo_dias);
  } else {
    const pagoPeriodico = credito.abono + cargos.periodico;
    pagas = pagoPeriodico * credito.numero_pagos + cargos.final;
    cat = catPeriodico(recibes, pagoPeriodico, credito.numero_pagos, PERIODOS_POR_ANIO[credito.periodicidad]);
  }
  const costo = pagas - recibes;
  return {
    metricas: {
      monto_ofrecido: esNumero(credito.monto_ofrecido) ? credito.monto_ofrecido : null,
      recibes: redondear(recibes),
      pagas: redondear(pagas),
      costo_credito_pesos: redondear(costo),
      costo_pct_sobre_recibido: redondear((costo / recibes) * 100, 1),
      diferencia_ofrecido_depositado: esNumero(credito.monto_ofrecido) ? redondear(credito.monto_ofrecido - recibes) : null,
      cargos_iniciales_declarados: redondear(cargos.inicial),
    },
    cat: resumenCat(cat),
  };
}

function calcular(datos) {
  const advertencias = [];
  if (!datos || typeof datos !== 'object') return error('sin_datos');
  const tipo = { etiqueta_tienda: 'tienda', oferta_credito: 'prestamo' }[datos.tipo_entrada];
  if (!tipo) return error('tipo_no_soportado');

  const producto = datos.producto && typeof datos.producto === 'object' ? datos.producto : {};
  const credito = datos.credito && typeof datos.credito === 'object' ? datos.credito : {};

  const permitidas = tipo === 'prestamo' ? [...Object.keys(PERIODOS_POR_ANIO), 'unico'] : Object.keys(PERIODOS_POR_ANIO);
  if (credito.periodicidad != null && !permitidas.includes(credito.periodicidad)) return error('periodicidad_invalida', ['credito.periodicidad']);

  const faltan = camposFaltantes(tipo, producto, credito);
  if (faltan.length > 0) return error('datos_insuficientes', faltan);

  const resultado = tipo === 'tienda' ? calcularTienda(producto, credito, advertencias) : calcularPrestamo(credito, advertencias);
  return { estado: 'ok', motivo: 'ok', tipo, ...resultado, advertencias };
}

module.exports = { calcular };
