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
const RUTA_PROMPT = path.join(RAIZ, 'n8n', 'prompts', 'agente-system.md');

const MODULOS = {
  evaluar: ['sipres/sipres', 'calculo/calculo', 'semaforo/semaforo', 'extraccion/validar-extraccion', 'respuesta/respuesta', 'flujo/procesar'],
  verificar: ['sipres/sipres', 'respuesta/respuesta'],
  elegir: ['respuesta/respuesta', 'flujo/salida'],
  mensaje: ['respuesta/respuesta', 'flujo/mensaje'],
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

// La salida del nodo Agente trae `output` y, con returnIntermediateSteps, `intermediateSteps`. Si el agente falló
// y el nodo sigue en modo "continuar", trae `error`.
const cuerpoElegir = () => `const entrada = $input.first().json || {};
const resultado = __cargar('flujo/salida').elegirSalida({ texto: entrada.output, pasos: entrada.intermediateSteps, error: entrada.error });
return [{ json: resultado }];`;

const cuerpoClasificar = () => `const entrada = $input.first().json || {};
return [{ json: __cargar('flujo/mensaje').clasificarMensaje(entrada) }];`;

const cuerpoMensajeFijo = () => `const entrada = $input.first().json || {};
return [{ json: { texto: __cargar('flujo/mensaje').textoFijo(entrada.mensaje) } }];`;

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

const idWorkflow = (clave) => crypto.createHash('sha1').update(clave).digest('hex').slice(0, 16);

const AJUSTES = {
  executionOrder: 'v1',
  saveDataErrorExecution: 'none',
  saveDataSuccessExecution: 'none',
  saveManualExecutions: false,
  saveExecutionProgress: false,
};

/** Workflow que otro workflow (o una herramienta del agente) puede llamar, con una prueba manual que ya trae datos. */
function construirWorkflow({ nombre, clave, nombreNodo, campos, ejemplo, codigo }) {
  const disparador = 'Cuando lo llama otro workflow';
  const prueba = 'Prueba manual';
  const hacia = [[{ node: nombreNodo, type: 'main', index: 0 }]];
  const workflow = {
    id: idWorkflow(clave),
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
    settings: { ...AJUSTES },
  };
  return JSON.stringify(workflow, null, 2) + '\n';
}

const DESCRIPCION_EVALUAR =
  'Calcula el costo real, el CAT estimado y el semáforo de una oferta de crédito o de una etiqueta de tienda a abonos. ' +
  'Recibe en "extraccion" el objeto JSON con los datos extraídos del texto de la persona. ' +
  'Devuelve el resultado ya calculado o la pregunta que falta.';
const DESCRIPCION_VERIFICAR =
  'Busca una entidad por nombre en la tabla de SIPRES de Condusef. Recibe en "q" el nombre de la entidad. ' +
  'Devuelve su estado, la fecha de consulta y el mensaje para la persona.';
const DESCRIPCION_RAG =
  'Busca en los documentos cargados (comparativos de tarjetas) y devuelve fragmentos con su archivo y página. ' +
  'Úsala para preguntas generales, no para evaluar una oferta. Recibe la pregunta de la persona.';
// Servicio RAG de la rama Eugenio: POST /query con clave de portador y { query, topK }. `rag` es su nombre dentro de la
// red de Docker que crea su compose (hackaton-clara-rag); el contenedor de n8n debe estar conectado a esa red.
// La clave se guarda en n8n como credencial Header Auth: nombre `Authorization`, valor `Bearer <RAG_API_KEY>`.
const URL_RAG = 'http://rag:3000/query';
const DESCRIPCION_LISTAR_RECA =
  'Lista los contratos de adhesión del RECA (Registro de Contratos de Adhesión de Condusef) que hay disponibles, ' +
  'con su número de registro, nombre del producto e institución. Úsala para saber qué contratos existen y obtener ' +
  'el número de registro que necesita consultar_reca. No recibe parámetros.';
const DESCRIPCION_CONSULTAR_RECA =
  'Busca en un contrato RECA concreto y devuelve fragmentos con su registro, cláusula y fuente. Recibe en ' +
  'registroReca el número de registro (sale de listar_reca) y en query la pregunta de la persona sobre ese contrato ' +
  '(comisiones, cláusulas, penalizaciones). Sin el registro, llama primero a listar_reca.';
const URL_RECA_LISTA = 'http://rag:3000/reca/productos';
const AYUDA_CAMPO = { extraccion: 'texto JSON con los datos extraídos de la oferta', q: 'nombre de la entidad a buscar' };

const nodoCodigo = (nombre, codigo, posicion) => ({
  parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: codigo },
  id: identificador('bot', nombre),
  name: nombre,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: posicion,
});

