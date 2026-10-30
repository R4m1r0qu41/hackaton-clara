'use strict';

/**
 * Genera el código de los nodos Code de n8n y los workflows que lo usan, a partir de `motor/`.
 *
 *   node scripts/empaquetar.js              escribe n8n/nodos/*.js y n8n/workflows/*.json
 *   node scripts/empaquetar.js --verificar  no escribe: sale con error si lo generado quedó desactualizado
 *
 * El nodo Code de n8n no puede cargar archivos ni módulos, así que cada nodo lleva dentro, en un solo
 * texto, los módulos que necesita y un `require` mínimo para que se encuentren entre sí. La tabla de
 * SIPRES (`datos/procesado/sipres_entidades.json`) se embebe en el código; si no es válida, no se
 * empaqueta nada. Lo generado no se edita a mano: se cambia el módulo y se vuelve a generar. Una prueba
 * avisa si quedó desactualizado.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validarTabla } = require('../motor/sipres/sipres');

const RAIZ = path.resolve(__dirname, '..');
const RUTA_TABLA = path.join(RAIZ, 'datos', 'procesado', 'sipres_entidades.json');
const RUTA_NODOS = path.join(RAIZ, 'n8n', 'nodos');
const RUTA_WORKFLOWS = path.join(RAIZ, 'n8n', 'workflows');

const MODULOS = {
  evaluar: ['sipres/sipres', 'calculo/calculo', 'semaforo/semaforo', 'extraccion/validar-extraccion', 'respuesta/respuesta', 'flujo/procesar'],
  verificar: ['sipres/sipres', 'respuesta/respuesta'],
  elegir: ['respuesta/respuesta'],
};

const PRELUDIO = `const __fabricas = {};
const __cache = {};
function __resolver(desde, especificador) {
  const partes = desde.split('/').slice(0, -1);
  for (const parte of especificador.split('/')) {
    if (parte === '..') partes.pop();
    else if (parte !== '.') partes.push(parte);
  }
  return partes.join('/').replace(/\\.js$/, '');
}
function __cargar(ruta) {
  if (!__cache[ruta]) {
    const modulo = { exports: {} };
    __cache[ruta] = modulo;
    __fabricas[ruta](modulo, modulo.exports, (especificador) => __cargar(__resolver(ruta, especificador)));
  }
  return __cache[ruta].exports;
}`;

const HOY = `function __hoy() {
  return new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric' });
}`;

const leerFuente = (ruta) => fs.readFileSync(path.join(RAIZ, 'motor', `${ruta}.js`), 'utf8').replace(/\r\n/g, '\n').trimEnd();

function empaquetar({ nodo, modulos, cuerpo }) {
  return (
    [
      '// GENERADO por scripts/empaquetar.js. No lo edites aquí: cambia el módulo en motor/ y vuelve a generar.',
      `// Nodo Code de n8n: "${nodo}". Modo "Run Once for All Items", lenguaje JavaScript.`,
      '',
      PRELUDIO,
      '',
      ...modulos.map((ruta) => `__fabricas[${JSON.stringify(ruta)}] = function (module, exports, require) {\n${leerFuente(ruta)}\n};\n`),
      cuerpo,
    ].join('\n') + '\n'
  );
}

const tablaEmbebida = (tabla) => `const TABLA_SIPRES = ${JSON.stringify(tabla, null, 2)};`;

const cuerpoEvaluar = (tabla) => `${tablaEmbebida(tabla)}
${HOY}

const entrada = $input.first().json || {};
const resultado = __cargar('flujo/procesar').procesar({ extraccion: entrada.extraccion, tablaSipres: TABLA_SIPRES, hoy: __hoy() });
return [{ json: resultado }];`;

const cuerpoVerificar = (tabla) => `${tablaEmbebida(tabla)}

const entrada = $input.first().json || {};
const consulta = typeof entrada.q === 'string' ? entrada.q.slice(0, 200) : '';
const resultado = __cargar('sipres/sipres').buscarEntidad(TABLA_SIPRES, { nombre_comercial: consulta });
const texto = __cargar('respuesta/respuesta').mensajes.verificacion(resultado);
return [{ json: { ...resultado, texto } }];`;

const cuerpoElegir = () => `const entrada = $input.first().json || {};
const resultado = __cargar('respuesta/respuesta').elegirRespuesta(entrada.texto, entrada.ctx || null);
return [{ json: resultado }];`;

// Datos de ejemplo para la prueba manual de cada workflow. Son inventados: no hay datos de personas.
const EXTRACCION_EJEMPLO = {
  tipo_entrada: 'etiqueta_tienda',
  confianza_extraccion: 0.9,
  producto: { descripcion: 'Producto de ejemplo', precio_contado: 10000, tienda: 'Tienda de ejemplo' },
  credito: {
    otorgante_nombre_comercial: null,
    otorgante_razon_social: null,
    monto_ofrecido: null,
    monto_depositado: null,
    enganche: 0,
    abono: 1000,
    periodicidad: 'mensual',
    numero_pagos: 11,
    plazo_dias: null,
    monto_total_a_pagar: null,
    comisiones: [],
    seguros: [],
    cat_publicado: null,
  },
  senales_riesgo: {
    pide_anticipo: false,
    pide_permiso_contactos: false,
    pide_permiso_fotos_archivos: false,
    deposito_menor_a_ofrecido: false,
    plazo_menor_a_15_dias: false,
    presion_urgencia: false,
    texto_evidencia: [],
  },
  datos_faltantes: [],
};

const identificador = (...partes) => {
  const h = crypto.createHash('sha1').update(partes.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

/** Workflow que otro workflow (o una herramienta del agente) puede llamar, con una prueba manual que ya trae datos. */
function construirWorkflow({ nombre, clave, nombreNodo, campos, ejemplo, codigo }) {
  const disparador = 'Cuando lo llama otro workflow';
  const prueba = 'Prueba manual';
  const hacia = [[{ node: nombreNodo, type: 'main', index: 0 }]];
  const workflow = {
    id: crypto.createHash('sha1').update(clave).digest('hex').slice(0, 16),
    name: nombre,
    nodes: [
      {
        parameters: { inputSource: 'jsonExample', jsonExample: JSON.stringify(campos, null, 2) },
        id: identificador(clave, disparador),
        name: disparador,
        type: 'n8n-nodes-base.executeWorkflowTrigger',
        typeVersion: 1.1,
        position: [0, 0],
      },
      { parameters: {}, id: identificador(clave, prueba), name: prueba, type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200] },
      {
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: codigo },
        id: identificador(clave, nombreNodo),
        name: nombreNodo,
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [320, 100],
      },
    ],
    connections: { [disparador]: { main: hacia }, [prueba]: { main: hacia } },
    pinData: { [prueba]: [{ json: ejemplo }] },
    active: false,
    settings: {
      executionOrder: 'v1',
      saveDataErrorExecution: 'none',
      saveDataSuccessExecution: 'none',
      saveManualExecutions: false,
      saveExecutionProgress: false,
    },
  };
  return JSON.stringify(workflow, null, 2) + '\n';
}

