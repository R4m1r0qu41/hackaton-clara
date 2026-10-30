'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { convertir, escribirTabla } = require('./importar-sipres');
const { validarTabla } = require('../motor/sipres/sipres');

// Datos ficticios con la forma del JSON de la rama Eugenio (data/sipres-entidades.json).
const entidad = (nombre, razon, extra = {}) => ({
  clave_registro: '1',
  id_sipres: '1',
  nombre_comercial: nombre,
  razon_social: razon,
  estado: 'registrada',
  estado_sipres: 'En operación',
  sector: 'Sociedades Financieras Populares',
  sectores: ['Sociedades Financieras Populares'],
  buscable: true,
  entidad_federativa: 'Ciudad de México',
  fecha_consulta: '2026-10-30',
  terminos_buscados: [],
  url_ficha: 'https://ejemplo.mx/ficha',
  ...extra,
});
const fuente = (entidades) => ({ fuente: { nombre: 'SIPRES' }, fecha_consulta: '2026-10-30', total_entidades: entidades.length, entidades });

test('convierte cada entidad al formato de la tabla, con la fecha en DD/MM/AAAA', () => {
  const { tabla, omitidas } = convertir(fuente([entidad('Zafiro', 'Zafiro Soluciones, S.A. de C.V., Sociedad Financiera Popular')]));
  assert.deepEqual(omitidas, []);
  assert.deepEqual(tabla, [
    {
      nombre_comercial: 'Zafiro',
      razon_social: 'Zafiro Soluciones, S.A. de C.V., Sociedad Financiera Popular',
      estado: 'registrada',
      terminos_buscados: [],
      fecha_consulta: '30/10/2026',
      sector: 'Sociedades Financieras Populares',
      estatus: 'En operación',
    },
  ]);
});

test('la tabla convertida pasa el validador de la tabla de SIPRES', () => {
  const { tabla } = convertir(fuente([entidad('Zafiro', 'Zafiro, S.A.'), entidad('Nimbo', 'Nimbo, S.A.', { clave_registro: '2' })]));
  assert.deepEqual(validarTabla(tabla), []);
});

test('omite, con su motivo, lo que la tabla no puede usar', () => {
  const { tabla, omitidas } = convertir(
    fuente([
      entidad('Zafiro', 'Zafiro, S.A.'),
      entidad('Financiera Digital', 'Grupo Servicios, S.A.'), // solo palabras genéricas
      entidad('Nimbo', 'Nimbo, S.A.', { fecha_consulta: 'ayer' }),
      entidad('Alfa', 'Alfa, S.A.', { estado: 'cancelada' }),
      'no es una fila',
      null,
    ])
  );
  assert.equal(tabla.length, 1);
  assert.equal(omitidas.length, 5);
  const motivos = omitidas.map((o) => o.motivo).join(' | ');
  assert.match(motivos, /nombre/);
  assert.match(motivos, /fecha/);
  assert.match(motivos, /estado/);
  assert.deepEqual(omitidas.map((o) => o.indice), [1, 2, 3, 4, 5]);
});

test('acepta una fecha que ya viene en DD/MM/AAAA y deja el sector y el estatus en null si faltan', () => {
  const { tabla } = convertir(fuente([entidad('Zafiro', 'Zafiro, S.A.', { fecha_consulta: '30/10/2026', sector: undefined, estado_sipres: undefined })]));
  assert.equal(tabla[0].fecha_consulta, '30/10/2026');
  assert.equal(tabla[0].sector, null);
  assert.equal(tabla[0].estatus, null);
});

test('rechaza un archivo que no tiene la lista de entidades', () => {
  for (const malo of [null, [], {}, { entidades: 'no' }, 'texto']) {
    assert.throws(() => convertir(malo), /entidades/);
  }
});

test('escribirTabla guarda una fila por línea y se puede volver a leer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sipres-imp-'));
  try {
    const ruta = path.join(dir, 'tabla.json');
    const { tabla } = convertir(fuente([entidad('Zafiro', 'Zafiro, S.A.'), entidad('Nimbo', 'Nimbo, S.A.')]));
    escribirTabla(ruta, tabla);
    const texto = fs.readFileSync(ruta, 'utf8');
    assert.deepEqual(JSON.parse(texto), tabla);
    assert.equal(texto.trim().split('\n').length, tabla.length + 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('la línea de comandos convierte un archivo y resume lo omitido, sin escribir si falla', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sipres-cli-'));
  try {
    const entrada = path.join(dir, 'entrada.json');
    const salida = path.join(dir, 'salida.json');
    fs.writeFileSync(entrada, JSON.stringify(fuente([entidad('Zafiro', 'Zafiro, S.A.'), entidad('Financiera Digital', 'Grupo Servicios, S.A.')])));
    const ok = spawnSync(process.execPath, [path.join(__dirname, 'importar-sipres.js'), entrada, salida], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /1 convertidas/);
    assert.match(ok.stdout, /1 omitidas/);
    assert.equal(JSON.parse(fs.readFileSync(salida, 'utf8')).length, 1);

    const roto = path.join(dir, 'roto.json');
    fs.writeFileSync(roto, '{"a":');
    const salida2 = path.join(dir, 'salida2.json');
    const mal = spawnSync(process.execPath, [path.join(__dirname, 'importar-sipres.js'), roto, salida2], { encoding: 'utf8' });
    assert.equal(mal.status, 1);
    assert.ok(!fs.existsSync(salida2));
    assert.equal(spawnSync(process.execPath, [path.join(__dirname, 'importar-sipres.js')], { encoding: 'utf8' }).status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
