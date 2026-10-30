// GENERADO por scripts/empaquetar.js. No lo edites aquí: cambia el módulo en motor/ y vuelve a generar.
// Nodo Code de n8n: "Evaluar oferta". Modo "Run Once for All Items", lenguaje JavaScript.

const __fabricas = {};
const __cache = {};
function __resolver(desde, especificador) {
  const partes = desde.split('/').slice(0, -1);
  for (const parte of especificador.split('/')) {
    if (parte === '..') partes.pop();
    else if (parte !== '.') partes.push(parte);
  }
  return partes.join('/').replace(/\.js$/, '');
}
function __cargar(ruta) {
  if (!__cache[ruta]) {
    const modulo = { exports: {} };
    __cache[ruta] = modulo;
    __fabricas[ruta](modulo, modulo.exports, (especificador) => __cargar(__resolver(ruta, especificador)));
  }
  return __cache[ruta].exports;
}

__fabricas["sipres/sipres"] = function (module, exports, require) {
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
};

__fabricas["calculo/calculo"] = function (module, exports, require) {
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
};

__fabricas["semaforo/semaforo"] = function (module, exports, require) {
'use strict';

/**
 * Semáforo de una oferta: color, razones con evidencia y leyenda.
 *
 * semaforo({ calculo, senales, sipres }, { umbrales, reglasDeExtraccion }) devuelve SIEMPRE:
 *   { color, leyenda, razones, resumen, estado_sipres, advertencias }
 *   color    'verde' | 'amarillo' | 'rojo' | 'gris'
 *   razones  [{ codigo, nivel, hecho, evidencia, datos }]: hechos verificables, nunca juicios
 *
 * Reglas de fondo:
 *  - Cualquier razón roja manda y se listan todas.
 *  - 'sin_verificar' por sí solo NUNCA produce rojo: da gris.
 *  - 'no_registrada_confirmada' exige fecha y al menos 2 términos buscados; si no, se trata como sin verificar.
 *  - Verde significa "no detectamos riesgos con la información consultada", nunca una recomendación.
 *  - Las señales que extrae el modelo (anticipo, permisos, presión, depósito menor) solo cuentan si se
 *    activa `reglasDeExtraccion`, y las de texto exigen evidencia literal. Por defecto están apagadas:
 *    el plan pide rojo solo con hechos verificados, y esta decisión queda con JR.
 */

const UMBRALES = {
  tienda: { rojo_desde_pct: 50, amarillo_desde_pct: 15 },
  prestamo: { costo_amarillo_desde_pct: 50, tolerancia_deposito_pesos: 1 },
};
const ESTADOS_SIPRES = ['registrada', 'no_registrada_confirmada', 'sin_verificar'];
const MIN_TERMINOS_CONFIRMACION = 2;

const LEYENDAS = {
  verde: 'No detectamos riesgos con la información consultada. Esto no es una recomendación de contratar.',
  amarillo: 'Hay puntos que conviene revisar antes de decidir.',
  rojo: 'Encontramos señales de riesgo. Revisa estos hechos antes de dar tus datos o firmar.',
  gris: 'No pudimos verificar todo con la información disponible.',
};
const ORDEN_NIVEL = { rojo: 0, amarillo: 1, gris: 2, verde: 3, info: 4 };

const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);
const textoUtil = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const razon = (codigo, nivel, hecho, evidencia = [], datos = {}) => ({ codigo, nivel, hecho, evidencia, datos });

function pesos(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

function resultado(color, razones, advertencias, estadoSipres = null) {
  const ordenadas = razones
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ORDEN_NIVEL[a.r.nivel] - ORDEN_NIVEL[b.r.nivel] || a.i - b.i)
    .map((x) => x.r);
  return {
    color,
    leyenda: LEYENDAS[color],
    razones: ordenadas,
    resumen: {
      rojas: ordenadas.filter((r) => r.nivel === 'rojo').length,
      amarillas: ordenadas.filter((r) => r.nivel === 'amarillo').length,
    },
    estado_sipres: estadoSipres,
    advertencias,
  };
}

function semaforoTienda(calculo, umbral, advertencias) {
  const m = calculo.metricas || {};
  const pct = m.sobrecosto_pct;
  if (!esNumero(pct) || pct < 0 || !esNumero(m.costo_total) || !esNumero(m.precio_contado)) {
    return resultado('gris', [razon('datos_incoherentes', 'gris', 'Los datos de la etiqueta no cuadran; conviene revisarlos.')], advertencias);
  }
  const nivel = pct >= umbral.rojo_desde_pct ? 'rojo' : pct >= umbral.amarillo_desde_pct ? 'amarillo' : 'verde';
  const hecho =
    `En abonos pagas ${pesos(m.costo_total)} y de contado cuesta ${pesos(m.precio_contado)}: ` +
    `${pesos(m.sobrecosto_pesos)} más (${pct}%).`;
  const datos = {
    costo_total: m.costo_total,
    precio_contado: m.precio_contado,
    sobrecosto_pesos: m.sobrecosto_pesos,
    sobrecosto_pct: pct,
    umbral_rojo_pct: umbral.rojo_desde_pct,
    umbral_amarillo_pct: umbral.amarillo_desde_pct,
  };
  return resultado(nivel, [razon('sobrecosto', nivel, hecho, [], datos)], advertencias);
}

/** Estado de SIPRES ya validado: lo que no sea claro se trata como sin verificar. */
function leerSipres(sipres, advertencias) {
  let estado = 'sin_verificar';
  if (sipres && typeof sipres === 'object') {
    if (ESTADOS_SIPRES.includes(sipres.estado)) estado = sipres.estado;
    else advertencias.push('estado_sipres_invalido');
  }
  const fecha = textoUtil(sipres && sipres.fecha_consulta);
  const buscados = sipres && Array.isArray(sipres.terminos_buscados) ? sipres.terminos_buscados.map(textoUtil).filter(Boolean) : [];
  if (estado === 'no_registrada_confirmada' && (!fecha || buscados.length < MIN_TERMINOS_CONFIRMACION)) {
    advertencias.push('sipres_confirmacion_insuficiente');
    estado = 'sin_verificar';
  }
  if (estado === 'registrada' && !fecha) advertencias.push('sipres_sin_fecha');
  return { estado, fecha, buscados };
}

function razonesSipres({ estado, fecha, buscados }) {
  const cuando = fecha ? ` del ${fecha}` : '';
  if (estado === 'no_registrada_confirmada') {
    return razon(
      'sipres_no_registrada_confirmada',
      'rojo',
      `No la encontramos en el SIPRES de Condusef (búsqueda manual${cuando}).`,
      buscados.length ? [`Términos buscados: ${buscados.join(', ')}`] : [],
      { fecha_consulta: fecha }
    );
  }
  if (estado === 'registrada') {
    return razon('sipres_registrada', 'verde', `Aparece registrada en el SIPRES de Condusef (consulta${cuando}).`, [], { fecha_consulta: fecha });
  }
  return razon('sipres_sin_verificar', 'gris', 'No la tenemos en nuestra base; hay que verificarla en el SIPRES.');
}

/** Reglas que dependen de lo que el modelo extrajo del texto: solo si se activan. */
function razonesDeExtraccion(m, senales, umbral, advertencias) {
  const sig = senales && typeof senales === 'object' ? senales : {};
  const evidencia = Array.isArray(sig.texto_evidencia) ? sig.texto_evidencia.map(textoUtil).filter(Boolean) : [];
  const conEvidencia = (campo) => {
    if (sig[campo] === true && evidencia.length === 0) {
      advertencias.push(`senal_sin_evidencia:${campo}`);
      return false;
    }
    return sig[campo] === true;
  };
  const razones = [];
  if (conEvidencia('pide_anticipo')) razones.push(razon('pide_anticipo', 'rojo', 'Pide un pago por adelantado para liberar el crédito.', evidencia));
  if (conEvidencia('pide_permiso_contactos')) razones.push(razon('pide_permiso_contactos', 'rojo', 'Pide acceso a tus contactos.', evidencia));
  if (conEvidencia('pide_permiso_fotos_archivos')) razones.push(razon('pide_permiso_fotos_archivos', 'rojo', 'Pide acceso a tus fotos o archivos.', evidencia));
  if (conEvidencia('presion_urgencia')) razones.push(razon('presion_urgencia', 'amarillo', 'Usa frases de presión o urgencia.', evidencia));
  if (sig.plazo_menor_a_15_dias === true) razones.push(razon('plazo_muy_corto', 'amarillo', 'El plazo para pagar es menor a 15 días.'));

  const diferencia = m.diferencia_ofrecido_depositado;
  if (esNumero(diferencia) && diferencia > 0) {
    const cargos = esNumero(m.cargos_iniciales_declarados) ? m.cargos_iniciales_declarados : 0;
    if (diferencia - cargos > umbral.tolerancia_deposito_pesos) {
      razones.push(
        razon(
          'deposito_menor_sin_explicacion',
          'rojo',
          `Ofrece ${pesos(m.monto_ofrecido)} pero deposita ${pesos(m.recibes)}: ${pesos(diferencia)} menos, y no declara cargos que lo expliquen.`,
          [],
          { monto_ofrecido: m.monto_ofrecido, recibes: m.recibes, diferencia, cargos_iniciales: cargos }
        )
      );
    } else {
      razones.push(
        razon('deposito_menor_con_cargos', 'info', `Deposita ${pesos(diferencia)} menos de lo ofrecido, que corresponde a cargos iniciales declarados (${pesos(cargos)}).`, [], {
          diferencia,
          cargos_iniciales: cargos,
        })
      );
    }
  }
  return razones;
}

function semaforoPrestamo(calculo, senales, sipres, umbral, usarExtraccion, advertencias) {
  const m = calculo.metricas || {};
  const lectura = leerSipres(sipres, advertencias);
  const razones = [razonesSipres(lectura)];
  if (usarExtraccion) razones.push(...razonesDeExtraccion(m, senales, umbral, advertencias));

  const pct = m.costo_pct_sobre_recibido;
  if (esNumero(pct) && pct >= umbral.costo_amarillo_desde_pct) {
    razones.push(
      razon(
        'costo_alto',
        'amarillo',
        `Pagarías ${pesos(m.pagas)} por recibir ${pesos(m.recibes)}: ${pesos(m.costo_credito_pesos)} de costo (${pct}% de lo que recibes).`,
        [],
        {
          pagas: m.pagas,
          recibes: m.recibes,
          costo_credito_pesos: m.costo_credito_pesos,
          costo_pct_sobre_recibido: pct,
          cat_texto: calculo.cat ? calculo.cat.texto : null,
          umbral_pct: umbral.costo_amarillo_desde_pct,
        }
      )
    );
  }

  let color;
  if (razones.some((r) => r.nivel === 'rojo')) color = 'rojo';
  else if (lectura.estado === 'sin_verificar') color = 'gris';
  else color = razones.some((r) => r.nivel === 'amarillo') ? 'amarillo' : 'verde';

  if (color === 'verde') razones.push(razon('sin_senales_de_riesgo', 'verde', 'No se detectaron señales de riesgo en lo que enviaste.'));
  return resultado(color, razones, advertencias, lectura.estado);
}

function semaforo(entrada = {}, opciones = {}) {
  const { calculo, senales, sipres } = entrada || {};
  const u = (opciones && opciones.umbrales) || {};
  const umbrales = {
    tienda: { ...UMBRALES.tienda, ...(u.tienda || {}) },
    prestamo: { ...UMBRALES.prestamo, ...(u.prestamo || {}) },
  };
  const advertencias = [];

  if (!calculo || calculo.estado !== 'ok' || (calculo.tipo !== 'tienda' && calculo.tipo !== 'prestamo')) {
    return resultado('gris', [razon('sin_calculo', 'gris', 'No hay datos suficientes para calcular el costo.')], advertencias);
  }
  if (calculo.tipo === 'tienda') return semaforoTienda(calculo, umbrales.tienda, advertencias);
  return semaforoPrestamo(calculo, senales, sipres, umbrales.prestamo, !!(opciones && opciones.reglasDeExtraccion), advertencias);
}

module.exports = { semaforo, UMBRALES, LEYENDAS };
};

__fabricas["extraccion/validar-extraccion"] = function (module, exports, require) {
'use strict';

/**
 * Valida y normaliza lo que el modelo extrajo de una oferta (contrato de `extraccion/schema.json`).
 *
 * validarExtraccion(entrada, { minConfianza }) acepta el objeto o su texto JSON (con o sin cercas de código)
 * y devuelve SIEMPRE un objeto { estado, motivo, datos?, preguntas?, advertencias }:
 *   'error_formato'  la entrada no se puede leer o el tipo no es del esquema
 *   'cobranza'       el mensaje es una cobranza: no se calcula
 *   'desconocido'    el modelo no reconoció una oferta: se pide aclaración
 *   'preguntar'      la confianza es baja: se pide el texto completo
 *   'listo'          datos normalizados, listos para calcular
 *
 * El modelo propone y el código decide: solo pasan los campos del esquema, los números inválidos pasan a
 * null con advertencia (desconocido es null, nunca cero), los textos se limpian y se acotan, y las
 * señales numéricas (plazo corto, depósito menor) las calcula el código con sus propios datos.
 * Que falten datos para calcular no se decide aquí: lo dice calcular().
 */

const TIPOS = ['etiqueta_tienda', 'oferta_credito', 'cobranza', 'desconocido'];
const PERIODICIDADES = ['semanal', 'quincenal', 'mensual', 'diario', 'unico'];
const MOMENTOS = ['inicial', 'periodico', 'final'];
const DIAS_POR_PERIODO = { semanal: 7, quincenal: 15, mensual: 30, diario: 1 };
const PLAZO_CORTO_DIAS = 15;
const MIN_CONFIANZA = 0.5;

const MAX_TEXTO = 120;
const MAX_EVIDENCIA = 160;
const MAX_EVIDENCIAS = 5;
const MAX_FALTANTES = 10;

const CAMPOS = {
  raiz: ['tipo_entrada', 'confianza_extraccion', 'producto', 'credito', 'senales_riesgo', 'datos_faltantes'],
  producto: ['descripcion', 'precio_contado', 'tienda'],
  credito: [
    'otorgante_nombre_comercial', 'otorgante_razon_social', 'monto_ofrecido', 'monto_depositado', 'enganche', 'abono',
    'periodicidad', 'numero_pagos', 'plazo_dias', 'monto_total_a_pagar', 'comisiones', 'seguros', 'cat_publicado',
  ],
  senales: [
    'pide_anticipo', 'pide_permiso_contactos', 'pide_permiso_fotos_archivos', 'deposito_menor_a_ofrecido',
    'plazo_menor_a_15_dias', 'presion_urgencia', 'texto_evidencia',
  ],
};
const SENALES_DEL_MODELO = ['pide_anticipo', 'pide_permiso_contactos', 'pide_permiso_fotos_archivos', 'presion_urgencia'];

const PREGUNTA_COMPLETA = '¿Puedes pegar el texto completo de la oferta o de la etiqueta? No estoy seguro de haberlo leído bien.';
const PREGUNTA_DESCONOCIDO = '¿Me compartes el texto de la oferta o de la etiqueta que quieres revisar?';

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const faltante = (v) => v === null || v === undefined;

function limpiarTexto(valor, maximo) {
  return valor
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximo)
    .trim();
}

function leerEntrada(entrada) {
  if (typeof entrada === 'string') {
    const limpio = entrada.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let objeto;
    try {
      objeto = JSON.parse(limpio);
    } catch {
      return { motivo: 'json_invalido' };
    }
    return esObjeto(objeto) ? { objeto } : { motivo: 'entrada_invalida' };
  }
  return esObjeto(entrada) ? { objeto: entrada } : { motivo: 'entrada_invalida' };
}

function normalizador(advertencias) {
  return {
    numero(valor, campo) {
      if (faltante(valor)) return null;
      if (typeof valor === 'number' && Number.isFinite(valor) && valor >= 0) return valor;
      advertencias.push(`numero_invalido:${campo}`);
      return null;
    },
    entero(valor, campo) {
      if (faltante(valor)) return null;
      if (Number.isInteger(valor) && valor >= 1) return valor;
      advertencias.push(`entero_invalido:${campo}`);
      return null;
    },
    texto(valor, campo, maximo = MAX_TEXTO) {
      if (faltante(valor)) return null;
      if (typeof valor !== 'string') {
        advertencias.push(`texto_invalido:${campo}`);
        return null;
      }
      return limpiarTexto(valor, maximo) || null;
    },
    cargos(lista, ruta) {
      if (faltante(lista)) return [];
      if (!Array.isArray(lista)) {
        advertencias.push(`lista_invalida:${ruta}`);
        return [];
      }
      const resultado = [];
      lista.forEach((cargo, i) => {
        const concepto = esObjeto(cargo) && typeof cargo.concepto === 'string' ? limpiarTexto(cargo.concepto, MAX_TEXTO) : '';
        if (!concepto) {
          advertencias.push(`cargo_invalido:${ruta}[${i}]`);
          return;
        }
        let momento = null;
        if (!faltante(cargo.momento)) {
          if (MOMENTOS.includes(cargo.momento)) momento = cargo.momento;
          else advertencias.push(`momento_invalido:${ruta}[${i}]`);
        }
        resultado.push({ concepto, monto: this.numero(cargo.monto, `${ruta}[${i}].monto`), momento });
      });
      return resultado;
    },
  };
}

function plazoCorto(credito) {
  let dias = credito.plazo_dias;
  if (dias === null && credito.numero_pagos !== null && Object.hasOwn(DIAS_POR_PERIODO, credito.periodicidad)) {
    dias = DIAS_POR_PERIODO[credito.periodicidad] * credito.numero_pagos;
  }
  return dias !== null && dias < PLAZO_CORTO_DIAS;
}

function normalizarSenales(entrada, credito, n, advertencias) {
  let origen = entrada;
  if (!esObjeto(origen)) {
    advertencias.push('senales_ausentes');
    origen = {};
  }
  const senales = {};
  for (const campo of SENALES_DEL_MODELO) {
    const valor = origen[campo];
    if (valor !== true && valor !== false && !faltante(valor)) advertencias.push(`senal_invalida:${campo}`);
    senales[campo] = valor === true;
  }
  let evidencia = origen.texto_evidencia;
  if (!faltante(evidencia) && !Array.isArray(evidencia)) {
    advertencias.push('lista_invalida:senales_riesgo.texto_evidencia');
    evidencia = [];
  }
  senales.texto_evidencia = (evidencia || [])
    .filter((e) => typeof e === 'string')
    .map((e) => limpiarTexto(e, MAX_EVIDENCIA))
    .filter(Boolean)
    .slice(0, MAX_EVIDENCIAS);
  senales.plazo_menor_a_15_dias = plazoCorto(credito);
  senales.deposito_menor_a_ofrecido =
    credito.monto_ofrecido !== null && credito.monto_depositado !== null && credito.monto_depositado < credito.monto_ofrecido;
  return senales;
}

function normalizarDatos(objeto, advertencias) {
  const n = normalizador(advertencias);
  const seccion = (nombre) => {
    if (esObjeto(objeto[nombre])) return objeto[nombre];
    advertencias.push(`seccion_ausente:${nombre}`);
    return {};
  };
  const p = seccion('producto');
  const c = seccion('credito');

  const producto = {
    descripcion: n.texto(p.descripcion, 'producto.descripcion'),
    precio_contado: n.numero(p.precio_contado, 'producto.precio_contado'),
    tienda: n.texto(p.tienda, 'producto.tienda'),
  };

  let periodicidad = null;
  if (!faltante(c.periodicidad)) {
    if (PERIODICIDADES.includes(c.periodicidad)) periodicidad = c.periodicidad;
    else advertencias.push('periodicidad_invalida');
  }
  const credito = {
    otorgante_nombre_comercial: n.texto(c.otorgante_nombre_comercial, 'credito.otorgante_nombre_comercial'),
    otorgante_razon_social: n.texto(c.otorgante_razon_social, 'credito.otorgante_razon_social'),
    monto_ofrecido: n.numero(c.monto_ofrecido, 'credito.monto_ofrecido'),
    monto_depositado: n.numero(c.monto_depositado, 'credito.monto_depositado'),
    enganche: n.numero(c.enganche, 'credito.enganche'),
    abono: n.numero(c.abono, 'credito.abono'),
    periodicidad,
    numero_pagos: n.entero(c.numero_pagos, 'credito.numero_pagos'),
    plazo_dias: n.entero(c.plazo_dias, 'credito.plazo_dias'),
    monto_total_a_pagar: n.numero(c.monto_total_a_pagar, 'credito.monto_total_a_pagar'),
    comisiones: n.cargos(c.comisiones, 'credito.comisiones'),
    seguros: n.cargos(c.seguros, 'credito.seguros'),
    cat_publicado: n.numero(c.cat_publicado, 'credito.cat_publicado'),
  };

  let faltantes = objeto.datos_faltantes;
  if (!faltante(faltantes) && !Array.isArray(faltantes)) {
    advertencias.push('lista_invalida:datos_faltantes');
    faltantes = [];
  }
  return {
    producto,
    credito,
    senales_riesgo: normalizarSenales(objeto.senales_riesgo, credito, n, advertencias),
    datos_faltantes: (faltantes || [])
      .filter((f) => typeof f === 'string')
      .map((f) => limpiarTexto(f, MAX_TEXTO))
      .filter(Boolean)
      .slice(0, MAX_FALTANTES),
  };
}

function hayCamposDesconocidos(objeto) {
  const revisar = (obj, conocidos) => esObjeto(obj) && Object.keys(obj).some((k) => !conocidos.includes(k));
  return (
    revisar(objeto, CAMPOS.raiz) ||
    revisar(objeto.producto, CAMPOS.producto) ||
    revisar(objeto.credito, CAMPOS.credito) ||
    revisar(objeto.senales_riesgo, CAMPOS.senales)
  );
}

function validarExtraccion(entrada, opciones = {}) {
  const advertencias = [];
  const lectura = leerEntrada(entrada);
  if (!lectura.objeto) return { estado: 'error_formato', motivo: lectura.motivo, advertencias };
  const objeto = lectura.objeto;

  if (!TIPOS.includes(objeto.tipo_entrada)) return { estado: 'error_formato', motivo: 'tipo_entrada_invalido', advertencias };
  if (hayCamposDesconocidos(objeto)) advertencias.push('campos_desconocidos');

  const c = objeto.confianza_extraccion;
  const confianzaValida = typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1;
  if (!confianzaValida) advertencias.push('confianza_invalida');
  const confianza = confianzaValida ? c : 0;

  if (objeto.tipo_entrada === 'cobranza') {
    return { estado: 'cobranza', motivo: 'cobranza', datos: { tipo_entrada: 'cobranza', confianza_extraccion: confianza }, advertencias };
  }
  if (objeto.tipo_entrada === 'desconocido') {
    return { estado: 'desconocido', motivo: 'tipo_desconocido', preguntas: [PREGUNTA_DESCONOCIDO], advertencias };
  }

  const datos = { tipo_entrada: objeto.tipo_entrada, confianza_extraccion: confianza, ...normalizarDatos(objeto, advertencias) };
  const minimo = typeof opciones.minConfianza === 'number' ? opciones.minConfianza : MIN_CONFIANZA;
  if (confianza < minimo) {
    return { estado: 'preguntar', motivo: 'confianza_baja', preguntas: [PREGUNTA_COMPLETA], datos, advertencias };
  }
  return { estado: 'listo', motivo: 'ok', datos, advertencias };
}

module.exports = { validarExtraccion };
};

__fabricas["respuesta/respuesta"] = function (module, exports, require) {
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
};

__fabricas["flujo/procesar"] = function (module, exports, require) {
'use strict';

/**
 * Orquestador: lo que hace la herramienta `evaluar_oferta` del bot.
 *
 * procesar({ extraccion, tablaSipres, config, hoy }) devuelve SIEMPRE un objeto:
 *   { accion: 'responder', texto, motivo, log, advertencias }  -> enviar `texto` tal cual
 *   { accion: 'redactar', ctx, plantilla, log, advertencias }  -> el modelo redacta con `ctx`, o se envía `plantilla`
 *
 * Encadena: validar extracción -> (SIPRES si es un préstamo) -> calcular -> semáforo -> contexto.
 * No guarda nada, no llama a ninguna API y no copia el texto de la persona: el log solo lleva fecha,
 * tipo de entrada, color del semáforo y estado de SIPRES.
 *
 * config: { minConfianza, umbrales, reglasDeExtraccion, enlaces }. Las reglas de extracción están
 * apagadas por defecto (ver semaforo.js).
 */

const { validarExtraccion } = require('../extraccion/validar-extraccion');
const { calcular } = require('../calculo/calculo');
const { semaforo } = require('../semaforo/semaforo');
const { buscarEntidad } = require('../sipres/sipres');
const R = require('../respuesta/respuesta');

const PREGUNTAS = {
  'producto.precio_contado': '¿Cuál es el precio de contado del producto?',
  'credito.monto_depositado': '¿Cuánto dinero te depositan realmente?',
  'credito.abono': '¿De cuánto es cada pago?',
  'credito.numero_pagos': '¿Cuántos pagos son?',
  'credito.periodicidad': '¿Cada cuánto pagas: semanal, quincenal o mensual?',
  'credito.monto_total_a_pagar': '¿Cuánto pagarás en total?',
  'credito.plazo_dias': '¿En cuántos días tienes que pagar?',
};

function buscarSipres(datos, tablaSipres, advertencias) {
  const resultado = buscarEntidad(tablaSipres, {
    nombre_comercial: datos.credito.otorgante_nombre_comercial,
    razon_social: datos.credito.otorgante_razon_social,
  });
  if (resultado.motivo !== 'ok') advertencias.push(`sipres:${resultado.motivo}`);
  resultado.advertencias.forEach((a) => advertencias.push(`sipres:${a}`));
  return resultado;
}

function procesar({ extraccion, tablaSipres, config, hoy = null } = {}) {
  const cfg = config && typeof config === 'object' ? config : {};
  const validacion = validarExtraccion(extraccion, { minConfianza: cfg.minConfianza });
  const advertencias = [...validacion.advertencias];

  const log = (tipo, color, sipres) => ({ fecha: hoy, tipo_entrada: tipo, semaforo: color, estado_sipres: sipres });
  const responder = (texto, motivo, tipo = 'desconocido') => ({
    accion: 'responder',
    texto,
    motivo,
    log: log(tipo, 'n.a.', 'n.a.'),
    advertencias,
  });

  if (validacion.estado === 'error_formato') return responder(R.mensajes.error(), 'error_formato');
  if (validacion.estado === 'cobranza') return responder(R.mensajes.cobranza(), 'cobranza', 'cobranza');
  if (validacion.estado === 'desconocido' || validacion.estado === 'preguntar') {
    const tipo = validacion.datos ? validacion.datos.tipo_entrada : 'desconocido';
    return responder(R.mensajes.aclaracion(validacion.preguntas), validacion.motivo, tipo);
  }

  const datos = validacion.datos;
  const sipres = datos.tipo_entrada === 'oferta_credito' ? buscarSipres(datos, tablaSipres, advertencias) : null;

  const calculo = calcular(datos);
  if (calculo.estado !== 'ok') {
    if (calculo.motivo === 'datos_insuficientes') {
      const preguntas = Array.from(new Set(calculo.campos.map((campo) => PREGUNTAS[campo]).filter(Boolean)));
      return responder(R.mensajes.aclaracion(preguntas), 'datos_insuficientes', datos.tipo_entrada);
    }
    return responder(R.mensajes.error(), `calculo_invalido:${calculo.motivo}`, datos.tipo_entrada);
  }

  const resultado = semaforo(
    {
      calculo,
      senales: datos.senales_riesgo,
      sipres: sipres && { estado: sipres.estado, fecha_consulta: sipres.fecha_consulta, terminos_buscados: sipres.terminos_buscados },
    },
    { umbrales: cfg.umbrales, reglasDeExtraccion: cfg.reglasDeExtraccion === true }
  );
  const fuentes = sipres && sipres.fecha_consulta ? { sipres: { fecha: sipres.fecha_consulta } } : {};
  const ctx = R.armarContexto({ calculo, semaforo: resultado, fuentes, config: cfg });
  if (!ctx) return responder(R.mensajes.error(), 'sin_contexto', datos.tipo_entrada);

  return {
    accion: 'redactar',
    ctx,
    plantilla: R.plantillaDesdeContexto(ctx),
    log: log(datos.tipo_entrada, resultado.color, resultado.estado_sipres || 'n.a.'),
    advertencias: Array.from(new Set([...advertencias, ...ctx.advertencias])),
  };
}

module.exports = { procesar };
};

