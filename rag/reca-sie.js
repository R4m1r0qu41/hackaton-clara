import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const defaultRoot = fileURLToPath(new URL('../data/reca/', import.meta.url));
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const tokens = s => norm(s).match(/[a-z0-9]+/g) || [];
const hash = b => createHash('sha256').update(b).digest('hex');
export function loadRecaSie(root=defaultRoot) {
 const records=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 const reference=JSON.parse(fs.readFileSync(path.join(root,'sie.json'),'utf8'));
 const clauses=JSON.parse(fs.readFileSync(path.join(root,'clausulas.json'),'utf8')).hallazgos;
 if(reference.id_serie!=='SF316116' || !Number.isFinite(reference.valor_pct))throw Error('Referencia SIE inválida');
 const seen=new Set();
 for(const r of records){
  if(seen.has(r.registration))throw Error('Registro RECA duplicado');seen.add(r.registration);
  for(const d of r.documents){
   if(!/^[A-Za-z0-9_-]+\.pdf$/.test(d.file))throw Error('Nombre PDF inválido');
   const pdf=fs.readFileSync(path.join(root,'documentos',d.file));
   const text=fs.readFileSync(path.join(root,'documentos',d.file.replace(/\.pdf$/,'.txt')));
   if(hash(pdf)!==d.sha256 || hash(text)!==d.text_sha256)throw Error('La evidencia RECA cambió');
   d.pages=text.toString('utf8').split('\f');if(!d.pages.at(-1).trim())d.pages.pop();
  }
 }
 for(const c of clauses){const r=records.find(r=>r.registration===c.numero_reca);const d=r?.documents.find(d=>d.url===c.origen.url && d.sha256===c.origen.sha256);if(!d || c.origen.pagina_pdf<1 || c.origen.pagina_pdf>d.pages.length)throw Error('Cláusula sin evidencia');}
 return {records,reference,clauses};
}
let cached;
export function queryRecaSie(question,{registroReca,topK=5,corpus}={}) {
 if(typeof question!=='string' || !question.trim() || question.length>4000)throw Error('Pregunta inválida');
 if(typeof registroReca!=='string' || !registroReca.trim())throw Error('Se requiere registroReca');
 if(!Number.isSafeInteger(topK)||topK<1||topK>100)throw Error('topK inválido');
 const {records,reference,clauses}=corpus || (cached ||= loadRecaSie());
 const record=records.find(r=>r.registration===registroReca);
 if(!record)return {results:[],estado:'registro_no_encontrado',registroReca};
 const ignored=new Set('que cual cuales cuanto como del las los una para con por tiene este producto credito de el la en es se un'.split(' '));
 const terms=[...new Set(tokens(question).filter(t=>t.length>2&&!ignored.has(t)))];
 const matches=[];
 for(const d of record.documents)for(const [index,text] of d.pages.entries()){
  const words=new Set(tokens(text));let score=terms.filter(t=>words.has(t)).length;
  if(terms.some(t=>t.startsWith('moratori')) && ![...words].some(t=>t.startsWith('moratori')))score=0;
  if(terms.some(t=>t.startsWith('ordinari')) && ![...words].some(t=>t.startsWith('ordinari')))score=0;
  if(score)matches.push({text,source:d.file,page:index+1,chunkIndex:0,score,sourceType:'RECA',url:d.url,sha256:d.sha256,registroReca,fechaConsulta:record.verified_at_utc});
 }
 matches.sort((a,b)=>b.score-a.score || a.page-b.page);
 const referenceResult={text:`Interés ordinario de referencia: ${reference.valor_pct}%, promedio ponderado de cartera comparable de créditos personales. Periodo: ${reference.periodo_publicado}. No es CAT ni tasa individual del producto.`,source:reference.id_serie,page:null,chunkIndex:0,sourceType:'SIE',url:reference.fuente_datos,fechaConsulta:reference.fecha_consulta_utc,periodo:reference.periodo_publicado};
 return {results:[...matches.slice(0,topK),referenceResult],estado:'piloto_referencia_promedio',estadoRecuperacionContrato:matches.length?'con_evidencia':'sin_coincidencias',registroReca,producto:record.product,condiciones:clauses.filter(c=>c.numero_reca===registroReca),interesOrdinarioReferencia:{valorPct:reference.valor_pct,naturaleza:'promedio_mercado',serie:reference.id_serie,periodo:reference.periodo_publicado,aplicabilidadAlProducto:'no_verificada'},catPct:null,tasaIndividualPct:null,estadoReca:record.status_code,advertencias:['Referencia SIE aceptada para el piloto; no es CAT ni tasa individual.','La pertenencia de cada producto a la cartera estadística y la comparabilidad no están verificadas.','Los fragmentos RECA y cláusulas son evidencia candidata, pendiente de validación de JR.','No se calcula capacidad de pago ni se garantiza evitar sobreendeudamiento.']};
}
