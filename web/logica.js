'use strict';

/**
 * Lógica pura de la página: sin DOM, para poder probarla con node --test.
 * La página no decide veredictos: solo traduce lo que manda el servidor a texto e íconos.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Logica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  // URL oficial dada por JR (30/10/2026).
  const SIPRES_URL = 'https://webapps.condusef.gob.mx/SIPRES/jsp/pub/index.jsp';
  const MIN_BUSQUEDA = 3;
  const MAX_TEXTO = 5000;

  const SEMAFORO = {
    verde: { palabra: 'Sin señales' },
    amarillo: { palabra: 'Ojo' },
    rojo: { palabra: 'Alerta con hecho' },
    gris: { palabra: 'Sin verificar' },
  };

  /** Color del servidor → palabra y línea. "n.a." o un valor desconocido: sin semáforo. */
  function vistaSemaforo(color, datosAl) {
    const base = SEMAFORO[color];
    if (!base) return null;
    const lineas = {
      verde: `No detectamos riesgos con la información consultada${datosAl ? ` el ${datosAl}` : ''}. No es una recomendación.`,
      amarillo: 'El motivo está en el texto de abajo.',
      rojo: 'Hay un hecho verificado, con fecha y fuente, en el texto de abajo.',
      gris: 'Falta información para evaluarla; el motivo está en el texto de abajo.',
    };
    return { clave: color, palabra: base.palabra, linea: lineas[color] };
  }

  /**
   * Estado SIPRES → ícono y título. Lo desconocido se trata como sin_verificar:
   * nunca se afirma que una entidad está registrada sin que el servidor lo diga.
   * "n.a." (no hubo verificación) devuelve null.
   */
  function vistaSipres(estado) {
    if (estado === 'n.a.' || estado === null || estado === undefined) return null;
    if (estado === 'registrada') {
      return { icono: 'ok', titulo: 'Aparece como registrada en SIPRES', enlace: false };
    }
    if (estado === 'no_registrada_confirmada') {
      return { icono: 'advertencia-confirmada', titulo: 'No aparece en SIPRES', enlace: true };
    }
    return { icono: 'advertencia-bn', titulo: 'No pudimos verificarla', enlace: true };
  }

  const AVISOS = {
    respuesta_de_ejemplo: 'Esta respuesta es de ejemplo: el motor real todavía no está conectado.',
    dato_de_ejemplo: 'Este dato es de ejemplo, no es real.',
    'sipres:no_esta_en_tabla': 'La entidad no está en nuestra tabla de SIPRES, así que no pudimos verificarla.',
  };

  function avisosLegibles(advertencias) {
    if (!Array.isArray(advertencias)) return [];
    return advertencias.map((codigo) => AVISOS[codigo] || `Aviso del servidor: ${String(codigo)}`);
  }

  /** Hay datos de ejemplo si el servidor lo marca o lo advierte. */
  function esEjemplo(resp) {
    if (!resp || typeof resp !== 'object') return false;
    if (resp.ejemplo === true || resp.origen === 'ejemplo') return true;
    return Array.isArray(resp.advertencias)
      && resp.advertencias.some((a) => a === 'respuesta_de_ejemplo' || a === 'dato_de_ejemplo');
  }

  function textoOrigen(origen) {
    if (origen === 'llm') return { etiqueta: 'Modelo', detalle: 'Redactado por el modelo y revisado por el código.' };
    if (origen === 'plantilla') {
      return { etiqueta: 'Plantilla', detalle: 'Respuesta con plantilla fija: el modelo no estuvo disponible.' };
    }
    if (origen === 'ejemplo') return { etiqueta: 'Ejemplo', detalle: 'Respuesta de ejemplo, no es real.' };
    return { etiqueta: 'Origen desconocido', detalle: 'El servidor no indicó de dónde salió la respuesta.' };
  }

  /** Solo se enlazan URLs http(s): el dato viene del servidor y es un dato, no una instrucción. */
  function esUrlSegura(url) {
    if (typeof url !== 'string') return false;
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function consultaValida(q) {
    return typeof q === 'string' && q.trim().length >= MIN_BUSQUEDA;
  }

  function textoValido(texto) {
    return typeof texto === 'string' && texto.trim().length > 0 && texto.length <= MAX_TEXTO;
  }

  function esNumero(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  /** Desconocido (null o no numérico) es "dato faltante", nunca cero. */
  function formatearValor(valor, unidad) {
    if (!esNumero(valor)) return 'dato faltante';
    const n = valor.toLocaleString('es-MX');
    return unidad ? `${n} ${unidad}` : n;
  }

  /** Filas para las barras: pct es null cuando el valor se desconoce. */
  function barras(estados) {
    if (!Array.isArray(estados)) return [];
    const conocidos = estados.map((e) => e && e.valor).filter(esNumero);
    const max = conocidos.length ? Math.max(...conocidos) : 0;
    return estados.map((e) => {
      const valor = e && esNumero(e.valor) ? e.valor : null;
      const pct = valor === null ? null : max > 0 ? Math.min(100, Math.max(0, (valor / max) * 100)) : 0;
      return { id: e && e.estado_id, nombre: (e && e.nombre) || 'Sin nombre', valor, pct };
    });
  }

  return {
    SIPRES_URL, MIN_BUSQUEDA, MAX_TEXTO,
    vistaSemaforo, vistaSipres, avisosLegibles, esEjemplo, textoOrigen,
    esUrlSegura, consultaValida, textoValido, formatearValor, barras,
  };
});
