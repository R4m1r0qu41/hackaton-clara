'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {verificarDocumento}=require('../origen');
const pdf=Buffer.from('%PDF-1.4\ntexto');
const doc={file:'123c.pdf',url:'https://registros.condusef.gob.mx/reca/admin/contratos_anexos/123c.pdf',sha256:createHash('sha256').update(pdf).digest('hex')};
test('solo declara coincidencia cuando el PDF y el hash coinciden',async()=>{
 assert.equal((await verificarDocumento('r',doc,async()=>({status:200,body:pdf}))).estado,'sin_cambio_detectado');
 assert.equal((await verificarDocumento('r',doc,async()=>({status:200,body:Buffer.from('%PDF-diferente')}))).estado,'cambio_detectado');
});
test('no trata errores, redirecciones o texto HTML como PDF válido',async()=>{
 for(const respuesta of [{status:302,body:pdf},{status:200,body:Buffer.from('<html>error')},{status:500,body:pdf}]) assert.equal((await verificarDocumento('r',doc,async()=>respuesta)).estado,'no_comprobado');
 assert.equal((await verificarDocumento('r',doc,async()=>{throw Error('red')})).estado,'no_comprobado');
 assert.equal((await verificarDocumento('r',{...doc,url:'https://otro.ejemplo/123c.pdf'})).estado,'no_comprobado');
});
