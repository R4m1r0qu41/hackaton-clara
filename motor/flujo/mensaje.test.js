'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clasificarMensaje, textoFijo } = require('./mensaje');
const R = require('../respuesta/respuesta');

// Una actualización de Telegram, con datos de la persona que el clasificador no debe copiar.
const actualizacion = (mensaje) => ({
  update_id: 1,
  message: { message_id: 5, from: { id: 99, first_name: 'Persona', username: 'persona_ejemplo' }, chat: { id: 12345, type: 'private' }, date: 1790000000, ...mensaje },
});
const texto = (t) => actualizacion({ text: t });

const congelar = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && congelar(v));
  return Object.freeze(o);
};

test('un texto libre va al agente', () => {
  assert.deepEqual(clasificarMensaje(texto('Pagaré $500 al mes por 12 meses')), { ruta: 'texto', chat_id: 12345, texto: 'Pagaré $500 al mes por 12 meses' });
});

test('start, ayuda y comandos desconocidos dan la bienvenida', () => {
  for (const t of ['/start', '/START', '/start@MiBot', '/start algo', '/ayuda', '/help', '/otra cosa']) {
    assert.deepEqual(clasificarMensaje(texto(t)), { ruta: 'fijo', chat_id: 12345, mensaje: 'bienvenida' }, t);
  }
});

test('/verificar con nombre va a la verificación', () => {
  assert.deepEqual(clasificarMensaje(texto('/verificar Nombre de la entidad')), { ruta: 'verificar', chat_id: 12345, q: 'Nombre de la entidad' });
  assert.equal(clasificarMensaje(texto('/verificar@MiBot   Nombre  ')).q, 'Nombre');
  assert.equal(clasificarMensaje(texto('/VERIFICAR Nombre')).ruta, 'verificar');
});

test('/verificar sin nombre explica cómo usarlo', () => {
  for (const t of ['/verificar', '/verificar   ', '/verificar@MiBot']) {
    assert.deepEqual(clasificarMensaje(texto(t)), { ruta: 'fijo', chat_id: 12345, mensaje: 'verificar_sin_nombre' }, t);
  }
});

test('lo que no es texto (foto, sticker, texto vacío) dice que solo se lee texto', () => {
  for (const mensaje of [{ photo: [{ file_id: 'x' }] }, { sticker: {} }, { text: '   ' }]) {
    assert.deepEqual(clasificarMensaje(actualizacion(mensaje)), { ruta: 'fijo', chat_id: 12345, mensaje: 'solo_texto' });
  }
});

test('sin mensaje o sin chat se ignora, sin lanzar excepciones', () => {
  for (const entrada of [undefined, null, 42, 'texto', {}, { update_id: 1 }, { message: { text: 'hola' } }, { message: { chat: {}, text: 'hola' } }]) {
    const r = clasificarMensaje(entrada);
    assert.equal(r.ruta, 'ignorar');
    assert.equal(r.chat_id, null);
  }
});

test('acepta el mensaje directamente, sin la envoltura de la actualización', () => {
  assert.deepEqual(clasificarMensaje({ chat: { id: 7 }, text: 'hola' }), { ruta: 'texto', chat_id: 7, texto: 'hola' });
});

test('conserva el identificador de chat tal como llega', () => {
  assert.equal(clasificarMensaje({ message: { chat: { id: '999' }, text: 'hola' } }).chat_id, '999');
});

test('acota el texto y el nombre a buscar', () => {
  assert.equal(clasificarMensaje(texto('a'.repeat(5000))).texto.length, 4000);
  assert.equal(clasificarMensaje(texto(`/verificar ${'b'.repeat(500)}`)).q.length, 200);
});

test('no copia datos de la persona', () => {
  for (const entrada of [texto('hola'), texto('/start'), texto('/verificar Nombre'), actualizacion({ photo: [{ file_id: 'x' }] })]) {
    const r = clasificarMensaje(entrada);
    assert.ok(Object.keys(r).every((k) => ['ruta', 'chat_id', 'texto', 'q', 'mensaje'].includes(k)));
    assert.ok(!JSON.stringify(r).includes('persona_ejemplo'));
    assert.ok(!JSON.stringify(r).includes('Persona'));
  }
});

test('textoFijo devuelve el mensaje acordado y cae a "solo texto" si no conoce la clave', () => {
  assert.equal(textoFijo('bienvenida'), R.mensajes.bienvenida());
  assert.equal(textoFijo('solo_texto'), R.mensajes.soloTexto());
  assert.equal(textoFijo('verificar_sin_nombre'), R.mensajes.verificarSinNombre());
  assert.equal(textoFijo('otra'), R.mensajes.soloTexto());
  assert.equal(textoFijo(undefined), R.mensajes.soloTexto());
});

test('no modifica la entrada', () => {
  assert.doesNotThrow(() => clasificarMensaje(congelar(texto('/verificar Nombre'))));
});