function nodoHerramienta({ nombre, descripcion, subworkflow, campo, posicion }) {
  return {
    parameters: {
      name: nombre,
      description: descripcion,
      source: 'database',
      workflowId: { __rl: true, value: idWorkflow(subworkflow), mode: 'id' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: { [campo]: `={{ $fromAI('${campo}', '${AYUDA_CAMPO[campo]}', 'string') }}` },
        matchingColumns: [],
        schema: [{ id: campo, displayName: campo, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string', removed: false }],
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
    },
    id: identificador('bot', nombre),
    name: nombre,
    type: '@n8n/n8n-nodes-langchain.toolWorkflow',
    typeVersion: 2.2,
    position: posicion,
  };
}

const reglaDeRuta = (salida) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: identificador('bot', 'regla', salida), leftValue: '={{ $json.ruta }}', rightValue: salida, operator: { type: 'string', operation: 'equals' } }],
    combinator: 'and',
  },
  renameOutput: true,
  outputKey: salida,
});

const hacia = (...nodos) => nodos.map((node, i) => [{ node, type: 'main', index: i }]);
const aIA = (tipo) => ({ [tipo]: [[{ node: 'Agente', type: tipo, index: 0 }]] });

/**
 * Workflow principal del bot: Telegram, ruteo, agente con sus herramientas y verificador final.
 * Sin credenciales: se asignan en n8n (Telegram y DeepSeek). El modelo debe soportar llamadas a herramientas.
 */
function construirBot({ codigos, instrucciones }) {
  // Cada ejecución procesa una sola actualización de Telegram: `.first()` no depende del emparejamiento de ítems.
  const alChat = "={{ $('Clasificar mensaje').first().json.chat_id }}";
  const nodos = [
    { parameters: { updates: ['message'], additionalFields: {} }, id: identificador('bot', 'Telegram Trigger'), name: 'Telegram Trigger', type: 'n8n-nodes-base.telegramTrigger', typeVersion: 1.5, position: [0, 300], webhookId: identificador('bot', 'webhook') },
    nodoCodigo('Clasificar mensaje', codigos.clasificar, [260, 300]),
    {
      parameters: { rules: { values: ['fijo', 'verificar', 'texto'].map(reglaDeRuta) }, options: {} },
      id: identificador('bot', 'Ruta'),
      name: 'Ruta',
      type: 'n8n-nodes-base.switch',
      typeVersion: 3.2,
      position: [520, 300],
    },
    nodoCodigo('Mensaje fijo', codigos.mensajeFijo, [800, 100]),
    nodoCodigo('Verificar entidad', codigos.verificar, [800, 300]),
    {
      parameters: { promptType: 'define', text: '={{ $json.texto }}', options: { systemMessage: instrucciones, returnIntermediateSteps: true, maxIterations: 6 } },
      id: identificador('bot', 'Agente'),
      name: 'Agente',
      type: '@n8n/n8n-nodes-langchain.agent',
      typeVersion: 3.1,
      position: [800, 520],
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 1000,
      onError: 'continueRegularOutput',
    },
    { parameters: { model: 'deepseek-chat', options: {} }, id: identificador('bot', 'Modelo'), name: 'Modelo', type: '@n8n/n8n-nodes-langchain.lmChatDeepSeek', typeVersion: 1, position: [700, 760] },
    {
      parameters: { sessionIdType: 'customKey', sessionKey: alChat, contextWindowLength: 6 },
      id: identificador('bot', 'Memoria'),
      name: 'Memoria',
      type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
      typeVersion: 1.3,
      position: [860, 760],
    },
    nodoHerramienta({ nombre: 'evaluar_oferta', descripcion: DESCRIPCION_EVALUAR, subworkflow: 'evaluar-oferta', campo: 'extraccion', posicion: [1020, 760] }),
    nodoHerramienta({ nombre: 'verificar_entidad', descripcion: DESCRIPCION_VERIFICAR, subworkflow: 'verificar-entidad', campo: 'q', posicion: [1180, 760] }),
    {
      parameters: {
        method: 'POST',
        url: URL_RAG,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: "={{ { query: $fromAI('query', 'la pregunta de la persona, en una frase', 'string'), topK: 5 } }}",
        descriptionType: 'manual',
        toolDescription: DESCRIPCION_RAG,
      },
      id: identificador('bot', 'consultar_rag'),
      name: 'consultar_rag',
      // Variante de herramienta del nodo HTTP Request base. El nodo de LangChain toolHttpRequest no funciona con el
      // Agente 3.1 de n8n 2.44.5: solo suministra datos y el motor pide que la herramienta se ejecute.
      type: 'n8n-nodes-base.httpRequestTool',
      typeVersion: 4.5,
      position: [1340, 760],
    },
    {
      parameters: {
        method: 'GET',
        url: URL_RECA_LISTA,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        descriptionType: 'manual',
        toolDescription: DESCRIPCION_LISTAR_RECA,
      },
      id: identificador('bot', 'listar_reca'),
      name: 'listar_reca',
      type: 'n8n-nodes-base.httpRequestTool',
      typeVersion: 4.5,
      position: [1500, 760],
    },
    {
      parameters: {
        method: 'POST',
        url: URL_RAG,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody:
          "={{ { query: $fromAI('query', 'la pregunta de la persona sobre el contrato, en una frase', 'string'), registroReca: $fromAI('registroReca', 'número de registro RECA del contrato, tal como lo da listar_reca', 'string'), topK: 5 } }}",
        descriptionType: 'manual',
        toolDescription: DESCRIPCION_CONSULTAR_RECA,
      },
      id: identificador('bot', 'consultar_reca'),
      name: 'consultar_reca',
      type: 'n8n-nodes-base.httpRequestTool',
      typeVersion: 4.5,
      position: [1660, 760],
    },
    nodoCodigo('Elegir respuesta', codigos.elegir, [1100, 520]),
    {
      parameters: { chatId: alChat, text: '={{ $json.texto }}', additionalFields: { appendAttribution: false } },
      id: identificador('bot', 'Enviar respuesta'),
      name: 'Enviar respuesta',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [1400, 300],
    },
  ];
  const workflow = {
    id: idWorkflow('bot'),
    name: 'Crédito Claro · bot',
    nodes: nodos,
    connections: {
      'Telegram Trigger': { main: hacia('Clasificar mensaje') },
      'Clasificar mensaje': { main: hacia('Ruta') },
      Ruta: { main: [[{ node: 'Mensaje fijo', type: 'main', index: 0 }], [{ node: 'Verificar entidad', type: 'main', index: 0 }], [{ node: 'Agente', type: 'main', index: 0 }]] },
      'Mensaje fijo': { main: hacia('Enviar respuesta') },
      'Verificar entidad': { main: hacia('Enviar respuesta') },
      Agente: { main: hacia('Elegir respuesta') },
      'Elegir respuesta': { main: hacia('Enviar respuesta') },
      Modelo: aIA('ai_languageModel'),
      Memoria: aIA('ai_memory'),
      evaluar_oferta: aIA('ai_tool'),
      verificar_entidad: aIA('ai_tool'),
      consultar_rag: aIA('ai_tool'),
      listar_reca: aIA('ai_tool'),
      consultar_reca: aIA('ai_tool'),
    },
    active: false,
    settings: { ...AJUSTES },
  };
  return JSON.stringify(workflow, null, 2) + '\n';
}

