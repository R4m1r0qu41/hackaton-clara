'use strict';
// Verificación offline reproducible: no modifica archivos ni descarga datos.
const { cargar } = require('./consulta');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const fs = require('node:fs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function ejecutar(bin, args) {
  const r = spawnSync(bin, args, { maxBuffer: 30 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw Error(`${bin} no pudo verificar el documento`);
  return r.stdout;
}
function verificar() {
  const registros = cargar(); // Verifica hashes de documentos, texto y OCR.
  if (registros.length !== 10 || new Set(registros.map(x => x.registration)).size !== 10) throw Error('Se requieren diez registros distintos');
  let documentos = 0, sospechas = 0;
  const audit = JSON.parse(fs.readFileSync(join(__dirname, 'piloto', 'revision-codigos.json'), 'utf8'));
  const mapa = new Map();
  for (const x of audit.resultados) {
    const key = `${x.registro}:${x.documento}:${x.pagina}`;
    if (mapa.has(key)) throw Error('Auditoría de códigos tiene páginas duplicadas');
    mapa.set(key, x);
  }
  const auditoriaOcr = JSON.parse(fs.readFileSync(join(__dirname, 'piloto', 'revision-ocr-privacidad.json'), 'utf8'));
  const mapaOcr = new Map();
  for (const x of auditoriaOcr.resultados) {
    const key = `${x.registro}:${x.documento}:${x.pagina}`;
    if (mapaOcr.has(key)) throw Error('Auditoría OCR tiene páginas duplicadas');
    mapaOcr.set(key, x);
  }
  let paginas = 0, deteccionesOcr = 0;
  for (const r of registros) {
    if (!r.is_current || r.selected_version !== r.current_version || r.registration !== r.selected_version) throw Error(`Versión sin confirmar: ${r.registration}`);
    if (!r.documents.some(x => x.label[1] === 'Contrato') || !r.documents.some(x => x.label[1] === 'Carátula')) throw Error(`Falta contrato o carátula: ${r.registration}`);
    for (const d of r.documents) {
      const u = new URL(d.url);
      if (u.protocol !== 'https:' || u.host !== 'registros.condusef.gob.mx' || u.pathname !== `/reca/admin/contratos_anexos/${d.file}`) throw Error(`URL inválida: ${d.file}`);
      const pdf = join(__dirname, 'piloto', 'documentos', d.file);
      const texto = ejecutar('pdftotext', ['-layout', pdf, '-']);
      if (sha(texto) !== d.text_sha256) throw Error(`Extracción no reproducible: ${d.file}`);
      const info = ejecutar('pdfinfo', [pdf]).toString('utf8');
      const pages = /^Pages:\s*(\d+)\s*$/m.exec(info);
      if (!pages || Number(pages[1]) !== d.paginas.length) throw Error(`Páginas inconsistentes: ${d.file}`);
      for (let pagina = 1; pagina <= d.paginas.length; pagina++) {
        const resultado = mapa.get(`${r.registration}:${d.file}:${pagina}`);
        if (!resultado || resultado.sha256_pdf !== d.sha256 || resultado.resultado !== 'ningun_codigo_detectado') throw Error(`Revisión de código pendiente: ${d.file}, página ${pagina}`);
        const ocr = mapaOcr.get(`${r.registration}:${d.file}:${pagina}`);
        if (!ocr || ocr.sha256_pdf !== d.sha256 || !['sin_deteccion', 'posible_identificador'].includes(ocr.resultado)) throw Error(`Criba OCR pendiente: ${d.file}, página ${pagina}`);
        if (ocr.resultado === 'posible_identificador') deteccionesOcr++;
        paginas++;
      }
      // Es una alarma parcial; no asegura ausencia de identificadores en el PDF.
      const criba = /(?<!\d)\d{16,20}(?!\d)|\bCLABE\s*[:\-]?\s*[\d -]{8,}/i;
      if (criba.test(texto.toString('utf8')) || d.ocr.some(o => criba.test(o.texto))) sospechas++;
      documentos++;
    }
  }
  if (mapa.size !== paginas || mapaOcr.size !== paginas) throw Error('Auditoría contiene páginas ajenas o antiguas');
  if (sospechas) throw Error(`Hay ${sospechas} documentos con posibles datos bancarios; revisar antes de usar`);
  return { registros: registros.length, documentos, paginas, deteccionesOcr, privacidad: 'cribas parciales; falta revisión humana', estado: 'pendiente_revision_JR' };
}
try { console.log(JSON.stringify(verificar(), null, 2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
