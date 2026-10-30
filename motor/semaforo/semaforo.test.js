'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { semaforo } = require('./semaforo');

const calculoTienda = (pct, metricas = {}) => ({
  estado: 'ok',
  tipo: 'tienda',
  metricas: { costo_total: 11000, precio_contado: 10000, sobrecosto_pesos: Math.round(pct * 100), sobrecosto_pct: pct, ...metricas },
  cat: { texto: '30.0%' },
  advertencias: [],
});

const calculoPrestamo = (metricas = {}) => ({
  estado: 'ok',
  tipo: 'prestamo',
  metricas: {
    monto_ofrecido: 10000,
    recibes: 10000,
    pagas: 11000,
    costo_credito_pesos: 1000,
    costo_pct_sobre_recibido: 10,
    diferencia_ofrecido_depositado: 0,
    cargos_iniciales_declarados: 0,
    ...metricas,
  },
  cat: { texto: '25.0%' },
  advertencias: [],
});

const sipres = (estado = 'registrada', extra = {}) => ({
  estado,
  fecha_consulta: '30/10/2026',
  terminos_buscados: ['Zafiro', 'Zafiro Soluciones'],
  ...extra,
});

const senales = (extra = {}) => ({
  pide_anticipo: false,
  pide_permiso_contactos: false,
  pide_permiso_fotos_archivos: false,
  deposito_menor_a_ofrecido: false,
  plazo_menor_a_15_dias: false,
  presion_urgencia: false,
  texto_evidencia: [],
  ...extra,
});

const razon = (r, codigo) => r.razones.find((x) => x.codigo === codigo);
const congelar = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && congelar(v));
  return Object.freeze(o);
};
const EXTRACCION = { reglasDeExtraccion: true };

test('tienda: bajo el umbral amarillo da verde y no recomienda contratar', () => {
  const r = semaforo({ calculo: calculoTienda(14.9) });
  assert.equal(r.color, 'verde');
  assert.equal(r.razones[0].codigo, 'sobrecosto');
  assert.equal(r.razones[0].nivel, 'verde');
  assert.match(r.leyenda, /no es una recomendación/i);
});

test('tienda: 15% es amarillo y 50% es rojo', () => {
  assert.equal(semaforo({ calculo: calculoTienda(15) }).color, 'amarillo');
  assert.equal(semaforo({ calculo: calculoTienda(49.9) }).color, 'amarillo');
  assert.equal(semaforo({ calculo: calculoTienda(50) }).color, 'rojo');
});

test('tienda: el hecho cita los montos del cálculo', () => {
  const r = semaforo({ calculo: calculoTienda(20, { costo_total: 12000, precio_contado: 10000, sobrecosto_pesos: 2000 }) });
  const hecho = razon(r, 'sobrecosto').hecho;
  assert.ok(hecho.includes('$12,000'));
  assert.ok(hecho.includes('$10,000'));
  assert.ok(hecho.includes('20%'));
});

test('tienda: un sobrecosto negativo o desconocido da gris', () => {
  for (const pct of [-5, null]) {
    const r = semaforo({ calculo: calculoTienda(pct) });
    assert.equal(r.color, 'gris');
    assert.equal(r.razones[0].codigo, 'datos_incoherentes');
  }
});

test('sin cálculo válido da gris', () => {
  for (const entrada of [undefined, {}, { calculo: { estado: 'error' } }]) {
    const r = semaforo(entrada);
    assert.equal(r.color, 'gris');
    assert.equal(r.razones[0].codigo, 'sin_calculo');
  }
});

test('préstamo: no registrada confirmada es rojo, con fecha y términos como evidencia', () => {
  const r = semaforo({ calculo: calculoPrestamo(), sipres: sipres('no_registrada_confirmada') });
  assert.equal(r.color, 'rojo');
  const x = razon(r, 'sipres_no_registrada_confirmada');
  assert.equal(x.nivel, 'rojo');
  assert.ok(x.hecho.includes('30/10/2026'));
  assert.deepEqual(x.evidencia, ['Términos buscados: Zafiro, Zafiro Soluciones']);
  assert.equal(r.estado_sipres, 'no_registrada_confirmada');
});

test('préstamo: no registrada sin fecha o con un solo término no es rojo', () => {
  const sinFecha = semaforo({ calculo: calculoPrestamo(), sipres: sipres('no_registrada_confirmada', { fecha_consulta: null }) });
  const unTermino = semaforo({ calculo: calculoPrestamo(), sipres: sipres('no_registrada_confirmada', { terminos_buscados: ['Zafiro'] }) });
  for (const r of [sinFecha, unTermino]) {
    assert.equal(r.color, 'gris');
    assert.equal(r.estado_sipres, 'sin_verificar');
    assert.ok(r.advertencias.includes('sipres_confirmacion_insuficiente'));
  }
});

test('préstamo: registrada y costo bajo da verde', () => {
  const r = semaforo({ calculo: calculoPrestamo(), sipres: sipres('registrada') });
  assert.equal(r.color, 'verde');
  assert.equal(razon(r, 'sipres_registrada').nivel, 'verde');
  assert.ok(razon(r, 'sin_senales_de_riesgo'));
});

test('préstamo: sin verificar da gris, nunca rojo', () => {
  const r = semaforo({ calculo: calculoPrestamo(), sipres: sipres('sin_verificar') });
  assert.equal(r.color, 'gris');
  assert.equal(razon(r, 'sipres_sin_verificar').nivel, 'gris');
});

test('préstamo: sin dato de SIPRES se trata como sin verificar', () => {
  const r = semaforo({ calculo: calculoPrestamo() });
  assert.equal(r.color, 'gris');
  assert.equal(r.estado_sipres, 'sin_verificar');
});

