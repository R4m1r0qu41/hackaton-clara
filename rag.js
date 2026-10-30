// server/rag.js — Recuperación determinista para /api/explicar. Sin dependencias.
// Junta: entidad + producto + comparables de su categoría + referencia + fragmentos de conocimiento.
import { readFileSync } from 'node:fs';

const leer = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const entidades = leer('entidades.json');
const productos = leer('products.verified.json');
const referencias = leer('referencias.json');
const conocimiento = leer('conocimiento.json');

const norm = (s) => (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function buscarConocimiento(pregunta, max = 3) {
  const q = norm(pregunta);
  return conocimiento
    .map((k) => ({ k, score: k.palabras.filter((p) => q.includes(norm(p))).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.k);
}

export function recuperar({ entidad_id, producto_id, pregunta = '' }) {
  const producto = productos.find((p) => p.id === producto_id) ?? null;
  const entidad = entidades.find((e) => e.id === (entidad_id ?? producto?.entidad_id)) ?? null;
  const comparables = producto
    ? productos.filter((p) => p.categoria === producto.categoria && p.id !== producto.id)
    : [];
  const ref = producto ? referencias.cat_por_categoria[producto.categoria] ?? null : null;
  const textos = buscarConocimiento(pregunta);

  const items = [
    entidad && { tipo: 'entidad', dato: entidad, url: entidad.evidencia.url, fecha: entidad.evidencia.fecha_consulta },
    producto && { tipo: 'producto', dato: producto, url: producto.evidencia.url, fecha: producto.evidencia.periodo },
    ...comparables.map((c) => ({ tipo: 'comparable', dato: { nombre: c.nombre, cat_pct: c.cat_pct }, url: c.evidencia.url, fecha: c.evidencia.periodo })),
    ref && ref.url && { tipo: 'referencia', dato: ref, url: ref.url, fecha: ref.periodo },
    { tipo: 'referencia', dato: referencias.inflacion, url: referencias.inflacion.url, fecha: referencias.inflacion.periodo },
    ...textos.map((k) => ({ tipo: 'conocimiento', dato: k.texto, url: k.url, fecha: k.fecha_captura })),
  ].filter(Boolean);

  return items.map((it, i) => ({ ref: `E${i + 1}`, ...it }));
}

// Valida que la respuesta del modelo cite solo referencias que existen.
export function citasValidas(texto, evidencia) {
  const citas = [...texto.matchAll(/\[E(\d+)\]/g)].map((m) => Number(m[1]));
  return citas.length > 0 && citas.every((n) => n >= 1 && n <= evidencia.length);
}
