'use strict';

/**
 * Rutas del servidor.
 *
 * Esta versión devuelve RESPUESTAS DE EJEMPLO (origen: "ejemplo") con la forma del contrato del plan,
 * para que n8n y la página se construyan en paralelo. Nada de lo que devuelve es un dato real: los
 * nombres, las fechas y las cifras son ilustrativos. El motor real sustituye a cada manejador sin
 * cambiar la forma de la respuesta.
 *
 * Cada ruta: { metodo, ruta, protegida, manejar({ url, cuerpo, config }) } y devuelve el objeto JSON
 * de la respuesta 200, o lanza ErrorHttp.
 */

const FECHA_EJEMPLO = '30/10/2026';
const MAX_TEXTO = 5000;

class ErrorHttp extends Error {
  constructor(estado, codigo, mensaje) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

const ENTIDADES_EJEMPLO = [
  {
    nombre_comercial: 'Entidad de Ejemplo',
    razon_social: null,
    estado: 'registrada',
    terminos_buscados: ['entidad de ejemplo'],
    fecha_consulta: FECHA_EJEMPLO,
  },
];

const ESTADOS_EJEMPLO = [
  { estado_id: 'EJ-01', nombre: 'Estado de ejemplo 1', valor: null },
  { estado_id: 'EJ-02', nombre: 'Estado de ejemplo 2', valor: null },
];

function normalizar(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function exigirObjeto(cuerpo) {
  if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    throw new ErrorHttp(400, 'entrada_invalida', 'El cuerpo debe ser un objeto JSON.');
  }
  return cuerpo;
}

function exigirTexto(valor, campo) {
  if (typeof valor !== 'string' || !valor.trim()) {
    throw new ErrorHttp(400, 'entrada_invalida', `Falta el campo ${campo}.`);
  }
  if (valor.length > MAX_TEXTO) {
    throw new ErrorHttp(400, 'entrada_invalida', `El campo ${campo} excede ${MAX_TEXTO} caracteres.`);
  }
  return valor;
}

const rutas = [
  {
    metodo: 'GET',
    ruta: '/api/salud',
    protegida: false,
    manejar: ({ config }) => ({ ok: true, modo: 'ejemplo', ia: config.iaActiva, datos_al: FECHA_EJEMPLO }),
  },
  {
    // Sustituye al nodo Code "Procesar" de n8n. Sin la forma real de salidaLLM, solo se exige que venga.
    metodo: 'POST',
    ruta: '/api/procesar',
    protegida: true,
    manejar: ({ cuerpo }) => {
      const entrada = exigirObjeto(cuerpo);
      if (entrada.salidaLLM === undefined) {
        throw new ErrorHttp(400, 'entrada_invalida', 'Falta el campo salidaLLM.');
      }
      return {
        accion: 'redactar',
        ctx: { ejemplo: true },
        plantilla: 'Respuesta de ejemplo: el cálculo real todavía no está conectado.',
        log: { fecha: FECHA_EJEMPLO, tipo_entrada: 'oferta_credito', semaforo: 'gris', estado_sipres: 'sin_verificar' },
        advertencias: ['respuesta_de_ejemplo'],
      };
    },
  },
  {
    // Sustituye al nodo Code "Elegir respuesta" de n8n.
    metodo: 'POST',
    ruta: '/api/elegir-respuesta',
    protegida: true,
    manejar: ({ cuerpo }) => {
      const entrada = exigirObjeto(cuerpo);
      if (entrada.ctx === null || typeof entrada.ctx !== 'object') {
        throw new ErrorHttp(400, 'entrada_invalida', 'Falta el campo ctx.');
      }
      return {
        texto: 'Respuesta de ejemplo (plantilla): el verificador real todavía no está conectado.',
        origen: 'plantilla',
        motivo: 'ejemplo',
        fallas: [],
      };
    },
  },
  {
    // Para la página. No se repite el texto del usuario en la respuesta.
    metodo: 'POST',
    ruta: '/api/consulta',
    protegida: false,
    manejar: ({ cuerpo }) => {
      exigirTexto(exigirObjeto(cuerpo).texto, 'texto');
      return {
        texto: 'Respuesta de ejemplo: el motor real todavía no está conectado.',
        origen: 'ejemplo',
        color: 'gris',
        estado_sipres: 'sin_verificar',
        motivo: 'ejemplo',
        advertencias: ['respuesta_de_ejemplo'],
      };
    },
  },
  {
    // Que una entidad no esté en la tabla da sin_verificar, nunca "no registrada".
    metodo: 'GET',
    ruta: '/api/verificar',
    protegida: false,
    manejar: ({ url }) => {
      const consulta = normalizar(exigirTexto(url.searchParams.get('q'), 'q'));
      const fila = consulta.length >= 3
        ? ENTIDADES_EJEMPLO.find((e) => normalizar(e.nombre_comercial).includes(consulta))
        : undefined;
      if (!fila) {
        return {
          estado: 'sin_verificar',
          fecha_consulta: null,
          terminos_buscados: [],
          entidad: null,
          motivo: 'no_esta_en_tabla',
          advertencias: [],
        };
      }
      return {
        estado: fila.estado,
        fecha_consulta: fila.fecha_consulta,
        terminos_buscados: fila.terminos_buscados,
        entidad: fila.nombre_comercial,
        motivo: 'ok',
        advertencias: ['dato_de_ejemplo'],
      };
    },
  },
  {
    metodo: 'GET',
    ruta: '/api/acceso/estados',
    protegida: false,
    manejar: () => ({
      ejemplo: true,
      indicador: 'Dato de ejemplo',
      unidad: null,
      periodo: null,
      fuente_url: null,
      estados: ESTADOS_EJEMPLO,
    }),
  },
  {
    metodo: 'GET',
    ruta: '/api/acceso',
    protegida: false,
    manejar: ({ url }) => {
      const id = exigirTexto(url.searchParams.get('estado'), 'estado');
      const estado = ESTADOS_EJEMPLO.find((e) => e.estado_id === id);
      if (!estado) throw new ErrorHttp(404, 'estado_no_encontrado', 'No hay un estado con ese id.');
      return { ejemplo: true, ...estado, indicador: 'Dato de ejemplo', periodo: null, fuente_url: null };
    },
  },
];

module.exports = { rutas, ErrorHttp };
