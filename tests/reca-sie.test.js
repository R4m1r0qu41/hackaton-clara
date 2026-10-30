import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadRecaSie,queryRecaSie} from '../rag/reca-sie.js';
import {createRagServer} from '../rag/server.js';
const corpus=loadRecaSie();
test('diez contratos íntegros y referencia SIE con periodo',()=>{
 assert.equal(corpus.records.length,10);assert.ok(corpus.records.every(r=>r.documents.length===1&&r.documents[0].label[1]==='Contrato'));
 for(const record of corpus.records){const r=queryRecaSie('interés ordinario y moratorio',{registroReca:record.registration,corpus});assert.equal(r.interesOrdinarioReferencia.valorPct,39.0809);assert.equal(r.catPct,null);assert.equal(r.tasaIndividualPct,null);assert.ok(r.results.some(e=>e.sourceType==='SIE'));assert.ok(r.results.filter(e=>e.sourceType==='RECA').every(e=>e.registroReca===record.registration&&e.page>0&&e.url&&e.sha256));}
});
test('Banamex conserva máximo contractual y factor moratorio separados del promedio',()=>{
 const r=queryRecaSie('interés moratorio',{registroReca:'0300-140-000731/30-00405-0226',corpus});
 const c=r.condiciones.find(c=>c.tipo==='condiciones_intereses');assert.equal(c.campos_candidatos.maximo_ordinario_anual_pct,50);assert.equal(c.campos_candidatos.factor_moratorio_sobre_ordinario,1.2);assert.ok(r.results.some(e=>e.sourceType==='RECA'&&e.page===6));
 assert.equal(queryRecaSie('CAT',{registroReca:'inexistente',corpus}).estado,'registro_no_encontrado');
});
test('API n8n RECA-SIE funciona sin PostgreSQL y exige autenticación',async t=>{
 const apiKey='test-'.repeat(10);const server=createRagServer({mode:'reca-sie',apiKey});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/readyz')).status,200);
 assert.equal((await fetch(base+'/reca/productos')).status,401);
 const catalog=await fetch(base+'/reca/productos',{headers:{authorization:`Bearer ${apiKey}`}});assert.equal(catalog.status,200);assert.equal((await catalog.json()).productos.length,10);
 const body=JSON.stringify({query:'tasa ordinaria y CAT',registroReca:'0300-140-000731/30-00405-0226'});
 assert.equal((await fetch(base+'/query',{method:'POST',headers:{'content-type':'application/json'},body})).status,401);
 const r=await fetch(base+'/query',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`},body});assert.equal(r.status,200);const data=await r.json();assert.equal(data.interesOrdinarioReferencia.serie,'SF316116');assert.equal(data.catPct,null);assert.ok(data.results.some(e=>e.sourceType==='SIE'));
 const missing=await fetch(base+'/query',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`},body:JSON.stringify({query:'CAT'})});assert.equal(missing.status,400);
});
test('rechaza una captura cuyo texto fue alterado', async()=>{
 const fs=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reca-integridad-'));
 try{
  const source=new URL('../data/reca/',import.meta.url);await fs.cp(source,dir,{recursive:true});const r=corpus.records[0];const file=r.documents[0].file.replace('.pdf','.txt');await fs.appendFile(path.join(dir,'documentos',file),'alterado');assert.throws(()=>loadRecaSie(dir),/evidencia RECA cambió/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
