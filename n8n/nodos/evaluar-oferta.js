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

  const coincidencias = tabla.filter((fila) => {
    if (!fila || typeof fila !== 'object') return false;
    const propios = [fila.nombre_comercial, fila.razon_social].map(terminos);
    return propios.some((p) => nombres.some((n) => coincide(n, p)));
  });
  if (coincidencias.length === 0) return sinVerificar('no_esta_en_tabla');

  const estados = new Set(coincidencias.map((f) => f.estado));
  if (estados.size !== 1 || !ESTADOS.includes(coincidencias[0].estado)) {
    return sinVerificar('coincidencias_contradictorias', { advertencias: ['coincidencias_ambiguas'] });
  }

  const fila = coincidencias[0];
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
      return `✅ ${entidad ? `${entidad}: aparece` : 'Aparece'} registrada en el SIPRES de Condusef${fecha ? ` (consulta del ${fecha})` : ''}.`;
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
  elegirRespuesta,
  mensajes,
  AVISO_CAT,
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

const TABLA_SIPRES = [];
function __hoy() {
  return new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric' });
}

const entrada = $input.first().json || {};
const resultado = __cargar('flujo/procesar').procesar({ extraccion: entrada.extraccion, tablaSipres: TABLA_SIPRES, hoy: __hoy() });
return [{ json: resultado }];
