'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { construirTodo, leerTabla, RUTA_TABLA, RUTA_NODOS, RUTA_WORKFLOWS } = require('./empaquetar');
const { procesar } = require('../motor/flujo/procesar');
const { elegirRespuesta } = require('../motor/respuesta/respuesta');

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

test('construye los tres nodos y los dos workflows', () => {
  const t = paquete();
  assert.deepEqual(Object.keys(t.nodos).sort(), ['elegir-respuesta.js', 'evaluar-oferta.js', 'verificar-entidad.js']);
  assert.deepEqual(Object.keys(t.workflows).sort(), ['evaluar-oferta.json', 'verificar-entidad.json']);
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

test('elegir_respuesta da lo mismo que llamar a elegirRespuesta', () => {
  const codigo = paquete().nodos['elegir-respuesta.js'];
  const { ctx, plantilla } = procesar({ extraccion: extraccion('etiqueta_tienda'), tablaSipres: TABLA, hoy: FECHA });
  const texto = `${plantilla}\nTe cobrarán $99,999.`;
  assert.deepEqual(ejecutar(codigo, { texto, ctx })[0].json, JSON.parse(JSON.stringify(elegirRespuesta(texto, ctx))));
  const sinContexto = ejecutar(codigo, { texto })[0].json;
  assert.equal(sinContexto.origen, 'plantilla');
  assert.equal(sinContexto.motivo, 'sin_contexto');
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
  for (const [nombre, texto] of Object.entries(paquete().workflows)) {
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
