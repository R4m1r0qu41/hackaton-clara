'use strict';
// Verifica la ficha pública; no descarga documentos ni altera el corpus.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const MAX_BYTES = 2 * 1024 * 1024;
function urlValida(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'registros.condusef.gob.mx' && !u.port && !u.username && !u.password && u.pathname === '/reca/tarjeta_nueva.php';
  } catch { return false; }
}
async function curlFetch(url) {
  const args = ['--silent', '--show-error', '--max-time', '15', '--max-filesize', String(MAX_BYTES), '--proto', '=https', '--write-out', '\n%{http_code}', '--', url];
  const { stdout } = await exec('curl', args, { encoding: 'buffer', maxBuffer: MAX_BYTES + 32, timeout: 17000 });
  const status = Number(stdout.subarray(stdout.length - 3).toString());
  if (!Number.isInteger(status) || status < 100 || status > 599 || stdout[stdout.length - 4] !== 10) throw Error('Respuesta HTTP inválida');
  return new Response(stdout.subarray(0, stdout.length - 4), {status});
}
async function verificarFicha(registro, fetcher = curlFetch) {
  const base = {registro: registro.registration, version_capturada: registro.current_version, codigo_capturado: registro.status_code};
  if (!urlValida(registro.detail_url)) return {...base, estado: 'no_comprobado', motivo: 'URL de ficha inválida'};
  try {
    const res = await fetcher(registro.detail_url, {redirect:'manual', signal:AbortSignal.timeout(15000)});
    if (!res.ok || res.status !== 200) return {...base, estado:'no_comprobado', motivo:`HTTP ${res.status}`};
    if (!res.body) return {...base, estado:'no_comprobado', motivo:'Respuesta sin cuerpo'};
    let size = 0; const parts = [];
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > MAX_BYTES) { await res.body.cancel().catch(() => {}); return {...base, estado:'no_comprobado', motivo:'Ficha demasiado grande'}; }
      parts.push(Buffer.from(chunk));
    }
    const html = Buffer.concat(parts).toString('utf8');
    const match = /\bconst\s+contractData\s*=\s*(\{[^\r\n]*\})\s*;/.exec(html);
    if (!match) return {...base, estado:'no_comprobado', motivo:'Formato de ficha no reconocido'};
    const obj = JSON.parse(match[1]);
    if (typeof obj.currentVersion !== 'string' || typeof obj.selectedVersion !== 'string' || typeof obj.contractStatus !== 'string' || typeof obj.isCurrentVersion !== 'boolean') return {...base, estado:'no_comprobado', motivo:'Faltan metadatos de la ficha'};
    const igual = obj.currentVersion === registro.current_version && obj.selectedVersion === registro.registration && obj.isCurrentVersion && obj.contractStatus === registro.status_code;
    return {...base, version_actual:obj.currentVersion, version_seleccionada:obj.selectedVersion, codigo_actual:obj.contractStatus, estado:igual ? 'sin_cambio_detectado' : 'cambio_detectado'};
  } catch { return {...base, estado:'no_comprobado', motivo:'Error de red o lectura'}; }
}
async function verificarTodas(registros, fetcher = curlFetch) {
  const resultados=[];
  // Consultas secuenciales para reducir carga al portal público.
  for (const r of registros) resultados.push(await verificarFicha(r, fetcher));
  return {fecha_consulta_utc:new Date().toISOString(), advertencia:'Comprobación de metadatos de ficha, no de contenidos PDF, disponibilidad comercial ni validación de JR.', resultados};
}
module.exports = {urlValida, verificarFicha, verificarTodas};
if (require.main === module) {
  const registros = JSON.parse(fs.readFileSync(path.join(__dirname,'piloto','manifest.json'),'utf8'));
  verificarTodas(registros).then(r => { console.log(JSON.stringify(r,null,2)); if(r.resultados.some(x=>x.estado!=='sin_cambio_detectado')) process.exitCode=1; }).catch(() => {console.error('No se pudo comprobar las fichas');process.exitCode=1;});
}
