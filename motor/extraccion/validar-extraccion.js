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
