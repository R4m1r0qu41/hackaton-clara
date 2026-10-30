'use strict';
// Ensamble piloto de evidencias; no calcula ni atribuye la tasa SIE al producto.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
function consultar(registro, root=path.join(__dirname,'piloto')) {
 const manifest=fs.readFileSync(path.join(root,'manifest.json'));
 const piloto=JSON.parse(fs.readFileSync(path.join(root,'sie-piloto.json'),'utf8'));
 if(createHash('sha256').update(manifest).digest('hex')!==piloto.manifest_sha256)throw Error('El manifiesto cambió; revisión requerida');
 const productos=JSON.parse(manifest);
 const producto=productos.find(x=>x.registration===registro);
 if(!producto)return {estado:'registro_no_encontrado',evidencia:[]};
 if(registro!==piloto.registro_reca)return {estado:'sin_vinculo_revisado',registro,evidencia:[]};
 const contrato=producto.documents.find(x=>x.url===piloto.reca.documento_url && x.sha256===piloto.reca.sha256);
 if(!contrato || piloto.reca.pagina_pdf<1 || piloto.reca.pagina_pdf>contrato.text_pages)throw Error('La evidencia del contrato no coincide');
 const pdf=fs.readFileSync(path.join(root,'documentos',contrato.file));
 if(createHash('sha256').update(pdf).digest('hex')!==contrato.sha256)throw Error('El contrato no coincide con su hash');
 return {estado:piloto.estado,registro,producto:piloto.producto,evidencia:[{fuente:'RECA',...piloto.reca},{fuente:'SIE',...piloto.sie}],relacion:piloto.relacion,advertencia:piloto.observaciones};
}
module.exports={consultar};
if(require.main===module){try{console.log(JSON.stringify(consultar(process.argv[2]),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
