'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { crearServidor } = require('../app');

function iniciar(extra = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-web-'));
  const webDir = path.join(raiz, 'web');
  fs.mkdirSync(webDir);
  fs.writeFileSync(path.join(webDir, 'index.html'), '<h1>pagina de prueba</h1>');
  fs.writeFileSync(path.join(raiz, 'secreto.txt'), 'no debe salir');
  const servidor = crearServidor({ botApiKey: null, iaActiva: false, webDir, ...extra });
  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => {
      resolve({
        base: `http://127.0.0.1:${servidor.address().port}`,
        cerrar: () => new Promise((r) => { servidor.close(r); servidor.closeAllConnections(); }),
      });
    });
  });
}

async function pedir(base, ruta, { metodo = 'GET', cuerpo, cabeceras = {} } = {}) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: cuerpo === undefined ? cabeceras : { 'Content-Type': 'application/json', ...cabeceras },
    body: cuerpo === undefined ? undefined : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no es JSON */ }
  return { estado: res.status, json, texto };
}

test('GET /api/salud responde ok y avisa que es modo ejemplo', async () => {
  const s = await iniciar();
  try {
    const r = await pedir(s.base, '/api/salud');
    assert.equal(r.estado, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.modo, 'ejemplo');
    assert.equal(r.json.ia, false);
  } finally { await s.cerrar(); }
});

test('GET /api/verificar encuentra la entidad de ejemplo ignorando acentos y mayúsculas', async () => {
  const s = await iniciar();
  try {
    const r = await pedir(s.base, '/api/verificar?q=' + encodeURIComponent('ENTIDAD de Ejémplo'));
    assert.equal(r.estado, 200);
    assert.equal(r.json.estado, 'registrada');
    assert.equal(r.json.motivo, 'ok');
    assert.ok(r.json.advertencias.includes('dato_de_ejemplo'));
  } finally { await s.cerrar(); }
});

test('GET /api/verificar: lo que no está en la tabla es sin_verificar, nunca no_registrada_confirmada', async () => {
  const s = await iniciar();
  try {
    for (const q of ['Financiera Desconocida', 'ab', 'zzz']) {
      const r = await pedir(s.base, '/api/verificar?q=' + encodeURIComponent(q));
      assert.equal(r.estado, 200);
      assert.equal(r.json.estado, 'sin_verificar');
      assert.equal(r.json.fecha_consulta, null);
    }
  } finally { await s.cerrar(); }
});

test('GET /api/verificar sin q devuelve 400', async () => {
  const s = await iniciar();
  try {
    const r = await pedir(s.base, '/api/verificar');
    assert.equal(r.estado, 400);
    assert.equal(r.json.error.codigo, 'entrada_invalida');
  } finally { await s.cerrar(); }
});

test('POST /api/procesar valida la entrada y devuelve la forma del contrato', async () => {
  const s = await iniciar();
  try {
    const mala = await pedir(s.base, '/api/procesar', { metodo: 'POST', cuerpo: {} });
    assert.equal(mala.estado, 400);
    const sinCuerpo = await pedir(s.base, '/api/procesar', { metodo: 'POST' });
    assert.equal(sinCuerpo.estado, 400);
    const ok = await pedir(s.base, '/api/procesar', { metodo: 'POST', cuerpo: { salidaLLM: { x: 1 } } });
    assert.equal(ok.estado, 200);
    assert.equal(ok.json.accion, 'redactar');
    assert.deepEqual(Object.keys(ok.json.log).sort(), ['estado_sipres', 'fecha', 'semaforo', 'tipo_entrada']);
    assert.ok(ok.json.advertencias.includes('respuesta_de_ejemplo'));
  } finally { await s.cerrar(); }
});

test('POST /api/elegir-respuesta exige ctx y devuelve origen plantilla', async () => {
  const s = await iniciar();
  try {
    const mala = await pedir(s.base, '/api/elegir-respuesta', { metodo: 'POST', cuerpo: { textoLLM: 'hola' } });
    assert.equal(mala.estado, 400);
    const ok = await pedir(s.base, '/api/elegir-respuesta', { metodo: 'POST', cuerpo: { textoLLM: null, ctx: {} } });
    assert.equal(ok.estado, 200);
    assert.equal(ok.json.origen, 'plantilla');
    assert.deepEqual(ok.json.fallas, []);
  } finally { await s.cerrar(); }
});