/** Construye en memoria todos los archivos generados. No escribe nada. */
function construirTodo({ tablaSipres, instrucciones = leerPrompt() }) {
  const problemas = validarTabla(tablaSipres);
  if (problemas.length > 0) throw new Error(`La tabla de SIPRES no es válida:\n${problemas.join('\n')}`);

  const nodos = {
    'evaluar-oferta.js': empaquetar({ nodo: 'Evaluar oferta', modulos: MODULOS.evaluar, cuerpo: cuerpoEvaluar(tablaSipres) }),
    'verificar-entidad.js': empaquetar({ nodo: 'Verificar entidad', modulos: MODULOS.verificar, cuerpo: cuerpoVerificar(tablaSipres) }),
    'elegir-respuesta.js': empaquetar({ nodo: 'Elegir respuesta', modulos: MODULOS.elegir, cuerpo: cuerpoElegir() }),
    'clasificar-mensaje.js': empaquetar({ nodo: 'Clasificar mensaje', modulos: MODULOS.mensaje, cuerpo: cuerpoClasificar() }),
    'mensaje-fijo.js': empaquetar({ nodo: 'Mensaje fijo', modulos: MODULOS.mensaje, cuerpo: cuerpoMensajeFijo() }),
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
    'bot.json': construirBot({
      instrucciones,
      codigos: {
        clasificar: nodos['clasificar-mensaje.js'],
        mensajeFijo: nodos['mensaje-fijo.js'],
        verificar: nodos['verificar-entidad.js'],
        elegir: nodos['elegir-respuesta.js'],
      },
    }),
  };
  return { nodos, workflows };
}

function leerPrompt(ruta = RUTA_PROMPT) {
  if (!fs.existsSync(ruta)) throw new Error(`No existe el archivo de instrucciones del agente: ${ruta}`);
  const texto = fs.readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n').trim();
  if (!texto) throw new Error(`El archivo de instrucciones del agente está vacío: ${ruta}`);
  return texto;
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

module.exports = { construirTodo, leerTabla, leerPrompt, RAIZ, RUTA_TABLA, RUTA_NODOS, RUTA_WORKFLOWS, RUTA_PROMPT };
