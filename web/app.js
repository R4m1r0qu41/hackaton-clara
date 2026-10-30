'use strict';

/**
 * Página de Crédito Claro. Habla solo con rutas abiertas de /api (sin X-Bot-Key ni claves).
 * Todo lo que llega del servidor se inserta como texto (textContent), nunca como HTML.
 */
(function () {
  const L = window.Logica;
  const ESPERA_MS = 10000;
  const EJEMPLO_OFERTA = 'Préstamo de $5,000, me depositan $4,200, 4 pagos quincenales de $1,600';

  let datosAl = null;
  let accesoCargado = false;

  // ---------- utilidades ----------

  function el(etiqueta, opciones, ...hijos) {
    const nodo = document.createElement(etiqueta);
    const o = opciones || {};
    if (o.clase) nodo.className = o.clase;
    if (o.texto !== undefined) nodo.textContent = o.texto;
    if (o.attrs) for (const [k, v] of Object.entries(o.attrs)) nodo.setAttribute(k, v);
    for (const h of hijos) if (h) nodo.append(h);
    return nodo;
  }

  function vaciar(nodo) {
    while (nodo.firstChild) nodo.removeChild(nodo.firstChild);
  }

  function enlace(url, texto) {
    if (!L.esUrlSegura(url)) return el('span', { texto });
    return el('a', { texto, attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' } });
  }

  function icono(variante) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const uso = document.createElementNS(ns, 'use');
    const ok = variante === 'ok';
    uso.setAttribute('href', ok ? '#ic-ok' : '#ic-advertencia');
    svg.appendChild(uso);
    svg.setAttribute('class', `icono ${variante === 'advertencia-confirmada' ? 'tri-confirmada' : ok ? 'tri-ok' : 'tri-bn'}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', ok ? 'Registrada' : 'Advertencia');
    return svg;
  }

  class ErrorApi extends Error {}

  async function api(ruta, opciones) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), ESPERA_MS);
    try {
      const resp = await fetch(ruta, {
        ...opciones,
        signal: control.signal,
        headers: { 'Content-Type': 'application/json' },
      });
      let datos = null;
      try { datos = await resp.json(); } catch { /* cuerpo no JSON */ }
      if (!resp.ok) {
        throw new ErrorApi((datos && datos.error && datos.error.mensaje) || 'El servidor respondió con un error.');
      }
      return datos;
    } catch (e) {
      if (e instanceof ErrorApi) throw e;
      throw new ErrorApi('No hay conexión con el servidor. Intenta de nuevo en un momento.');
    } finally {
      clearTimeout(reloj);
    }
  }

  function mostrarError(nodo, mensaje) {
    nodo.textContent = mensaje;
    nodo.hidden = false;
  }

  function limpiarError(nodo) {
    nodo.textContent = '';
    nodo.hidden = true;
  }

  function franjaEjemplo() {
    return el('p', { clase: 'franja-ejemplo', texto: 'Datos de ejemplo: no son reales.' });
  }

  function bloqueSipres(estado) {
    const v = L.vistaSipres(estado);
    if (!v) return null;
    const cuerpo = el('div', null, el('h3', { texto: v.titulo }));
    if (v.enlace) {
      cuerpo.append(el('p', null, enlace(L.SIPRES_URL, 'Verifícala en SIPRES (CONDUSEF)')));
    }
    return el('div', { clase: 'sipres' }, icono(v.icono), cuerpo);
  }

  // ---------- rutas ----------

  const VISTAS = ['inicio', 'oferta', 'entidad', 'acceso'];

  function mostrarVista() {
    const hash = location.hash.replace(/^#\/?/, '');
    const id = VISTAS.includes(hash) ? hash : 'inicio';
    for (const v of VISTAS) document.getElementById(v).hidden = v !== id;
    document.body.dataset.vista = id;
    const titulo = document.querySelector(`#${id} h1, #${id} h2`);
    if (titulo) titulo.focus({ preventScroll: false });
    if (id === 'acceso' && !accesoCargado) cargarAcceso();
  }

  // ---------- inicio ----------

  async function cargarSalud() {
    const linea = document.getElementById('linea-salud');
    try {
      const s = await api('/api/salud');
      datosAl = s && s.datos_al ? String(s.datos_al) : null;
      const partes = [datosAl ? `Datos consultados al ${datosAl}.` : 'El servidor no indicó la fecha de los datos.'];
      partes.push(s && s.ia ? 'Modelo de IA disponible.' : 'Sin modelo de IA: se usan plantillas fijas.');
      linea.textContent = partes.join(' ');
    } catch (e) {
      linea.textContent = 'Sin conexión con el servidor.';
    }
  }

  // ---------- oferta ----------

  function pintarOferta(resp) {
    const destino = document.getElementById('resultado-oferta');
    vaciar(destino);
    if (L.esEjemplo(resp)) destino.append(franjaEjemplo());

    const tarjeta = el('div', { clase: 'tarjeta' });
    const sem = L.vistaSemaforo(resp.color, datosAl);
    if (sem) {
      tarjeta.append(el('div', { clase: `semaforo ${sem.clave}` },
        el('span', { clase: 'punto', attrs: { 'aria-hidden': 'true' } }),
        el('div', null,
          el('div', { clase: 'palabra', texto: sem.palabra }),
          el('p', { clase: 'linea', texto: sem.linea }))));
    }
    tarjeta.append(el('p', { clase: 'texto-respuesta', texto: typeof resp.texto === 'string' ? resp.texto : '' }));
    const origen = L.textoOrigen(resp.origen);
    tarjeta.append(el('p', null,
      el('span', { clase: 'etiqueta', texto: origen.etiqueta }), ' ',
      el('span', { clase: 'nota', texto: origen.detalle })));
    destino.append(tarjeta);

    const sipres = bloqueSipres(resp.estado_sipres);
    if (sipres) destino.append(el('div', { clase: 'tarjeta' }, sipres));

    const avisos = L.avisosLegibles(resp.advertencias);
    if (avisos.length) {
      const lista = el('ul');
      for (const a of avisos) lista.append(el('li', { texto: a }));
      destino.append(el('div', { clase: 'tarjeta' }, el('h3', { texto: 'Avisos' }), lista));
    }

    destino.append(panelFuente(resp));
  }

  /** «¿De dónde sale?»: lista las fuentes si el servidor las manda; si no, lo dice. */
  function panelFuente(resp) {
    const panel = el('details', { clase: 'tarjeta fuente' }, el('summary', { texto: '¿De dónde sale?' }));
    const fuentes = Array.isArray(resp.fuentes) ? resp.fuentes : [];
    if (fuentes.length) {
      const lista = el('ul');
      for (const f of fuentes) {
        const partes = [f.autoridad, f.periodo ? `periodo ${f.periodo}` : null, f.consultado_en ? `consultado el ${f.consultado_en}` : null]
          .filter(Boolean).join(' · ');
        lista.append(el('li', null, enlace(f.url, partes || 'Fuente')));
      }
      panel.append(lista);
    } else {
      panel.append(el('p', { texto: 'Esta respuesta todavía no trae sus fuentes desde el servidor. No tomes las cifras como verificadas.' }));
    }
    if (resp.estado_sipres && resp.estado_sipres !== 'n.a.') {
      panel.append(el('p', null, 'Estado SIPRES: ', enlace(L.SIPRES_URL, 'consulta oficial de CONDUSEF')));
    }
    return panel;
  }

  function iniciarOferta() {
    const form = document.getElementById('form-oferta');
    const campo = document.getElementById('texto-oferta');
    const error = document.getElementById('error-oferta');
    const boton = form.querySelector('button[type="submit"]');

    document.getElementById('cargar-ejemplo').addEventListener('click', () => {
      campo.value = EJEMPLO_OFERTA;
      limpiarError(error);
      campo.focus();
    });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      limpiarError(error);
      if (!L.textoValido(campo.value)) {
        mostrarError(error, campo.value.trim() ? `El texto no puede pasar de ${L.MAX_TEXTO} caracteres.` : 'Pega primero el texto de la oferta.');
        campo.focus();
        return;
      }
      boton.disabled = true;
      boton.textContent = 'Revisando…';
      vaciar(document.getElementById('resultado-oferta'));
      try {
        pintarOferta(await api('/api/consulta', { method: 'POST', body: JSON.stringify({ texto: campo.value }) }));
      } catch (e) {
        mostrarError(error, e.message);
      } finally {
        boton.disabled = false;
        boton.textContent = 'Revisar';
      }
    });
  }

  // ---------- entidad ----------

  function pintarEntidad(resp) {
    const destino = document.getElementById('resultado-entidad');
    vaciar(destino);
    if (L.esEjemplo(resp)) destino.append(franjaEjemplo());

    const bloque = bloqueSipres(resp.estado);
    const tarjeta = el('div', { clase: 'tarjeta' }, bloque);
    if (resp.entidad) tarjeta.append(el('p', null, el('strong', { texto: String(resp.entidad) })));
    if (resp.fecha_consulta) tarjeta.append(el('p', { texto: `Consulta del ${resp.fecha_consulta}.` }));
    if (Array.isArray(resp.terminos_buscados) && resp.terminos_buscados.length) {
      tarjeta.append(el('p', { texto: `Términos buscados: ${resp.terminos_buscados.join(', ')}.` }));
    }
    destino.append(tarjeta);

    const avisos = L.avisosLegibles(resp.advertencias);
    if (avisos.length) {
      const lista = el('ul');
      for (const a of avisos) lista.append(el('li', { texto: a }));
      destino.append(el('div', { clase: 'tarjeta' }, el('h3', { texto: 'Avisos' }), lista));
    }
    destino.append(el('p', { clase: 'nota' }, 'Para cualquier otra institución, búscala directamente en ',
      enlace(L.SIPRES_URL, 'SIPRES de CONDUSEF'), '.'));
  }

  function iniciarEntidad() {
    const form = document.getElementById('form-entidad');
    const campo = document.getElementById('q-entidad');
    const error = document.getElementById('error-entidad');
    const boton = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      limpiarError(error);
      if (!L.consultaValida(campo.value)) {
        mostrarError(error, `Escribe al menos ${L.MIN_BUSQUEDA} letras.`);
        campo.focus();
        return;
      }
      boton.disabled = true;
      vaciar(document.getElementById('resultado-entidad'));
      try {
        pintarEntidad(await api(`/api/verificar?q=${encodeURIComponent(campo.value.trim())}`));
      } catch (e) {
        mostrarError(error, e.message);
      } finally {
        boton.disabled = false;
      }
    });
  }

  // ---------- acceso por estado ----------

  async function cargarAcceso() {
    const destino = document.getElementById('resultado-acceso');
    vaciar(destino);
    destino.append(el('p', { clase: 'nota', texto: 'Cargando…' }));
    try {
      const datos = await api('/api/acceso/estados');
      accesoCargado = true;
      pintarAcceso(datos);
    } catch (e) {
      vaciar(destino);
      destino.append(el('p', { clase: 'error', texto: e.message }));
      const reintentar = el('button', { clase: 'boton secundario', texto: 'Reintentar', attrs: { type: 'button' } });
      reintentar.addEventListener('click', cargarAcceso);
      destino.append(reintentar);
    }
  }

  function pintarAcceso(datos) {
    const destino = document.getElementById('resultado-acceso');
    vaciar(destino);
    if (L.esEjemplo(datos)) destino.append(franjaEjemplo());

    const ficha = el('div', { clase: 'tarjeta' },
      el('h3', { texto: datos.indicador || 'Indicador sin nombre' }),
      el('p', { texto: `Unidad: ${datos.unidad || 'dato faltante'}` }),
      el('p', { texto: `Periodo: ${datos.periodo || 'dato faltante'}` }),
      el('p', null, 'Fuente: ', datos.fuente_url ? enlace(datos.fuente_url, 'fuente oficial') : 'dato faltante'));
    destino.append(ficha);

    const detalle = el('div', { clase: 'tarjeta', attrs: { 'aria-live': 'polite' } },
      el('p', { clase: 'nota', texto: 'Toca un estado para ver su detalle.' }));
    const lista = el('ul', { clase: 'estados' });
    const filas = [];

    for (const b of L.barras(datos.estados)) {
      const boton = el('button', { clase: 'estado-fila', attrs: { type: 'button', 'aria-pressed': 'false' } },
        el('span', null, b.nombre),
        el('span', { clase: 'valor', texto: L.formatearValor(b.valor, datos.unidad) }),
        el('span', { clase: `pista${b.pct === null ? ' faltante' : ''}`, attrs: { 'aria-hidden': 'true' } },
          b.pct === null ? null : el('span', { clase: 'relleno', attrs: { style: `width:${b.pct}%` } })));
      boton.addEventListener('click', () => {
        for (const f of filas) f.setAttribute('aria-pressed', f === boton ? 'true' : 'false');
        cargarDetalle(b.id, detalle);
      });
      filas.push(boton);
      lista.append(el('li', null, boton));
    }
    destino.append(lista, detalle);
    destino.append(el('p', { clase: 'nota', texto: 'Indicador por estado. No indica acceso en tu domicilio ni que puedas contratar un servicio. Un valor faltante significa que no hay dato, no que sea cero.' }));
  }

  async function cargarDetalle(id, destino) {
    vaciar(destino);
    destino.append(el('p', { clase: 'nota', texto: 'Cargando…' }));
    try {
      const d = await api(`/api/acceso?estado=${encodeURIComponent(id)}`);
      vaciar(destino);
      if (L.esEjemplo(d)) destino.append(franjaEjemplo());
      destino.append(
        el('h3', { texto: d.nombre || 'Estado' }),
        el('p', { texto: `${d.indicador || 'Indicador'}: ${L.formatearValor(d.valor, null)}` }),
        el('p', { texto: `Periodo: ${d.periodo || 'dato faltante'}` }),
        el('p', null, 'Fuente: ', d.fuente_url ? enlace(d.fuente_url, 'fuente oficial') : 'dato faltante'));
    } catch (e) {
      vaciar(destino);
      destino.append(el('p', { clase: 'error', texto: e.message }));
    }
  }

  // ---------- arranque ----------

  iniciarOferta();
  iniciarEntidad();
  window.addEventListener('hashchange', mostrarVista);
  mostrarVista();
  cargarSalud();
})();