test('POST /api/consulta valida el texto y no devuelve lo que escribió la persona', async () => {
  const s = await iniciar();
  try {
    const vacio = await pedir(s.base, '/api/consulta', { metodo: 'POST', cuerpo: { texto: '   ' } });
    assert.equal(vacio.estado, 400);
    const largo = await pedir(s.base, '/api/consulta', { metodo: 'POST', cuerpo: { texto: 'a'.repeat(5001) } });
    assert.equal(largo.estado, 400);
    const ok = await pedir(s.base, '/api/consulta', { metodo: 'POST', cuerpo: { texto: 'mi dato SECRETO123' } });
    assert.equal(ok.estado, 200);
    assert.equal(ok.json.origen, 'ejemplo');
    assert.equal(ok.json.color, 'gris');
    assert.ok(!ok.texto.includes('SECRETO123'));
  } finally { await s.cerrar(); }
});

test('con BOT_API_KEY, las rutas de n8n piden X-Bot-Key y el resto no', async () => {
  const s = await iniciar({ botApiKey: 'clave-de-prueba' });
  try {
    const cuerpo = { salidaLLM: {} };
    const sin = await pedir(s.base, '/api/procesar', { metodo: 'POST', cuerpo });
    assert.equal(sin.estado, 401);
    const mala = await pedir(s.base, '/api/procesar', { metodo: 'POST', cuerpo, cabeceras: { 'X-Bot-Key': 'otra' } });
    assert.equal(mala.estado, 401);
    const buena = await pedir(s.base, '/api/procesar', { metodo: 'POST', cuerpo, cabeceras: { 'X-Bot-Key': 'clave-de-prueba' } });
    assert.equal(buena.estado, 200);
    const libre = await pedir(s.base, '/api/salud');
    assert.equal(libre.estado, 200);
  } finally { await s.cerrar(); }
});

test('GET /api/acceso/estados y /api/acceso: desconocido es null y un id inexistente es 404', async () => {
  const s = await iniciar();
  try {
    const lista = await pedir(s.base, '/api/acceso/estados');
    assert.equal(lista.estado, 200);
    assert.ok(lista.json.estados.length > 0);
    assert.ok(lista.json.estados.every((e) => e.valor === null));
    const uno = await pedir(s.base, '/api/acceso?estado=EJ-01');
    assert.equal(uno.estado, 200);
    assert.equal(uno.json.valor, null);
    const falta = await pedir(s.base, '/api/acceso?estado=XX');
    assert.equal(falta.estado, 404);
    const sin = await pedir(s.base, '/api/acceso');
    assert.equal(sin.estado, 400);
  } finally { await s.cerrar(); }
});

test('errores: JSON inválido, cuerpo enorme, ruta inexistente y método no permitido', async () => {
  const s = await iniciar();
  try {
    const roto = await pedir(s.base, '/api/consulta', { metodo: 'POST', cuerpo: '{' });
    assert.equal(roto.estado, 400);
    assert.equal(roto.json.error.codigo, 'json_invalido');
    const grande = await pedir(s.base, '/api/consulta', { metodo: 'POST', cuerpo: { texto: 'a'.repeat(300000) } });
    assert.equal(grande.estado, 413);
    const nada = await pedir(s.base, '/api/no-existe');
    assert.equal(nada.estado, 404);
    const metodo = await pedir(s.base, '/api/salud', { metodo: 'POST', cuerpo: {} });
    assert.equal(metodo.estado, 405);
  } finally { await s.cerrar(); }
});

test('la página se sirve desde webDir y no permite salir de esa carpeta', async () => {
  const s = await iniciar();
  try {
    const inicio = await pedir(s.base, '/');
    assert.equal(inicio.estado, 200);
    assert.ok(inicio.texto.includes('pagina de prueba'));
    for (const ruta of ['/..%2fsecreto.txt', '/%2e%2e%2fsecreto.txt', '/no-existe.html']) {
      const r = await pedir(s.base, ruta);
      assert.equal(r.estado, 404, ruta);
      assert.ok(!r.texto.includes('no debe salir'), ruta);
    }
  } finally { await s.cerrar(); }
});
