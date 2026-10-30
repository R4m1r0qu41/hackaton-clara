'use strict';
// Recuperación exploratoria: devuelve fragmentos, no determina condiciones financieras.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = path.join(__dirname, 'piloto');
const normalizar = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const palabras = s => normalizar(s).match(/[\p{L}\p{N}]+/gu) || [];
const vacias = new Set('de del la el los las un una y o para por con en que es se al si hay cual cuanto cuáles qué como cuál su sus sobre'.split(' '));
const temas = {
  tasa: ['tasa', 'interes', 'ordinaria', 'ordinario', 'moratoria', 'moratorio'],
  cat: ['cat', 'costo anual total'],
  gracia: ['gracia', 'diferimiento'],
  comisiones: ['comision', 'comisiones'],
  plazo: ['plazo', 'vencimiento'],
  pagos: ['pago', 'pagos', 'amortizacion'],
};
function cargar(base = dir) {
  const registros = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  return registros.map(r => ({...r, documents: r.documents.map(d => {
    if (!/^[a-zA-Z0-9_-]+\.pdf$/.test(d.file)) throw Error('Nombre de documento inválido');
    const pdf = fs.readFileSync(path.join(base, 'documentos', d.file));
    if (crypto.createHash('sha256').update(pdf).digest('hex') !== d.sha256) throw Error(`Hash incorrecto: ${d.file}`);
    const text = fs.readFileSync(path.join(base, 'documentos', d.file.replace(/\.pdf$/, '.txt')));
    if (crypto.createHash('sha256').update(text).digest('hex') !== d.text_sha256) throw Error(`Hash de texto incorrecto: ${d.file}`);
    const paginas = text.toString('utf8').split('\f');
    if (paginas.at(-1).trim() === '') paginas.pop();
    const ocr = (d.ocr || []).map(o => {
      if (!/^[a-zA-Z0-9_.-]+\.txt$/.test(o.file) || !Number.isInteger(o.pagina) || o.pagina < 1 || o.pagina > paginas.length) throw Error('OCR inválido');
      const contenido = fs.readFileSync(path.join(base, 'documentos', o.file));
      if (crypto.createHash('sha256').update(contenido).digest('hex') !== o.sha256) throw Error(`Hash de OCR incorrecto: ${o.file}`);
      return {...o, texto: contenido.toString('utf8')};
    });
    return {...d, paginas, ocr};
  })}));
}
function consultar(registros, registro, pregunta, limite = 5) {
  if (typeof registro !== 'string' || !registro.trim() || typeof pregunta !== 'string' || !pregunta.trim()) throw Error('Se requiere registro y pregunta');
  if (!Number.isInteger(limite) || limite < 1 || limite > 20) throw Error('Límite inválido');
  const r = registros.find(x => x.registration === registro);
  if (!r) return {estado: 'registro_no_encontrado', evidencia: []};
  const q = palabras(pregunta).filter(w => !vacias.has(w) && w.length > 2);
  const terminos = new Set(q);
  const relevantes = Object.values(temas).filter(lista => lista.some(t => q.includes(t) || (t.includes(' ') && ` ${palabras(pregunta).join(' ')} `.includes(` ${t} `))));
  const especificos = [];
  if (q.some(t => ['ordinaria', 'ordinario', 'ordinarios', 'ordinarias'].includes(t))) especificos.push(['ordinaria', 'ordinario', 'ordinarios', 'ordinarias']);
  if (q.some(t => ['moratoria', 'moratorio', 'moratorios', 'moratorias'].includes(t))) especificos.push(['moratoria', 'moratorio', 'moratorios', 'moratorias']);
  for (const lista of relevantes) for (const t of lista) terminos.add(t);
  if (!terminos.size) return {estado: 'consulta_insuficiente', evidencia: []};
  const resultados = [];
  for (const d of r.documents) for (const entrada of [...d.paginas.map((texto, i) => ({texto, pagina: i + 1, extraccion: 'pdf_texto'})), ...d.ocr.map(o => ({texto: o.texto, pagina: o.pagina, extraccion: 'ocr_sin_revisar'}))]) {
    const pagina = entrada.texto;
    // Agrupamos líneas cercanas para conservar encabezados y contexto de tablas.
    const lineas = pagina.split(/\r?\n/);
    for (let i = 0; i < lineas.length; i += 12) {
      const texto = lineas.slice(i, i + 16).join('\n').trim();
      if (!texto) continue;
      const tokens = palabras(texto);
      const cuerpo = ` ${tokens.join(' ')} `;
      const score = [...terminos].filter(t => cuerpo.includes(` ${t} `)).length;
      const temaPresente = [...relevantes, ...especificos].every(lista => lista.some(t => cuerpo.includes(` ${t} `)));
      if (score && temaPresente) resultados.push({score, registro: r.registration, producto: r.product, documento: d.label[1], url: d.url, pagina: entrada.pagina, extraccion: entrada.extraccion, sha256: d.sha256, texto});
    }
  }
  resultados.sort((a,b) => b.score-a.score || a.pagina-b.pagina);
  return {estado: resultados.length ? 'evidencia_sin_validar' : 'sin_evidencia', version_actual: r.is_current, estado_reca_codigo: r.status_code, advertencia: 'Exploración de documentos; JR debe validar fuentes y condiciones. No supone una oferta vigente ni una cifra aplicable. Un período de gracia puede referirse a cancelar el contrato y no a diferir pagos.', evidencia: resultados.slice(0, limite)};
}
module.exports = {cargar, consultar};
if (require.main === module) {
  try {
    const [registro, ...pregunta] = process.argv.slice(2);
    console.log(JSON.stringify(consultar(cargar(), registro, pregunta.join(' ')), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
