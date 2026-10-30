'use strict';
// Revisa códigos localmente. No almacena ni imprime sus valores.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { cargar } = require('./consulta');
const raiz = path.join(__dirname, 'piloto');
function correr(cmd, args) {
  const p = spawnSync(cmd, args, { maxBuffer: 10 * 1024 * 1024, timeout: 35000 });
  if (p.error) throw p.error;
  return p;
}
function main() {
  const registros = cargar(), resultados = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reca-codigos-'));
  try {
    for (const r of registros) for (const d of r.documents) for (let pagina = 1; pagina <= d.paginas.length; pagina++) {
      const prefix = path.join(tmp, 'pagina');
      const archivo = path.join(raiz, 'documentos', d.file);
      const pdf = correr('pdftoppm', ['-f', String(pagina), '-l', String(pagina), '-scale-to', '1800', '-png', '-singlefile', archivo, prefix]);
      if (pdf.status !== 0) throw Error(`No se pudo renderizar ${d.file}, página ${pagina}`);
      const z = correr('zbarimg', ['--quiet', '--raw', `${prefix}.png`]);
      if (![0, 4].includes(z.status)) throw Error(`No se pudo revisar ${d.file}, página ${pagina}`);
      resultados.push({registro:r.registration, documento:d.file, pagina, resultado:z.stdout.length ? 'codigo_detectado' : 'ningun_codigo_detectado', sha256_pdf:d.sha256});
      fs.unlinkSync(`${prefix}.png`);
    }
    const zbar = correr('zbarimg', ['--version']);
    const poppler = correr('pdftoppm', ['-v']);
    const report = {metodo:'pdftoppm escala 1800; zbarimg; criba parcial, no prueba ausencia', resultados, fecha_utc:new Date().toISOString(), herramientas:{render:poppler.stderr.toString().split('\n')[0], lector:zbar.stdout.toString().trim()}};
    const salida = path.join(raiz, 'revision-codigos.json');
    const archivoTemporal = path.join(tmp, 'revision.json');
    fs.writeFileSync(archivoTemporal, JSON.stringify(report, null, 2) + '\n');
    fs.renameSync(archivoTemporal, salida);
    console.log(`Páginas revisadas: ${resultados.length}. Con códigos detectados: ${resultados.filter(x => x.resultado === 'codigo_detectado').length}. No se guardaron los valores.`);
  } finally { fs.rmSync(tmp, {recursive:true, force:true}); }
}
try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
