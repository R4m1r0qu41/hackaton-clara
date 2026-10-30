'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {urlValida, verificarFicha} = require('../actualidad');
const ficha={registration:'reg-1',current_version:'reg-1',status_code:'1',detail_url:'https://registros.condusef.gob.mx/reca/tarjeta_nueva.php?pidact=1'};
const html = obj => new Response(`const contractData = ${JSON.stringify(obj)};`);
const data = {currentVersion:'reg-1',selectedVersion:'reg-1',contractStatus:'1',isCurrentVersion:true};
test('detecta cambios en versión y estado de la ficha', async () => {
 assert.equal((await verificarFicha(ficha, async()=>html(data))).estado, 'sin_cambio_detectado');
 assert.equal((await verificarFicha(ficha, async()=>html({...data,currentVersion:'reg-2'}))).estado, 'cambio_detectado');
 assert.equal((await verificarFicha(ficha, async()=>html({...data,contractStatus:'3'}))).estado, 'cambio_detectado');
});
test('errores, redirecciones y formatos desconocidos no se interpretan como vigencia', async () => {
 assert.equal((await verificarFicha(ficha, async()=>new Response('',{status:302}))).estado,'no_comprobado');
 assert.equal((await verificarFicha(ficha, async()=>new Response('texto extraño'))).estado,'no_comprobado');
 assert.equal((await verificarFicha(ficha, async()=>{throw Error('sin red')})).estado,'no_comprobado');
 assert.equal(urlValida('https://registros.condusef.gob.mx.ejemplo/reca/tarjeta_nueva.php'),false);
});
test('no acepta respuestas incompletas o demasiado grandes', async () => {
 assert.equal((await verificarFicha(ficha, async()=>html({currentVersion:'reg-1'}))).estado,'no_comprobado');
 assert.equal((await verificarFicha(ficha, async()=>new Response('x'.repeat(2*1024*1024+1)))).estado,'no_comprobado');
});
test('una selección que dejó de ser actual se marca como cambio', async () => {
 assert.equal((await verificarFicha(ficha, async()=>html({...data,isCurrentVersion:false}))).estado,'cambio_detectado');
});