const TABLA_SIPRES = [
  {
    "nombre_comercial": "Fincomún",
    "razon_social": "Fincomún, Servicios Financieros, S.A. de C.V., Sociedad Financiera Popular",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Unagra",
    "razon_social": "UNAGRA, S.A. de C.V., Sociedad Financiera Popular",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finamigo",
    "razon_social": "Financiera Mexicana para el Desarrollo Rural, S.A. de C.V., S. F. P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fita Servicios Financieros",
    "razon_social": "Financiera Tamazula, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Monte de Piedad",
    "razon_social": "Financiera Monte de Piedad, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Klar",
    "razon_social": "Klar Technologies, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BBDC DIGITAL",
    "razon_social": "Ictineo Plataforma, S.A. de C.V., Sociedad Financiera Popular",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credicapital",
    "razon_social": "Solución Asea, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Avantthya",
    "razon_social": "Operaciones de Tu Lado, S.A. de C.V., Sociedad Financiera Popular",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Unete",
    "razon_social": "Únete Financiera de Allende, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Resuelve Fin",
    "razon_social": "Sociedad de Alternativas Económicas, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Multiplica",
    "razon_social": "Multiplica México, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finsocial",
    "razon_social": "Financiera del Sector Social, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bienestar Prestamos y Ahorro",
    "razon_social": "Administradora de Caja Bienestar, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ASP Integra Opciones",
    "razon_social": "Opciones Empresariales del Noreste, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Broxel",
    "razon_social": "Financiera Broxel, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Progressa",
    "razon_social": "Caja Progressa, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Stori",
    "razon_social": "Stori México, S.A. de C.V. S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Libertad",
    "razon_social": "Libertad Servicios Financieros, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capital Activo",
    "razon_social": "Capital Activo, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sofiexpress",
    "razon_social": "J.P. Sofiexpress, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fondeadora",
    "razon_social": "Fondea Technologies, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Más",
    "razon_social": "Financiera Más, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulso",
    "razon_social": "Impulso para el Desarrollo de México, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Paso Seguro",
    "razon_social": "Paso Seguro Creando Futuro, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Súmate",
    "razon_social": "Financiera Súmate, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kubo",
    "razon_social": "Ku-Bo Financiero, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINSUS",
    "razon_social": "Financiera Sustentable de México, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CrediClub",
    "razon_social": "Crediclub, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SFP Porvenir",
    "razon_social": "SFP Porvenir, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PREMO",
    "razon_social": "Préstamo Empresarial Oportuno, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRENSA",
    "razon_social": "Grupo Regional de Negocios, S.A. de C.V., S.F.P.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Trafalgar SFP",
    "razon_social": "Trafalgar SFP, S.A. de C.V., Sociedad Financiera Popular",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras Populares",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inmaculada",
    "razon_social": "Caja Inmaculada, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Coop",
    "razon_social": "CoopDesarrollo, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CristóbalColón",
    "razon_social": "Caja Popular Cristóbal Colón, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Cihualpilli",
    "razon_social": "Caja Cihualpilli de Tonalá, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Providencia",
    "razon_social": "Caja Popular la Providencia, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja 15 de Mayo",
    "razon_social": "Caja Popular 15 de Mayo, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Oblatos",
    "razon_social": "Caja Popular Oblatos, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Apaseo",
    "razon_social": "Caja Popular Apaseo el Alto S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Cerano",
    "razon_social": "Caja Popular Cerano, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cortazar",
    "razon_social": "Caja Popular Cortazar, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Alianza",
    "razon_social": "Caja Popular los Reyes, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Yanga",
    "razon_social": "Caja Popular de Ahorros Yanga, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Hipódromo",
    "razon_social": "Caja Hipódromo, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SMG",
    "razon_social": "Caja SMG, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CP Purépero",
    "razon_social": "Caja Popular Purépero, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Acreimex",
    "razon_social": "Cooperativa Acreimex, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "San Pablo",
    "razon_social": "Caja Popular San Pablo, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "La Juventino",
    "razon_social": "Caja Popular Juventino Rosas, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "San Gabriel",
    "razon_social": "Caja Solidaria San Gabriel, S.C., de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Solidaria Huimilpan",
    "razon_social": "Caja Solidaria San Miguel Huimilpan, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CSN",
    "razon_social": "CSN Cooperativa Financiera, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ejidos de Xalisco",
    "razon_social": "Caja Solidaria Ejidos de Xalisco, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Epitacio Huerta",
    "razon_social": "Caja Solidaria Epitacio Huerta, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Manzanillo",
    "razon_social": "Caja Popular Manzanillo, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Valladolid Caja Financiera",
    "razon_social": "Caja Morelia Valladolid, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Chiquiliztli",
    "razon_social": "Caja Solidaria Chiquiliztli, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Tecuala",
    "razon_social": "Caja Solidaria Tecuala, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CSJ.Bautista",
    "razon_social": "Cooperativa San Juan Bautista de San Juan del Río, Qro., S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fray Juan Calero",
    "razon_social": "Caja Popular Fray Juan Calero, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Mitras",
    "razon_social": "Caja Mitras, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Popular Mexicana",
    "razon_social": "Caja Popular Mexicana, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Valle",
    "razon_social": "Caja Solidaria Valle de Guadalupe, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Alianza",
    "razon_social": "Jesús María Montaño, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Elota",
    "razon_social": "Caja Solidaria Elota, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja San José",
    "razon_social": "Caja Popular San José de Casimiro, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RED ECO COOP",
    "razon_social": "Red Eco de la Montaña, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FES",
    "razon_social": "Fesolidaridad, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lachao",
    "razon_social": "Cooperativa Lachao, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "José Ma. Mercado",
    "razon_social": "Caja Popular José Ma. Mercado, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sistemas POC",
    "razon_social": "Sistemas de Proyectos Organizados en Comunidad, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CSGuachinango",
    "razon_social": "Caja Solidaria Guachinango, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Popular Las Huastecas",
    "razon_social": "Caja Popular las Huastecas, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONSIGO",
    "razon_social": "Caja de Ahorros Tepeyac, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja de Ahorro de los Telefonistas",
    "razon_social": "Caja de Ahorro de los Telefonistas, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Santa María de Guadalupe",
    "razon_social": "Caja Santa Maria de Guadalupe, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Real del Potosí",
    "razon_social": "Caja Real del Potosí, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agustín de I",
    "razon_social": "Caja Popular Agustín de Iturbide, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja San Rafael",
    "razon_social": "Caja Popular San Rafael, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Seficroc",
    "razon_social": "Seficroc, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Tepic",
    "razon_social": "Caja Tepic, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "San Isidro",
    "razon_social": "Caja San Isidro, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CSC Amealco",
    "razon_social": "Caja Solidaria Campesina Santa María Amealco, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CajaTomatlán",
    "razon_social": "Caja Popular Tomatlán, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Tlajo",
    "razon_social": "Caja Popular San José de Tlajomulco, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Velasco",
    "razon_social": "Caja Popular José Ma. Velasco, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja SM",
    "razon_social": "Caja Santa María, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "León Franco",
    "razon_social": "Caja Popular León Franco de Rioverde, SLP., S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cerrodelasil",
    "razon_social": "Caja Cerro de la Silla, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CSRSerrana",
    "razon_social": "Caja Solidaria Regional Serrana, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Pio XII",
    "razon_social": "Caja Popular Pio XII, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CDP",
    "razon_social": "Caja Depac Poblana, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tzaulán",
    "razon_social": "Caja Popular Tzaulán, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sagrada Fam",
    "razon_social": "Caja la Sagrada Familia, S.C. de A.P de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Buenos Aires",
    "razon_social": "Caja Buenos Aires, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CSLaHuerta",
    "razon_social": "Caja Solidaria la Huerta, S.C. de A.P. de R.L de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Acapiotzin",
    "razon_social": "Cooperativa Acapiotzin, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Unifam",
    "razon_social": "Caja de Ahorros UNIFAM, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Galeana",
    "razon_social": "Caja Solidaria Galeana, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "San Andrés",
    "razon_social": "Cooperativa San Andrés Coyutla, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aguascalientes",
    "razon_social": "Caja Solidaria Aguascalientes, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CPTeocelo",
    "razon_social": "Caja Popular Teocelo, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CComonfort",
    "razon_social": "Caja Popular Comonfort, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja AMA",
    "razon_social": "Caja Arturo Márquez Aguilar, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Tonaya",
    "razon_social": "Caja Popular Nuestra Señora de Tonaya, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Popular Villanueva",
    "razon_social": "Caja Popular Villanueva, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Alianza",
    "razon_social": "Caja Popular Santuario Guadalupano, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CP Sahuayo",
    "razon_social": "Caja Popular Sahuayo, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tata Vasco",
    "razon_social": "Caja Popular Tata Vasco, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Atemajac",
    "razon_social": "Cooperativa de Ahorro y Préstamo Caja Popular Atemajac, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CajaProgreso",
    "razon_social": "Progreso de Vicente Guerrero S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "C Cristo Rey",
    "razon_social": "Caja Popular Cristo Rey, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "San Juan",
    "razon_social": "Caja Solidaria Sierra de San Juan, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "C Concepción",
    "razon_social": "Caja Popular Inmaculada Concepción de la Huerta, S.C. de A.P. de R.L. C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CajaPeñitas",
    "razon_social": "Caja Popular Peñitas, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Santiago Apostol",
    "razon_social": "Caja Popular Santiago Apóstol, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dos Ríos",
    "razon_social": "Caja Solidaria Dos Ríos, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Sur",
    "razon_social": "Caja Solidaria Sur de Jalisco, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CPSJI",
    "razon_social": "Caja Popular San José Iturbide, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Casa Ahorro",
    "razon_social": "Caja Solidaria Casa de Ahorro Campesino, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAJASAMAO",
    "razon_social": "Caja Solidaria Santa María del Oro, S.C. de A.P de R.L de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CajaDrArroyo",
    "razon_social": "Caja Solidaria Dr. Arroyo, S.C. de A.P. de R.L. de C.V",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja JC",
    "razon_social": "Caja Solidaria José Carrillo García, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NuevaGalicia",
    "razon_social": "Caja Solidaria Nueva Galicia, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SnJuan Bosco",
    "razon_social": "Caja Popular San Juan Bosco, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EIZ",
    "razon_social": "Esperanza Indígena Zapoteca, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dolores Hgo",
    "razon_social": "Caja Popular Dolores Hidalgo, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CS Magdalena",
    "razon_social": "Caja Solidaria Magdalena, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Yuriria",
    "razon_social": "Caja Popular Yuriria, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MiguelCruces",
    "razon_social": "Caja Solidaria San Miguel de Cruces, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IFR Tlapanal",
    "razon_social": "IFR Tlapanaltomin, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Yolomecatl",
    "razon_social": "Cooperativa Yolomecatl, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Rosario",
    "razon_social": "Caja Popular Rosario, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "El Rosario",
    "razon_social": "El Rosario, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Florencio Rosas",
    "razon_social": "Caja Popular Florencio Rosas de Querétaro, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "La Merced",
    "razon_social": "Caja Popular la Merced, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cooperativa Caz",
    "razon_social": "Caja Zongolica S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "C Polotitlán",
    "razon_social": "Caja Polotitlán, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja SolTala",
    "razon_social": "Caja Solidaria Tala, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Zapotitlán",
    "razon_social": "Caja Solidaria Zapotitlán, S.C. de A.P de R.L de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CPSMA",
    "razon_social": "Caja Popular San Miguel de Allende, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finagam",
    "razon_social": "FINAGAM, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CajaCamotlan",
    "razon_social": "Caja Solidaria Puente de Camotlán, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CaJala",
    "razon_social": "Caja Solidaria Jala, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lagunillas",
    "razon_social": "Caja Popular Lagunillas, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "El Limón",
    "razon_social": "Caja Solidaria el Limón, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "C Xochitlan",
    "razon_social": "Caja Solidaria Xochitlan, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nuevo México",
    "razon_social": "Cooperativa Nuevo México, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tosepantomin",
    "razon_social": "Tosepantomin, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Fama",
    "razon_social": "Caja Fama, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "9 de agosto",
    "razon_social": "Caja Popular 9 de Agosto Salamanca, S.C. de A.P. de R.L. de C.V",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Tuxca",
    "razon_social": "Caja Solidaria Tuxca, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SanSebastián",
    "razon_social": "Caja Solidaria San Sebastián del Oeste, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prog García",
    "razon_social": "Caja Popular Progreso García, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CajaChavinda",
    "razon_social": "Caja Popular Chavinda, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CajaTamazula",
    "razon_social": "Caja Popular Tamazula, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CSCuautitlán",
    "razon_social": "Caja Solidaria Cuautitlán, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CSantiaguito",
    "razon_social": "Caja de Ahorro Santiaguito, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Guadalupana",
    "razon_social": "Caja la Guadalupana, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Minatitlán",
    "razon_social": "Caja Solidaria Minatitlán, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Itzaez",
    "razon_social": "Caja Itzaez, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "C Tecolotlán",
    "razon_social": "Caja Solidaria Tecolotlán, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tangamandapi",
    "razon_social": "Caja Popular Padre Epifanio Padilla de Tangamandapio, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "U.S. Allende",
    "razon_social": "Unión de Servicios Allende, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sn Bernardino",
    "razon_social": "Caja Popular San Bernardino de Siena Valladolid, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Teocaltiche",
    "razon_social": "La Caja Solidaria de Teocaltiche, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caja Maravatio",
    "razon_social": "Caja Popular Maravatío, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "C Tepoztlán",
    "razon_social": "Cooperativa Tepoztlán, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kafen Tomin",
    "razon_social": "Caja Solidaria Kafen Tomin, S.C. de A.P de R.L de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nva Atemajac",
    "razon_social": "Cooperativa Nueva Atemajac del Valle, S.C. de A.P. DE R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ten Apatz Tz",
    "razon_social": "Caja Solidaria Ten Apatz Tzotzob, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "San Dionisio",
    "razon_social": "Caja Solidaria San Dionisio Ocotepec, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Coop Suljaa",
    "razon_social": "Cooperativa Suljaa, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nuevo Ideal",
    "razon_social": "Caja Solidaria Nuevo Ideal, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gonzalo Vega",
    "razon_social": "Caja Gonzalo Vega, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ciudad Hidalgo",
    "razon_social": "Caja Popular Ciudad Hidalgo, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "COSTA ALEGRE",
    "razon_social": "Caja Solidaria Costa Alegre, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAJA CORONEO",
    "razon_social": "Caja Solidaria Coroneo, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAJA TALPENSE",
    "razon_social": "Caja Solidaria Talpense, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SAKATEKAPAN",
    "razon_social": "Sakatekapan, S.C. de A.P. de R.L. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Cooperativas de Ahorro y Préstamo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bancomext",
    "razon_social": "Banco Nacional de Comercio Exterior, S.N.C.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca de desarrollo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banobras",
    "razon_social": "Banco Nacional de Obras y Servicios Públicos, S.N.C, Institución de Banca de Desarrollo.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca de desarrollo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banjército",
    "razon_social": "Banco Nacional del Ejército, Fuerza Aérea y Armada, Sociedad Nacional de Crédito, Institución de Banca de Desarrollo.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca de desarrollo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NAFIN",
    "razon_social": "Nacional Financiera, Sociedad Nacional de Crédito, Institución de Banca de Desarrollo.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca de desarrollo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banco del Bienestar",
    "razon_social": "Banco del Bienestar, Sociedad Nacional de Crédito, Institución de Banca de Desarrollo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca de desarrollo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SHF",
    "razon_social": "Sociedad Hipotecaria Federal, Sociedad Nacional de Crédito, Institución de Banca de Desarrollo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca de desarrollo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banamex",
    "razon_social": "Banco Nacional de México, S. A., Integrante del Grupo Financiero Banamex.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BBVA",
    "razon_social": "BBVA México, S.A., Institución de Banca Múltiple, Grupo Financiero BBVA México",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Santander",
    "razon_social": "Banco Santander México, S.A., Institución de Banca Múltiple, Grupo Financiero Santander México",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HSBC",
    "razon_social": "HSBC México, S.A., Institución de Banca Múltiple, Grupo Financiero HSBC.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bajío",
    "razon_social": "Banco del Bajío, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banco Inbursa",
    "razon_social": "Banco Inbursa, S. A., Institución de Banca Múltiple, Grupo Financiero Inbursa",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mifel",
    "razon_social": "Banca Mifel, S.A., Institución de Banca Múltiple, Grupo Financiero Mifel",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Scotiabank",
    "razon_social": "Scotiabank Inverlat, S.A., Institución de Banca Múltiple, Grupo Financiero Scotiabank Inverlat",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banregio",
    "razon_social": "Banco Regional, S.A., Institución de Banca Múltiple, Banregio Grupo Financiero",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Invex",
    "razon_social": "Banco Invex, S.A., Institución de Banca Múltiple, Invex Grupo Financiero.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bansi",
    "razon_social": "Bansi, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Afirme",
    "razon_social": "Banca Afirme, S.A., Institución de Banca Múltiple, Afirme Grupo Financiero",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banorte",
    "razon_social": "Banco Mercantil del Norte, S.A., Institución de Banca Múltiple, Grupo Financiero Banorte",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bank of America",
    "razon_social": "Bank of America México, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MUFG",
    "razon_social": "MUFG Bank México, S.A., Institución de Banca Múltiple Filial",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JP Morgan",
    "razon_social": "Banco J.P. Morgan, S.A., Institución de Banca Múltiple, J.P. Morgan Grupo Financiero",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Monex",
    "razon_social": "Banco Monex, S.A., Institución de Banca Múltiple, Monex Grupo Financiero",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ve Por Más",
    "razon_social": "Banco Ve Por Más, S.A., Institución de Banca Múltiple, Grupo Financiero Ve Por Más.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banco Citi México",
    "razon_social": "Banco Citi México, S.A., Institución de Banca Múltiple, Grupo Financiero Citi México",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credit Suisse",
    "razon_social": "Banco Credit Suisse (México), S.A., Institución de Banca Múltiple, Grupo Financiero Credit Suisse (Mexico).",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Azteca",
    "razon_social": "Banco Azteca, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kapital Bank",
    "razon_social": "KPTL México Bank, S.A., Institución de Banca Múltiple, Kapital México Grupo Financiero",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Barclays",
    "razon_social": "Barclays Bank México, S.A., Institución de Banca Múltiple, Grupo Financiero Barclays México.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Compartamos",
    "razon_social": "Banco Compartamos, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Multiva",
    "razon_social": "Banco Multiva, S.A. Institución de Banca Múltiple, Grupo Financiero Multiva",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ACTINVER",
    "razon_social": "Banco Actinver, S.A., Institución de Banca Múltiple, Grupo Financiero Actinver",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Intercam",
    "razon_social": "Intercam Banco, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bancoppel",
    "razon_social": "BanCoppel, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ualá",
    "razon_social": "Ualá, S. A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BIAfirme",
    "razon_social": "Banco de Inversión Afirme, S.A., Institución de Banca Múltiple, Afirme Grupo Financiero",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Consubanco",
    "razon_social": "Consubanco, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VW BANK",
    "razon_social": "Volkswagen Bank, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BASE",
    "razon_social": "Banco Base, S.A., Institución de Banca Múltiple, Grupo Financiero Base",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bankaool",
    "razon_social": "Bankaool, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Pagatodo",
    "razon_social": "Banco Pagatodo, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banco Banfeliz",
    "razon_social": "Banco Banfeliz S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inmobiliario Mexicano",
    "razon_social": "Banco Inmobiliario Mexicano, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banco Dondé",
    "razon_social": "Fundación Dondé Banco, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bancrea",
    "razon_social": "Banco Bancrea, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Covalto",
    "razon_social": "Banco Covalto, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ICBC",
    "razon_social": "Industrial and Commercial Bank of China México, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sabadell",
    "razon_social": "Banco Sabadell, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Shinhan",
    "razon_social": "Banco Shinhan de México, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mizuho",
    "razon_social": "Mizuho Bank México, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bank of China",
    "razon_social": "Bank of China México, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banco S3 Caceis",
    "razon_social": "Banco S3 Caceis México, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banco KEB Hana",
    "razon_social": "Banco KEB Hana México, S.A., Institución de Banca Múltiple Filial",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BNP Paribas",
    "razon_social": "BNP Paribas México, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BANCO BINEO",
    "razon_social": "Banco Bineo, S.A., Institución de Banca Múltiple, Grupo Financiero Banorte",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HEY BANCO",
    "razon_social": "Hey Banco, S.A. Institución de Banca Múltiple, Banregio Grupo Financiero",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OPENBANK",
    "razon_social": "Openbank México, S.A., Institución de Banca Múltiple, Grupo Financiero Santander México",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "REVOLUT BANK",
    "razon_social": "Revolut Bank, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BANCO PLATA",
    "razon_social": "Banco Plata, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NUBANK",
    "razon_social": "Nubank, S.A., Institución de Banca Múltiple",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de banca múltiple",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FUNDARY",
    "razon_social": "Fundary, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KLIMB",
    "razon_social": "Likideo MX, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BXL FINTECH",
    "razon_social": "BXL FINTECH, S.A. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Doopla",
    "razon_social": "Grupo Finansiell, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prestadero",
    "razon_social": "Communitas Aurum, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "M2crowd",
    "razon_social": "M2crowd, S.A. de C.V., Institución de Financiamiento Colectivo.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Play Business",
    "razon_social": "Play Business, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "100 LADRILLOS",
    "razon_social": "Plataforma Inmobiliaria Cien Ladrillos, S.A.P.I. de C.V., Institución de Financiamiento Colectivo.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Arces",
    "razon_social": "Crowd Up Mex, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CROWDLINK",
    "razon_social": "PorCuanto, S.A. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TOP KAPITAL",
    "razon_social": "Top Kapital Desarrollos Inmobiliarios del Centro, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ARKANGELES",
    "razon_social": "Angeles en ARK, S.A.P.I de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Red Girasol",
    "razon_social": "Red Girasol, S.A.P.I de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Yo Te Presto",
    "razon_social": "Comunidad de Préstamos, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINSPHERA",
    "razon_social": "Sustainable Tech ESG, S.A.P.I. de C.V., Institución de Financiamiento Colectivo.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "Autorizada"
  },
  {
    "nombre_comercial": "FINTIGO",
    "razon_social": "Fintigo, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MONIFIC",
    "razon_social": "MONIFIC, S.A. DE CV., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capital Funding",
    "razon_social": "Emprendimientos Maussan y González, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Expansive",
    "razon_social": "EXPANSIVE REALTY, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INVERTECA",
    "razon_social": "Grupo Quindalo, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCOMBI",
    "razon_social": "UCOMBI, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "Autorizada"
  },
  {
    "nombre_comercial": "SNOWBALL",
    "razon_social": "SFC Snowball Community, S.A. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "briq.mx",
    "razon_social": "Briq Fund, S.A.P.I de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lendera",
    "razon_social": "Lendera Crowdfunding, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TEC SDF",
    "razon_social": "TEC SDF, S.A.P.I. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PM2",
    "razon_social": "Plataforma por Metro Cuadrado, S.A.P.I. de C.V., Institución de Financiamiento Colectivo.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Afluenta",
    "razon_social": "Afluenta México, S.A. de C.V., Institución de Financiamiento Colectivo",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Instituciones de Financiamiento Colectivo",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sólida",
    "razon_social": "Arrendadora y Factor Banorte, S.A. de C.V., SOFOM, E.R., Grupo Financiero Banorte",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Start Banregio",
    "razon_social": "Start Banregio, S.A. de C.V. SOFOM, E.R., Banregio Grupo Financiero",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Bajío",
    "razon_social": "Financiera Bajío, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mifel Sofom",
    "razon_social": "Mifel, S.A. de C.V., SOFOM, E.R., Grupo Financiero Mifel",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gramin Carso",
    "razon_social": "Gramin Carso, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sofom Inbursa",
    "razon_social": "Sofom Inbursa, S.A. de C.V., SOFOM, E.R., Grupo Financiero Inbursa",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finanmadrid",
    "razon_social": "Finanmadrid México, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Arrendadora BX+",
    "razon_social": "Arrendadora Ve Por Más, S.A. de C.V., SOFOM, E.R., Grupo Financiero Ve Por Más",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "A Afirme",
    "razon_social": "Arrendadora Afirme, S.A. de C.V., SOFOM, E.R., Afirme Grupo Financiero",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "F Afirme",
    "razon_social": "Factoraje Afirme, S.A. de C.V., SOFOM, E.R., Afirme Grupo Financiero",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Consupago",
    "razon_social": "Consupago, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Opcipres",
    "razon_social": "Opcipres, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Comercios AF",
    "razon_social": "Comercios Afiliados, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OSM",
    "razon_social": "Operadora de Servicios Mega, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Metrofinanciera",
    "razon_social": "Metrofinanciera, S.A.P.I. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TRATON Financial Services Mexico",
    "razon_social": "TRATON Financial Services Mexico, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mercader Fin",
    "razon_social": "Mercader Financial, S.A., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GM Financial",
    "razon_social": "GM Financial de México, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Faccorp",
    "razon_social": "Factoring Corporativo, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cetelem",
    "razon_social": "Autoexpress Inbursa, S.A. de C.V., Sofom, E.R., Grupo Financiero Inbursa",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FordCredit",
    "razon_social": "Ford Credit de México, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PDN",
    "razon_social": "Portafolio de Negocios, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Value Arrend",
    "razon_social": "Value Arrendadora, S.A. de C.V., SOFOM, E.R., Value Grupo Financiero",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ION",
    "razon_social": "ION Financiera, S.A.P.I. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Registral II",
    "razon_social": "Promotora de Infraestructura Registral II, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sofoplus",
    "razon_social": "Sofoplus, S.A.P.I. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "STM Financial",
    "razon_social": "STM Financial, S.A.P.I. de C.V., SOFOM, E.R., Grupo Financiero Inbursa",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINBE",
    "razon_social": "Financiera Bepensa, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INCLUSION FIN",
    "razon_social": "Santander Inclusión Financiera, S.A. de C.V., SOFOM, E. R., Grupo Financiero Santander México.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Abancrea",
    "razon_social": "Arrendadora Bancrea, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Arbase",
    "razon_social": "Arrendadora Base, S.A. de C.V., SOFOM, E.R., Grupo Financiero Base.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Invex Consumo",
    "razon_social": "Invex Consumo, S.A. de C.V., SOFOM, E.R., Invex Grupo Financiero",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIN ÚTIL",
    "razon_social": "Fin Útil, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Más Nómina",
    "razon_social": "Fisofo, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Hey Portafolios",
    "razon_social": "Hey Portafolios, S.A. de C.V., SOFOM E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Element Fleet",
    "razon_social": "Element Fleet México, S.A. de C.V., SOFOM, E.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple, E.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCAY",
    "razon_social": "Unión de Crédito Agrícola del Yaqui, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Cajeme",
    "razon_social": "Unión de Crédito Agrícola de Cajeme, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCGT",
    "razon_social": "Unión de Crédito Ganadero de Tabasco, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCAMAYO",
    "razon_social": "Unión de Crédito Agrícola del Mayo, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCAH",
    "razon_social": "Unión de Crédito Agrícola de Huatabampo, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCDelicias",
    "razon_social": "Unión de Crédito Delicias, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCIALSA",
    "razon_social": "Unión de Crédito Industrial y Agropecuario de la Laguna, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Unicrece",
    "razon_social": "Unión de Crédito Agrícola Ganadero del Estado de Yucatán,S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "--",
    "razon_social": "Credicor Mexicano Unión de Crédito, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCAIVYSA-",
    "razon_social": "Unión de Crédito Agropecuario e Industrial del Valle del Yaqui, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UNICRECHI",
    "razon_social": "Unión de Crédito Chihuahuense, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCIVBA",
    "razon_social": "Crece Unión de Crédito, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCSM",
    "razon_social": "Unión de Crédito San Marcos, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCA",
    "razon_social": "Unión de Crédito Alpura, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PPUC",
    "razon_social": "Protección Patrimonial Unión de Crédito, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCGP",
    "razon_social": "Unión de Crédito de Gómez Palacio, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GN",
    "razon_social": "Unión de Crédito Ganaderos del Norte, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCB Impulsa",
    "razon_social": "UCB Impulsa Unión de Crédito, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Unicreco",
    "razon_social": "Unión de Crédito del Comercio, Servicios y Turismo del Sureste, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCS",
    "razon_social": "Unión de Crédito del Soconusco, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCCISTO",
    "razon_social": "Unión de Crédito del Comercio e Industria y Servicios Turísticos de Occidente, S. A. de C. V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCAGI",
    "razon_social": "Unión de Crédito Agrícola, Ganadera e Industrial del Potosí, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gasolineros",
    "razon_social": "Unión de Crédito de Gasolineros, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCIC",
    "razon_social": "Unión de Crédito de la Industria de la Construcción de San Luis Potosí, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCIC",
    "razon_social": "Unión de Crédito de la Industria de la Construcción de Sonora, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UNICCO",
    "razon_social": "Unión de Crédito de Comercio, Servicios y Turismo de Chiapas, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCICUR",
    "razon_social": "Unión de Crédito de la Industria de la Curtiduría del Estado de Guanajuato, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UNICUN",
    "razon_social": "Unión de Crédito Industrial, Comercial y de Servicios de Cancún, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCHSA",
    "razon_social": "Unión de Crédito de Hidalgo, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Unicremix",
    "razon_social": "Unión de Crédito Mixta del Carmen, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCREI",
    "razon_social": "Unión de Crédito de Industriales de Nuevo León, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UC Saltillo",
    "razon_social": "Unión de Crédito Saltillo, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCREMIX",
    "razon_social": "Unión de Crédito de la Mixteca, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCICA",
    "razon_social": "UCICA, Unión de Crédito, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCREA",
    "razon_social": "Unión de Crédito Allende, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "valora",
    "razon_social": "Valora Unión de Crédito, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCM Coah",
    "razon_social": "Unión de Crédito Mixta de Coahuila, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCDA",
    "razon_social": "Unión de Crédito de Distribuidores Automotrices, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "El Águila",
    "razon_social": "Unión de Crédito el Águila, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prodemex",
    "razon_social": "Unión de Crédito Promotora para el Desarrollo Económico del Estado de México, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCACSA",
    "razon_social": "Unión de Crédito Agricultores de Cuauhtémoc, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UniCCo",
    "razon_social": "Unión de Crédito para la Contaduría Pública, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCG",
    "razon_social": "Unión de Crédito General, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Uncred pto vta",
    "razon_social": "Unión de Crédito de Puerto Vallarta, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Santa Fe",
    "razon_social": "Unión de Crédito Santa Fe, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Define",
    "razon_social": "Unión de Crédito Define, S.A. de C.V",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCISA",
    "razon_social": "Unión de Crédito Integral, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Unidesarrollo",
    "razon_social": "Unión de Crédito Desarrollo de Chiapas, S. A. de C. V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ficein",
    "razon_social": "Ficein Unión de Crédito, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UNICREICH",
    "razon_social": "Unión de Crédito Interestatal Chiapas, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCEPCO",
    "razon_social": "Unión de Crédito Estatal de Productores de Café de Oaxaca, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Monarca",
    "razon_social": "Unión de Crédito Monarca, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Red Uno",
    "razon_social": "CrediRed Uno Unión de Crédito, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Multi",
    "razon_social": "Multiopciones Unión de Crédito, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCRNV",
    "razon_social": "Unión de Crédito Regional del Norte de Veracruz, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCEV",
    "razon_social": "Unión de Crédito Empresarial de Veracruz, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "-",
    "razon_social": "Unión de Crédito de Uruapan, S.A. de C.V",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Altamira",
    "razon_social": "Altamira Unión de Crédito, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Esphera",
    "razon_social": "Unión de Crédito Esphera, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credilasa",
    "razon_social": "Unión de Crédito de la Comarca Lagunera, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Provimex",
    "razon_social": "Unión de Crédito de la Provincia Mexicana, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UCAGSA",
    "razon_social": "Unión de Crédito Agropecuaria de Guanajuato, S.A. de C.V.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Uniones de crédito",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FEmprendedor",
    "razon_social": "Oportunidades para Emprendedores, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fincrecemos",
    "razon_social": "Grupo Consultor para la Microempresa, S.A. de C.V., SOFOM, ENR",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cashfin",
    "razon_social": "Cashfin Financial Services, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Daimler",
    "razon_social": "Daimler Financial Services, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "COFIDAN",
    "razon_social": "Corporación Financiera de América del Norte, S.A. de C.V., S.O.F.O.M, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cualli",
    "razon_social": "Financiera Cualli, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fisan",
    "razon_social": "Sandovalesco, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "De Lage Landen",
    "razon_social": "De Lage Landen, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fifac",
    "razon_social": "Fifac Grupo, S A de C V, SOFOM, ENR",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crediayuda",
    "razon_social": "Ayuda a las Finanzas Familiares, S.A. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tamogi",
    "razon_social": "Tamogi, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credix",
    "razon_social": "Credix GS, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fomenta Mx",
    "razon_social": "Fomenta Mx, S.A de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "QC SOLUCIONES",
    "razon_social": "QC Soluciones Financieras, S.A.P.I. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Crece",
    "razon_social": "Grupo de Desarrollo Crece, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PARATODO",
    "razon_social": "Paratodo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Conserva",
    "razon_social": "Consultores de Servicios Varios, S.A. de C.V. SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Viyees",
    "razon_social": "Financiera Viyees, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agrocapital",
    "razon_social": "Agrocapital del Noroeste, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Profile",
    "razon_social": "Promotora Profile, S.A.P.I. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fomenta GBM",
    "razon_social": "Fomenta GBM, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credifiel",
    "razon_social": "Publiseg, S.A.P.I. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MICROSSUR",
    "razon_social": "Microfinanzas y Servicios del Sureste, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ICM SOFOM",
    "razon_social": "Interactiva Capital México, S.A.P.I., de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Logra Fin",
    "razon_social": "Logra Financiamientos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MEX FACTOR",
    "razon_social": "Mex-Factor, S.A. de C.V. SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Findep",
    "razon_social": "Financiera Independencia, S.A.B. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crédito Único",
    "razon_social": "Crédito Único, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fisatel",
    "razon_social": "Fisatel México, S.A. de C.V., SOFOM., E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOLVIMÁS SOFOM",
    "razon_social": "Solvimás, S.A de C.V SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Arrenda+",
    "razon_social": "Arrendadora y Soluciones de Negocios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONSOL",
    "razon_social": "Consol Negocios, S.A. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINAGIL",
    "razon_social": "Finagil, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MCS CONTROLADORA",
    "razon_social": "MCS Controladora, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gestióndeact",
    "razon_social": "Gestión de Activos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KRP",
    "razon_social": "KRP Financial Business, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crea",
    "razon_social": "Microfinanciera Crece, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Adrenalina",
    "razon_social": "Aceleradora Adrenalina, S.A. de C.V., SOFOM ENR",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "C&B Pyme",
    "razon_social": "Carson & Brasch Pyme, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "C Capital Global, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "razon_social": "C Capital Global, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MASKAPITAL",
    "razon_social": "Kapitalmujer, S.A. de C.V. SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulsa",
    "razon_social": "Arrendamientos Operativos Impulsa, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Afipyme",
    "razon_social": "Afipyme, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caterpillar",
    "razon_social": "Caterpillar Crédito, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Premier",
    "razon_social": "Premier Estrategia, S.A. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crediavance",
    "razon_social": "Crediavance, S.A. de C.V., SOFOM, ENR",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CORPOFIN",
    "razon_social": "Corporación Financiera de Arrendamiento, S.A. de C.V. SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FACTOROPTIMO",
    "razon_social": "Factor Óptimo, S.A. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "J D F M",
    "razon_social": "John Deere Financial México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MEXFIN",
    "razon_social": "Mexicana de Fomento Innovador, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "The Outdoors Financial",
    "razon_social": "Grupo Agrifin, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SUPERA PRÉSTAMOS",
    "razon_social": "Supera Préstamos, S.A. de C.V., SOFOM ENR",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SFI SOFOM",
    "razon_social": "Soluciones Financieras Internacionales, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Avance",
    "razon_social": "Avance y Fortalecimiento Integral, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Efim",
    "razon_social": "Efim, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ACD",
    "razon_social": "Alternativas de Capital para el Desarrollo S.A.P.I. de C.V., SOFOM., E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nogaleros",
    "razon_social": "Nogaleros del Noroeste, S.A. de C.V. SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crédito Maestro",
    "razon_social": "Financiera Maestra, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NOVACREDIT",
    "razon_social": "Novacredit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TANEWI",
    "razon_social": "TANEWI, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vivaz",
    "razon_social": "Desarrollo Vivaz, S.A. de C.V. S.O.F.O.M., E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OPFINA",
    "razon_social": "Operadora Financiera de Mexico, SA de CV SOFOM ENR",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ProCredito",
    "razon_social": "Pro Confianza, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GZ CAPITAL",
    "razon_social": "GZ Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LI Financiera",
    "razon_social": "LI Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOFOM ANEC",
    "razon_social": "Servicios Financieros ANEC, S.A. de C .V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dimex Capital",
    "razon_social": "Dimex Capital, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulsarte",
    "razon_social": "Impulsarte para Crecer, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AFI Sofom",
    "razon_social": "Análisis, Filtro e Índices, S.A.P.I. de C.V. S.O.F.O.M. E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Ufimas",
    "razon_social": "Grupo Ufimas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IMPESA",
    "razon_social": "Impulsora Emergente, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ENFOR",
    "razon_social": "Entidad de Fomento Regional, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDICAM",
    "razon_social": "Credicam, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Rioses",
    "razon_social": "Rioses, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Integra",
    "razon_social": "Integra Arrenda S.A de C.V., SOFOM E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CIA",
    "razon_social": "Consultora Integral de Agronegocios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LBBW México",
    "razon_social": "LBBW México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SEJURE",
    "razon_social": "Sejurefid, S.A., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fimex",
    "razon_social": "Hipotecaria Fimex, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Pretmex",
    "razon_social": "Pretmex, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Fast",
    "razon_social": "Grupo Fast Servicios Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DCC",
    "razon_social": "Dispersora de Crédito Cuauhtémoc, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aprecia",
    "razon_social": "Fomepade, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "QFS Financiera",
    "razon_social": "Quality Financial Services, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Attendo",
    "razon_social": "Attendo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Exitus Credit",
    "razon_social": "Exitus Credit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agrofinanciera",
    "razon_social": "Agrofinanciera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finacen",
    "razon_social": "Finacen, S.A. de C.V. SOFOM, ENR",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Centerfin",
    "razon_social": "Centerfin, S.A. de C.V. S.O.F.O.M, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Afin Gana",
    "razon_social": "Afin Gana, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Premier",
    "razon_social": "Financiera Premier, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Convengamos",
    "razon_social": "Convengamos Todos, S.A. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Accedde",
    "razon_social": "Accedde, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PBF",
    "razon_social": "Patrimonio y Beneficio Familiar, S.A. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "addenda",
    "razon_social": "KRTC, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cargill",
    "razon_social": "Cargill Servicios Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GKF",
    "razon_social": "Grupo KF, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FinLaguna",
    "razon_social": "Seven Financial, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SME",
    "razon_social": "Soluciones Múltiples Empresariales, S.A. de C.V. S.O.F.O.M., E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sidegan",
    "razon_social": "Sistema de Desarrollo Ganadero UGRS S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Apoyo Cotidiano",
    "razon_social": "Apoyo Cotidiano, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cofine",
    "razon_social": "Cofine, S.A.P.I. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulsora Hogar",
    "razon_social": "Impulsora Consorcio Hogar S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "COPEFINSA",
    "razon_social": "Corporación de Operaciones Finas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aproser",
    "razon_social": "Asistencia Productiva para el Sector Rural, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Marjo",
    "razon_social": "Financiera Marjo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "G.F.",
    "razon_social": "Grupo Finanziamiento, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Proaktiva",
    "razon_social": "Proaktiva, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LEPEZO",
    "razon_social": "Fomento Empresarial Lepezo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "tlr",
    "razon_social": "Tu Lanita Rápida, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prosperemos",
    "razon_social": "Grupo Prosperemos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fintegra",
    "razon_social": "Fintegra Financiamiento S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CNH Capital",
    "razon_social": "CNH Servicios Comerciales, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Otorgapluss",
    "razon_social": "Otorgapluss Opciones Patrimoniales S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Apo.atu.Eco.",
    "razon_social": "Apoyo a Tu Economía, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lar Home",
    "razon_social": "Lar Home, S.A. de C.V. SOFOM ENR",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LC Liquidez",
    "razon_social": "LC Liquidez Corporativa S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "R. Pardo",
    "razon_social": "R. Pardo y Asociados, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agro Firme",
    "razon_social": "Agro Firme, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sisfin",
    "razon_social": "Grupo Sisfin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Plenus",
    "razon_social": "Plenus Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "COIN",
    "razon_social": "Capitales del Sureste, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Banx",
    "razon_social": "Jinx, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Relámpago",
    "razon_social": "Red de Servicios Financieros, S.A. de C.V., SOFOM E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prestiquick",
    "razon_social": "Prestiquick, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agro Sofom",
    "razon_social": "Agro Sofom, S.A.P.I. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credicampo",
    "razon_social": "Impulsora de Crédito Rural, S.A. de C.V. SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Codhesa",
    "razon_social": "Corporativo de Desarrollo Humano y Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finanserca",
    "razon_social": "Finanserca, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Backtrend",
    "razon_social": "Junomx Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONSEDE",
    "razon_social": "Consede, Consultores y Servicios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credenz",
    "razon_social": "Fimubac, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Zurita",
    "razon_social": "Zurita Consultores Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "WLB México",
    "razon_social": "WLB México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Para Crecer",
    "razon_social": "Agrofinanciera Internacional, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRAMEEN DE LA FRONTERA",
    "razon_social": "Grameen de la Frontera Sonora, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Comfinemp",
    "razon_social": "Compañía Financiera Empresarial, S.A. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FinLabor",
    "razon_social": "Financiera Labor, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Santa Fe",
    "razon_social": "Soluciones Económicas Santa Fe, S.A. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vextor",
    "razon_social": "Vextor Activo, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Interbank",
    "razon_social": "Interdns, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONTANGO",
    "razon_social": "Contango, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cinco Dos",
    "razon_social": "Cinco Dos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credicrece",
    "razon_social": "Credicrece, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Hir Casa Crédito",
    "razon_social": "Hir Soluciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kettera",
    "razon_social": "Grupo Kettera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "iLeasing",
    "razon_social": "International Leasing Support, S.A.P.I. de C.V. SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agrolagos",
    "razon_social": "Agrolagos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sacsa",
    "razon_social": "Sacsa Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SIDERT",
    "razon_social": "Servicios Integrales para el Desarrollo Rural del Trópico, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Emprende",
    "razon_social": "Empresarios por el Derecho a la Actividad Económica, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Garanfimex",
    "razon_social": "Garantía Fiduciaria Mexicana, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cap Fin",
    "razon_social": "Cap Fin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EXITUS CAPITAL",
    "razon_social": "Exitus Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Executory",
    "razon_social": "Executory, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finsur",
    "razon_social": "Financiera Insurgentes, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Río Grande",
    "razon_social": "Río Grande Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cocdep",
    "razon_social": "Consultoría y Capacitación para el Desarrollo Productivo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sofipaz",
    "razon_social": "Sofipaz, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Findeca",
    "razon_social": "Findeca, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SEFIPADE",
    "razon_social": "Servicios Financieros para el Desarrollo SEFIPADE, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "mi solucion",
    "razon_social": "Mi Solución Productiva, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mipymex",
    "razon_social": "Mipymex, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOFIPA",
    "razon_social": "Sofipa Corporation, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "F1NPULSA",
    "razon_social": "Finadix, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDIJAL",
    "razon_social": "Credijal, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finactiv",
    "razon_social": "Finactiv, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ADAMANTINE",
    "razon_social": "Proyectos Adamantine, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SACIMEX",
    "razon_social": "Opciones Sacimex, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fincrece",
    "razon_social": "Fincrece, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Jova Capital",
    "razon_social": "Jova Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FLOCAL",
    "razon_social": "Financiera Local, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capital Agrí",
    "razon_social": "Capital Agrícola, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PaKda",
    "razon_social": "Pacada, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crédito para tí",
    "razon_social": "Crédito para ti, S.A. de C.V. S.O.F.O.M. E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Pacto",
    "razon_social": "Corporación Pacto, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Estímulo C.",
    "razon_social": "Estímulo Corporativo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Antali",
    "razon_social": "Antali Corporation, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINPO",
    "razon_social": "Finpo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VIVALIA",
    "razon_social": "Vivalia, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credinorte",
    "razon_social": "Finanzas del Norte, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inmediprest",
    "razon_social": "Faprei, S.A.P.I. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "REFACIL",
    "razon_social": "Refácil Servicios Integrales, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cefemex CAPITAL",
    "razon_social": "Financiera Cefemex S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Regiofinanciera",
    "razon_social": "Regiofinanciera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agrodansa",
    "razon_social": "Agrodansa Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agrofinsa",
    "razon_social": "Agrofinanciera el Valle, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Alfil",
    "razon_social": "Financiera Alfil, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Innovacredit",
    "razon_social": "Innodi, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Amigo",
    "razon_social": "Financiera Amigo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finvay",
    "razon_social": "Finvay, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GDM3 Capital",
    "razon_social": "GDM3 Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CL CAPITAL",
    "razon_social": "Crédito y Logistica de Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Positiva",
    "razon_social": "Positiva Soluciones Crediticias, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cresca",
    "razon_social": "Crédito Especializado al Campo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Opción Cicom",
    "razon_social": "Opción Cicom, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIPABIDE",
    "razon_social": "Financiamiento para Bienestar y Desarrollo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FLASA",
    "razon_social": "Financiera los Álamos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AES",
    "razon_social": "Apoyo a la Educación Superior, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CrediConfia",
    "razon_social": "Desarrolladora e Impulsora de Negocios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lafin",
    "razon_social": "Micros Lafín, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Protufu",
    "razon_social": "Promoviendo Tu Futuro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fin K2",
    "razon_social": "Fin K2, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NyP",
    "razon_social": "Negocios y Proyectos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mizrafin",
    "razon_social": "Mizrafin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tótem",
    "razon_social": "Tótem Prestamos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SEFIA SOFOM",
    "razon_social": "Servicios y Financiamiento Agrícola, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "unicredix",
    "razon_social": "Universal de Servicios Patrimoniales, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inserex",
    "razon_social": "Inserex, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SERFIMEX",
    "razon_social": "Serfimex Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Percapita",
    "razon_social": "Probenso Group, S.A., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alsol",
    "razon_social": "Alsol Contigo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Orthos",
    "razon_social": "Orthos Financial Solutions, S.A. de C.V.,SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Afix",
    "razon_social": "Afix Servicios Financieros, S.A.P.I. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TREO FINANCIERO",
    "razon_social": "Treo Financiero, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dxn Express",
    "razon_social": "DXN Express, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Río Yaqui",
    "razon_social": "Promotora Río Yaqui, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Facicasa",
    "razon_social": "FACICASA S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SofomTepeyac",
    "razon_social": "Sociedad de Fomento Local Tepeyac, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Op Efectiva",
    "razon_social": "Financiera Opción Efectiva S.A.P.I de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINEF",
    "razon_social": "Financiamiento Efectivo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crediamigo",
    "razon_social": "Prestaciones Finmart, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PAS",
    "razon_social": "Soluciones Administrativas para el Desarrollo Económico y Social, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UNICREDIT",
    "razon_social": "Unicredit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UNIFICC",
    "razon_social": "Unificcom ,S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crea más",
    "razon_social": "Hipotecaria Crea Más, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PASF",
    "razon_social": "Préstamo Amigo Servicios Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alivio Cap",
    "razon_social": "Alivio Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agro Mon",
    "razon_social": "Agro Mon, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "presta simple",
    "razon_social": "Presta Simple, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FGKA",
    "razon_social": "Servicios FGKA, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sinaloa Positivo",
    "razon_social": "Sinaloa Positivo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EF Diez",
    "razon_social": "E Factor Diez, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soficam",
    "razon_social": "Sociedad Financiera Campesina, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BMW FS",
    "razon_social": "BMW Financial Services de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agrocap",
    "razon_social": "Agrocap del Norte, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HFinancieros",
    "razon_social": "H Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finsanlla",
    "razon_social": "Finsanlla, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Porohui",
    "razon_social": "Porohui Geld, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credifácil",
    "razon_social": "Credifácil, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Creavanza",
    "razon_social": "Grupo Asesor Creavanza, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Engen Capital",
    "razon_social": "Engencap Fin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finagra",
    "razon_social": "Financiera Agropecuaria del Sureste, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINDECH",
    "razon_social": "Financiando el Desarrollo de Chiapas Findech, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GF Arco",
    "razon_social": "G.F. Arco, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INCREC",
    "razon_social": "Integración de Crecimiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fasecapital",
    "razon_social": "Fasec Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Usacredit",
    "razon_social": "Usacredit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Creditline",
    "razon_social": "Créditos y Servicios Financieros Creditline, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Liquick",
    "razon_social": "Servicios Liquick, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crece México",
    "razon_social": "Crece Más México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Liquidex",
    "razon_social": "Liquidex, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gain S",
    "razon_social": "Grupo Acceso Inmobiliario S, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Valorex",
    "razon_social": "Valorex, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ABBE",
    "razon_social": "Préstamo en un 2x3, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Rentamigo",
    "razon_social": "Rentamigo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Micro Credit",
    "razon_social": "Micro Credit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GFSK",
    "razon_social": "Global Financial Solution GFSK, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fomentamos",
    "razon_social": "Impulsora Popular de Guanajuato, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agroexpress",
    "razon_social": "Agroimpulso Express, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "COINSA",
    "razon_social": "Crédito Operativo Integral, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Avanza México",
    "razon_social": "Contigo Avanza México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UnifinCredit",
    "razon_social": "Unifin Credit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Roshfin",
    "razon_social": "Roshfin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Laudex",
    "razon_social": "Corporativo Laudex, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prologis Mx",
    "razon_social": "Prologis México Finco, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "New Life",
    "razon_social": "New Life & Zone, México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alternativa Financiera",
    "razon_social": "Alternativa Financiera Prosesa, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "C Consentida",
    "razon_social": "Casas Consentidas Javer, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VFC Financial",
    "razon_social": "VFC Financial Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Braxel",
    "razon_social": "Financiera Braxel, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alpez Servicios Financieros",
    "razon_social": "Alpez, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tonalli",
    "razon_social": "Tonalli Préstamos, S.A. de .C.V, SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crego",
    "razon_social": "Crego, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "R.H. Avant",
    "razon_social": "Soluciones en R.H. Avant, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Asefimex",
    "razon_social": "Asesoría Financiera de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Fortaleza",
    "razon_social": "Financiera Fortaleza, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Lunma",
    "razon_social": "Grupo Lunma, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prorsum",
    "razon_social": "Prorsum, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SAN EXPEDITO",
    "razon_social": "Casa San Expedito, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Acrese",
    "razon_social": "Acrese, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINAGRIC",
    "razon_social": "Financiera Agrícola Camargo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Elite Sofom",
    "razon_social": "Digal Elite, S.A.P.I. de C.V., SOFOM , E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONFIA",
    "razon_social": "Confía Negocios Empresariales del Sureste, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROSIBA",
    "razon_social": "Procesos Sistemáticos del Bajío, S.A., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Easy Acceptance",
    "razon_social": "Easy Acceptance, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Operadora Prespen",
    "razon_social": "Operadora Prespen, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Trust",
    "razon_social": "Administradora de Inmuebles Samir, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prexp",
    "razon_social": "Préstamos Expeditos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nextfin",
    "razon_social": "Nextfin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Infra Capital Patrimonial",
    "razon_social": "Infra Capital Patrimonial, S.A. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dinerocrecer",
    "razon_social": "Dinero para Crecer, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Amicorp",
    "razon_social": "Amicorp México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AFA",
    "razon_social": "Alianza Familiar, S.A.P.I. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UNIMOSSIMPULSA",
    "razon_social": "Unimoss Impulsa, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BBP Capital",
    "razon_social": "BBP Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Admiral Capital",
    "razon_social": "Admiral Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AMVIS, S.A. de C.V., SOFOM, ENR",
    "razon_social": "AMVIS, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDICAOR",
    "razon_social": "Credicaor, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Doña Juanita",
    "razon_social": "Doña Juanita Finanzas Populares, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capital Empresarial Sofom",
    "razon_social": "Esquemas Soluciones Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Evoluciona F",
    "razon_social": "VI Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINAMO",
    "razon_social": "Administradora de Soluciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Graneros",
    "razon_social": "Graneros del Norte Río Bravo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VFS",
    "razon_social": "VFS México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fomenpalma",
    "razon_social": "Fomenpalma, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Global GLC",
    "razon_social": "Global Lending Corporation GLC, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credifom",
    "razon_social": "Credifom, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sierra Nevad",
    "razon_social": "Administradora Sierra Nevada, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Findesol K",
    "razon_social": "Findesol Kapital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Amehuan",
    "razon_social": "Amehuan, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ArezFin",
    "razon_social": "Arez Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Avanpiña",
    "razon_social": "Avanpiña, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ayopsa",
    "razon_social": "Ayuda Oportuna, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Intermercado",
    "razon_social": "GB Plus, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AEF",
    "razon_social": "Apoyo Económico Familiar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credit Mas",
    "razon_social": "Expansión Económica, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cei Cor",
    "razon_social": "Cei Cor Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Solfin",
    "razon_social": "Soluciones Creativas Fin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Solufex",
    "razon_social": "Solufex, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "gueld",
    "razon_social": "Gueld Internacional, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FSY",
    "razon_social": "Financiera San Ysidro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Acervo Ec",
    "razon_social": "Acervo Económico, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ENR",
    "razon_social": "Microfinanciera Cruse, S.A. de .C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Abonitos",
    "razon_social": "Grupo Anisal, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Balor Dispersora",
    "razon_social": "Balor Dispersora, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lana +",
    "razon_social": "Lana +, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BDI",
    "razon_social": "BDI Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Benefintbsa",
    "razon_social": "Beneficios Integrales BSA, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capa",
    "razon_social": "Calidad Patrimonial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CFL Sofom",
    "razon_social": "Centro Financiero Lagunero, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credicia",
    "razon_social": "Credicia, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Consufin",
    "razon_social": "Consufin Servicios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Creafi",
    "razon_social": "Creafi, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CCE Sofom",
    "razon_social": "Crecimiento en Conjunto para Empresas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credi Trune",
    "razon_social": "Credi Trune, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "COP.SOFOM.ENR",
    "razon_social": "Crédito Oportuno, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crédito Útil",
    "razon_social": "Crédito Útil, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dextra",
    "razon_social": "Dextra de Occidente, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Servicios Financieros Hogar",
    "razon_social": "Servicios Financieros Hogar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINLAG",
    "razon_social": "Finlag, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Accifin",
    "razon_social": "Accifin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Siempre Efec",
    "razon_social": "Siempre Efectivo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FortaCrédito",
    "razon_social": "Fortaleza Económica, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ficomsa",
    "razon_social": "Financiera Comercial Sabinas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Firmeza Financiera",
    "razon_social": "Firmeza Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mohinora",
    "razon_social": "Financiera Mohinora, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Paquime",
    "razon_social": "Financiera Paquime, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fincre Servicios",
    "razon_social": "Fincre Servicios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Hermes SOFOM",
    "razon_social": "Fomento de Negocios Hermes, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GASBEL",
    "razon_social": "Gasbel Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GFI Apoyo",
    "razon_social": "GFI Apoyo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SUPPLY",
    "razon_social": "Supply Credit de México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "H.H.",
    "razon_social": "Hipotecaria Hogar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IDYFM",
    "razon_social": "Impulso Desarrollo y Fomento de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inclusión Hipotecaria",
    "razon_social": "Inclusión Hipotecaria, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AlphaCredit",
    "razon_social": "AlphaCredit Capital,S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CLICK",
    "razon_social": "Click Seguridad Jurídica, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Podemos",
    "razon_social": "Podemos Progresar, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Accender",
    "razon_social": "Accender Liquidez, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aktiva Finan",
    "razon_social": "Aktiva Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "REGIODOMINIO",
    "razon_social": "Regiodominio Financiero, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nuestro Apoyo",
    "razon_social": "Negocios Empresariales de Apoyo de Oaxaca, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Op. Némesis",
    "razon_social": "Operadora Némesis, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MasxMenos",
    "razon_social": "Operadora de Empeños y Préstamos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FACIKREDES",
    "razon_social": "OPT Sistemas Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finconmigo",
    "razon_social": "Servicios Financieros Contigo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capital Saludable",
    "razon_social": "PrestoMyC, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aprogre",
    "razon_social": "Apoyo Agropecuario de Guanajuato, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fidedigna",
    "razon_social": "Promoción al Fortalecimiento Económico, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TNEC",
    "razon_social": "Tu Negocio Emprendedor Crece, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prosuma",
    "razon_social": "Prosuma Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Refácil",
    "razon_social": "Refácil, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Rosob y Asociados",
    "razon_social": "Rosob y Asociados, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IN C&L®",
    "razon_social": "Su Servicio Financiero, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tesorera del Norte, S.A. de C.V., SOFOM, E.N.R.",
    "razon_social": "Tesorera del Norte, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capital El Molino",
    "razon_social": "Capital el Molino, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Si Agro",
    "razon_social": "Si Agro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sofir Regiomontana",
    "razon_social": "Sofir Regiomontana, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soluciones",
    "razon_social": "Soluciones para Proyectos Productivos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finkpital",
    "razon_social": "Tierra Productiva del Norte, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fidegarante",
    "razon_social": "Fidegarante, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Zendere",
    "razon_social": "Zéndere Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fisanran",
    "razon_social": "Fisanran, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Frame",
    "razon_social": "Apoyo Frame, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ASF Nómina",
    "razon_social": "ASF Servicios Financieros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MASPF",
    "razon_social": "Compañía Financiera Maspf, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Te damos lana",
    "razon_social": "Consultora Especializada Vanirc, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOFOM PIKACHO",
    "razon_social": "Financiera el Pikacho, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fincentiva",
    "razon_social": "Financiera Incentiva, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Operadora NT",
    "razon_social": "Operadora NT, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Recuperación",
    "razon_social": "Recuperación Total, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Providencia",
    "razon_social": "Servicios Monetarios Providencia, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SEFINOM",
    "razon_social": "Sefinom, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AT One",
    "razon_social": "AT One, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FAST FS",
    "razon_social": "Fast FS, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PLATINO",
    "razon_social": "Platino, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Navo Agro Gasa",
    "razon_social": "Navo Agro Gasa, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gestiona Capital",
    "razon_social": "Gestiona Capital Soluciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Trínitas",
    "razon_social": "Financiera Trínitas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cabott Capital",
    "razon_social": "Cabott Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DPatrimonial",
    "razon_social": "Dalton Patrimonial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gemini",
    "razon_social": "Gemini Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Innovateur",
    "razon_social": "Innovateur, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "milal",
    "razon_social": "Milal Servicios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inventa Finance",
    "razon_social": "Grupo Pideco, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Bananera",
    "razon_social": "Financiera Bananera Pacífico Centro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AvanteFuture",
    "razon_social": "García Cruz Servicios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Estratégia y Soluciones, Sofom",
    "razon_social": "G 308 Estrategia y Soluciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GARROM",
    "razon_social": "Grupo Promotor Garrom, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vimifos",
    "razon_social": "Corporativo Vimifos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finvivir",
    "razon_social": "Finvivir, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vértice",
    "razon_social": "Vértice Soluciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fondera",
    "razon_social": "Fondera, S.A. de C.V, SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MAK 3",
    "razon_social": "Mak 3 Celular, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PCH",
    "razon_social": "PCH Servicios Financieros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EliteFin",
    "razon_social": "Elite Financiera Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Helios",
    "razon_social": "Financiera Helios, S.A.P.I. de C.V. SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sufirma",
    "razon_social": "Sufirma, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Acércate",
    "razon_social": "Financiera Acercate, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOFIM",
    "razon_social": "Sociedad Financiera Merkavan, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SEFIISTMO",
    "razon_social": "Sefiistmo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Rayaexpress",
    "razon_social": "Frosch, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Xpress",
    "razon_social": "Grupo Empresarial y Proyectos Arvido, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "San Borja",
    "razon_social": "Soluciones y Crédito San Borja, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Emprendamos",
    "razon_social": "Emprendamos Fin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cofeti",
    "razon_social": "Administradora Avanza, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ERBE",
    "razon_social": "ERBE Protección de tu Patrimonio, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Acsein",
    "razon_social": "Acsein, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Préstamo Feliz",
    "razon_social": "Préstamos Felices en 15 Minutos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "El Cochinito de México",
    "razon_social": "El Cochinito de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DEPROFAM",
    "razon_social": "Desarrollo y Progreso Familiar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOFIMAS",
    "razon_social": "Sofimas Consultores del Noroeste, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SWELL",
    "razon_social": "Swell Finanzas en Movimiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FLUX",
    "razon_social": "Flux Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kcm Alliance",
    "razon_social": "Kcm Alliance Group, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Atrevus",
    "razon_social": "JMMETEPEC S.A. de C.V. SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fomul",
    "razon_social": "Fomento Multiempresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Génesis",
    "razon_social": "Génesis, Servicios para el Desarrollo de la Microempresa, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ever Think",
    "razon_social": "Impulsora de Negocios Ever Think, S.A.P.I. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tu Dinero",
    "razon_social": "Tu Dinero, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agapo",
    "razon_social": "Agropecuario Apoyo de Occidente, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DD3 Hipotecaria",
    "razon_social": "DD3 Hipotecaria, S.A de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Omnifinanciera",
    "razon_social": "Omnifinanciera, S.A de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINFERSA",
    "razon_social": "Finfersa, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "J&C XTRAFIN",
    "razon_social": "J&C Xtrafin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Emprendiendo Juntos El Camino",
    "razon_social": "Smart F Services, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Sendai",
    "razon_social": "Financiera Sendai, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nuvol",
    "razon_social": "Nuvol Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alternativa",
    "razon_social": "Alternativa Financiera para el Desarrollo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRUPOMERCHI",
    "razon_social": "Grupo Mercantil de Chihuahua, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDINSPIRA",
    "razon_social": "Dinero Fácil y Rápido, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prestaciones Aya",
    "razon_social": "Consorcio Contigo Aya de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CFC",
    "razon_social": "Consultoría y Financiamiento para el Crecimiento Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CapitalTech",
    "razon_social": "Capitaltech Financial, S.A.P.I de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Futuro ABC",
    "razon_social": "Futuro ABC, S.A.P.I. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Translift",
    "razon_social": "Grupo Translift, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VanguardiaFJ",
    "razon_social": "Vanguardia FJ, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Padio",
    "razon_social": "Mae del Golfo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agrumnostro",
    "razon_social": "Agrumnostro de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ATP",
    "razon_social": "Asistencia para el Trabajo y la Producción, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AvanzaSólido",
    "razon_social": "Avanza Sólido, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ghil Bajío",
    "razon_social": "Ghil Bajío, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "COPROFIN",
    "razon_social": "Comercializadora de Productos Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Clave",
    "razon_social": "Comercio Clave de Crecimiento Mundial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREE-C",
    "razon_social": "Concreec, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Corporativo",
    "razon_social": "Corporativo de Fomento FJ, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDINOM",
    "razon_social": "Credinom JR&JM, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "D-Menonita",
    "razon_social": "Dispersora Menonita, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EXKA",
    "razon_social": "Expansión Kapital del Sur, S.A.P.I de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ficade",
    "razon_social": "Ficade, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Convive Tu Financiera",
    "razon_social": "Convive Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREE-C",
    "razon_social": "Focreec, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fortalece SF",
    "razon_social": "Fortalece Servicios Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GLN Gestión",
    "razon_social": "GLN Gestión y Logística del Norte, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vifin",
    "razon_social": "Grupo Mexlazza, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Otz.",
    "razon_social": "Grupo Otz, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDIPLUS",
    "razon_social": "Impulsora MTP, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IBS",
    "razon_social": "Intercambios Baja Sur, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kabaros",
    "razon_social": "Kabaros Finanzas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LUMO FINAN",
    "razon_social": "Lumo Financiera del Centro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Luxom",
    "razon_social": "Luxom Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Monto Fácil",
    "razon_social": "Monto Fácil, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Pacto",
    "razon_social": "Servicios Pacto, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PEV",
    "razon_social": "Préstamos Especializados del Valle, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Punto economico",
    "razon_social": "Punto Económico, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Reach Home",
    "razon_social": "Reach Home, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Rilsa",
    "razon_social": "Respuesta Integral de Liquidez, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finbaja",
    "razon_social": "Servicios Financieros de la Baja California, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulsa",
    "razon_social": "Sipernipe, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOLUGOB",
    "razon_social": "Solugob, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tactical",
    "razon_social": "Tactical Leasing México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vamos a Mejorar",
    "razon_social": "Vamos a Mejorar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crédito Fácil",
    "razon_social": "HINV, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Se Dueño",
    "razon_social": "Se Dueño, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cristafin",
    "razon_social": "Cristaliza Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dinerito",
    "razon_social": "Dinerito Audaz, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Save",
    "razon_social": "Save Préstamos Personales, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ATUPSA",
    "razon_social": "Apoyando tu progreso, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alborada",
    "razon_social": "Huautla en la Alborada, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EDR Silver",
    "razon_social": "EDR Silver de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fondeo Horizonte",
    "razon_social": "Fondeo Horizonte, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SEL Efectivo",
    "razon_social": "Soluciones Efectivas de Liquidez, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kolibrí",
    "razon_social": "Kolibrí Verde, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finyteca",
    "razon_social": "Finyteca, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BC Credit",
    "razon_social": "BC CREDIT, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINMAQ",
    "razon_social": "Mañarina, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RDA Capital",
    "razon_social": "RDA Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Multisoluciones",
    "razon_social": "GM Multisoluciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Hoy por ti",
    "razon_social": "HXTI, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRECE",
    "razon_social": "Crece y Alcanza Más, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Altitud",
    "razon_social": "Fomento Altitud, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Hall & Money",
    "razon_social": "Hall & Money, S.A. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Disi Crédito",
    "razon_social": "Disi Operaciones Empresariales, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINPA",
    "razon_social": "Financiera Pequeña Australia, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Goldberg",
    "razon_social": "Goldberg-Zogovic, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mex Capital",
    "razon_social": "Mex Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VEMO IMPULSO",
    "razon_social": "Financiera por el Impulso Económico, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vercapital",
    "razon_social": "Grupo Veracruzano Desarrollo de Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AgroLaguna",
    "razon_social": "Agrofinanciera la Laguna, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RP SOFOM",
    "razon_social": "Requerimiento Patrimonial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VFMéxico",
    "razon_social": "Vision F México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fin Alta",
    "razon_social": "Fin Alta Vista, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dinercap Nomina",
    "razon_social": "Grupo Kelq, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DAE",
    "razon_social": "DAE Hipotecaria, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "COVI",
    "razon_social": "Corporativo Vida, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MYO",
    "razon_social": "Operadora Broxel, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fin Kronos",
    "razon_social": "Financiera Kronos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Britagu",
    "razon_social": "Britagu Group, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DANI",
    "razon_social": "Distribuidora de Apoyo Nacional e Integral, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Arsesa",
    "razon_social": "Financiera Arsesa, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ONIX FINANCIERA",
    "razon_social": "Lusitano FG, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Marfil",
    "razon_social": "Marfil Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Metafinanciera México",
    "razon_social": "Metafinanciera México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Misef SOFOM",
    "razon_social": "Microsoluciones Efectivas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Pre15na",
    "razon_social": "Pre15Na, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sec Primario",
    "razon_social": "Sociedad de Apoyo para Sectores Primarios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Transsupport",
    "razon_social": "Transsupport, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finvale",
    "razon_social": "Finvale, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PromoCar",
    "razon_social": "Avanti PPA, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Samex",
    "razon_social": "Power Mix de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Figan Ugrch",
    "razon_social": "Figan Ugrch, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FSS",
    "razon_social": "Financiera Sans Souci, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LanAhora",
    "razon_social": "Soluregio, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Edupass",
    "razon_social": "Educapass S.A. de C.V. SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finagro",
    "razon_social": "Financiera Agropecuaria de Coahuila, S.A. DE C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Invesur",
    "razon_social": "Invesur, S.A.P.I de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FinOnce",
    "razon_social": "Financiera Empresarial Once, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "A tu alcance",
    "razon_social": "Negocios a tu alcance, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FAMF",
    "razon_social": "Fortaleza a mi Futuro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MER",
    "razon_social": "Microcrédito para la Emprendedora Rural, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRCapital",
    "razon_social": "Palace Resorts Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Consumer",
    "razon_social": "Consumer & Business Loan, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tolfin",
    "razon_social": "Tolfin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agro LAAD",
    "razon_social": "Agronegocios LAAD, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Calfer",
    "razon_social": "Caferal, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cre-Ser",
    "razon_social": "Crédito Productivo Cre-Ser, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TBY",
    "razon_social": "Soluciones Integrales TBY, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DNO Plus",
    "razon_social": "DNO Plus, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Élitra Financiera",
    "razon_social": "Operadora MFM, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINMAR",
    "razon_social": "Financiera Mariana, S.A. de C. V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NOMI FIN",
    "razon_social": "Corporación Nomi Fin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Indeprom",
    "razon_social": "Indeprom, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cargill SE",
    "razon_social": "Cargill Soluciones Empresariales, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Asfa Atlas",
    "razon_social": "Agroservicios Financieros Atlas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SMC",
    "razon_social": "SMC Soluciones de Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Apoyo Facil",
    "razon_social": "Apoyo y Liquidez, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Profimex",
    "razon_social": "Prestaciones Plus, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "H M Reit",
    "razon_social": "H+M Reit, S.A.P.I de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sefim",
    "razon_social": "Sefim, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Creditpro",
    "razon_social": "Creditpro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credilikeme",
    "razon_social": "Confianza Digital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Previcrem",
    "razon_social": "Previcrem, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Solvantia",
    "razon_social": "Solvantia, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Just Wealth",
    "razon_social": "Just Wealth, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IPC",
    "razon_social": "IPC Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Factor GFC",
    "razon_social": "Factor GFC Global, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AMIFIN",
    "razon_social": "SGS Soluciones a tu Medida, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gpo Cassanra",
    "razon_social": "Despacho Cassanra de la Costa, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Pidamás",
    "razon_social": "Pidamás, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Criafe",
    "razon_social": "Criafe, S.A. de C.V., SOFOM,E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CreaNegocios",
    "razon_social": "Alternativa en Negocios de Oportunidad, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kae",
    "razon_social": "Kae Patrimonio, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Compromiso",
    "razon_social": "Compromiso que Suma Valor, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Hir Pyme",
    "razon_social": "Hir Pyme, S.A de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vimifos",
    "razon_social": "Corporativo Financiero Vimifos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finantra",
    "razon_social": "Finantra, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Reale Sol",
    "razon_social": "Reale Soluciones de Emprendedores, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GB Agrostar",
    "razon_social": "GB Agrostar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Blú Capital",
    "razon_social": "Agronegocios de Chihuahua, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kueski",
    "razon_social": "Kueski, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inspira",
    "razon_social": "Inspira Comunidad, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Benefitt",
    "razon_social": "Grupo Corporativo Benefitt México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DTMEX",
    "razon_social": "Directodo México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Facilita",
    "razon_social": "Facilita Recursos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Pensionacred",
    "razon_social": "Pensionacredit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Patrimonio",
    "razon_social": "Patrimonio, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Edyen",
    "razon_social": "Edyen Capital, S.A.de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sinfin",
    "razon_social": "Sinergia Financiera de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRESTOMATIC",
    "razon_social": "Prestomatic, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fondo ACH",
    "razon_social": "Adelanto Express, S.A. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Instacred",
    "razon_social": "Instacred, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agrofinancie",
    "razon_social": "Agropecuaria Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Creconfi",
    "razon_social": "Crédito y Consultoría Financiera y Patrimonial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FactorExprés",
    "razon_social": "Factor Exprés, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sofiat",
    "razon_social": "Soluciones Financieras Agropecuarias de Tlaxcala, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agrofinamex",
    "razon_social": "Agrofinanciera de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Indentro",
    "razon_social": "Círculo Inteligente, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aprocch",
    "razon_social": "Asociación de Productores del Corredor de Chihuahua, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Hacercapital",
    "razon_social": "Hacercapital Corporation, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capital Enérgico",
    "razon_social": "Capital Enérgico de México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "C Primero",
    "razon_social": "Grupo C Primero, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mendel",
    "razon_social": "Financiera CR Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alra del Sur",
    "razon_social": "Alra del Sur Asesoría Hipotecaria, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Contigo",
    "razon_social": "Cege Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Movi Plus",
    "razon_social": "Movimientos Plus, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finprode",
    "razon_social": "Financiamiento Productivo Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Eficiencia",
    "razon_social": "Alta Eficiencia MG, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agrofin",
    "razon_social": "Agrofinanciera del Noroeste, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Thirone",
    "razon_social": "Thirone Financial Services, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PayJoy",
    "razon_social": "Cashahora, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ferco",
    "razon_social": "Soluciones Globales Ferco, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Pref Capital",
    "razon_social": "Preference Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Toreco",
    "razon_social": "Toreco, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Apoyo Multi",
    "razon_social": "Apoyo Multi J.L, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prof Banderi",
    "razon_social": "Profesionales de Banderilla, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Procea",
    "razon_social": "Operadora Procea del Centro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "R Capitalis",
    "razon_social": "R Capitalis Group, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Konfío",
    "razon_social": "Red Amigo Dal, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soly. Op. 13",
    "razon_social": "Soluciones y Oportunidades Financieras, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Confia",
    "razon_social": "Confia Mag, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sumaexpress",
    "razon_social": "Sumaexpress, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cruz del Sol",
    "razon_social": "Cruz del Valle Real del Sol de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crediplata",
    "razon_social": "Crediplata, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Promotex",
    "razon_social": "Grupo Promotex, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finamax",
    "razon_social": "Finamax, S.A de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Advalorum",
    "razon_social": "Desarrollo Empresarial AIN, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Sihusel",
    "razon_social": "Financiera Sihusel, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Propela",
    "razon_social": "Propela Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fin Kapital",
    "razon_social": "Finanzierung Kapital, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Habitus",
    "razon_social": "Habitus Social, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sefi Financiera",
    "razon_social": "Sefi Estratégicos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDICER",
    "razon_social": "Crecer Solución Inmediata, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINOX",
    "razon_social": "Corporación Financiera de Occidente, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sofial",
    "razon_social": "Sociedad Financiera Alpura, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inspira Negocios",
    "razon_social": "Inspira Negocios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Arrojo Empre",
    "razon_social": "Arrojo Empresarial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FRT",
    "razon_social": "Rancho Tetenco, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Redpoll",
    "razon_social": "Redpoll Trading, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Q Billete",
    "razon_social": "Quiero Billete, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ragalo",
    "razon_social": "Intermediaria Ragalo de Monclova, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "El de Fiar",
    "razon_social": "El de Fiar SDLTS, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RMS FINANCIAL",
    "razon_social": "RMS Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sade",
    "razon_social": "Servicios Auxiliares del Desarrollo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TC Laref",
    "razon_social": "TC Laref, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fideem",
    "razon_social": "Fideem Financiando el Desarrollo Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Para Bien",
    "razon_social": "Bien para Bien, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lavoro",
    "razon_social": "Lavoro Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DAKAB CAPITAL",
    "razon_social": "Ysagel, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Intelligent",
    "razon_social": "Corporativo de Negocios Intelligent, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Rapicreer",
    "razon_social": "Rápido Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mr. Presta",
    "razon_social": "Mr. Presta, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Pixel",
    "razon_social": "Pixel Conexiones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agrosol VR",
    "razon_social": "Agrosoluciones VR, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Incentiva",
    "razon_social": "OMT Financial México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Préstamos Yes",
    "razon_social": "Grupo Empresarial Aran, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JP Fortuna",
    "razon_social": "JP Buena Fortuna, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tenmas",
    "razon_social": "Tenmas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Servicios Administrativos Autlán",
    "razon_social": "Servicios Administrativos Autlán, S.A. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FactorTaalku",
    "razon_social": "Crédito Taalku, S.A.P.I de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CATCK P",
    "razon_social": "CATCK P, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aspiria",
    "razon_social": "Advantech Servicios Financieros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Recapemp",
    "razon_social": "Recursos para el Apoyo a Capital Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Baracaf",
    "razon_social": "Baracaf, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soluciones Empresariales",
    "razon_social": "Soluciones Empresariales Eficaces de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prosef",
    "razon_social": "PR Soporte Efectivo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Diexell",
    "razon_social": "Diexell Servicios Financieros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fecto",
    "razon_social": "Fecto, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Firmeza HMP",
    "razon_social": "Firmeza HMP, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Yavo Capital",
    "razon_social": "Yavo Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Selinfip",
    "razon_social": "Servicio de Financiamiento del Norte, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Atila Financ",
    "razon_social": "Promotoría VVV, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PANHEC",
    "razon_social": "Panhec, S.A.P.I. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "COMAIN",
    "razon_social": "Compromiso Aduanero Integral, S.A., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JLM",
    "razon_social": "Acceso Directo JLM, S.A.P.I de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Flex Capital",
    "razon_social": "Impulso Empresarial Empic, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MI DINERITO",
    "razon_social": "Finprospera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CEESA",
    "razon_social": "Crédito Especializado Stándar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "YUHU MX",
    "razon_social": "Pro Quatro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lexintel",
    "razon_social": "Lexintel, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finasob",
    "razon_social": "Finasob, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AltumCapital",
    "razon_social": "Altum CP, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MGL",
    "razon_social": "MGL Soluciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sembrador Cí",
    "razon_social": "Sembrador Círculo de Servicios Populares, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sinergia Ch",
    "razon_social": "Sinergia Ch, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inovaciones",
    "razon_social": "Inovaciones SMR, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tutelle",
    "razon_social": "Tutelle de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credipass",
    "razon_social": "Credipass, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROCAP",
    "razon_social": "Compañía de Servicios el Ángel, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Steel Factor",
    "razon_social": "Steel Factoring, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prestasol",
    "razon_social": "Presta Soluciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credi Recur",
    "razon_social": "Credi Recursos y Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finh",
    "razon_social": "Finh Soluciones Económicas, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PREVOL FINANCIERA",
    "razon_social": "Préstamos de Volada, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Structura",
    "razon_social": "Structura Capital Management, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROFIA",
    "razon_social": "Promotora Financiera Avanza, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Afgani Credisocial",
    "razon_social": "Credisocial México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Multi-Apoyos",
    "razon_social": "Multi-Apoyos de Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crédito Plan",
    "razon_social": "Crédito Plan Real, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Préstamos GP",
    "razon_social": "Préstamos GP, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mastercash",
    "razon_social": "Mastercash, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "R.F.I.N.",
    "razon_social": "Sociedad Empresarial R.F.I.N., S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "G.I.P. TP",
    "razon_social": "Grupo Impulsor Progresa TP, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Himalia Protección Inteligente",
    "razon_social": "Himalia Protección Inteligente, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gpo Factofin",
    "razon_social": "Grupo Factofin, S.A.P.I., de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DAE S.A.",
    "razon_social": "Desarrolladora de Alternativas Estratégicas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MVM",
    "razon_social": "Mediadora de Vivienda Mexicana, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LIQUIDEZ EXPRESS",
    "razon_social": "Apoyos que Cuentan, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Intercap",
    "razon_social": "Intercambio de Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SFG",
    "razon_social": "Servicios Financieros del Guadiana, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SLC Solución, SOLUCREE",
    "razon_social": "SLC Soluciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SMBC",
    "razon_social": "SMBC, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GI",
    "razon_social": "GI de Occidente, S.A. de C.V, SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Potencia Financiera",
    "razon_social": "Darfin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Solutions Boss",
    "razon_social": "Financial Solutions Boss, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Quant",
    "razon_social": "Quant Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TotalFin",
    "razon_social": "FCapital México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finocci",
    "razon_social": "Finocci, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fomento Económico ETM",
    "razon_social": "Fomento Económico ETM, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Plancredi",
    "razon_social": "Plan Credi, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HipotecariaR",
    "razon_social": "Hipotecaria Roma, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FACTO",
    "razon_social": "Factor Corporativo Aries, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Arcalternati",
    "razon_social": "Arcalternativa de Recursos de Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sierra Axis",
    "razon_social": "Sierra Axis, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credimon",
    "razon_social": "Credimon, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Semis",
    "razon_social": "Financiera Semis, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Patrimonio P",
    "razon_social": "Patrimonio Plus, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "¡Sal de apuros!",
    "razon_social": "Arco Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JGI Solution",
    "razon_social": "JGI Solutions, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MC CASH",
    "razon_social": "MC Cash Corp, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAPEM",
    "razon_social": "Grupo Olinx, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Masoportunas",
    "razon_social": "Más Soluciones Oportunas, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finab",
    "razon_social": "Finab, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GNIfinancial",
    "razon_social": "GNI Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crediforza",
    "razon_social": "Crediforza, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Santos",
    "razon_social": "Financiera Santos, S.A.P.I. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sahara",
    "razon_social": "Sahara Mezzanine, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Braskem",
    "razon_social": "Braskem México Proyectos, S.A de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDIMAGNO",
    "razon_social": "Somim, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vivus",
    "razon_social": "Difinance, S.A. de C.V. SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Retail Moda",
    "razon_social": "Retail Moda México, S.A.P.I. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prosperity",
    "razon_social": "Prosperity Factor, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Escala",
    "razon_social": "Escala Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BSO micro",
    "razon_social": "Bitechi Soluciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MDQR",
    "razon_social": "Grupo MDQR, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credifort",
    "razon_social": "Créditos Fortaleza, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Baransi",
    "razon_social": "Baran Servicios Integrales, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Conpresto",
    "razon_social": "Confianza Presto, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kronox",
    "razon_social": "Servicios Financieros Kronox, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Herbodem",
    "razon_social": "Herbodem, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prof-sofom",
    "razon_social": "Profuturo GNP, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Edifica",
    "razon_social": "Impulsora Inmobiliaria Edifica de Cuauhtémoc, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ULTRA CAPITAL",
    "razon_social": "Grupo MSQR, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GOISPV",
    "razon_social": "Glass International OISPV, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Goifin",
    "razon_social": "Goifin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Access K",
    "razon_social": "Access K, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vangurdencre",
    "razon_social": "Vanguardia en Créditos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GOG",
    "razon_social": "Global Owners Group, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Legado Cuauh",
    "razon_social": "Legado Cuauhtémoc, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fin Didxazaa",
    "razon_social": "Financiera Didxazaa, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Respaldo Elite",
    "razon_social": "Respaldo Elite, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credian",
    "razon_social": "Financiera Recrea, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EP México",
    "razon_social": "Energía Proactiva de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "E- Energía",
    "razon_social": "Corporativo E- Energía de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulsora Financiera",
    "razon_social": "Impulsora Financiera del Norte, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Equity Link",
    "razon_social": "Equity Link S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Marverde Infraestructura",
    "razon_social": "Marverde Infraestructura, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FTV",
    "razon_social": "Financiera TV, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dealcorp MX",
    "razon_social": "Dealcorp MX, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Madero Reserve",
    "razon_social": "Madero Reserve, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AME",
    "razon_social": "Alternativa más Expansión AME, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OCE",
    "razon_social": "Organización Capitalista Empresarial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fincea",
    "razon_social": "Fincea Potosina, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Solid Cash",
    "razon_social": "Solid Cash, S.A. DE C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOLIDA",
    "razon_social": "Solvencia Integral de Desarrollo y Avance S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DAG Soluciones Financieras",
    "razon_social": "JMF Arquitectura de Negocios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UB Estructure",
    "razon_social": "UB Estructure, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Miqueas",
    "razon_social": "Miqueas Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GEM Opticred",
    "razon_social": "GEM Opticredit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MMU",
    "razon_social": "Mezzanine México Uno, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulsando Va",
    "razon_social": "Impulsando Valor Activecapital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Promocash",
    "razon_social": "Promocash Centenario, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Axtum",
    "razon_social": "Axtum, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KFV Soluciones",
    "razon_social": "KFV Soluciones Inmediatas, S.A. de .C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VFK",
    "razon_social": "VFK Fortalece, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FICALI",
    "razon_social": "Productos y Servicios Financieros Cachanilla, S.A. de C.V., SOFOM,E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AC-Fin",
    "razon_social": "Ac- Fin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impad",
    "razon_social": "Impulsora Pad, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Primer Logro",
    "razon_social": "Primer Logro S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Opciones MVS",
    "razon_social": "Opciones MVS, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CT-FIN",
    "razon_social": "CT-Fin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Money Holding",
    "razon_social": "Money Holding, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Midemi",
    "razon_social": "Misión de Desarrollo Micro Empresarial México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAPSOL",
    "razon_social": "BTCV Soluciones Integrales, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crezca Hoy",
    "razon_social": "Finanzas con Valor, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GG FS México",
    "razon_social": "GG FS México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Walker Capital",
    "razon_social": "Iniciativa Empresarial del Norte, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Angelus Certum",
    "razon_social": "Angelus Certum, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Plain Capita",
    "razon_social": "Plain Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kampala",
    "razon_social": "Kampala Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AMN Alternativa Mexicana",
    "razon_social": "Alternativa Mexicana de Negocios CYG, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Catcomercial",
    "razon_social": "GFCM Comercial México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Leasy Sofom",
    "razon_social": "Consultancy Leasy, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sofocade",
    "razon_social": "Sofocade, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mezta SF",
    "razon_social": "Mezta Servicios Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sangar",
    "razon_social": "Sangar Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Amico Cap",
    "razon_social": "Amico Cap, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SUM en un Click",
    "razon_social": "Vales de Felicidad, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Promujer",
    "razon_social": "Asociación Promujer de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dos Movimien",
    "razon_social": "Dos Movimiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ID Financiera",
    "razon_social": "Identidad Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Konser",
    "razon_social": "Servicios Integrales AE Corporativo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Consi SOFOM",
    "razon_social": "Consilior Operadora de Cartera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sofagro",
    "razon_social": "Sociedad Financiera Agropecuaria, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Global C",
    "razon_social": "Global Currency Market, S.A.P.I. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINAE",
    "razon_social": "Finae, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Floou",
    "razon_social": "Floou, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Unita Capital",
    "razon_social": "Unita Capital S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Índigo",
    "razon_social": "Estructura Índigo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capipaís",
    "razon_social": "Capitales del País, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finacciona",
    "razon_social": "Finacciona, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRIVESA SOFOM",
    "razon_social": "Privesalliance, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Balanza",
    "razon_social": "Balanza Servicio y Soluciones para tu futuro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Conduco",
    "razon_social": "Conduco, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IMPES",
    "razon_social": "IMPES Empresas Sustentables, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sisacoa",
    "razon_social": "Grupo Sisacoa, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Osamel",
    "razon_social": "Planet Group Osamel, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Patmil",
    "razon_social": "Patrimonios Milenio, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bircon",
    "razon_social": "Bir Contigo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BMT Servicio",
    "razon_social": "BMT Servicios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fortrade SF",
    "razon_social": "Fortrade SF, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Maxcapital",
    "razon_social": "Maxcapital Intercontinental, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ficosertur",
    "razon_social": "Ficosertur de Nayarit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credipegaso",
    "razon_social": "Credipegaso S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NOMINOM",
    "razon_social": "Inteligencia Financiera Kia, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "La Florida",
    "razon_social": "Servicios y Administración Operativa la Florida, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Avantta Sentir Común",
    "razon_social": "Avantta Sentir Común, S.A de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FONDEOR",
    "razon_social": "Fondeo y Desarrollo Emprendedor, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cufrisa",
    "razon_social": "Soluciones Patrimoniales Cufrisa, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EMXFinance",
    "razon_social": "Emerson México Finance, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aser",
    "razon_social": "Aser Promotora, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crcmx",
    "razon_social": "Crcmx, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Americafin",
    "razon_social": "Americafin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mreit",
    "razon_social": "Mreit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tres Zapotes",
    "razon_social": "Financiera Personalizada Tres Zapotes, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Hernán",
    "razon_social": "Sociedad de Préstamo Grupo Hernández, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Drex Soluciones",
    "razon_social": "Apoyo Asertivo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Pro Negocios",
    "razon_social": "Pro Negocios y Transacciones de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SFS",
    "razon_social": "Servicios Financieros Soriana, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cherry Exclusive",
    "razon_social": "Cherry Exclusive S.A. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Atha",
    "razon_social": "Atha Inteligencia Artificial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Emercredit",
    "razon_social": "Emercredit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gifom",
    "razon_social": "Gifom, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KAN Financiera",
    "razon_social": "PT78, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Unisofom",
    "razon_social": "Unisofom, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AR18",
    "razon_social": "AR18, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fin Atlas",
    "razon_social": "Corporación Financiera Atlas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ABI",
    "razon_social": "Uranden y Tecuen, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAGSA",
    "razon_social": "Crédito Agrícola y Ganadero, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soluciones Cañeras",
    "razon_social": "Soluciones Cañeras, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vida Fin",
    "razon_social": "Vida Fin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TIII PR3STAMOS",
    "razon_social": "TIII PR3STAMOS, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "E-Bussines Park SOFOM",
    "razon_social": "Esential Bussines Park, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Quantia",
    "razon_social": "Quantia Industrial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SISTEMA DE MICROCRÉDITOS MAC",
    "razon_social": "Sistema de Microcréditos Mac, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Korum Capital",
    "razon_social": "Korum Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ACF",
    "razon_social": "Administradora de Colaterales Financieros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credilex",
    "razon_social": "Credilex, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tribus",
    "razon_social": "Tribus Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Anjolin",
    "razon_social": "Grupo Anjolin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Afalianza",
    "razon_social": "Administracion Financiera Alianza, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alteoportuna",
    "razon_social": "Alternativa Oportuna, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDIGILSA",
    "razon_social": "Financiera Agro-Industrial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sotiderc",
    "razon_social": "Sotiderc, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GICBC Financiera",
    "razon_social": "GICBC Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ideas",
    "razon_social": "Ideas y Tecnologías para Tu Vida, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sum Feliz",
    "razon_social": "Sum Préstamo Feliz, S.A. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sofnex",
    "razon_social": "Sofnex Servicios, S.A. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Promodeseos",
    "razon_social": "Promodeseos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Norhol",
    "razon_social": "Norhol, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Golconda",
    "razon_social": "Grupo Golconda Guerrero, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GMC Agrofin",
    "razon_social": "GMC Agrofin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Superia",
    "razon_social": "3JH Servicios Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Consigue tus metas",
    "razon_social": "Consigue Tus Metas, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prestix",
    "razon_social": "Prextiss Tradefix, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "F2m",
    "razon_social": "Financiero 2m, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIA Laguna",
    "razon_social": "Financiera Agropecuaria de la Laguna, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MUFLM",
    "razon_social": "MUFG Finance and Leasing Mexico, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nxx Capital",
    "razon_social": "NXX Capital Mezz I, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sun Economia",
    "razon_social": "Sun Economía, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cgb",
    "razon_social": "CGB Hipotecaria, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "+SolidezGFA",
    "razon_social": "GFA Fomento del Bajío, S.A.P.I. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Va servicios",
    "razon_social": "Va Servicios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bioenova",
    "razon_social": "Bioenova, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cps Acción Empresarial",
    "razon_social": "CPS Acción Empresarial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MNJ Capital",
    "razon_social": "MNJ Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Meso Capital",
    "razon_social": "Meso Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fasol",
    "razon_social": "Fasol Soluciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HDA",
    "razon_social": "HDA Soluciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cocrea",
    "razon_social": "Soluciones Cocrea, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LMX 24",
    "razon_social": "Limemx 24, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credi Vive",
    "razon_social": "Credi Vive Peninsular, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Desarrollarte",
    "razon_social": "Apoyo y Servicio para el Desarrollo Rural y Urbano, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fincitri",
    "razon_social": "Fincitri, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SDIF",
    "razon_social": "SDIF México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulso de Negocios",
    "razon_social": "Impulso de Negocios Proexpansión, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Axionex Financiera",
    "razon_social": "Axionex Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grufica",
    "razon_social": "Grufica, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DARUMA SOFOM",
    "razon_social": "Nos Comprometemos con tus Sueños, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Guba",
    "razon_social": "Apoyos Guba, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kishon",
    "razon_social": "Kishon, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TMG",
    "razon_social": "TMG Financial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nébula",
    "razon_social": "Nébula Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credicrea",
    "razon_social": "Tecnimarc, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credilab",
    "razon_social": "Credilab, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crea+",
    "razon_social": "Crea Más Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INVEKTA",
    "razon_social": "Corporativo Lurett, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KapitalFlex",
    "razon_social": "Cumplo y Avanzo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bargaf",
    "razon_social": "Bargaf, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vis Et Certus",
    "razon_social": "Vis Et Certus, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "La Tanda",
    "razon_social": "La Tanda Miranda, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Captalys Mexico",
    "razon_social": "Proveedora de Impulso Empresarial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Liquidez Monetaria",
    "razon_social": "Liquidez y Financiacion Monetaria, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREJUSA",
    "razon_social": "Crédito Empresarial de Juárez, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PPE Sofom",
    "razon_social": "Passadís del Pep, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crediquincena",
    "razon_social": "Crediquincena, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ALG",
    "razon_social": "ALG Servicios Financieros México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDISOLUCIONES",
    "razon_social": "Estrategias Patrimoniales Garantizadas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "REU",
    "razon_social": "Registro de Envase Universales, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Praxtesa",
    "razon_social": "Praxtesa, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Davida",
    "razon_social": "Davida SP, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Eclipse Treinta",
    "razon_social": "Eclipse Treinta, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SAC",
    "razon_social": "SAC Soluciones Alternativas para tu Crecimiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AGS Capital",
    "razon_social": "Ags Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tai",
    "razon_social": "Terminal de Apoyo a la Industria, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "123 Con Nosotros",
    "razon_social": "123 Con Nosotros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EBOR FINANCIAL",
    "razon_social": "GF Ebor, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SERFI",
    "razon_social": "Servicios Financieros Juárez, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KEO",
    "razon_social": "Keo World, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Emprende Más",
    "razon_social": "Emprende Más, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ayuda y Armonía",
    "razon_social": "Ayuda y Armonía, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "YAVE",
    "razon_social": "Yave Smart Lending SPV, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credinal",
    "razon_social": "Credinal, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kualinet",
    "razon_social": "Kualinet, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Carop",
    "razon_social": "Cartera de Oportunidades, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "De Capital",
    "razon_social": "Financiera Desarrolladora de Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Karilo Credit",
    "razon_social": "Karilo Credit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crédito Corporativo",
    "razon_social": "Crédito Corporativo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alianza Tarasca",
    "razon_social": "Financiera Alianza Tarasca, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Estamos Para Ti",
    "razon_social": "Estamos para Ti, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IDF CAPITAL",
    "razon_social": "IDF Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Babilomo Corp",
    "razon_social": "Babilomo Corp, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Click Mutualia",
    "razon_social": "Soluciones Cocay, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo IEA",
    "razon_social": "Impulso Economico Activo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Losung",
    "razon_social": "Losung Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sama",
    "razon_social": "Solid Assets Management, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CH Capital",
    "razon_social": "Chumacero Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lynx CP",
    "razon_social": "Lynx CP, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Más Bisne",
    "razon_social": "Más Bisne, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FTS Sofom",
    "razon_social": "Financiamos tus Sueños, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CME Sofom",
    "razon_social": "Capital para Mexicanos Emprendedores, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FMF Sofom",
    "razon_social": "Financiamos a Mexicanos Fuertes, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fmetas sofom",
    "razon_social": "Financiamos tus Metas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alta650",
    "razon_social": "Alta650, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Despliegue Evolutivo",
    "razon_social": "Despliegue Evolutivo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Booster Capital",
    "razon_social": "Booster Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vipoga",
    "razon_social": "Vipoga, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mira Financiera",
    "razon_social": "Mira Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alderiva De México",
    "razon_social": "Alderiva de México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Merama Growth",
    "razon_social": "Merama Growth, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ekon",
    "razon_social": "Ec Estrategia Emprendedora, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IFG Soluciones",
    "razon_social": "IFG Soluciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sinergia",
    "razon_social": "Sinergia Empresarial FLG, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Serious",
    "razon_social": "Serious, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kuali",
    "razon_social": "Karum Operadora de Pagos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Creditea",
    "razon_social": "Creditea, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fincalia",
    "razon_social": "Fincalia de México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IQWB",
    "razon_social": "IQ Worldwide Business, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Harvest",
    "razon_social": "Harvest Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inyecta",
    "razon_social": "FSMP Soluciones de Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Futurando",
    "razon_social": "Futurando, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Efcapital",
    "razon_social": "EFC Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Juntos Financiera",
    "razon_social": "Juntos Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cumplo",
    "razon_social": "Ekscelenko, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Maquila Suppliers",
    "razon_social": "Maquila Suppliers Financial Corp, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Eduk Pro",
    "razon_social": "Eduk Pro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fitma",
    "razon_social": "Fitma Taakin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Suma Financiera",
    "razon_social": "Suma Financiera del Pacífico, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Creditas",
    "razon_social": "LGF Occidente, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Workcap Solutions",
    "razon_social": "Workcap Solutions, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Janhez",
    "razon_social": "Janhez Servicios Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Reyes",
    "razon_social": "Financiera Reyes, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fingar88",
    "razon_social": "Fingar Mexicana 88, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Wolf Financial Services",
    "razon_social": "Peralta Soluciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Loscar",
    "razon_social": "Operadora Loscar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Portafolio",
    "razon_social": "Portafolio Américas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Link Cap",
    "razon_social": "Link Cap Group, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Nieto",
    "razon_social": "Sociedad Financiera Nieto, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Solve GCM",
    "razon_social": "Vatoro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alterna Capital",
    "razon_social": "Alterna Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulso Regional",
    "razon_social": "Impulso Regional del Sureste, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finanzas a tu Lado",
    "razon_social": "Finatul México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Assets Fixxes Capital",
    "razon_social": "Assets & Fixxes, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fincalo",
    "razon_social": "Fincalo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credignt",
    "razon_social": "Credi GNT, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Avalié",
    "razon_social": "Avalie, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Escala KSE",
    "razon_social": "Grupo Escala KSE, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crédito Ágil",
    "razon_social": "Impulso Económico Crea, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Redhez",
    "razon_social": "Redhez Promads, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Feliz",
    "razon_social": "Financiera Feliz, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Bonaterra",
    "razon_social": "Financiera Bonaterra, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Blue Capital Times",
    "razon_social": "Blue Capital Times, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Komatsu Finance México",
    "razon_social": "Komatsu Finance México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Principia Futuro",
    "razon_social": "Grupo Principia Futuro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GCC",
    "razon_social": "Grupo Comprometido por Crecer, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Competidor Financiero",
    "razon_social": "Competidor Financiero, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gkfm",
    "razon_social": "GKFM, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Idealoperadora Administrativa",
    "razon_social": "Idealoperadora Administrativa, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soluciones BTM",
    "razon_social": "Soluciones Digitales BTM, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Superávit",
    "razon_social": "Superávit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BRAVIO CAPITAL",
    "razon_social": "Bravio Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tparss",
    "razon_social": "Tparss, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alcapital",
    "razon_social": "Alcana Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bretón",
    "razon_social": "Bretón Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Farefo",
    "razon_social": "Farefo Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Vida Mejor",
    "razon_social": "Fciero Vida Mejor, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cwh Certeza",
    "razon_social": "CWH Certeza de Opción, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finasole",
    "razon_social": "Finasole, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Oportunidades Financieras para tu Negocio",
    "razon_social": "Oportunidades Financieras para tu Negocio, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ez Pz",
    "razon_social": "Servicios Digitales TR, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prodesa",
    "razon_social": "Promotora del Desarrollo Económico de Saltillo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lakshmi",
    "razon_social": "Desarrollo Empresarial Lakshmi, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Puntocima Financiera",
    "razon_social": "Puntocima Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ckd Rf Estructurada",
    "razon_social": "CKD RF Estructurada, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Elatec",
    "razon_social": "Elatec, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Petramare Servicios",
    "razon_social": "Petramare Servicios Consolidados, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "A55 FINANCIERA",
    "razon_social": "A55 Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mxfin",
    "razon_social": "Mxfin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Pasefi",
    "razon_social": "Pasefi, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sixel Contigo",
    "razon_social": "Sixel Contigo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Frontalfin",
    "razon_social": "Frontal Credit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dex One Capital",
    "razon_social": "Dex One Capital S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "We Capital",
    "razon_social": "Gahr We Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulsar Capital Empresarial",
    "razon_social": "Impulsar Capital Empresarial, S.A.P.I de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "XURE",
    "razon_social": "NX Financial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Arrendadora Cresca",
    "razon_social": "Arrendadora Cresca, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fincap",
    "razon_social": "Financial Intelligence Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fincaluxor",
    "razon_social": "Fincaluxor, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Opción a Tu Medida",
    "razon_social": "Opción a Tu Medida, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Koin",
    "razon_social": "Xirex Contigo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "APOYO APU",
    "razon_social": "Apoyo Apu, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Desarrollo de Occidente",
    "razon_social": "Financiera Empresarial para el Desarrollo de Occidente, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Divino Dinero",
    "razon_social": "Secaman, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Operaciones Oportunas",
    "razon_social": "Operaciones Oportunas, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EASY INDIVIDUAL SOLUTIONS",
    "razon_social": "Easy Individual Solutions, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONFIANZA EN TU PROYECTO",
    "razon_social": "Confianza en tu Proyecto, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PBCNA SOFOM",
    "razon_social": "PBCNA, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Justo a la medida financiera",
    "razon_social": "Justo a la Medida Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cadofi",
    "razon_social": "Cadofi Servicios Integrales, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soda Capital",
    "razon_social": "Soda FN, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JMSOLUCIONES",
    "razon_social": "JM Soluciones a tu Liquidez, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soluciones FH",
    "razon_social": "Soluciones de Crédito FH, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MS 2050",
    "razon_social": "MS 2050, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KAO SF",
    "razon_social": "Kao SF, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "As Bussiness Credit",
    "razon_social": "AS Business Credit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "O & Z INNOVACION FINANCIERA",
    "razon_social": "O & Z Innovacion Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tu Kapital En Evolución",
    "razon_social": "Tu Kapital en Evolución, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Capitolio",
    "razon_social": "Financiera Capitolio, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREATIVO SOCIEDAD FINANCIERA",
    "razon_social": "Creativo Sociedad Financiera Nacional, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Wolf Heritage",
    "razon_social": "TP del Occidente, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Preporod",
    "razon_social": "Preporod, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Futura",
    "razon_social": "Financiera Futura Mexicana, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FRONT CAPITAL",
    "razon_social": "Alianza Pongo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TIVEG",
    "razon_social": "TIVEG, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MacroCredit",
    "razon_social": "AJM Servicios Integrales de la Huasteca, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soporte Impulsa",
    "razon_social": "Soporte Impulsa, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prestua",
    "razon_social": "Impulsare Proyectos para Ti, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EMPRENDE CON MOVI",
    "razon_social": "Emprende con Movi, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CFZ",
    "razon_social": "Compañía Financiera del Zuaque, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiamos tu necesidad",
    "razon_social": "Financiamos Tu Necesidad, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIFNACO",
    "razon_social": "Fifnaco, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Escalabilidad Empresarial en México",
    "razon_social": "Escalabilidad Empresarial en México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GLN",
    "razon_social": "Grupo Legal Nevermind, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prestaciones Sure",
    "razon_social": "Prestaciones Sure, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AMP II",
    "razon_social": "AM Partners, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lordanou",
    "razon_social": "Lordanou, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FOCREMEX",
    "razon_social": "Fomento Crediticio Mexicano, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Stock Financiero",
    "razon_social": "Stock Financiero, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "San Judas Tadeo Servicios de Cartera",
    "razon_social": "San Judas Tadeo Servicios de Cartera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LIV FD",
    "razon_social": "Liv FD, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VULTUR CAPITAL",
    "razon_social": "Vultur Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "1900 S.F.",
    "razon_social": "1900 Soluciones Financieras, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AORA",
    "razon_social": "Efeval, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SFK CAPITAL",
    "razon_social": "Servicios Fkalli, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TUKU",
    "razon_social": "Futuro Pyme, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ENECREDIT",
    "razon_social": "Enecredit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ADEUSIS",
    "razon_social": "Grupo Adeusis, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ADVENTUS",
    "razon_social": "Adventus Capital, S.A. DE C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EMPUJE ECONOMICO",
    "razon_social": "Empuje Económico, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "WESHARE GO",
    "razon_social": "Explo Tecnología, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Confiare",
    "razon_social": "Etérea Business, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GUERALVA",
    "razon_social": "Gueralva Financiera del Bajío, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tranquilidad Asertiva",
    "razon_social": "Tranquilidad Asertiva, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MUVOP",
    "razon_social": "Muvop, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crece Enlace",
    "razon_social": "Crece Enlace Empresarial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finank",
    "razon_social": "Finank, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nozomi",
    "razon_social": "Tozan Ailto, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ulta",
    "razon_social": "Aumento Ulta, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Generando Rlq",
    "razon_social": "Generando RLQ, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAPITAL INICIAL",
    "razon_social": "Adelante Veintiuno, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Proyectos Lurok",
    "razon_social": "Proyectos Lurok, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EMPRENDE CON CRÉDITO",
    "razon_social": "Siempre Emprende con Crédito, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IMCO DEL BAJIO",
    "razon_social": "Imco del Bajio, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VAMMIGRANTE",
    "razon_social": "Vínculos y Activos para Mexicanos Migrantes, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PPC",
    "razon_social": "Prospectivas y Proyectos Corporativos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alka",
    "razon_social": "Alka Capitals, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SUSTENTABLE RYR",
    "razon_social": "Sustentable Ryr, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIERA CULTIVA",
    "razon_social": "Financiera Cultiva, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Quid",
    "razon_social": "Financiera Quid, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TPF MÉXICO",
    "razon_social": "TPF México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SIGNO DE PESOS",
    "razon_social": "Signo de Pesos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Creciendo a tu lado",
    "razon_social": "Growing Project de México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOLEBIS",
    "razon_social": "Solebis Asociados, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EMPRESA MEXICANA DESARROLLANDO EL FUTURO",
    "razon_social": "Empresa Mexicana Desarrollando el Futuro , S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CINCO VC",
    "razon_social": "Cinco VC, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROYECCIÓN ECONÓMICA Y EMPESARIAL",
    "razon_social": "Proyección Económica y Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulsa Servicios Financieros",
    "razon_social": "Impulsa tu ganancia, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fidezza Finanzas",
    "razon_social": "Tiempo de Ganar, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soluciona Tu Futuro",
    "razon_social": "Soluciona tu Futuro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SESURA",
    "razon_social": "SESURA, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GTO LEASING",
    "razon_social": "Gto Leasing Services, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIX CRÉDITO",
    "razon_social": "Facilidad Inmediata, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prosperidad",
    "razon_social": "Impulso y Prosperidad, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LEGACY",
    "razon_social": "Promotora de Proyectos Legacy S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Acciona Financiación",
    "razon_social": "Acciona Financiación de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Presti-go",
    "razon_social": "RASESU, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ACAMINO",
    "razon_social": "Apoyo en el Camino, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Rapidito Mexlg",
    "razon_social": "Rapidito Mexlg, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIERA ARMA TU CREDITO",
    "razon_social": "Financiera Arma Tu Crédito, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OPPORTUNITY",
    "razon_social": "Portafolio de Oportunidades, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Scania Finance México",
    "razon_social": "Scania Finance México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Xepelin",
    "razon_social": "Operadora Falcon, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VINLA",
    "razon_social": "Vinla Maremi, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DMA",
    "razon_social": "DMA Innovando tu Crecimiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KARYCASH",
    "razon_social": "Karycash, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ABVI",
    "razon_social": "ABV Innovación Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "POLO",
    "razon_social": "Incremento Polo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "COTE",
    "razon_social": "Progreso Cote, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INGENIO VERTICAL",
    "razon_social": "Ingenio Vertical, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIERA GANAMOS TODOS",
    "razon_social": "Financiera Ganamos Todos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRECE PRESTACIONES",
    "razon_social": "Crece Prestaciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "APORTANDO",
    "razon_social": "Aportando FLP, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Apoyo Integral",
    "razon_social": "Vas Pagando, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BÍ FINANCIERA",
    "razon_social": "Bí Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Produfin",
    "razon_social": "Más Inclusión y Valor para Ti, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IMPETU DE NEGOCIOS",
    "razon_social": "Ímpetu de Negocios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sofactor",
    "razon_social": "Sofactor, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gádita",
    "razon_social": "Gádita, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KAPITALIZER",
    "razon_social": "Millenials Innovations, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAPITAL A TU FAVOR",
    "razon_social": "Capital A Tu Favor, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SEYCO FINANZAS",
    "razon_social": "Seyco Finanzas, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Teleporter",
    "razon_social": "Teleporter, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OPCR",
    "razon_social": "OPCR, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Fidarp",
    "razon_social": "Grupo Fidarp, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ARCA FINANCIERA",
    "razon_social": "Arca Financiera para el Futuro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOLDI CAPITAL",
    "razon_social": "Soldi Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SIEMENS SOFOM",
    "razon_social": "Siemens Servicios Comerciales, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINCALOSA",
    "razon_social": "Servicios Fincalosa, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RUSCELLO",
    "razon_social": "Ruscello, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TALIPOT CAPITAL",
    "razon_social": "Talipot Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prestatux",
    "razon_social": "Prestatux, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kredi",
    "razon_social": "Financiera Inteligente, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRUPO GARTELO",
    "razon_social": "Grupo Gartelo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kody FNS",
    "razon_social": "Kody FNS, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Apoyometas",
    "razon_social": "Apoyometas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INTEGRIDAD FINANCIERA",
    "razon_social": "Interactive Financial de Occidente, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Semper",
    "razon_social": "Semper Services, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FDG Pro",
    "razon_social": "FDG Pro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Trasierra",
    "razon_social": "Trasierra, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Zumpt",
    "razon_social": "Zumpt, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MONERGIZE",
    "razon_social": "Monergize MX, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Olson Capital",
    "razon_social": "Alend, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nowports Capital",
    "razon_social": "Avenida Vessel, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Axen Capital México",
    "razon_social": "Miley Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TRUE LEND",
    "razon_social": "True Lend, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tales Global",
    "razon_social": "Tales Global Business, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MOSKALTI CAPITAL",
    "razon_social": "Moskalti Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soluciones Modelo",
    "razon_social": "Soluciones Modelo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SWIPESA",
    "razon_social": "Swipesa, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INNOVACION Y LIQUIDEZ EFECTIVA",
    "razon_social": "Innovación y Liquidez Efectiva, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREFINCA",
    "razon_social": "Crefinca, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRUPO VIALITYME",
    "razon_social": "Grupo Vialityme, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "QUINTA SOLUTION",
    "razon_social": "Quinta Solution, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAS",
    "razon_social": "Campo Agrícola del Sureste, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Super Loan-Préstamos sin Buró",
    "razon_social": "Impulso Financiero para tu Familia, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finanzas Active 24",
    "razon_social": "Finanzas Active 24, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credilazos",
    "razon_social": "Finayo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RENACES DIA A DIA",
    "razon_social": "Renaces Día a Día, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BRINKS CAPITAL MEXICO",
    "razon_social": "Brink s Capital México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prestamos Rayo",
    "razon_social": "Préstamos Rayo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "intersom",
    "razon_social": "Intersom, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOFORTALEZA",
    "razon_social": "Factor Fortaleza, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIADO MEXICO",
    "razon_social": "Fiado México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LOGRA Y CRECE",
    "razon_social": "Logra y Crece, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROLEVER CAPITAL",
    "razon_social": "Prolever Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Sysco GC",
    "razon_social": "Grupo Sysco GC, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OPORTUNIDADES MEX LATINO",
    "razon_social": "Oportunidades Mex Latino, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Rendisof",
    "razon_social": "RENDISOF, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDBOSS",
    "razon_social": "CREDBOSS, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KRONOSFIN",
    "razon_social": "KRONOSFIN, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BISHAM WEALTH",
    "razon_social": "Bisham Wealth, S.A.P.I. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BROOKLYN CAPITAL",
    "razon_social": "Brooklyn Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MVSC",
    "razon_social": "MVSC Solutions, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credi5",
    "razon_social": "FC5, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Proyección Económica UG",
    "razon_social": "Proyección Económica UG, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CANDESOL",
    "razon_social": "Candelaria Soluciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Promotor JJM",
    "razon_social": "Grupo Promotor JJM, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GOGAN",
    "razon_social": "Servicios en Administración Gogán, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PA'YA",
    "razon_social": "TIGRIADA, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRESTAMOS XPRESS",
    "razon_social": "Prestamos Personales Xpress, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alianty",
    "razon_social": "Fomenta tu Ganancia, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREEMOS EN TU NEGOCIO",
    "razon_social": "Creemos en Tu Negocio, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAPITALTA",
    "razon_social": "Alta Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Obelix",
    "razon_social": "Desarrollo Profesional Obelix, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PREQUINCENA",
    "razon_social": "DOVISH, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DREAM CARS",
    "razon_social": "Dream Cars Financial Services, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credmex",
    "razon_social": "Impulsa tu Rendimiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "STM",
    "razon_social": "Klu Lending, S.A. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RED FORTALECIMIENTO EMPRESARIAL",
    "razon_social": "Red Fortalecimiento Empresarial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GAFIVAL",
    "razon_social": "Gafival, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finalianza",
    "razon_social": "SOFW, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GOVA IMPULSO ECONÓMICO",
    "razon_social": "GOVA Impulso Económico, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAPIX.MX",
    "razon_social": "CAPIX.MX, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRIME LOAN OUTS",
    "razon_social": "Prime Loan Outs, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FUTURO EXPONENCIAL",
    "razon_social": "Futuro Exponencial, S.A.P.I., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINCASH",
    "razon_social": "Progreso Económico Eleva, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Btg Pactual Capital",
    "razon_social": "BTG Pactual, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIERA SOLVE",
    "razon_social": "Financiera Solve, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inventa Factoring",
    "razon_social": "Confiar es ganar, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OPORTUCRECE",
    "razon_social": "OPORTUCRECE, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Binco",
    "razon_social": "Confíanos tu Futuro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EXPERTOX",
    "razon_social": "EXPERTOX, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Balfi",
    "razon_social": "Soluciones Arlav, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finsostener",
    "razon_social": "FINSOSTENER, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INSTAURA",
    "razon_social": "Finkargo México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ZR40",
    "razon_social": "ZR40, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HDM 1975",
    "razon_social": "HDM 1975, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ganancia Confiable",
    "razon_social": "Ganancia Confiable, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "STILAKREDIYA",
    "razon_social": "Stilakrediya S.A.P.I. de C.V. SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINFORTUNA",
    "razon_social": "Finfortuna, S.A.P.I. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dinero Prospero",
    "razon_social": "Dinero Prospero, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINAUGE",
    "razon_social": "Finauge, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FOMSTER",
    "razon_social": "FOMSTER, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Biser",
    "razon_social": "Biser Procesos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Especializado Eniatus de México Registro",
    "razon_social": "Grupo Especializado Eniatus de México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MXDisruption",
    "razon_social": "International Disruption, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BID Q",
    "razon_social": "BID Q, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Te Apoyo",
    "razon_social": "Apoyo Económico de Baja California, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BORDER CREDIT",
    "razon_social": "Border Credit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EMAX",
    "razon_social": "Emax Financial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GP PREVISION Y VALORES",
    "razon_social": "GP Previsión y Valores, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "STOCK CENTRAL",
    "razon_social": "Stock Central, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prediama",
    "razon_social": "Prediama, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRINCIPAL HIVE",
    "razon_social": "Principal Hive, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EAGM",
    "razon_social": "EA Gestión Monetaria, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KC2 Capital",
    "razon_social": "KC2 Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Rex Financial",
    "razon_social": "Rex Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DAAB",
    "razon_social": "DAAB Servicios y Soluciones Financieras, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Seamos Socios",
    "razon_social": "Financiera Seamos Socios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIAMIENTO CORPORATIVO NAVIO",
    "razon_social": "Financiamiento Corporativo, NAVIO, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Welkap",
    "razon_social": "Soluciones ASTA LAKSMI, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NANOFIN",
    "razon_social": "NANOFIN, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tala",
    "razon_social": "Tala Mobile, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SPH FINANCIERA",
    "razon_social": "SPH Servicios Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Zwolf Re S.A.P.I. de C.V., SOFOM, E.N.R.",
    "razon_social": "Zwolf Re, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SÚPER PRÉSTAMO",
    "razon_social": "Águila Digital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SLTS",
    "razon_social": "SLTS Servicios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dracma Capital",
    "razon_social": "Dracma Capital Services, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ESCANDINAVOS I",
    "razon_social": "Escandinavos I, S.A. DE C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lease Now",
    "razon_social": "Lease Now, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vandelier",
    "razon_social": "Vandelier CSN, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UNLIMIT",
    "razon_social": "Unlimit Leasing, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PINTOSTRADING",
    "razon_social": "Pintostrading, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BIN BROKERS",
    "razon_social": "Bin Brokers e Intermediarios de Negocios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PIDENOS CREDITO",
    "razon_social": "Pídenos Crédito, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Servicios Stacie",
    "razon_social": "Servicios Stacie, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Facilidades",
    "razon_social": "Facilidades Maremi, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GUAITA",
    "razon_social": "Guaita, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tu Bienestar SIS",
    "razon_social": "Tu Bienestar Sis, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "WEBLETT",
    "razon_social": "WEBLETT, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SDA T-APOYA",
    "razon_social": "SDA T-Apoya, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MAT",
    "razon_social": "Multiapoyo Tu Respaldo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "REGIWORLD",
    "razon_social": "Regiworld, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MASHAWORLD",
    "razon_social": "Mashaworld, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KARYWORLD",
    "razon_social": "Karyworld, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MEXDIN",
    "razon_social": "Elaworld, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vital Progreso",
    "razon_social": "Vital Progreso, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Interestelar Time",
    "razon_social": "Interestelar Time, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BIA",
    "razon_social": "Bridge International Accelerator, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Konke",
    "razon_social": "Konke Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LIQUIDEZ TOTAL",
    "razon_social": "Liquidez Total, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KRUVAST",
    "razon_social": "Kruvast, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CASA DE ORO Q",
    "razon_social": "IM Mesoamericana MX, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Punto Cla B",
    "razon_social": "Punto Cla B, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Naica Capital",
    "razon_social": "Naica Capital S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINYAAB",
    "razon_social": "FINYAAB, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FICORBA",
    "razon_social": "FICORBA, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Atlizintla Financiera",
    "razon_social": "Dinero en Tu Control, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TE RESPALDAMOS",
    "razon_social": "Te Respaldamos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NT SOLUCIONES FINANCIERAS",
    "razon_social": "NA-TO Soluciones Financieras, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KAAT AANTAH",
    "razon_social": "Soluciones Kaat Aantah, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TOTAL MONEY",
    "razon_social": "Total Money, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INTEGRACIÓN FAMILIAR CAVECO",
    "razon_social": "Integración Familiar Caveco, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FALGO",
    "razon_social": "Falgo Ventures, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Coztyc",
    "razon_social": "Demoficracia, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "WeDoo Financing",
    "razon_social": "Wedoo Financing, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VALUBY",
    "razon_social": "VALUBY, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capital Tay",
    "razon_social": "Capital Tay, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Altitud",
    "razon_social": "Financiera Altitud, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRESTAMOS PARA PENSIONADOS",
    "razon_social": "Préstamos para Pensionados, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alcazar Suma",
    "razon_social": "Dos Once Suma, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRUPO IAF21",
    "razon_social": "Grupo IAF21, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HA ESTRUCTURA",
    "razon_social": "HA Estructura KPTL, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HK VENTURE",
    "razon_social": "HK Venture, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Hun Vital",
    "razon_social": "Hun Vital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crezcamos Con Visión Eempresarial",
    "razon_social": "Crezcamos con Visión Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fame Credit",
    "razon_social": "Fame Credit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AVANZA FIN CAPITAL",
    "razon_social": "Avanza Fin Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "APLU",
    "razon_social": "Apolo Oportunidades, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Apoyos Simpli",
    "razon_social": "Apoyos Simpli, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Petrolending",
    "razon_social": "Petrolending, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mediadora PRP",
    "razon_social": "Mediadora PRP, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lefimc",
    "razon_social": "LEFIMC Solidez Empresarial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crezko",
    "razon_social": "Crezko Servicios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "F.CUBE",
    "razon_social": "Grupo Empresarial F.Cube, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sabupen",
    "razon_social": "Sabupen, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Omakool",
    "razon_social": "Omakool, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Adelanto Ya",
    "razon_social": "Grupo Kullki, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vigoris Capital",
    "razon_social": "Maks Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Working & Success",
    "razon_social": "Working & Success, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kailash Financiera",
    "razon_social": "Kailash Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grey Oak",
    "razon_social": "Grey Oak, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ALUX",
    "razon_social": "Alux Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finbra.com",
    "razon_social": "Litore Avances, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BALI",
    "razon_social": "Bali Operaciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lendbit",
    "razon_social": "Lendbit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INPAR",
    "razon_social": "Incremento Par, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dragonfly",
    "razon_social": "Dragonfly Technology, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AFT SOFOM",
    "razon_social": "Alternativas Financieras para tu Bienestar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Zonaplata",
    "razon_social": "Zonaplata Latamxn, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Increscendo México Financial & Services",
    "razon_social": "Increscendo México Financial & Services, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AQ Patrimonial",
    "razon_social": "AQ Patrimonial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Suplemento Monetario",
    "razon_social": "Suplemento Monetario, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FACILITADORA HERMANDAD",
    "razon_social": "Facilitadora Hermandad, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Evolfin",
    "razon_social": "Evolfin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TCumplimos",
    "razon_social": "TCumplimos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caprepa Evolution",
    "razon_social": "Caprepa Evolution, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Emporio Financiero",
    "razon_social": "Emporio Financiero YE, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mattilda",
    "razon_social": "Mattilda-EDU, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CORONUS",
    "razon_social": "Coronus, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GBT",
    "razon_social": "GBT Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alana Capital",
    "razon_social": "Alana Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Creze",
    "razon_social": "Prestadora de Servicios Ciclomart, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MGA Karal",
    "razon_social": "MGA Karal, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soluciones Benignas",
    "razon_social": "Soluciones Benignas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EXANTE",
    "razon_social": "PHI 1618 de México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fomento de Patrimonio Económico",
    "razon_social": "Fomento de Patrimonio Económico, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Xrisol Empresarial",
    "razon_social": "Xrisol Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MUGA",
    "razon_social": "MUGA Servicios Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Money Giver",
    "razon_social": "Money Giver, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "2514m",
    "razon_social": "Aledart, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INFRATEK",
    "razon_social": "Ingeniería Económica para la Infraestructura, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Triple Alianza",
    "razon_social": "Triple Alianza para el Desarrollo Microempresarial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Liquicapital",
    "razon_social": "Administradora Liquicapital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GO2ME",
    "razon_social": "GO2ME, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TIP AUTO",
    "razon_social": "Tip Auto, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Meta Patrimonio",
    "razon_social": "Meta Patrimonio, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRARFI",
    "razon_social": "Crarfi, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Un Dígito Más",
    "razon_social": "Un Dígito Más, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bockdefi",
    "razon_social": "Bockdefi, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Repucot",
    "razon_social": "Repucot, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDITO SUSTENTABLE",
    "razon_social": "Desarrollo del Crédito Sustentable, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inventa Credit",
    "razon_social": "Inventa SFIEH, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BEST CAPITAL",
    "razon_social": "Monte Blanco International Services, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capital & Financial Soul",
    "razon_social": "Capital & Financial Soul, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SICOPRE",
    "razon_social": "Grupo Gaschas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prestabit",
    "razon_social": "Synthetixdefi, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Defiswap",
    "razon_social": "Defiswap, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KRECE",
    "razon_social": "Oportunidades y Alianza Krece, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Rayito Money",
    "razon_social": "Rayito Money, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BAVOME",
    "razon_social": "Bavome, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Multiplicando para bien",
    "razon_social": "Multiplicando para Bien, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MEJORANDO TU ECONOMIA",
    "razon_social": "Mejorando Tú Economía, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "QUIRAZO",
    "razon_social": "Apoyos Inteligentes Quirazo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TABLETA FINANCIERA",
    "razon_social": "Tableta Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Tecnológico Confiar de México",
    "razon_social": "Grupo Tecnológico Confiar de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SACOGO",
    "razon_social": "SACOGO Soluciones Empresariales de Confianza, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Creando Capital",
    "razon_social": "Creando tu Ganancia, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lana Digital",
    "razon_social": "Lana Digital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRUPO JAFEL",
    "razon_social": "Grupo Jafel, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ARFEGA",
    "razon_social": "Arfega, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Parhelio",
    "razon_social": "Parhelio, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FLUYE FINANCIERA",
    "razon_social": "Fluye Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MTR CRECIMIENTO Y SOLUCIONES",
    "razon_social": "MTR Crecimiento y Soluciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Soluciones Financieras DCL",
    "razon_social": "Soluciones Financieras DCL, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Solvento",
    "razon_social": "Bocav, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Eleva Oportunidades",
    "razon_social": "Eleva Oportunidades, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INCREMENTANDO TU PATRIMONIO",
    "razon_social": "Incrementando Tú Patrimonio, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FORAWAY",
    "razon_social": "Foraway, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MHM CAPITAL",
    "razon_social": "PRTCH, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDIARIO7",
    "razon_social": "Nuestra Prioridad es Tú Bienestar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TMF Mexico SOFOM",
    "razon_social": "TMF MEXICO CMS, S.A.P.I. DE C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Accede",
    "razon_social": "Accede a Tus Sueños, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOLUCIONES INTEGRALES CALCOLEG",
    "razon_social": "Soluciones Integrales Calcoleg, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "aviva",
    "razon_social": "Aviva Financial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ALDEJ",
    "razon_social": "Doin Vest, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FLEXFIN CAPITAL",
    "razon_social": "Flexfin Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Creci Oportunidad",
    "razon_social": "Creci Oportunidad, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ANCAPITAL FINANCIERA",
    "razon_social": "Financiera Antara, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Torrubia",
    "razon_social": "Apoyos e Impulsos al Mexicano Trabajador, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Consolidando Esfuerzos",
    "razon_social": "Consolidando Esfuerzos en Emprendimiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Turrent",
    "razon_social": "Liga Turrent, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FUTURATE",
    "razon_social": "Futurate, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SILVER F&C",
    "razon_social": "Silver F&C, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FACILIDADES ACTIVAS",
    "razon_social": "Facilidades Activas, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VARODA",
    "razon_social": "Varoda, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Spenda",
    "razon_social": "Spenda, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Spica Capital",
    "razon_social": "Spica Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aghanar",
    "razon_social": "Grupo Aghanar Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Meta Servicios",
    "razon_social": "Meta Servicios Financieros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiamas",
    "razon_social": "Maydef, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RODA LATINOAMERICA",
    "razon_social": "Transcom Latinoamérica, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finetjal",
    "razon_social": "Finetjal, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "QUINTERHOL",
    "razon_social": "Quark International Holdings México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Black Horse Capital",
    "razon_social": "Black Horse Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GREENLINE",
    "razon_social": "Greenline Sociedad Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Maxivale",
    "razon_social": "Maxivale, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BURGOS FINANCIAL",
    "razon_social": "Burgos Financial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SUNPOR",
    "razon_social": "Sunpor, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IMPULSORA PRODECO",
    "razon_social": "Impulsora Prodeco, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Económika S",
    "razon_social": "Impulsando Capital S, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sialia",
    "razon_social": "Sialia, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Caften",
    "razon_social": "Caften, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ALATADRA",
    "razon_social": "Alatadra, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fast Track Billing",
    "razon_social": "Fast Track Billing, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Meta FS",
    "razon_social": "Meta FS, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LIQUIDEZ PARA TU PATRIMONIO",
    "razon_social": "Liquidez para Tú Patrimonio, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LENDMEX",
    "razon_social": "Grupo Lendmex, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRECIENDO",
    "razon_social": "Crecimiento Acelerado para Empresas en México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sunem Capital",
    "razon_social": "Sunem Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Takafin",
    "razon_social": "Takafin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INICIATIVA COMO SI",
    "razon_social": "Iniciativa Cómo Sí, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SXRONDA2",
    "razon_social": "Lobos Gestión Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KOMONI",
    "razon_social": "Negocios y Estrategias ABBSO, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tu Abono En Cuenta",
    "razon_social": "Administración Financiera SAM, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bold Moves",
    "razon_social": "Bold Moves, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AYUDA EXPRESS PARA TI",
    "razon_social": "Ayuda Express para Ti, S.A.P.I., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MOORE",
    "razon_social": "Enlace Moore, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ALPHALIONS",
    "razon_social": "Alphalions, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IMPARABLE",
    "razon_social": "Imparable Servicios Financieros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FUNDTREE",
    "razon_social": "Fundtree, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Akkadian Capital",
    "razon_social": "Akkadian Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CIVA",
    "razon_social": "CIVA Soluciones Hipotecarias, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sahara Finance",
    "razon_social": "Sahara Finance, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Credit Saison Mexico",
    "razon_social": "Credit Saison Mexico, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "WETOP",
    "razon_social": "Wetop, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PFESA SOLUCIONES EMPRESARIALES",
    "razon_social": "PFESA Soluciones Empresariales, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MONLINK",
    "razon_social": "Monlink, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRUPO PEDEX",
    "razon_social": "Grupo Pedex, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HIKUFI",
    "razon_social": "Hikufi, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FORZA FINANCIERA",
    "razon_social": "Forza Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GA SOLUCIONES",
    "razon_social": "GA Soluciones Financieras, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINCREER",
    "razon_social": "GLSC Financiera Fincreer, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alto Impacto",
    "razon_social": "Alto Impacto Rural, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Freedom to Scale / Fairplay",
    "razon_social": "Freedom To Scale, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRICING",
    "razon_social": "Pricing Klug, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OPORTUNIFY",
    "razon_social": "Oportunify, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Panks Brothers Co",
    "razon_social": "Panks Brothers Co, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRUPO FISURJA",
    "razon_social": "Grupo Fisurja, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vortice Capital",
    "razon_social": "Vortice Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINALIA",
    "razon_social": "Apoyo Findel Valle, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Apoyo Superior de México",
    "razon_social": "Apoyo Superior de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Holding World Company",
    "razon_social": "Holding World Company, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOLUCIONES EN PRESTAMOS IMADIE",
    "razon_social": "Soluciones en Préstamos Imadie, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SER AFÍN CONCRETANDO PROYECTOS",
    "razon_social": "Ser Afín Concretando Proyectos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Viabilidad Ejecutiva",
    "razon_social": "Viabilidad Ejecutiva, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IMPULSO GO",
    "razon_social": "Impulso Go, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIBSCO",
    "razon_social": "Fibsco, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AFFLUX GROWTH",
    "razon_social": "Afflux Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RUMHINRIKI",
    "razon_social": "Rumhinriki, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BLOCKFIN",
    "razon_social": "Blockfin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kapitaliza respalda tus sueños",
    "razon_social": "Kapitaliza Respalda Tus Sueños, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ECOPEM",
    "razon_social": "Ecopem, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SISU Institución Financiera",
    "razon_social": "SISU Institución Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DTC",
    "razon_social": "Consultores DTC, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fintegra Capital",
    "razon_social": "Fintegra Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Quiero Ganar",
    "razon_social": "Quiero Ganar, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIL",
    "razon_social": "Ancil, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DONOSTIA CAPITAL",
    "razon_social": "Donostia Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Solvencia de Capital",
    "razon_social": "Solvencia de Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "De La Mano Solidario",
    "razon_social": "Ezy, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RAMI ESTRATEGIAS",
    "razon_social": "RAMI Estrategias, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BONDEFI",
    "razon_social": "Bondefi, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gol SF",
    "razon_social": "Gol Servicios Financieros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Go 4u",
    "razon_social": "Go 4u, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Stallemerc",
    "razon_social": "Stallemerc, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IGAN",
    "razon_social": "Igan Incrementa tus Ganancias, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lemonade FS",
    "razon_social": "Lemonade FS, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "THAIN CREDIT",
    "razon_social": "Thain Credit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DIGITAL DECK",
    "razon_social": "Digital Deck, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AYADOS",
    "razon_social": "Ayados, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Navepol",
    "razon_social": "Navepol, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Tuvilar",
    "razon_social": "Tuvilar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KEEPING",
    "razon_social": "Keeping Partners, S.A.P.I. DE C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NAWI",
    "razon_social": "LME.3333, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ADE 2024",
    "razon_social": "ADE 2024, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RCT 2022",
    "razon_social": "RCT 2022, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nori",
    "razon_social": "Noriat, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SUREKEEP",
    "razon_social": "Surekeep, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "QREDIO SOLUCIONES",
    "razon_social": "Qredio Soluciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kaitz",
    "razon_social": "Kaitz, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ID LATAM 1",
    "razon_social": "International Disruption Latam 1, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PIMX",
    "razon_social": "PiMX Estrategia, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DERIVING THE FUTURE.",
    "razon_social": "Deriving The Future, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NOMCREDIT",
    "razon_social": "Vigo Kapital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grow your future",
    "razon_social": "Grow your future, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ACELERADORA PREMIER",
    "razon_social": "Aceleradora Premier, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INFIX",
    "razon_social": "Infix, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BAUBAP",
    "razon_social": "Baubap, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NDM&ECOMERCE HOLDING",
    "razon_social": "BTQ Tesoro, S.A.P.I. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nucleo Potencias",
    "razon_social": "Núcleo Potencias, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SP DYNAMIC",
    "razon_social": "SP Dynamic, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Ar Bienestrar",
    "razon_social": "Financiera Ar Bienestar, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PISTMX",
    "razon_social": "PISTMX, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TAVERON",
    "razon_social": "Taveron Solución Digital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Juntos Podemos Más",
    "razon_social": "Financiera Juntos Podemos Más, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BD CREDITO",
    "razon_social": "BD Crédito, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FEX CAPITAL",
    "razon_social": "FEX Capital Loans, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIERA DE CRÉDITO AGROINDUSTRIAL",
    "razon_social": "Financiera de Crédito Agroindustrial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "WISEMENT",
    "razon_social": "Wisement, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CFDM",
    "razon_social": "Créditos Formales de México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "D1 FINANCIAL",
    "razon_social": "D1 Financial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDIPRO",
    "razon_social": "Crédito Prospera CREDIPRO, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capital para tu Bienestar",
    "razon_social": "Capital para tu bienestar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fauser Capital",
    "razon_social": "Fauser Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TFS Capital",
    "razon_social": "TFS Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Emser Capital",
    "razon_social": "Emser Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ARLAV FINANCIERA",
    "razon_social": "Arlav Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Garantiza tu Futuro",
    "razon_social": "Garantiza tu Futuro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Optimus",
    "razon_social": "Optimus MGP, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "QUAESTUM",
    "razon_social": "Quaestum, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ROBSAN CREANDO VALOR",
    "razon_social": "Robsan Creando Valor, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KIPPON",
    "razon_social": "Kippon Ventures México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sinapsis, Impacto y Desarrollo Rural",
    "razon_social": "Sinapsis, Impacto y Desarrollo Rural, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRUPO HJV",
    "razon_social": "Grupo HJV, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crédito Empresarial Seguro Si",
    "razon_social": "Crédito Empresarial Seguro Si, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SIAN",
    "razon_social": "Servicios Integrales y Aceleradora del Norte, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Win Fin",
    "razon_social": "Operadora Fiji, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROINFRA",
    "razon_social": "Promotora Financiera de Proyectos de Infraestructura, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SEED",
    "razon_social": "SEED Sustentabilidad Estratégica Empresarial en Desarrollo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AYFS",
    "razon_social": "Ayuda Fácil, Soluciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ágil Financiera",
    "razon_social": "Financiamiento Ágil Especializado, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DOÑA MELQUI TE PRESTA",
    "razon_social": "Doña Melqui te Presta, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CERTIA",
    "razon_social": "Dinexus, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DIAM SUSTENTABLE",
    "razon_social": "Sustentable EYP, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDITOO SERVICIOS FINANCIEROS LATAM",
    "razon_social": "Creditoo Servicios Financieros Latam, SA de CV, SOFOM, ENR",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PLATAFORMA DE CREDITOS",
    "razon_social": "Plataforma de Créditos Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LLATY VENTURES",
    "razon_social": "LLATY VENTURES, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LIONWARD",
    "razon_social": "Ficuniam, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ORAG",
    "razon_social": "Orag Asesores, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ARMALOD",
    "razon_social": "Gestión y Servicios Armalod, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TU VAQUITA FINANCIERA",
    "razon_social": "Tu Vaquita Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BLANKFEIN",
    "razon_social": "Blankfein Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GARBO",
    "razon_social": "Garbo GSA México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINSICREDI",
    "razon_social": "Finsicredi, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SYMA",
    "razon_social": "Gadeleon. S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIERA KAIZEN",
    "razon_social": "Financiera Kaizen de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDIAMO",
    "razon_social": "Crediamo México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FEMAR",
    "razon_social": "Femar Estrategias, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CASHPITAL",
    "razon_social": "Cashpital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MONETIA",
    "razon_social": "GBN Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MORELCAMP",
    "razon_social": "Grupo Morelcamp, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HUBNESS",
    "razon_social": "Hubness, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SPARTAN VENTURES",
    "razon_social": "Spartan Ventures, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ACTIVOS AXXIS",
    "razon_social": "Activos Axxis, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DPC CAPITAL",
    "razon_social": "Apoyos HBP, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prime Money",
    "razon_social": "Prime Money, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MAXICONFIANZA",
    "razon_social": "Maxiconfianza, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capsofin",
    "razon_social": "Capsofin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SMART GAIN",
    "razon_social": "Smart Gain, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NEGOCIOS NT",
    "razon_social": "Negocios Financieros de Nueva Transformación, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NOVO OPCIONES",
    "razon_social": "Novo Opciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crédito para Crecer con México",
    "razon_social": "Crédito para Crecer con México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SENTAURUS",
    "razon_social": "Sentaurus Mayab Desarrollos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GOLDFY",
    "razon_social": "Goldfy, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OPORTUNIDAD TU PATRIMONIO",
    "razon_social": "Ven-Sumat, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RJ22",
    "razon_social": "RJ22, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SPLITVALUE",
    "razon_social": "Splitvalue, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "URIEOS",
    "razon_social": "Urieos, Alternativas, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JOYLEND",
    "razon_social": "Joylend, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AHORA MÁS",
    "razon_social": "Ahora Más, Alternativas, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Visión Duke",
    "razon_social": "Duke Financial Service, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "La abundancia en ti",
    "razon_social": "La Abundancia en Ti, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KVELLCHI",
    "razon_social": "Kvellchi, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PINEGRID MÉXICO",
    "razon_social": "Origon Payments, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KOTINOS",
    "razon_social": "Kótinos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BINMTEC",
    "razon_social": "Binmtec, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ABC",
    "razon_social": "Apoyo Básico Comercial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Colorines",
    "razon_social": "Financiera Colorines, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MAGNOCREDITO INTEGRAL",
    "razon_social": "Magnocrédito Integral, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LEVY FNC",
    "razon_social": "Levy FNC Group, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SIEF",
    "razon_social": "Servicios de Inclusión en Economía y Finanzas GAC, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDALIA",
    "razon_social": "Corporativo Grosel, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sinergia Financiera Alev",
    "razon_social": "Sinergia Financiera Alev, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ENERLENDING",
    "razon_social": "Enerlending, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CELULA CAPITAL",
    "razon_social": "Célula Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HRH 2022",
    "razon_social": "HRH 2022, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "STX FINANCIAL SERVICES",
    "razon_social": "STX Financial Services, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nolan",
    "razon_social": "Sociedad Innovadora en Soluciones para el Desarrollo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UNICREDIK",
    "razon_social": "Unicredik, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JAML Financial Services de México",
    "razon_social": "JAML Financial Services de México, S.A. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Denona",
    "razon_social": "Apoyos Denona, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AGRO IMPACTO",
    "razon_social": "Financiera Easy Credit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LEMAD CAPITAL",
    "razon_social": "Lemad Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PAZI",
    "razon_social": "Profinanza del Bajío, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRISTAL SERVICIOS FINANCIEROS",
    "razon_social": "Cristal Servicios Financieros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINTERPREST",
    "razon_social": "Finterprest, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "397 Cap",
    "razon_social": "397 Cap, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MXM",
    "razon_social": "Más x Menos Kapital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIERA MONETA",
    "razon_social": "Grupo Guanavo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FORTALEZA ABC",
    "razon_social": "Fortaleza ABC, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CORPORATIVO EMPRESARIAL VALKYRIAM",
    "razon_social": "Corporativo Empresarial Valkyriam, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BRETTON WOODS",
    "razon_social": "Bretton Woods, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SERVICIOS ADMINISTRATIVOS VALKYRIAM",
    "razon_social": "Servicios Administrativos Valkyriam, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Xaver Capital",
    "razon_social": "Xaver Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulso Más",
    "razon_social": "Build Cap, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DER & DER",
    "razon_social": "Der & Der Solutions, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Furaha",
    "razon_social": "Furaha, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONFI",
    "razon_social": "Conficreo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AINMTEC",
    "razon_social": "Ainmtec, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HABLEMOS DE DINERO",
    "razon_social": "Hablemos de Dinero, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Mexisur",
    "razon_social": "Financiera MEXISUR, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Marketplace de Préstamos",
    "razon_social": "Marketplace de Préstamos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IProgreso",
    "razon_social": "Ip Impulsando tu Progreso, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ID LATAM 2",
    "razon_social": "International Disruption Latam 2, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LanaYa",
    "razon_social": "Innova tu Cartera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MALRIC",
    "razon_social": "Dirección y Servicios del Norte MALRIC, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "cerium",
    "razon_social": "CE58, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "METACAP",
    "razon_social": "Metacap Soluciones Integrales de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SERVICIOS MEIICA",
    "razon_social": "Servicios MEIICA, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Hexágono Capital",
    "razon_social": "Hexágono Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LEASPLUS",
    "razon_social": "Leasplus, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ZORIONA",
    "razon_social": "Zoriona, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "APX SF",
    "razon_social": "APX SF, S.A. DE C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Planea y Prospera",
    "razon_social": "Planea y Prospera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIERA KAT$ER",
    "razon_social": "Financiera Katser, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OKTOGON TER",
    "razon_social": "Oktogon Ter, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PALINKA",
    "razon_social": "Palinka, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BTON 77",
    "razon_social": "Bton 77, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOCIOS EDFES",
    "razon_social": "Socios EDFES, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OLUFIN",
    "razon_social": "Olufin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Grupo Hydrangea",
    "razon_social": "Grupo Hydrangea, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HIT CARTER",
    "razon_social": "Hit Carter, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PR59",
    "razon_social": "PR59, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LA57",
    "razon_social": "LA57, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CERTAINTY WALL",
    "razon_social": "Certainty Wall, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INCREASE INTELLIGENT",
    "razon_social": "Increase Intelligent, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FLUP",
    "razon_social": "Flup, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MP FINANCIAL CAPITAL",
    "razon_social": "MP Financial Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prosperidad a tu Alcance",
    "razon_social": "Prosperidad a tu Alcance, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINASOFT",
    "razon_social": "Finasoft, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Newport Financial",
    "razon_social": "Newport Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CROMA CAPITAL",
    "razon_social": "Croma Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JKL82",
    "razon_social": "JKL82, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MONEYNOTION",
    "razon_social": "Moneynotion, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Creditable",
    "razon_social": "Creditable, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CC LATAM",
    "razon_social": "CC Latam, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONQUER",
    "razon_social": "Conquer Servicios Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PESO A PESO CREDIPYME",
    "razon_social": "Peso a Peso Credipyme, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IMPULSO Y BIENESTAR",
    "razon_social": "Impulso y Bienestar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Quantic Capital",
    "razon_social": "Quantic Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sumafin",
    "razon_social": "Sumafin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "QUICKCAP",
    "razon_social": "Quickcap, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOFIVEXT",
    "razon_social": "Sofivext, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Velo Crédito",
    "razon_social": "ATMX Tecnología, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AVANZADINERO",
    "razon_social": "Avanzadinero, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BAYUT",
    "razon_social": "Bayut, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Expendedora de Ganancia",
    "razon_social": "Expendedora de Ganancia, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FALCON FINANCIERA",
    "razon_social": "Falcon Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FRACTAL ANALÍTICA",
    "razon_social": "Fractal Analítica, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "WISER FINANCIERA",
    "razon_social": "Wiser Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PATRIMONIO Y SOLIDEZ",
    "razon_social": "Patrimonio y Solidez, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDINICIA",
    "razon_social": "Finser Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HI1LIGHT",
    "razon_social": "Hi1Light, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIXI",
    "razon_social": "Fixi, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AION",
    "razon_social": "Aion Sigma, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Digital Moneyboxmx",
    "razon_social": "Digital Moneyboxmx, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RAÍCES FINANCIERAS",
    "razon_social": "Fuerza Textil Guanajuato, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TESTAFIN",
    "razon_social": "Testafin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Horus Ildumos",
    "razon_social": "Horus Ildumos, S.A.P.I. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fácil Préstamo-Sin buró",
    "razon_social": "Peso Yuan, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BC Capital",
    "razon_social": "Brazo de Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SALETA",
    "razon_social": "Grupo Saleta Azteca, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TMX Financiera",
    "razon_social": "TMX Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MUJER ESTRELLA",
    "razon_social": "Grupo Lipsi y Asociados, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera ARGA Creciendo Juntos",
    "razon_social": "Nexalend, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Raise Financial",
    "razon_social": "Raise Financial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "THALER",
    "razon_social": "Thaler Standard, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INCOME PROPERTY",
    "razon_social": "Income Property Standard, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OCTOPUS BALLOON",
    "razon_social": "Octopus Balloon, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Espacio Cehecupi",
    "razon_social": "Espacio Cehecupi, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FNX CAPITAL",
    "razon_social": "FNX Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Almirante Capital",
    "razon_social": "Almirante Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EDARF",
    "razon_social": "Socios Edarf, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VALEFIA",
    "razon_social": "Servicios Financieros Valefia, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Gestione Produttiva",
    "razon_social": "Servicios González Marmolejo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRUPO VIANN FAST TRACK",
    "razon_social": "Grupo Viann Fast Track, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Yuhu",
    "razon_social": "Yuhu Maximizador de Sueldos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capitaliza Tu Retiro",
    "razon_social": "Retira y Suma a tu Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Sofersof",
    "razon_social": "Sofersof, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ENLACE PANAM",
    "razon_social": "Enlace Panam, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MAXI IMPULSO",
    "razon_social": "Maxi Impulso, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ELAGOLD",
    "razon_social": "Elagold, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EZ CRÉDITO",
    "razon_social": "Limón Tesoro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KARYVERSE",
    "razon_social": "Karyverse, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EPI SOLUCIONES FINANCIERAS",
    "razon_social": "EPI Soluciones Financieras, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KREDIQRO",
    "razon_social": "Krediqro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NUMBERS BOX",
    "razon_social": "Numbers Box, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AHORA TU, MAS",
    "razon_social": "Ahora Tú, Más, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PALM",
    "razon_social": "Palm Lending, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "QuePadre",
    "razon_social": "NBQ Technology México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SAVERLOOM",
    "razon_social": "Amador Tech, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ROBIN CAPITAL",
    "razon_social": "Robin Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IMPULSO CREATIVO LM",
    "razon_social": "Impulso Creativo LM, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BRICPORT",
    "razon_social": "Soluciones Bricport, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fema Servicios Financieros",
    "razon_social": "Fema Servicios Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANZAS ACERTIVAS",
    "razon_social": "Finanzas Acertivas, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "WATU",
    "razon_social": "Lendsof, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CLARITY CAPITAL",
    "razon_social": "Clarity Capital, S.A.P.I. de C.V., SOFOM, E.N.R",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FACTOR Q",
    "razon_social": "Factor Q, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROSPERA PLUS KPTL",
    "razon_social": "Prospera Plus KPTL, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Quantum Lion",
    "razon_social": "Quantum Lion, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Niubbe",
    "razon_social": "Niubbe, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alcancía Digital",
    "razon_social": "Alcancía Digital MX, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KINESIS CATALÍTICA",
    "razon_social": "Kinesis Catalítica, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VIENA 360",
    "razon_social": "Viena 360, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OLIMPO FACILITIES",
    "razon_social": "Olimpo Facilities, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ave",
    "razon_social": "Ave Márgenes de Eficiencia, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "L BA CAPITAL",
    "razon_social": "L BA Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINGO TECH CAPITAL",
    "razon_social": "Fingo Tech Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DIGICRED DE MÉXICO",
    "razon_social": "Digicred de México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CASHFLOW LOANS",
    "razon_social": "Cashflow Loans, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANSURGE",
    "razon_social": "Finansurge, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finloop",
    "razon_social": "Finloop, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINOVASPHERE",
    "razon_social": "Finovasphere, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TEMPLE CAPITAL",
    "razon_social": "Temple Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROVELOZ",
    "razon_social": "Proveloz, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Firma Mexicana de Apoyo al Emprendimiento S.A. de C.V., SOFOM, E.N.R.",
    "razon_social": "Firma Mexicana de Apoyo al Emprendimiento, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIDIPEC",
    "razon_social": "Fidipec, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Lantar Financiera",
    "razon_social": "Lantar Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GROW INSIDE",
    "razon_social": "Grow Inside, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROMOTOR PROACTIVO",
    "razon_social": "Promotor Proactivo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINADES",
    "razon_social": "Finades, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Capital Recio",
    "razon_social": "Capital Recio S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIDENTUM",
    "razon_social": "Fidentum, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PYMEARREND",
    "razon_social": "Pymearrend, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Limon Damm",
    "razon_social": "Grupo Limon Damm, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NOVA SQONE",
    "razon_social": "Nova Sqone, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Operaciones Ascendente",
    "razon_social": "Operaciones Ascendente, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CMC CAPITAL EN MOVIMIENTO",
    "razon_social": "CMC Capital en Movimiento y Crecimiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Industrias Avanzadas Viablex",
    "razon_social": "Industrias Avanzadas Viablex, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CASDIER",
    "razon_social": "Casdier del Sureste, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JHHD SERVICIOS DEL NORTE S.A., SOFOM, E.N.R.",
    "razon_social": "JHHD Servicios del Norte, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GHWX 777",
    "razon_social": "GHWX 777, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TROUVER K",
    "razon_social": "Trouver K, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Comunicación y Negociación",
    "razon_social": "Comunicación y Negociación Empresarial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIERA CYBORG",
    "razon_social": "Financiera Cyborg, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KC3 Capital",
    "razon_social": "KC3 Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EQUIFIRST",
    "razon_social": "Equifirst, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOLIDEZ ECONOMICA DEL NORTE",
    "razon_social": "Solidez Económica del Norte, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bogji Yusan",
    "razon_social": "Jun Ji-Hyun Servicios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Incentivando a Las Mujeres",
    "razon_social": "Incentivando a Las Mujeres, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDI TRANSFORMA",
    "razon_social": "Veridian, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ifin Capital",
    "razon_social": "Ifin Capital, S.A. de C.V., SOFOM E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LIMA YEDI",
    "razon_social": "Lima Yedi, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mad Inn Solutions",
    "razon_social": "Mad Inn Solutions, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DinDispo",
    "razon_social": "Optimal Empire, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ALTAR CI SOLUTIONS",
    "razon_social": "Altar CI Solutions, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ICUSA",
    "razon_social": "Industrias de Culiacán Productos y Servicios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KS CREDIT",
    "razon_social": "KS Credit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDIFIA",
    "razon_social": "Capifia, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SCC",
    "razon_social": "Soluciones Crediticias Complementarias, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DE ROSA MJ",
    "razon_social": "De Rosa MJ, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GOPJ",
    "razon_social": "Gopj, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LUZKY",
    "razon_social": "Loanex, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulsos y Protocolos",
    "razon_social": "Selecta Servicios Financieros S.A. de C.V. SOFOM ENR",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SLANA",
    "razon_social": "Pronto Fondeo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SITESCAPITAL",
    "razon_social": "Sitescapital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dundas",
    "razon_social": "Crecimiento Dundas, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OCÉANO FINANCIERO",
    "razon_social": "Océano Financiero, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FASTLOAN MEXICO",
    "razon_social": "Fastloan México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RSDA CONFIANZA",
    "razon_social": "RSDA Confianza, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AMER",
    "razon_social": "Amer Estrategias, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NEXUS FX",
    "razon_social": "Nexus FX, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OMNIWEALTH",
    "razon_social": "Omniwealth, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PUNTO ASCIENDE",
    "razon_social": "Punto Asciende, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ALIADO PATRIMONIAL",
    "razon_social": "Aliado Patrimonial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRARVOX",
    "razon_social": "Crarvox, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PREMOLTI",
    "razon_social": "Premolti, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SDG-HEADS",
    "razon_social": "SDG-Heads, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "creciendo juntos dezega",
    "razon_social": "Creciendo Juntos Dezega, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SMAC SERVICIOS PATRIMONIALES",
    "razon_social": "Smac Servicios Patrimoniales, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JyJ Beyond",
    "razon_social": "J&J Beyond, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Actividades ABC",
    "razon_social": "Actividades ABC, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GROUP SERZA CAPITAL",
    "razon_social": "Group Serza Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EMPRECAP",
    "razon_social": "Emprecap, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NUESTRO APOYO",
    "razon_social": "Servicios Financieros Colectivos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TRIPLE C CAPITAL CONFIANZA Y CREDIMIENTO",
    "razon_social": "Triple C Capital Confianza Crecimiento, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Rápidos y Efectivos",
    "razon_social": "Sumat E Impulsa Crecimiento, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ENDLESS MONEY",
    "razon_social": "Endless Money, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Cofre de Proyectos",
    "razon_social": "Cofre de Proyectos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MET@VERSO C@PITAL",
    "razon_social": "Metaverso Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINATEA",
    "razon_social": "Finatea, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SI FACTOR",
    "razon_social": "Flexicap, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nextpay Servicios",
    "razon_social": "Nextpay Servicios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TAORMINA",
    "razon_social": "Taormina Grupo Empresarial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Loan Cash",
    "razon_social": "Loan Cash, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INOFOM",
    "razon_social": "Inofom, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "QUANTUMWEALTH",
    "razon_social": "Quantumwealth, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Yapi",
    "razon_social": "Yapi Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROSEFIS CAPITAL",
    "razon_social": "Prosefis Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OACIS",
    "razon_social": "Sistema Integral de Capital, Asesoría y Orientación, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "YAGO APOYO",
    "razon_social": "Yago Apoyo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prestamaz",
    "razon_social": "Prestamaz Soluciones MZT, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRAXIRA",
    "razon_social": "Craxira, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fisra Negocios",
    "razon_social": "FISRA Negocios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JERJAN",
    "razon_social": "Jerjan, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CERCANIO",
    "razon_social": "Bugapex, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fabez Servicios",
    "razon_social": "Fabez Servicios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINLEAP",
    "razon_social": "Galaxtecnia, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RETEC",
    "razon_social": "Retec Alcance y Estrategia, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Red Solutions",
    "razon_social": "Soluciones Tecnológicas Farpay, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LIEBRES114",
    "razon_social": "Liebres114, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MOY CHIMALLI",
    "razon_social": "Consultores Moy Chimalli, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Somos Tu Soporte",
    "razon_social": "Somos Tu Soporte, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ESFERA COMUNITARIA SAPI DE CV SOFOM ENR",
    "razon_social": "Esfera Comunitaria, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CHF SOLUCION",
    "razon_social": "CHF Solución Comercial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LIFEWISE CAPITAL",
    "razon_social": "Lifewise Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VERTICE VILLAHERMOSA",
    "razon_social": "Vértice Villahermosa, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finguizet",
    "razon_social": "Finguizet, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ISACAP",
    "razon_social": "Isacap, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "WEALTHFUSION FINANCIAL",
    "razon_social": "Wealthfusion Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AMD HANDA CAPITAL",
    "razon_social": "AMD Handa Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ZEKERHEID",
    "razon_social": "Zekerheid Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GONDEAL FINANCIAL SERVICES",
    "razon_social": "Gondeal Financial Services, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DAGMO SOFOM",
    "razon_social": "Servicios Dagmo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LETGO",
    "razon_social": "Letgo Empresarial , S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prospera Con Nosotros",
    "razon_social": "Prospera Con Nosotros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INTER NOS LUCRUM",
    "razon_social": "Inter Nos Lucrum, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRATIAM CAPITALE",
    "razon_social": "Gratiam Capitale, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SAYO",
    "razon_social": "Solvendom, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Luka Sekiz",
    "razon_social": "Luka Sekiz, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ME ESTRATEGICA",
    "razon_social": "Me Estratégica, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SICA BECEA",
    "razon_social": "SICA Becea, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROSPECTRA FINANCIAL",
    "razon_social": "Prospectra Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "B11 INNOVACIÓN FINANCIERA",
    "razon_social": "B11 Innovación Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VFS",
    "razon_social": "Versatec Financial Solutions, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TSEDI",
    "razon_social": "Tsedi, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ZIRAAT",
    "razon_social": "Ziraat Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Bridge Horizon",
    "razon_social": "Bridge Horizon, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Disi Tecnología",
    "razon_social": "Disi Tecnología, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "V NEGOCIOS",
    "razon_social": "Finiva V Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TROI",
    "razon_social": "Asesoría Integral Troi, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "T-SOBRA",
    "razon_social": "T-Sobra, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impacto ASG",
    "razon_social": "Bill Defender, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRARFEX",
    "razon_social": "Crarfex, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JALPER",
    "razon_social": "River Jalpert, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AILEND CAPITAL",
    "razon_social": "Ailend Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CLICK TU ALIADO",
    "razon_social": "Click Tu Aliado, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ALFIL RDH",
    "razon_social": "Alfil RDH , S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GRUPO PROMOTOR HGC MEXICO",
    "razon_social": "Grupo Promotor HGC México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Once Capital",
    "razon_social": "Noblenest Financiero, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INCENTIVANDO CRECIMIENTO",
    "razon_social": "Incentivando Crecimiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LEASING TIM",
    "razon_social": "Tim Value, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VERSATILEFIN",
    "razon_social": "Versatilefin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GUELT",
    "razon_social": "Guelt, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DIFERSE",
    "razon_social": "Estrategias DIFERSE, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ADN",
    "razon_social": "ADN Capital Soluciones de Crédito, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ALTFIN",
    "razon_social": "Altfin Integral, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINLOGIC",
    "razon_social": "Finlogic, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CANDUB",
    "razon_social": "Impulso Candub, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SITIAN SOCIOS",
    "razon_social": "Sitian Socios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SERATH ESTRATEGIAS",
    "razon_social": "Serath Estrategias Empresariales, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRESTOFIABLE",
    "razon_social": "Prestofiable, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Siaelifin",
    "razon_social": "Siaelifin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOPHOMON",
    "razon_social": "Sophomon, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FISOCAP",
    "razon_social": "Fisocap, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ximple",
    "razon_social": "Finanzas Embebidas Ximple, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DOÑA BONANZA FINANCIERA",
    "razon_social": "Doña Bonanza Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINRISE",
    "razon_social": "Finrise, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DINAMICA SOLIDARIA",
    "razon_social": "Dinámica Solidaria, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRESTO WEALTH",
    "razon_social": "Presto Wealth, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HolaFina",
    "razon_social": "Nuwa Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NEO CREDITO INTELIGENTE",
    "razon_social": "Neo Crédito Inteligente, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INTERNATIONAL WK4U",
    "razon_social": "International WK4U, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FOE CRONOS",
    "razon_social": "Financiamiento y Oportunidad Económica Cronos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOLPAY",
    "razon_social": "Solpay, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ipanema",
    "razon_social": "Negocios de Ipanema, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TROPRESS",
    "razon_social": "Tropress, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vigor Capital",
    "razon_social": "Vigor Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Saldo Amigo",
    "razon_social": "Saldo Amigo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BALAUR",
    "razon_social": "Balaur, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Más Plenium",
    "razon_social": "Administradora de Dinero Popular, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRECIMIENTO CALCULADO",
    "razon_social": "Crecimiento Calculado, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MAKSIL FINANCIAL",
    "razon_social": "Maksil Financial, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aumentando tu Alcance",
    "razon_social": "Aumentando tu alcance, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alegra Servicios Financieros",
    "razon_social": "Alegra Servicios Financieros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LIBERACRE",
    "razon_social": "Liberacre, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Dram Capital",
    "razon_social": "Dram Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Maosa Financial",
    "razon_social": "Maosa Financial Services, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREAMIGAS CON SUERTE",
    "razon_social": "Creamigas Con Suerte, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CLARA",
    "razon_social": "CF Tech, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDIYES JM",
    "razon_social": "Crediyes JM, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "3A Decker",
    "razon_social": "3A Decker, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MORE SUPPORT",
    "razon_social": "More Support, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Deimos Credit",
    "razon_social": "Deimos Credit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kanan Capital",
    "razon_social": "Kanan Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DYNAMOFINANCE",
    "razon_social": "Dynamofinance, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Brico Credit",
    "razon_social": "Brico Credit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CISAP",
    "razon_social": "Corporación, Impulso de Servicios y Asesorías Patrimoniales, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MITO PROGRESO",
    "razon_social": "Mito Progreso, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "QUO3",
    "razon_social": "Protección Quo 3, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Corvus Aritmetic",
    "razon_social": "Corvus Aritmetic, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Plamigo",
    "razon_social": "Polinomio Económico de Occidente, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LENDITO",
    "razon_social": "Lendito, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AFFLUENTE FINANCIERO",
    "razon_social": "Affluente Financiero, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "QUANTUM",
    "razon_social": "Quantum Wealth Solutions, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ISTHAR & DIAZ ASOCIADOS",
    "razon_social": "Isthar & Díaz Asociados, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IFINAN",
    "razon_social": "Ifinan, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EFX",
    "razon_social": "EFX Estrategia y Financiamiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ausbaus Desarrollo",
    "razon_social": "Ausbaus Desarrollo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Total Trusts",
    "razon_social": "Total Equities and Trusts, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CESOG",
    "razon_social": "Cred Impulsamex Servicios Financieros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CARFICO SOFOM",
    "razon_social": "Carfico, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONECTEMOS JUNTOS",
    "razon_social": "Conectemos Junto Contigo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Regio",
    "razon_social": "Financiera Regio Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINARA",
    "razon_social": "Finara, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MONATO CAPITAL",
    "razon_social": "Monato Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SIB CREDIT",
    "razon_social": "Sib Credit, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EPPA PAYMENTS",
    "razon_social": "Eppa Payments, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIESPEL",
    "razon_social": "Soluciones Fiespel, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DAYTONA",
    "razon_social": "Daytona Soluciones Emprendedoras, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ARISTO",
    "razon_social": "Administradora Aristo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDINOX",
    "razon_social": "Credinox, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANMEX INDUSTRIAL",
    "razon_social": "Finanmex Industrial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROXICASH",
    "razon_social": "Proxicash, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Rami Sise",
    "razon_social": "Rami Sise, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SANA HOY",
    "razon_social": "Sana Hoy, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DALM ESTRATEGIAS",
    "razon_social": "DALM Estrategias Alternativas del Norte, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SENDIPAY",
    "razon_social": "Sendipay, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "STANDARD OIL FINANCIAL CAPITAL",
    "razon_social": "Standard Oil Financial Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VITALIA",
    "razon_social": "Vitalia Crecimiento Solidario, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SUSTENTABLE Y PRODUCTIVO",
    "razon_social": "Sustentable y Productivo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRESTAFLASH",
    "razon_social": "Prestaflash Crexpress, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Eduja Negen",
    "razon_social": "Eduja Negen, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "XCMG FINANCE",
    "razon_social": "XCMG Financial México, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Leriat",
    "razon_social": "Leriat, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Agilizando Tus Finanzas",
    "razon_social": "Agilizando Tus Finanzas, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Crédito Sin Fronteras",
    "razon_social": "Crédito Sin Fronteras, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRE DIARIO",
    "razon_social": "Cre Diario Financiero, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ENTURE FINANCIAL",
    "razon_social": "Enture Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MONATO STRATEGIC",
    "razon_social": "Monato Strategic Finance, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINLEARNING",
    "razon_social": "Finlearning, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LATINCREA",
    "razon_social": "Latincrea, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LAVER",
    "razon_social": "Laver Integral, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Targa Finance",
    "razon_social": "Targa Finance, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROYECTA SIN FRONTERAS",
    "razon_social": "Proyecta Sin Fronteras, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRESTOCLARO",
    "razon_social": "Prestoclaro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HSBKAULI",
    "razon_social": "Hsbkauli, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SEGUMEX",
    "razon_social": "Administradora Segumex, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRECES DYNAMIC",
    "razon_social": "Creces Dynamic, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulso Urbanizador Poniente",
    "razon_social": "Impulso Urbanizador Poniente, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ARV LIQUIDEZ",
    "razon_social": "Arv Liquidez, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ELAJA",
    "razon_social": "Elaja, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KARYX",
    "razon_social": "Karyx, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Prozpera y Crea S.A.P.I. de C.V., SOFOM, E.N.R.",
    "razon_social": "Prozpera y Crea, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINXICO FINANCIAL",
    "razon_social": "Finxico Financial Services, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PITIC CAPITAL",
    "razon_social": "Pitic Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONTE CAPITAL",
    "razon_social": "Conte Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Kredfeed",
    "razon_social": "Kashfeed, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GUMA CAPITAL",
    "razon_social": "Guma Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Perrone Financial",
    "razon_social": "Perrone Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Camino Certero",
    "razon_social": "Camino Certero, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MON CAPITAL",
    "razon_social": "Mon Soluciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROYECTO COMUNITARIO EN FINANZAS",
    "razon_social": "Proyecto Comunitario en Finanzas, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KONEKTA",
    "razon_social": "Elastar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EMPRENDIMIENTO ESTRATÉGICO",
    "razon_social": "Emprendimiento Estratégico MVMR, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DÉFICIT ZERO",
    "razon_social": "Déficit Zero, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "REGYSTAR",
    "razon_social": "Regystar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DYNAPAY",
    "razon_social": "Dynapay, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOYLEND",
    "razon_social": "Soylend, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONVENIA",
    "razon_social": "Convenia, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CASHIPRO",
    "razon_social": "Cashipro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SALOMON BROTHERS FC",
    "razon_social": "Salomón Brothers Financial Corporation, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Axus",
    "razon_social": "Axus Soluciones Empresariales, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SERVICIO FINANCIERO COMETA",
    "razon_social": "Servicio Financiero Cometa del Oriente, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINCIS",
    "razon_social": "Fincis, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Damasco",
    "razon_social": "Aceleradora Damasco, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRENOR",
    "razon_social": "Crenor, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Recursos Morh Capital",
    "razon_social": "Recursos Morh Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "WECOME",
    "razon_social": "Wecome, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BIENES Y RECURSOS",
    "razon_social": "Bienes y Recursos de Capital Inteligente, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROLENDERS",
    "razon_social": "Prolenders, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROFIRE, APOYANDO TU RETIRO",
    "razon_social": "Profire, Apoyando Tu Retiro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRECEMOS",
    "razon_social": "Cashmode, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ROCA",
    "razon_social": "Roca Impulsora de Proyectos, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRESEA CAPITAL",
    "razon_social": "Cresea Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDUX APPROVE",
    "razon_social": "Credux Approve, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TRESORIO",
    "razon_social": "Tresorio, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOVIGA MEXICO",
    "razon_social": "Soviga México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Axiona Capital",
    "razon_social": "Axiona Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DJ89",
    "razon_social": "DJ89, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ESPIRAL CONTIGO",
    "razon_social": "Espiral Contigo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Momentum Paraciclico",
    "razon_social": "Momentum Paraciclico, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAPIMAX",
    "razon_social": "Capimax, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDISSFERA",
    "razon_social": "Credissfera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GELD CAPITAL",
    "razon_social": "Dinero Ángel, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MAXICOIN",
    "razon_social": "Maxicoin, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fiser Interestellar",
    "razon_social": "Fiser Interestellar, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IT FINANCIERA",
    "razon_social": "IT Financiera Inmobiliaria, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINSATRI",
    "razon_social": "Finsatri, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRESTPOINT FINANCIAL",
    "razon_social": "Crestpoint Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EQUITYGO",
    "razon_social": "Equitygo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Alifin Capital",
    "razon_social": "Alifin Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BAILMAX",
    "razon_social": "Bailmax, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIERA VALER",
    "razon_social": "Financiera Valer, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aventum",
    "razon_social": "AVENTUM, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TU CRECIMIENTO",
    "razon_social": "Apoyo Tu Crecimiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IC33",
    "razon_social": "Ic33, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LOZARK EMPRENDIMIENTO",
    "razon_social": "Lozark Emprendimiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PAAR FINANCE",
    "razon_social": "Paar Finance, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Wiseye",
    "razon_social": "Wiseye, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIAREM",
    "razon_social": "Fiarem, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CASHORBIT",
    "razon_social": "Blackfisk Estructuras Financieras, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Inficap",
    "razon_social": "Inficap, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ABD FINANCIAL SERVICES",
    "razon_social": "ABD Financial Services, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CLEAR CAPITAL",
    "razon_social": "Clear Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PIN",
    "razon_social": "PIN1 Proyección de Ideas y Negocios 1, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LUZ EMPRENDIBLE",
    "razon_social": "Luz Emprendible, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDITO LUNA",
    "razon_social": "Crédito Luna, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOFONEXUS",
    "razon_social": "Sofonexus, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Oasis ORCHESTRATORS",
    "razon_social": "HAYCAPITAL, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aurea Pay",
    "razon_social": "Olimpia Assets, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "UBBA CAPITAL",
    "razon_social": "UBBA Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "POLYMATH VENTURES",
    "razon_social": "Ofi Ti, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GOTAPP",
    "razon_social": "Gotapp Servicios Financieros, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LANAFI",
    "razon_social": "Lanafi Crédito, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TRADEIFY",
    "razon_social": "Tradeify, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Siya Financiera",
    "razon_social": "Siya Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "WUTRICH ZBIDEN DE MEXICO",
    "razon_social": "Wutrich Zbiden de México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DALBARIA",
    "razon_social": "Dalbaria, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GROWNOW SERVICES N SOLUTIONS",
    "razon_social": "Grownow Services N Solutions, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EXPLORA ESTRATEGIAS",
    "razon_social": "Explora Estrategias, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FOMECADE",
    "razon_social": "Fomecade, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MEJORA TU FUTURO",
    "razon_social": "Mejora Tu Futuro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "STATEN ISLAND FINANCIAL SERVICES",
    "razon_social": "Staten Island Financial Services, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KAITO CAPITAL",
    "razon_social": "Kaito Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TRANSNATIONAL UNION OF ENTREPRENEURS",
    "razon_social": "Transnational Union of Entrepreneurs, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulso Florio",
    "razon_social": "Impulso Florio, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SICURO CAPITAL",
    "razon_social": "Sicuro Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BRUFIN",
    "razon_social": "Brufin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Total Sofom",
    "razon_social": "Total Bonds & Equity, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROFOCADE",
    "razon_social": "Profocade, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "N2426",
    "razon_social": "N2426, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "KAPITALEX FUND",
    "razon_social": "Kapitalex Soluciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FMDE",
    "razon_social": "Financiera Mexicana para el Desarrollo Empresarial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Proyectta",
    "razon_social": "Integradora Proyectta, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Catalica Luma",
    "razon_social": "Catalica Luma, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FISURESTE",
    "razon_social": "Fisureste, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIMEX CAPITAL",
    "razon_social": "Fimex Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Albedia Empresarial",
    "razon_social": "Albedia Empresarial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "K1k2k3 7,",
    "razon_social": "K1K2K3 7, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDICHIC",
    "razon_social": "Credichic, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nomioax",
    "razon_social": "Nomioax, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Duxi Finanzas",
    "razon_social": "Vertrauen Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ANMX",
    "razon_social": "ANMX Proyección de Negocios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CIENNA EMPRENDIMIENTO",
    "razon_social": "Cienna Emprendimiento, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulsos Modernos Industriales",
    "razon_social": "Impulsos Modernos Industriales, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIXFOM",
    "razon_social": "Fixfom, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TOV GOLD",
    "razon_social": "Tov Gold, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINNWORKS SERVICIOS DE LIQUIDEZ",
    "razon_social": "Finnworks Servicios de Liquidez, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SEEDS AND COUNTRY GARDEN",
    "razon_social": "Seeds and Country Garden, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OPERADORA TENLO CLARO",
    "razon_social": "Operadora Tenlo Claro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OCLID FINANCIERA",
    "razon_social": "Oclid Financiera, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAPITAL PARA EMPODERAR A LOS MEXICANOS",
    "razon_social": "Capital para Empoderar a los Mexicanos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRÉDITO VIVO",
    "razon_social": "Crédito Vivo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONMIGO EMPRENDE SOLUCIONES",
    "razon_social": "Conmigo Emprende Soluciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ASAFI",
    "razon_social": "Creamexhr, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TERCIA CAPITAL",
    "razon_social": "Tercia Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Altech",
    "razon_social": "Tecfar FRS, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "P&Q CONCEPTOS",
    "razon_social": "P&Q Conceptos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FORTALEZA AGUILA",
    "razon_social": "Fortaleza Águila, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GASCAP",
    "razon_social": "Gascap Soluciones, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Nexxus DP",
    "razon_social": "Nexxus Deuda Privada, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Baikal",
    "razon_social": "Baikal Financiera, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Integra08",
    "razon_social": "Integra 08, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NEXTVENTURE",
    "razon_social": "Nextventure, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDITOS SAN ANGEL",
    "razon_social": "Créditos San Ángel, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROFIT UP",
    "razon_social": "Profit Up, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BIG GOO",
    "razon_social": "Big Goo Tu Apoyo, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRECIENDO MÉXICO MANSKI",
    "razon_social": "Creciendo México Manski S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FORTALEZAS DE NEGOCIOS",
    "razon_social": "Fortaleza de Negocios de Occidente FGW, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DLP",
    "razon_social": "DLP Economy, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NAVI CRED",
    "razon_social": "Navi Cred, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Luom Parametric",
    "razon_social": "Luom Parametric, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Royalpocket",
    "razon_social": "Royalpocket, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOFOMIC",
    "razon_social": "Sofomic, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRECIMIENTO Y EVOLUCION",
    "razon_social": "Crecimiento y Evolución Patrimonial de México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "IMPULSO FINANCIERO GLOBALIZADO",
    "razon_social": "Impulso Financiero Globalizado, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "METAKANS",
    "razon_social": "Metakans, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CASCADAS Y NUECES",
    "razon_social": "Cascadas y Nueces, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINCA CAPITAL",
    "razon_social": "Finca Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ZELPRET FINANCIAL",
    "razon_social": "Zelpret Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JVS México Soluciones",
    "razon_social": "JVS México Soluciones, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SONIAL CAPITAL",
    "razon_social": "Sonial Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDITO CAMINO",
    "razon_social": "Crédito Camino, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRECIMIENTO OBS",
    "razon_social": "Crecimiento OBS, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOLUCIONES INTEGRALES DE FINANCIAMIENTO ALIADO",
    "razon_social": "Soluciones Integrales de Financiamiento Aliado, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Minu Bienestar",
    "razon_social": "Minu Bienestar, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OPTICRÉDITO",
    "razon_social": "Opticrédito, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Transparencia Eficaz",
    "razon_social": "Transparencia Eficaz, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Comitiva Fenix",
    "razon_social": "Comitiva Fenix, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "TRUSDELA",
    "razon_social": "Trusdela, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Esencial",
    "razon_social": "Financiera Esencial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "STRATIUM MÉXICO",
    "razon_social": "Stratium México, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ER CAPITAL SERVICES",
    "razon_social": "ER Capital Services, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Imagina y Crece",
    "razon_social": "Imagina y Crece, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BOOST CREDIT",
    "razon_social": "Boost Credit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OPORTUNIX",
    "razon_social": "Oportunix, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "GLOBAL SUMAT",
    "razon_social": "Global Sumat, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PRIME LENDER",
    "razon_social": "Prime Lender, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Regularizadora de Flujo",
    "razon_social": "Regularizadora de Flujo, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BOLKT",
    "razon_social": "Bolkt, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SUFINC",
    "razon_social": "Financiera Fortaleza para Tu Economía, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SEGURACREDIT",
    "razon_social": "Seguracredit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Volja",
    "razon_social": "Volja, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FX ADVANCE CAPITAL",
    "razon_social": "FX Advance Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIERA GMX",
    "razon_social": "Financiera GMX, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LIDERES EN CREDITO",
    "razon_social": "Líderes en Crédito, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONEXION EXPANSIVE",
    "razon_social": "Conexion Expansive, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ESTRATEGIAS ALUMAE",
    "razon_social": "Estrategias Alumae, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Impulsora Río Yaqui",
    "razon_social": "Impulsora Río Yaqui, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NUOVO SERVICIOS FINANCIEROS",
    "razon_social": "Nuovo Servicios Financieros, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "REGYNOVA",
    "razon_social": "Regynova, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ELANOVA",
    "razon_social": "Elanova, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAPITAL PETROLEUM",
    "razon_social": "Capital Petroleum Financial Services, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LENDLIGTH",
    "razon_social": "Lendligth, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Mejorando tu proyecto",
    "razon_social": "Mejorando Tu Proyecto, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Modelo Arima",
    "razon_social": "Modelo Arima, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "PROSPERARE FORTE",
    "razon_social": "Prosperare Forte, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Apex Financial",
    "razon_social": "Apex Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Neven",
    "razon_social": "Corporativo Neven CUU, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LOANVEX",
    "razon_social": "Loanvex, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Vasa Impulso Económico",
    "razon_social": "Aserfi Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EDLEASING",
    "razon_social": "Edleasing, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "DINAMO FINANCIERA SOCIAL",
    "razon_social": "Dinamo Financiera Social, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera Flores Serna",
    "razon_social": "Financiera Flores Serna, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AB7",
    "razon_social": "AB7 Servicios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "EAFS FINANCE",
    "razon_social": "Eafs Finance, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ALMUDENA FINANCIERA, S.A. de C.V. SOFOM E.N.R.",
    "razon_social": "Almudena Financiera S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Finzer Asesores Ejecutivos",
    "razon_social": "Finzer Asesores Ejecutivos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HUMADEUS",
    "razon_social": "Humadeus, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Baldo",
    "razon_social": "Baldo Te Resuelve, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Ventoria",
    "razon_social": "Ventoria, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FOÜCHE CAPITAL",
    "razon_social": "Fouche Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MEXICREDITO FIEL",
    "razon_social": "Mexicrédito Fiel, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "SOMOS LA FINANCIERA DE LOS MEXICANOS",
    "razon_social": "Somos la Financiera de los Mexicanos, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VENTURECRED",
    "razon_social": "Venturecred, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MAFINVAREL",
    "razon_social": "Mafinvarel, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LOGIN INCLUSION",
    "razon_social": "Login Inclusión, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "arrendadora erco",
    "razon_social": "Apex Partners, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "WALLET TU EXITO FINANCIERO",
    "razon_social": "Éxito en Tu Futuro, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LANAFAST",
    "razon_social": "Lanafast, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "ACCION EN FINANZAS",
    "razon_social": "Acción en Finanzas, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LATAM FINANCIAL COIN",
    "razon_social": "Latam Financial Coin, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MD TRANSCAPITAL",
    "razon_social": "MD Transcapital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FDG5",
    "razon_social": "FDG5 Servicios, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FIRME PYME",
    "razon_social": "Balank, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Financiera del Bienestar Mexicano",
    "razon_social": "Financiera del Bienestar Mexicano, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "JANUS CREDIT",
    "razon_social": "Firmeza y Solidez, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "STELLARA",
    "razon_social": "Stellara, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fatum Asymmetric",
    "razon_social": "Fatum Asymmetric, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Imola",
    "razon_social": "Imola Financial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MUTUR IMPULSA",
    "razon_social": "Mutur Impulsa, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FINANCIERA MEXICANA DE LA MUJER",
    "razon_social": "RSD Mexicano Sustentable, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "BIIYUL",
    "razon_social": "Biiyul, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CP03510",
    "razon_social": "CP03510, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CREDIKO",
    "razon_social": "Créditos para la Educación Crediko, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CAPITAL PARA EL CRECIMIENTO EMPRESARIAL",
    "razon_social": "Capital para el Crecimiento Empresarial, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Shichang Servicios",
    "razon_social": "Shichang Servicios, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "NORD GOLD",
    "razon_social": "Nord Gold, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "RISK CAPIMEX",
    "razon_social": "Risk Capimex, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "FULTAM",
    "razon_social": "Grupo Fultam, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fortia Credit",
    "razon_social": "Fortia Credit, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Fuerza MX",
    "razon_social": "El Valor de la Fuerza Mexicana, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CONEXION CENTAURO",
    "razon_social": "Conexión Centauro, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "VIROTECH",
    "razon_social": "Virotech, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CRECER Y GANAR",
    "razon_social": "Crecer y Ganar, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "HALXA",
    "razon_social": "Halxa, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MMOX",
    "razon_social": "Desarrollo de Proyectos MMOX, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "Aliados de Crédito",
    "razon_social": "Aliados de Crédito, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "MEXICREDIT 777",
    "razon_social": "Mexicredit 777, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "AMPARA CAPITAL",
    "razon_social": "Ampara Capital, S.A. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "OXION CAPITAL",
    "razon_social": "Oxion Capital, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "LEXIUM FINANCE",
    "razon_social": "Lexium Finance, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "INNOVALEND",
    "razon_social": "Innovalend, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  },
  {
    "nombre_comercial": "CMINT",
    "razon_social": "Cmint, S.A.P.I. de C.V., SOFOM, E.N.R.",
    "estado": "registrada",
    "terminos_buscados": [],
    "fecha_consulta": "30/10/2026",
    "sector": "Sociedades Financieras de Objeto Múltiple E.N.R.",
    "estatus": "En operación"
  }
];
function __hoy() {
  return new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric' });
}

const entrada = $input.first().json || {};
const resultado = __cargar('flujo/procesar').procesar({ extraccion: entrada.extraccion, tablaSipres: TABLA_SIPRES, hoy: __hoy() });
return [{ json: resultado }];