/** Construye en memoria todos los archivos generados. No escribe nada. */
function construirTodo({ tablaSipres }) {
  const problemas = validarTabla(tablaSipres);
  if (problemas.length > 0) throw new Error(`La tabla de SIPRES no es válida:\n${problemas.join('\n')}`);

  const nodos = {
    'evaluar-oferta.js': empaquetar({ nodo: 'Evaluar oferta', modulos: MODULOS.evaluar, cuerpo: cuerpoEvaluar(tablaSipres) }),
    'verificar-entidad.js': empaquetar({ nodo: 'Verificar entidad', modulos: MODULOS.verificar, cuerpo: cuerpoVerificar(tablaSipres) }),
    'elegir-respuesta.js': empaquetar({ nodo: 'Elegir respuesta', modulos: MODULOS.elegir, cuerpo: cuerpoElegir() }),
  };
  const workflows = {
    'evaluar-oferta.json': construirWorkflow({
      nombre: 'Crédito Claro · evaluar_oferta',
      clave: 'evaluar-oferta',
      nombreNodo: 'Evaluar oferta',
      campos: { extraccion: 'texto JSON con la extracción de la oferta' },
      ejemplo: { extraccion: JSON.stringify(EXTRACCION_EJEMPLO) },
      codigo: nodos['evaluar-oferta.js'],
    }),
    'verificar-entidad.json': construirWorkflow({
      nombre: 'Crédito Claro · verificar_entidad',
      clave: 'verificar-entidad',
      nombreNodo: 'Verificar entidad',
      campos: { q: 'nombre de la entidad' },
      ejemplo: { q: 'Entidad de ejemplo' },
      codigo: nodos['verificar-entidad.js'],
    }),
  };
  return { nodos, workflows };
}

function leerTabla(ruta = RUTA_TABLA) {
  if (!fs.existsSync(ruta)) throw new Error(`No existe la tabla de SIPRES: ${ruta}`);
  let tabla;
  try {
    tabla = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    throw new Error(`La tabla de SIPRES no es JSON válido: ${ruta}`);
  }
  const problemas = validarTabla(tabla);
  if (problemas.length > 0) throw new Error(`La tabla de SIPRES no es válida (${ruta}):\n${problemas.join('\n')}`);
  return tabla;
}

function principal(argumentos) {
  const soloVerificar = argumentos.includes('--verificar');
  const { nodos, workflows } = construirTodo({ tablaSipres: leerTabla() });
  const archivos = [
    ...Object.entries(nodos).map(([nombre, contenido]) => [path.join(RUTA_NODOS, nombre), contenido]),
    ...Object.entries(workflows).map(([nombre, contenido]) => [path.join(RUTA_WORKFLOWS, nombre), contenido]),
  ];
  const cambiados = [];
  for (const [ruta, contenido] of archivos) {
    const actual = fs.existsSync(ruta) ? fs.readFileSync(ruta, 'utf8') : null;
    if (actual === contenido) continue;
    cambiados.push(path.relative(RAIZ, ruta));
    if (!soloVerificar) {
      fs.mkdirSync(path.dirname(ruta), { recursive: true });
      fs.writeFileSync(ruta, contenido);
    }
  }
  if (soloVerificar) {
    if (cambiados.length === 0) console.log('Todo está al día.');
    else console.error(`Desactualizados (corre node scripts/empaquetar.js):\n${cambiados.map((c) => `- ${c}`).join('\n')}`);
    return cambiados.length === 0 ? 0 : 1;
  }
  console.log(cambiados.length === 0 ? 'Sin cambios.' : `Escritos:\n${cambiados.map((c) => `- ${c}`).join('\n')}`);
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

module.exports = { construirTodo, leerTabla, RAIZ, RUTA_TABLA, RUTA_NODOS, RUTA_WORKFLOWS };
