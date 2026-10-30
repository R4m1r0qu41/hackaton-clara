'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { construirTodo, leerTabla, leerPrompt, RUTA_TABLA, RUTA_NODOS, RUTA_WORKFLOWS, RUTA_PROMPT } = require('./empaquetar');
const { procesar } = require('../motor/flujo/procesar');
const { elegirSalida } = require('../motor/flujo/salida');
const { clasificarMensaje, textoFijo } = require('../motor/flujo/mensaje');

const FECHA = '30/10/2026';

// Entidad ficticia: no corresponde a una empresa real.
const TABLA = [{ nombre_comercial: 'Zafiro', razon_social: null, estado: 'registrada', terminos_buscados: ['Zafiro', 'Zafiro Soluciones'], fecha_consulta: FECHA }];

const senales = () => ({
  pide_anticipo: false,
  pide_permiso_contactos: false,
  pide_permiso_fotos_archivos: false,
  deposito_menor_a_ofrecido: false,
  plazo_menor_a_15_dias: false,
  presion_urgencia: false,
  texto_evidencia: [],
});

const extraccion = (tipo, credito = {}) => ({
  tipo_entrada: tipo,
  confianza_extraccion: 0.9,
  producto:
    tipo === 'etiqueta_tienda'
      ? { descripcion: 'Producto de ejemplo', precio_contado: 10000, tienda: 'Tienda de ejemplo' }
      : { descripcion: null, precio_contado: null, tienda: null },
  credito: {
    otorgante_nombre_comercial: tipo === 'oferta_credito' ? 'Zafiro' : null,
    otorgante_razon_social: null,
    monto_ofrecido: tipo === 'oferta_credito' ? 10000 : null,
    monto_depositado: tipo === 'oferta_credito' ? 10000 : null,
    enganche: tipo === 'etiqueta_tienda' ? 0 : null,
    abono: 1000,
    periodicidad: 'mensual',
    numero_pagos: tipo === 'etiqueta_tienda' ? 11 : 12,
    plazo_dias: null,
    monto_total_a_pagar: null,
    comisiones: [],
    seguros: [],
    cat_publicado: null,
    ...credito,
  },
  senales_riesgo: senales(),
  datos_faltantes: [],
});

/** Corre el código como lo haría el nodo Code de n8n: sin require, con $input y un return de nivel superior. */
function ejecutar(codigo, json) {
  const entrada = { first: () => ({ json }), all: () => [{ json }] };
  const funcion = vm.runInNewContext(`(function ($input) {\n${codigo}\n})`, {});
  return JSON.parse(JSON.stringify(funcion(entrada)));
}

const paquete = () => construirTodo({ tablaSipres: TABLA });
const sinTabla = () => construirTodo({ tablaSipres: [] });

test('construye los cinco nodos y los tres workflows', () => {
  const t = paquete();
  assert.deepEqual(Object.keys(t.nodos).sort(), ['clasificar-mensaje.js', 'elegir-respuesta.js', 'evaluar-oferta.js', 'mensaje-fijo.js', 'verificar-entidad.js']);
  assert.deepEqual(Object.keys(t.workflows).sort(), ['bot.json', 'evaluar-oferta.json', 'verificar-entidad.json']);
});

