'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {cargar, consultar} = require('../consulta');
const registros = cargar();
test('el piloto conserva diez registros y hashes de veintinueve PDF', () => {
  assert.equal(registros.length, 10);
  assert.equal(registros.flatMap(r => r.documents).length, 29);
  assert.ok(registros.every(r => r.documents.every(d => d.paginas.length && d.paginas.some(p => p.trim()))));
});
test('recupera evidencia del registro exacto con página y enlace, sin declarar valores', () => {
  const id = '17102-140-044679/01-02644-1026';
  const r = consultar(registros, id, 'tasa de interés');
  assert.equal(r.estado, 'evidencia_sin_validar');
  assert.ok(r.evidencia.length);
  assert.ok(r.evidencia.every(e => e.registro === id && e.pagina > 0 && e.url.startsWith('https://registros.condusef.gob.mx/reca/')));
});
test('expone falta de evidencia y registros inexistentes', () => {
  assert.equal(consultar(registros, 'no existe', 'tasa').estado, 'registro_no_encontrado');
  assert.equal(consultar(registros, registros[0].registration, 'palabrainexistentexyz').estado, 'sin_evidencia');
  assert.throws(() => consultar(registros, '', 'cat'));
});
test('la versión histórica no se presenta como actual', () => {
  const historico = [{...registros[0], is_current: false}];
  const r = consultar(historico, historico[0].registration, 'tasa');
  assert.equal(r.version_actual, false);
});

test('período de gracia no recupera periodos de aclaración sin gracia', () => {
  const r = consultar(registros, registros[0].registration, 'período de gracia');
  assert.ok(r.evidencia.every(e => /gracia|diferimiento/i.test(e.texto)));
});

test('el texto OCR conserva fuente, página y advertencia', () => {
 const r = consultar(registros, '0300-140-000731/30-00405-0226', 'CAT', 20);
 assert.ok(r.evidencia.some(e => e.documento === 'Carátula' && e.pagina === 1 && e.extraccion === 'ocr_sin_revisar'));
});
test('localiza los anexos y cláusulas conocidas en el documento correcto', () => {
  const casos = [
    ['16701-140-042379/05-02331-0926', 'comision apertura', 'Carátula', 1],
    ['13157-140-044492/01-02328-0926', 'periodo de gracia', 'Contrato', 8],
    ['16701-140-042379/05-02331-0926', 'periodo de gracia', 'Contrato', 3],
  ];
  for (const [id, pregunta, documento, pagina] of casos) {
    assert.ok(consultar(registros, id, pregunta).evidencia.some(e => e.documento === documento && e.pagina === pagina));
  }
});
test('rechaza texto alterado aunque el PDF conserve su hash', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reca-test-'));
  try {
    const r = registros[0];
    const doc = r.documents[0];
    fs.mkdirSync(path.join(tmp, 'documentos'));
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify([{...r, documents: [doc]}]));
    const source = path.join(__dirname, '..', 'piloto', 'documentos', doc.file);
    fs.copyFileSync(source, path.join(tmp, 'documentos', doc.file));
    fs.writeFileSync(path.join(tmp, 'documentos', doc.file.replace(/\.pdf$/, '.txt')), 'texto alterado');
    assert.throws(() => cargar(tmp), /Hash de texto incorrecto/);
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
});
test('una pregunta de CAT recupera la carátula de cada registro entre cinco candidatos', () => {
  for (const r of registros) {
    const caratula = r.documents.find(d => d.label[1] === 'Carátula');
    const resultado = consultar(registros, r.registration, 'CAT');
    assert.ok(resultado.evidencia.some(e => e.url === caratula.url && e.pagina === 1), `No se recuperó la carátula de ${r.registration}`);
  }
});

test('una pregunta por interés ordinario o moratorio exige ese tipo en cada fragmento', () => {
  for (const r of registros) for (const [pregunta, termino] of [['interés ordinario', /ordinari[oa]/i], ['interés moratorio', /moratori[oa]/i]]) {
    const res = consultar(registros, r.registration, pregunta);
    assert.ok(res.evidencia.every(e => termino.test(e.texto)), `${r.registration}: ${pregunta}`);
  }
});
