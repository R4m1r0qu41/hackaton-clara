'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {consultar}=require('../sie-piloto');
test('devuelve fuentes RECA y SIE, sin atribuir el promedio al contrato',()=>{
 const r=consultar('0300-140-000731/30-00405-0226');
 assert.equal(r.estado,'piloto_sin_validar');
 assert.deepEqual(r.evidencia.map(x=>x.fuente),['RECA','SIE']);
 assert.equal(r.evidencia[0].pagina_pdf,6);
 assert.equal(r.evidencia[1].id_serie,'SF316116');
 assert.equal(r.relacion.tasa_del_producto_pct,null);
 assert.equal(r.relacion.cat_del_producto_pct,null);
 assert.equal(r.relacion.comparacion_cuantitativa,null);
});
test('no atribuye la referencia a otro registro sin validación',()=>{
 assert.equal(consultar('17102-140-044679/01-02644-1026').estado,'sin_vinculo_revisado');
 assert.equal(consultar('no existe').estado,'registro_no_encontrado');
});

test('conserva tope y fórmula contractual sin inventar tasa individual ni CAT',()=>{
 const r=consultar('0300-140-000731/30-00405-0226');const e=r.evidencia[0];
 assert.equal(e.interes_ordinario.maximo_contractual_anual_pct,50);
 assert.equal(e.interes_moratorio.factor_sobre_tasa_ordinaria,1.2);
 assert.equal(e.interes_ordinario.tasa_anual_cliente_pct,null);
 assert.equal(e.interes_moratorio.tasa_anual_cliente_pct,null);
 assert.equal(e.cat.valor_pct,null);
 assert.equal(e.tipo,'condiciones_intereses');
});

test('usa el promedio SIE como referencia ordinaria aceptada para el piloto',()=>{
 const r=consultar('0300-140-000731/30-00405-0226');
 assert.equal(r.relacion.tasa_ordinaria_referencia_pct,39.0809);
 assert.equal(r.relacion.serie_referencia,'SF316116');
 assert.equal(r.relacion.naturaleza_tasa,'promedio_ponderado_de_mercado');
 assert.equal(r.relacion.cat_del_producto_pct,null);
});