test('el código empaquetado es autocontenido: sin módulos del sistema ni archivos', () => {
  for (const [nombre, codigo] of Object.entries(paquete().nodos)) {
    assert.match(codigo, /^\/\/ GENERADO por scripts\/empaquetar\.js/, nombre);
    assert.ok(!/require\(['"]node:/.test(codigo), `${nombre}: usa un módulo de node:`);
    assert.ok(!/require\(['"][^.'"]/.test(codigo), `${nombre}: usa un módulo externo`);
    assert.ok(!/\bprocess\b|\bchild_process\b|\bfs\b/.test(codigo), `${nombre}: toca el sistema`);
  }
});

test('evaluar_oferta da lo mismo que llamar a procesar', () => {
  const datos = extraccion('etiqueta_tienda');
  const salida = ejecutar(paquete().nodos['evaluar-oferta.js'], { extraccion: JSON.stringify(datos) })[0].json;
  const esperado = procesar({ extraccion: datos, tablaSipres: TABLA, hoy: salida.log.fecha });
  assert.deepEqual(salida, JSON.parse(JSON.stringify(esperado)));
});

test('evaluar_oferta pone la fecha del log en formato DD/MM/AAAA', () => {
  const salida = ejecutar(paquete().nodos['evaluar-oferta.js'], { extraccion: extraccion('etiqueta_tienda') })[0].json;
  assert.match(salida.log.fecha, /^\d{2}\/\d{2}\/\d{4}$/);
});

test('evaluar_oferta acepta la extracción como objeto o como texto', () => {
  const codigo = paquete().nodos['evaluar-oferta.js'];
  const datos = extraccion('etiqueta_tienda');
  assert.equal(ejecutar(codigo, { extraccion: datos })[0].json.accion, 'redactar');
  assert.equal(ejecutar(codigo, { extraccion: JSON.stringify(datos) })[0].json.accion, 'redactar');
});

test('evaluar_oferta usa la tabla de SIPRES embebida', () => {
  const entrada = { extraccion: extraccion('oferta_credito') };
  assert.equal(ejecutar(paquete().nodos['evaluar-oferta.js'], entrada)[0].json.ctx.estado_sipres, 'registrada');
  assert.equal(ejecutar(sinTabla().nodos['evaluar-oferta.js'], entrada)[0].json.ctx.estado_sipres, 'sin_verificar');
});

test('evaluar_oferta sin extracción no lanza y responde con el mensaje de error', () => {
  const salida = ejecutar(paquete().nodos['evaluar-oferta.js'], {})[0].json;
  assert.equal(salida.accion, 'responder');
  assert.equal(salida.motivo, 'error_formato');
});

test('verificar_entidad busca en la tabla embebida y redacta el mensaje', () => {
  const codigo = paquete().nodos['verificar-entidad.js'];
  const registrada = ejecutar(codigo, { q: 'Zafiro' })[0].json;
  assert.equal(registrada.estado, 'registrada');
  assert.ok(registrada.texto.includes('✅'));
  const sin = ejecutar(codigo, {})[0].json;
  assert.equal(sin.estado, 'sin_verificar');
  assert.ok(sin.texto.includes('❔'));
});

test('verificar_entidad acota la consulta y no lanza con textos enormes', () => {
  const salida = ejecutar(paquete().nodos['verificar-entidad.js'], { q: 'a'.repeat(5000) })[0].json;
  assert.equal(salida.estado, 'sin_verificar');
});

test('elegir_respuesta da lo mismo que elegirSalida con la salida del agente', () => {
  const codigo = paquete().nodos['elegir-respuesta.js'];
  const resultado = procesar({ extraccion: extraccion('etiqueta_tienda'), tablaSipres: TABLA, hoy: FECHA });
  const salidaDelAgente = {
    output: `${resultado.plantilla}\nTe cobrarán $99,999.`,
    intermediateSteps: [{ action: { tool: 'evaluar_oferta', toolInput: '{}' }, observation: JSON.stringify(resultado) }],
  };
  const esperado = elegirSalida({ texto: salidaDelAgente.output, pasos: salidaDelAgente.intermediateSteps });
  assert.equal(esperado.motivo, 'verificador_rechazo');
  assert.deepEqual(ejecutar(codigo, salidaDelAgente)[0].json, JSON.parse(JSON.stringify(esperado)));
  assert.equal(ejecutar(codigo, { error: 'tiempo agotado' })[0].json.motivo, 'error_agente');
  assert.equal(ejecutar(codigo, {})[0].json.motivo, 'conversacion_rechazada');
});

test('clasificar_mensaje da lo mismo que clasificarMensaje', () => {
  const codigo = paquete().nodos['clasificar-mensaje.js'];
  const mensaje = (text) => ({ message: { chat: { id: 1 }, text } });
  for (const actualizacion of [mensaje('hola'), mensaje('/verificar Nombre'), mensaje('/start'), mensaje('/verificar'), {}]) {
    assert.deepEqual(ejecutar(codigo, actualizacion)[0].json, JSON.parse(JSON.stringify(clasificarMensaje(actualizacion))));
  }
});

test('mensaje_fijo devuelve el texto de la respuesta fija', () => {
  const codigo = paquete().nodos['mensaje-fijo.js'];
  assert.equal(ejecutar(codigo, { ruta: 'fijo', chat_id: 1, mensaje: 'bienvenida' })[0].json.texto, textoFijo('bienvenida'));
  assert.equal(ejecutar(codigo, { ruta: 'fijo', chat_id: 1, mensaje: 'verificar_sin_nombre' })[0].json.texto, textoFijo('verificar_sin_nombre'));
  assert.equal(ejecutar(codigo, {})[0].json.texto, textoFijo(undefined));
});

test('cada workflow lleva el código empaquetado en su nodo Code', () => {
  const t = paquete();
  for (const [archivo, nodo] of [['evaluar-oferta', 'evaluar-oferta.js'], ['verificar-entidad', 'verificar-entidad.js']]) {
    const wf = JSON.parse(t.workflows[`${archivo}.json`]);
    const codigo = wf.nodes.find((n) => n.type === 'n8n-nodes-base.code');
    assert.equal(codigo.parameters.jsCode, t.nodos[nodo]);
    assert.equal(codigo.parameters.mode, 'runOnceForAllItems');
  }
});

test('los workflows no guardan ejecuciones ni llevan credenciales', () => {
  for (const [nombre, texto] of Object.entries(paquete().workflows)) {
    const wf = JSON.parse(texto);
    assert.equal(wf.settings.saveDataSuccessExecution, 'none', nombre);
    assert.equal(wf.settings.saveDataErrorExecution, 'none', nombre);
    assert.equal(wf.settings.saveManualExecutions, false, nombre);
    assert.equal(wf.settings.saveExecutionProgress, false, nombre);
    assert.ok(!texto.includes('"credentials"'), nombre);
  }
});

test('las conexiones apuntan a nodos que existen y ambos disparadores llegan al nodo de código', () => {
  const subworkflows = Object.entries(paquete().workflows).filter(([nombre]) => nombre !== 'bot.json');
  assert.equal(subworkflows.length, 2);
  for (const [nombre, texto] of subworkflows) {
    const wf = JSON.parse(texto);
    const nombres = wf.nodes.map((n) => n.name);
    const codigo = wf.nodes.find((n) => n.type === 'n8n-nodes-base.code').name;
    const disparadores = wf.nodes.filter((n) => /Trigger$/.test(n.type)).map((n) => n.name);
    assert.equal(disparadores.length, 2, nombre);
    for (const [origen, salidas] of Object.entries(wf.connections)) {
      assert.ok(nombres.includes(origen), `${nombre}: ${origen}`);
      for (const destino of salidas.main.flat()) assert.ok(nombres.includes(destino.node), `${nombre}: ${destino.node}`);
    }
    for (const d of disparadores) assert.deepEqual(wf.connections[d].main[0].map((c) => c.node), [codigo], `${nombre}: ${d}`);
    assert.equal(new Set(wf.nodes.map((n) => n.id)).size, wf.nodes.length, `${nombre}: ids repetidos`);
  }
});

test('los datos fijados son de ejemplo, solo están en la prueba manual y corren bien', () => {
  const t = paquete();
  const wf = JSON.parse(t.workflows['evaluar-oferta.json']);
  assert.deepEqual(Object.keys(wf.pinData), ['Prueba manual']);
  const fijado = wf.pinData['Prueba manual'][0].json;
  assert.equal(JSON.parse(fijado.extraccion).producto.descripcion, 'Producto de ejemplo');
  assert.equal(ejecutar(t.nodos['evaluar-oferta.js'], fijado)[0].json.accion, 'redactar');
});

test('el disparador entre workflows declara su entrada de ejemplo', () => {
  const wf = JSON.parse(paquete().workflows['evaluar-oferta.json']);
  const disparador = wf.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
  assert.equal(disparador.typeVersion, 1.1);
  assert.equal(disparador.parameters.inputSource, 'jsonExample');
  assert.deepEqual(Object.keys(JSON.parse(disparador.parameters.jsonExample)), ['extraccion']);
});

// workflow principal

const bot = () => JSON.parse(paquete().workflows['bot.json']);
const nodo = (wf, nombre) => wf.nodes.find((n) => n.name === nombre);
const destinos = (conexiones, origen, tipo = 'main', salida = 0) => conexiones[origen][tipo][salida].map((c) => c.node);

test('el workflow principal tiene los nodos, tipos y versiones esperados', () => {
  const esperados = {
    'Telegram Trigger': ['n8n-nodes-base.telegramTrigger', 1.5],
    'Clasificar mensaje': ['n8n-nodes-base.code', 2],
    Ruta: ['n8n-nodes-base.switch', 3.2],
    'Mensaje fijo': ['n8n-nodes-base.code', 2],
    'Verificar entidad': ['n8n-nodes-base.code', 2],
    Agente: ['@n8n/n8n-nodes-langchain.agent', 3.1],
    Modelo: ['@n8n/n8n-nodes-langchain.lmChatDeepSeek', 1],
    Memoria: ['@n8n/n8n-nodes-langchain.memoryBufferWindow', 1.3],
    evaluar_oferta: ['@n8n/n8n-nodes-langchain.toolWorkflow', 2.2],
    verificar_entidad: ['@n8n/n8n-nodes-langchain.toolWorkflow', 2.2],
    // El nodo @n8n/n8n-nodes-langchain.toolHttpRequest no sirve con el Agente 3.1 de n8n 2.44.5 (solo suministra datos,
    // no se ejecuta): se usa el nodo HTTP Request base en su variante de herramienta.
    consultar_rag: ['n8n-nodes-base.httpRequestTool', 4.5],
    listar_reca: ['n8n-nodes-base.httpRequestTool', 4.5],
    consultar_reca: ['n8n-nodes-base.httpRequestTool', 4.5],
    'Elegir respuesta': ['n8n-nodes-base.code', 2],
    'Enviar respuesta': ['n8n-nodes-base.telegram', 1.2],
  };
  const wf = bot();
  assert.deepEqual(wf.nodes.map((n) => n.name).sort(), Object.keys(esperados).sort());
  for (const [nombre, [tipo, version]] of Object.entries(esperados)) {
    assert.equal(nodo(wf, nombre).type, tipo, nombre);
    assert.equal(nodo(wf, nombre).typeVersion, version, nombre);
  }
  assert.equal(new Set(wf.nodes.map((n) => n.id)).size, wf.nodes.length);
});

test('el Telegram Trigger solo escucha mensajes', () => {
  assert.deepEqual(nodo(bot(), 'Telegram Trigger').parameters.updates, ['message']);
});

test('el ruteo manda cada tipo de mensaje a su rama', () => {
  const wf = bot();
  const reglas = nodo(wf, 'Ruta').parameters.rules.values;
  assert.deepEqual(reglas.map((r) => r.outputKey), ['fijo', 'verificar', 'texto']);
  for (const regla of reglas) {
    assert.equal(regla.conditions.conditions[0].leftValue, '={{ $json.ruta }}');
    assert.equal(regla.conditions.conditions[0].rightValue, regla.outputKey);
    assert.equal(regla.conditions.conditions[0].operator.operation, 'equals');
  }
  assert.deepEqual(destinos(wf.connections, 'Telegram Trigger'), ['Clasificar mensaje']);
  assert.deepEqual(destinos(wf.connections, 'Clasificar mensaje'), ['Ruta']);
  assert.deepEqual([0, 1, 2].map((i) => destinos(wf.connections, 'Ruta', 'main', i)), [['Mensaje fijo'], ['Verificar entidad'], ['Agente']]);
  assert.deepEqual(destinos(wf.connections, 'Agente'), ['Elegir respuesta']);
  for (const origen of ['Mensaje fijo', 'Verificar entidad', 'Elegir respuesta']) {
    assert.deepEqual(destinos(wf.connections, origen), ['Enviar respuesta'], origen);
  }
});

test('el agente recibe modelo, memoria y las cinco herramientas por las conexiones de IA', () => {
  const wf = bot();
  assert.deepEqual(destinos(wf.connections, 'Modelo', 'ai_languageModel'), ['Agente']);
  assert.deepEqual(destinos(wf.connections, 'Memoria', 'ai_memory'), ['Agente']);
  for (const herramienta of ['evaluar_oferta', 'verificar_entidad', 'consultar_rag', 'listar_reca', 'consultar_reca']) {
    assert.deepEqual(destinos(wf.connections, herramienta, 'ai_tool'), ['Agente'], herramienta);
  }
});

test('consultar_rag llama al RAG con la pregunta del modelo y la clave se asigna en n8n', () => {
  const rag = nodo(bot(), 'consultar_rag');
  const p = rag.parameters;
  assert.equal(p.method, 'POST');
  assert.equal(p.url, 'http://rag:3000/query');
  assert.equal(p.authentication, 'genericCredentialType');
  // n8n no tiene un tipo de credencial "Bearer" genérico en el nodo HTTP: el token va en una credencial Header Auth
  // (nombre Authorization, valor "Bearer <clave>"). Comprobado contra n8n 2.44.5: httpBearerAuth da "not supported".
  assert.equal(p.genericAuthType, 'httpHeaderAuth');
  assert.equal(p.sendBody, true);
  assert.equal(p.contentType, 'json');
  assert.equal(p.specifyBody, 'json');
  assert.equal(p.descriptionType, 'manual');
  assert.match(p.jsonBody, /\$fromAI\('query'/);
  assert.match(p.jsonBody, /topK: 5/);
  assert.match(p.toolDescription, /documentos/);
  assert.ok(p.toolDescription.length > 40);
  assert.equal(rag.credentials, undefined);
});

test('listar_reca pide la lista de contratos RECA al servicio, con la misma credencial y sin cuerpo', () => {
  const lista = nodo(bot(), 'listar_reca');
  const p = lista.parameters;
  assert.equal(p.method, 'GET');
  assert.equal(p.url, 'http://rag:3000/reca/productos');
  assert.equal(p.authentication, 'genericCredentialType');
  assert.equal(p.genericAuthType, 'httpHeaderAuth');
  assert.ok(!p.sendBody);
  assert.equal(p.descriptionType, 'manual');
  assert.match(p.toolDescription, /RECA/);
  assert.match(p.toolDescription, /registro/i);
  assert.equal(lista.credentials, undefined);
});

test('consultar_reca consulta un contrato por su registro RECA con la pregunta del modelo', () => {
  const reca = nodo(bot(), 'consultar_reca');
  const p = reca.parameters;
  assert.equal(p.method, 'POST');
  assert.equal(p.url, 'http://rag:3000/query');
  assert.equal(p.authentication, 'genericCredentialType');
  assert.equal(p.genericAuthType, 'httpHeaderAuth');
  assert.equal(p.sendBody, true);
  assert.equal(p.specifyBody, 'json');
  assert.match(p.jsonBody, /\$fromAI\('query'/);
  assert.match(p.jsonBody, /\$fromAI\('registroReca'/);
  assert.match(p.toolDescription, /registro/i);
  assert.match(p.toolDescription, /listar_reca/);
  assert.equal(reca.credentials, undefined);
});

test('todas las conexiones del workflow principal apuntan a nodos que existen', () => {
  const wf = bot();
  const nombres = wf.nodes.map((n) => n.name);
  for (const [origen, tipos] of Object.entries(wf.connections)) {
    assert.ok(nombres.includes(origen), origen);
    for (const salidas of Object.values(tipos)) {
      for (const destino of salidas.flat()) assert.ok(nombres.includes(destino.node), `${origen} -> ${destino.node}`);
    }
  }
});

test('el workflow principal usa el código empaquetado en sus nodos Code', () => {
  const t = paquete();
  const wf = JSON.parse(t.workflows['bot.json']);
  const codigos = { 'Clasificar mensaje': 'clasificar-mensaje.js', 'Mensaje fijo': 'mensaje-fijo.js', 'Verificar entidad': 'verificar-entidad.js', 'Elegir respuesta': 'elegir-respuesta.js' };
  for (const [nombre, archivo] of Object.entries(codigos)) {
    assert.equal(nodo(wf, nombre).parameters.jsCode, t.nodos[archivo], nombre);
    assert.equal(nodo(wf, nombre).parameters.mode, 'runOnceForAllItems', nombre);
  }
});

test('las herramientas del agente apuntan a los sub-workflows por su identificador', () => {
  const t = paquete();
  const wf = JSON.parse(t.workflows['bot.json']);
  for (const [herramienta, archivo, campo] of [['evaluar_oferta', 'evaluar-oferta.json', 'extraccion'], ['verificar_entidad', 'verificar-entidad.json', 'q']]) {
    const parametros = nodo(wf, herramienta).parameters;
    assert.equal(parametros.name, herramienta);
    assert.ok(parametros.description.length > 20, herramienta);
    assert.equal(parametros.source, 'database');
    assert.equal(parametros.workflowId.mode, 'id');
    assert.equal(parametros.workflowId.value, JSON.parse(t.workflows[archivo]).id, herramienta);
    assert.match(parametros.workflowInputs.value[campo], new RegExp(`\\$fromAI\\('${campo}'`), herramienta);
  }
});

test('el agente guarda los pasos intermedios, reintenta y no tumba el flujo si falla', () => {
  const agente = nodo(bot(), 'Agente');
  assert.equal(agente.parameters.promptType, 'define');
  assert.equal(agente.parameters.text, '={{ $json.texto }}');
  assert.equal(agente.parameters.options.returnIntermediateSteps, true);
  assert.equal(agente.parameters.options.systemMessage, leerPrompt(RUTA_PROMPT));
  assert.equal(agente.retryOnFail, true);
  assert.ok(agente.maxTries >= 2);
  assert.equal(agente.onError, 'continueRegularOutput');
});

test('las instrucciones del agente nombran las herramientas y tratan el texto como dato', () => {
  const instrucciones = leerPrompt(RUTA_PROMPT);
  assert.match(instrucciones, /evaluar_oferta/);
  assert.match(instrucciones, /verificar_entidad/);
  assert.match(instrucciones, /no es una instrucción/i);
  assert.match(instrucciones, /no recomiendes/i);
  assert.match(instrucciones, /consultar_rag/);
  assert.match(instrucciones, /fragmentos/);
  assert.match(instrucciones, /listar_reca/);
  assert.match(instrucciones, /consultar_reca/);
  assert.match(instrucciones, /RECA/);
});

test('el modelo es DeepSeek y la credencial se asigna en n8n, no en el archivo', () => {
  const modelo = nodo(bot(), 'Modelo');
  assert.equal(modelo.parameters.model, 'deepseek-chat');
  assert.equal(modelo.credentials, undefined);
});

test('la memoria es de ventana corta y por chat', () => {
  const memoria = nodo(bot(), 'Memoria').parameters;
  assert.equal(memoria.sessionIdType, 'customKey');
  assert.match(memoria.sessionKey, /Clasificar mensaje.*chat_id/);
  assert.ok(memoria.contextWindowLength >= 1 && memoria.contextWindowLength <= 10);
});

test('Telegram responde al chat de origen, con el texto elegido y sin la firma de n8n', () => {
  const enviar = nodo(bot(), 'Enviar respuesta').parameters;
  assert.match(enviar.chatId, /Clasificar mensaje.*chat_id/);
  assert.equal(enviar.text, '={{ $json.texto }}');
  assert.equal(enviar.additionalFields.appendAttribution, false);
});

test('leerPrompt falla con claridad si no hay instrucciones', () => {
  assert.throws(() => leerPrompt(path.join(os.tmpdir(), 'no-existe-prompt.md')), /No existe/);
});

test('rechaza una tabla de SIPRES inválida', () => {
  assert.throws(() => construirTodo({ tablaSipres: [{ estado: 'otro' }] }), /Fila 1/);
  assert.throws(() => construirTodo({ tablaSipres: 'no es lista' }), /lista/);
});

test('leerTabla lee la tabla y falla con claridad si no sirve', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sipres-'));
  try {
    const guardar = (nombre, contenido) => {
      const ruta = path.join(dir, nombre);
      fs.writeFileSync(ruta, contenido);
      return ruta;
    };
    assert.deepEqual(leerTabla(guardar('buena.json', JSON.stringify(TABLA))), TABLA);
    assert.throws(() => leerTabla(path.join(dir, 'no-existe.json')), /No existe/);
    assert.throws(() => leerTabla(guardar('rota.json', '{"a":')), /no es JSON válido/);
    assert.throws(() => leerTabla(guardar('objeto.json', '{}')), /lista/);
    assert.throws(() => leerTabla(guardar('mala.json', JSON.stringify([{ estado: 'otro' }]))), /Fila 1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('la tabla de SIPRES del repo es válida', () => {
  assert.ok(Array.isArray(leerTabla(RUTA_TABLA)));
});

test('los archivos generados en disco están al día con el motor y la tabla', () => {
  const fresco = construirTodo({ tablaSipres: leerTabla(RUTA_TABLA) });
  const consejo = 'Corre node scripts/empaquetar.js';
  for (const [nombre, contenido] of Object.entries(fresco.nodos)) {
    assert.equal(fs.readFileSync(path.join(RUTA_NODOS, nombre), 'utf8'), contenido, `${nombre} desactualizado. ${consejo}`);
  }
  for (const [nombre, contenido] of Object.entries(fresco.workflows)) {
    assert.equal(fs.readFileSync(path.join(RUTA_WORKFLOWS, nombre), 'utf8'), contenido, `${nombre} desactualizado. ${consejo}`);
  }
});
