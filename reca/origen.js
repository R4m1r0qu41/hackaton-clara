'use strict';
// Compara contenido público de origen con la captura local, sin escribir los PDF.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const exec = promisify(execFile);
const MAX = 15 * 1024 * 1024;
function urlValida(doc) {
  try {
    const u=new URL(doc.url);
    return u.protocol==='https:' && u.hostname==='registros.condusef.gob.mx' && !u.port && !u.username && !u.password && !u.search && !u.hash && /^[A-Za-z0-9_-]+\.pdf$/.test(doc.file) && u.pathname===`/reca/admin/contratos_anexos/${doc.file}`;
  } catch {return false;}
}
async function descarga(url) {
  const args=['--silent','--show-error','--max-time','20','--max-filesize',String(MAX),'--proto','=https','--write-out','\n%{http_code}','--',url];
  const {stdout}=await exec('curl',args,{encoding:'buffer',maxBuffer:MAX+32,timeout:22000});
  if(stdout.length<4 || stdout[stdout.length-4]!==10) throw Error('respuesta HTTP inválida');
  return {status:Number(stdout.subarray(-3).toString()), body:stdout.subarray(0,-4)};
}
async function verificarDocumento(registro, doc, descargar=descarga) {
  const base={registro,documento:doc.file,url:doc.url,sha256_capturado:doc.sha256};
  if(!urlValida(doc))return {...base,estado:'no_comprobado',motivo:'URL inválida'};
  try {
    const r=await descargar(doc.url);
    if(r.status!==200)return {...base,estado:'no_comprobado',motivo:`HTTP ${r.status}`};
    if(!Buffer.isBuffer(r.body) || r.body.length>MAX || !r.body.subarray(0,5).equals(Buffer.from('%PDF-')))return {...base,estado:'no_comprobado',motivo:'Respuesta no es PDF válido o excede el límite'};
    const hash=createHash('sha256').update(r.body).digest('hex');
    return {...base,sha256_origen:hash,estado:hash===doc.sha256?'sin_cambio_detectado':'cambio_detectado'};
  } catch {return {...base,estado:'no_comprobado',motivo:'Error de red o lectura'};}
}
async function verificarTodos(registros,descargar=descarga) {
  const resultados=[];
  for(const r of registros)for(const d of r.documents) resultados.push(await verificarDocumento(r.registration,d,descargar));
  return {fecha_consulta_utc:new Date().toISOString(),advertencia:'Compara bytes descargados sin verificar disponibilidad comercial ni validez de condiciones.',resultados};
}
module.exports={urlValida,verificarDocumento,verificarTodos};
if(require.main===module){
 const bytes=fs.readFileSync(path.join(__dirname,'piloto','manifest.json'));const registros=JSON.parse(bytes);
 verificarTodos(registros).then(r=>{r.manifest_sha256=createHash('sha256').update(bytes).digest('hex');console.log(JSON.stringify(r,null,2));if(r.resultados.some(x=>x.estado!=='sin_cambio_detectado'))process.exitCode=1;}).catch(()=>{console.error('No se pudo verificar el origen');process.exitCode=1;});
}