test('préstamo: un estado de SIPRES desconocido se trata como sin verificar', () => {
  const r = semaforo({ calculo: calculoPrestamo(), sipres: sipres('quien_sabe') });
  assert.equal(r.color, 'gris');
  assert.ok(r.advertencias.includes('estado_sipres_invalido'));
});

test('préstamo: sin verificar con costo alto sigue gris y lista el costo como amarillo', () => {
  const r = semaforo({ calculo: calculoPrestamo({ costo_pct_sobre_recibido: 80, costo_credito_pesos: 8000, pagas: 18000 }), sipres: sipres('sin_verificar') });
  assert.equal(r.color, 'gris');
  assert.equal(razon(r, 'costo_alto').nivel, 'amarillo');
});

test('préstamo: registrada con costo de 50% o más sobre lo recibido es amarillo', () => {
  const alto = calculoPrestamo({ costo_pct_sobre_recibido: 50, costo_credito_pesos: 5000, pagas: 15000 });
  const casiAlto = calculoPrestamo({ costo_pct_sobre_recibido: 49.9, costo_credito_pesos: 4990, pagas: 14990 });
  assert.equal(semaforo({ calculo: alto, sipres: sipres() }).color, 'amarillo');
  assert.equal(semaforo({ calculo: casiAlto, sipres: sipres() }).color, 'verde');
});

test('por defecto las señales que extrae el modelo no producen rojo', () => {
  const r = semaforo({
    calculo: calculoPrestamo(),
    senales: senales({ pide_anticipo: true, texto_evidencia: ['Deposita primero $500'] }),
    sipres: sipres(),
  });
  assert.equal(r.color, 'verde');
  assert.equal(razon(r, 'pide_anticipo'), undefined);
});

test('con reglas de extracción, pedir anticipo con evidencia literal es rojo', () => {
  const r = semaforo(
    { calculo: calculoPrestamo(), senales: senales({ pide_anticipo: true, texto_evidencia: ['Deposita primero $500'] }), sipres: sipres() },
    EXTRACCION
  );
  assert.equal(r.color, 'rojo');
  assert.deepEqual(razon(r, 'pide_anticipo').evidencia, ['Deposita primero $500']);
});

test('con reglas de extracción, una señal sin evidencia literal se ignora con advertencia', () => {
  const r = semaforo({ calculo: calculoPrestamo(), senales: senales({ pide_anticipo: true }), sipres: sipres() }, EXTRACCION);
  assert.equal(r.color, 'verde');
  assert.ok(r.advertencias.includes('senal_sin_evidencia:pide_anticipo'));
});

test('con reglas de extracción, un depósito menor sin cargos que lo expliquen es rojo', () => {
  const calculo = calculoPrestamo({ monto_ofrecido: 5000, recibes: 4500, diferencia_ofrecido_depositado: 500, cargos_iniciales_declarados: 0 });
  const r = semaforo({ calculo, sipres: sipres() }, EXTRACCION);
  assert.equal(r.color, 'rojo');
  assert.equal(razon(r, 'deposito_menor_sin_explicacion').nivel, 'rojo');
});

test('con reglas de extracción, un depósito explicado por cargos declarados es informativo', () => {
  const calculo = calculoPrestamo({ monto_ofrecido: 10000, recibes: 9500, diferencia_ofrecido_depositado: 500, cargos_iniciales_declarados: 500 });
  const r = semaforo({ calculo, sipres: sipres() }, EXTRACCION);
  assert.equal(r.color, 'verde');
  assert.equal(razon(r, 'deposito_menor_con_cargos').nivel, 'info');
});

test('con reglas de extracción, una diferencia de $1 cabe en la tolerancia', () => {
  const calculo = calculoPrestamo({ diferencia_ofrecido_depositado: 1, cargos_iniciales_declarados: 0 });
  assert.equal(semaforo({ calculo, sipres: sipres() }, EXTRACCION).color, 'verde');
});

test('por defecto el depósito menor tampoco produce rojo', () => {
  const calculo = calculoPrestamo({ monto_ofrecido: 5000, recibes: 4500, diferencia_ofrecido_depositado: 500, cargos_iniciales_declarados: 0 });
  assert.equal(semaforo({ calculo, sipres: sipres() }).color, 'verde');
});

test('todas las razones rojas se listan y el resumen las cuenta', () => {
  const r = semaforo(
    { calculo: calculoPrestamo(), senales: senales({ pide_anticipo: true, texto_evidencia: ['Paga primero'] }), sipres: sipres('no_registrada_confirmada') },
    EXTRACCION
  );
  assert.equal(r.color, 'rojo');
  assert.equal(r.resumen.rojas, 2);
});

test('las razones salen ordenadas por nivel', () => {
  const calculo = calculoPrestamo({
    monto_ofrecido: 10000,
    recibes: 9500,
    diferencia_ofrecido_depositado: 500,
    cargos_iniciales_declarados: 500,
    costo_pct_sobre_recibido: 60,
    costo_credito_pesos: 5700,
    pagas: 15200,
  });
  const r = semaforo({ calculo, sipres: sipres() }, EXTRACCION);
  assert.equal(r.color, 'amarillo');
  assert.deepEqual(r.razones.map((x) => x.nivel), ['amarillo', 'verde', 'info']);
  assert.equal(r.resumen.amarillas, 1);
});

test('los umbrales se pueden ajustar', () => {
  assert.equal(semaforo({ calculo: calculoTienda(35) }, { umbrales: { tienda: { rojo_desde_pct: 30 } } }).color, 'rojo');
});

test('no modifica sus entradas', () => {
  const entrada = congelar({ calculo: calculoPrestamo(), senales: senales(), sipres: sipres() });
  assert.doesNotThrow(() => semaforo(entrada, EXTRACCION));
});
