# Crédito Claro — diseño de la página (`web/`) adaptado al plan v3

`Hackathon Clara · 30/10/2026 · Tareas 2C y 2D del Equipo 2 · Base: plan-equipo v3 y stubs de server/routes.js`

Este documento fusiona el diseño de pantalla original (brief v2.2 §3 y `shared/schema.ts`) con el plan v3. **Manda el plan v3.** Lo marcado como **propuesta** lo confirma JR o el Equipo 2.

## Qué había y qué se buscó

El diseño original es solo texto: la sección 3 del brief v2.2 (tres entradas, tarjetas, gráfica de costo, mapa, panel «¿De dónde sale?», marcadores) y los tipos `Producto`, `Evidencia` y `Perfil`. No existe maqueta visual en el repo, en los worktrees ni entre los artefactos publicados. Este documento es la primera especificación de pantallas.

## De qué cambia el diseño

| Original (brief v2.2) | v3 | Efecto en la página |
|---|---|---|
| Entrada: ingreso + comportamiento + ubicación | Entrada: texto de una oferta | El formulario de tres campos pasa a P1 |
| Tarjetas de producto con CAT y anualidad | `/api/consulta` devuelve texto + color | Las tarjetas pasan a P1 |
| Gráfica de barras de costo y toggle total/saldo | Sin endpoint de simulación | Pasan a P1 |
| React, Vite, Tailwind, Recharts en `src/` | `web/` con `index.html`, `app.js`, `styles.css`, `mapa-estados.svg`, sin dependencias | Sin build ni npm |
| `shared/schema.ts` como contrato | JSON de `/api/*` | El contrato es el de los endpoints |
| Semáforo por CAT contra referencia | Semáforo de Julio (sobrecosto y costo) | El amarillo no se explica con «CAT sobre la referencia» |

## Qué se conserva

- Español, primero móvil (360 px de ancho), sin formulario largo.
- Pregunta de entrada «¿Qué quieres entender?» con botones que **todos funcionan**; ningún botón muerto.
- Un recorrido: dato → resultado → fuente.
- Marcadores de estado del dato y el panel «¿De dónde sale?».
- Mapa por estado con indicador, periodo y fuente; sin dato oficial, barras.
- Nada de acusar: solo hechos con fuente y fecha.

## Pantallas P0

### 1 · Inicio — «¿Qué quieres entender?»

Tres botones, uno por función real:

1. **Revisar una oferta** → pantalla 2.
2. **Verificar una entidad** → pantalla 3.
3. **Ver acceso financiero por estado** → pantalla 4.

Una línea fija debajo: «Los datos se consultaron en [`datos_al` de `/api/salud`]. No guardamos tu texto». Si `/api/salud` falla, la línea dice que no hay conexión con el servidor.

### 2 · Revisar una oferta (`POST /api/consulta`)

- Caja de texto (`texto`, máximo 5000 caracteres, el límite del servidor) y tres textos de ejemplo que se cargan con un toque, rotulados «ejemplo». El plan solo trae uno (`Préstamo de $5,000, me depositan $4,200, 4 pagos quincenales de $1,600`); los otros dos se toman de las pruebas de `cuentasClaras` cuando el Equipo 2 las revise.
- Resultado, en este orden:
  1. **Semáforo:** círculo de color + palabra + una línea (ver «Semáforo»). Nunca solo color.
  2. **Texto** de la respuesta (`texto`).
  3. **Origen:** etiqueta `modelo` / `plantilla` / `ejemplo`. Con `plantilla`: «Respuesta con plantilla fija: el modelo no estuvo disponible». Es la parte visible del respaldo que exige `docs/ACCEPTANCE.md`.
  4. **SIPRES:** `estado_sipres` en palabras, con la misma señal de advertencia de la pantalla 3.
  5. **Advertencias** (`advertencias[]`), en lenguaje simple.
  6. **¿De dónde sale?** (ver la brecha 1).
- Error 400 o servidor apagado: mensaje fijo, sin pantalla en blanco. No se repite el texto del usuario ni se guarda.

### 3 · Verificar una entidad (`GET /api/verificar?q=`)

- Campo de búsqueda, desde 3 caracteres (el servidor responde `sin_verificar` con menos).
- La página muestra el estado **en palabras, con un ícono** (ver «Señal de advertencia»), más la fecha y los términos buscados. **Sin colores de semáforo:** `/api/verificar` no devuelve `color`, y la página no decide (la regla de «al menos 2 términos» vive en `sipres.js`). Estar registrada tampoco es «sin riesgos».

| `estado` | Ícono | Mensaje (propuesta) |
|---|---|---|
| `registrada` | Paloma neutra | «Aparece como registrada en SIPRES, consulta del [`fecha_consulta`]» + términos buscados |
| `no_registrada_confirmada` | **Triángulo de advertencia** (borde rojo) | «No aparece en SIPRES con los términos [`terminos_buscados`], consulta del [`fecha_consulta`]» |
| `sin_verificar` | **Triángulo de advertencia** (borde gris) | «No pudimos verificarla. Verifícala aquí» + enlace a SIPRES |

- Que la entidad no esté en nuestra tabla (`motivo: no_esta_en_tabla`) es siempre `sin_verificar`, nunca «no registrada». Ninguna palabra como «fraude» ni «estafa».
- Si JR quiere colores en esta pantalla, el Equipo 1 devuelve `color` desde el servidor (brecha 6).

### 4 · Acceso financiero (`GET /api/acceso/estados`, `/api/acceso?estado=`)

- Mapa SVG por estado (`mapa-estados.svg`), con el `estado_id` como id de cada trazo. Sin dato oficial, **barras** con lo que sí hay.
- `valor: null` se pinta con trama gris y la leyenda «dato faltante»; nunca como cero.
- Siempre visibles: `indicador`, `unidad`, `periodo` y `fuente_url`.
- Tocar un estado resalta ese territorio y abre su detalle con `/api/acceso?estado=` (del diseño original: un territorio destacado, con el estado como ubicación opcional).
- Nota fija: «Indicador por estado. No indica acceso en tu domicilio ni que puedas contratar un servicio».

## Semáforo

`color` llega como `verde`, `amarillo`, `rojo`, `gris` o `"n.a."` (no hubo cálculo).

| `color` | Palabra | Línea (propuesta) |
|---|---|---|
| `verde` | Sin señales | «No detectamos riesgos con la información consultada el [`datos_al` de `/api/salud`]. No es una recomendación». |
| `amarillo` | Ojo | El motivo viene en el texto del motor. |
| `rojo` | Alerta con hecho | Solo con un hecho verificado y su fecha. |
| `gris` | Sin verificar | «No pudimos verificarla» + enlace. |
| `n.a.` | Sin cálculo | Sin círculo; se muestra solo el texto. |

Cada color lleva palabra e ícono, por accesibilidad. Los umbrales los valida JR; la página no los calcula.

## Señal de advertencia (SIPRES no encontrada)

- Triángulo de advertencia: fondo amarillo, signo de exclamación negro, borde grueso. Se dibuja como SVG propio dentro de `web/` (sin imagen externa ni dependencia).
- Se usa cuando SIPRES no confirma a la entidad: `no_registrada_confirmada` y `sin_verificar`, en la pantalla 3 y en el bloque SIPRES del resultado de una oferta.
- **Borde rojo solo con `no_registrada_confirmada`**, que es un hecho con fecha y términos buscados. Con `sin_verificar` el borde es gris: no sabemos si está registrada, y v3 prohíbe que eso se vea como rojo.
- Siempre con texto al lado («No aparece en SIPRES» o «No pudimos verificarla») y `role="img"` con nombre «Advertencia». Nunca solo el ícono.
- La página elige el ícono según el `estado` que manda el servidor; no calcula ningún veredicto.

## Marcadores del dato

| Situación | Marcador |
|---|---|
| Valor `null` | **dato faltante** |
| `ejemplo: true`, o `advertencias` con `respuesta_de_ejemplo` o `dato_de_ejemplo` | Franja «Datos de ejemplo, no son reales» sobre todo el resultado |
| Cifra derivada de flujos de pago (CAT implícito) | **estimado** |
| Dato con `fecha_consulta`/`periodo` y `fuente_url` | Fecha y fuente a la vista |

La API de P0 no trae un indicador `verificado` por campo. La página **no** escribe «verificado» hasta que JR verifique la fila y el contrato lo exprese.

## Brechas del contrato (para pedir al Equipo 1; no se parchea `server/`)

1. `/api/consulta` no devuelve fuente ni evidencia: solo `texto`, `color`, `origen`, `estado_sipres`, `motivo`, `advertencias`. El panel «¿De dónde sale?» queda vacío en el resultado de una oferta. **Pedido:** un campo opcional `fuentes[]` con `autoridad`, `url`, `periodo`, `consultado_en`.
2. `/api/verificar` no trae la URL de SIPRES. Hace falta para el enlace del estado gris. **La URL la da JR; no se escribe de memoria.**
3. `/api/consulta` devuelve solo texto: no hay cifras estructuradas (pago, costo total) para pintarlas aparte. Se muestra el texto tal cual.
4. Nombres distintos para lo mismo: `estado` en `/api/verificar` y `estado_sipres` en `/api/consulta`. La página los trata por separado.
5. Los `estado_id` del mapa son `EJ-01`, `EJ-02` en el stub. El `mapa-estados.svg` espera ids reales; hay que acordar el esquema con el dato de CNBV.
6. `/api/verificar` no devuelve `color`. Solo hace falta si JR decide que la verificación de entidad lleve semáforo propio.

## Pasa a P1 (se conserva del diseño original)

Solo con P0 estable y con el adaptador de ~30 minutos que v3 describe:

- Selección guiada entidad → producto → monto y plazo, con `products.verified.json`.
- Tarjetas comparativas (CAT publicado, anualidad, fecha) y etiqueta **no plenamente comparable** para departamentales.
- Perfil de ingreso con periodicidad: diario × 365/12, semanal × 52/12, quincenal × 24/12, mensual × 1, siempre como aproximación y sin dictamen de capacidad de pago.
- Gráfica de costo en pesos, solo con tasas, cargos y método disponibles; nunca saldo × CAT.
- Control «Pago el total / Dejo saldo». **«Pago el mínimo» queda fuera:** v3 dice que no hay fórmula verificada.

## Reglas técnicas

- `web/` con HTML, CSS y JS planos; sin npm, sin build. El servidor la sirve desde `webDir`.
- La página solo llama a rutas abiertas (`/api/salud`, `/api/consulta`, `/api/verificar`, `/api/acceso*`). **Nunca** lleva `X-Bot-Key` ni ninguna clave.
- Sin `localStorage` con texto del usuario, sin historial, sin analítica de terceros.
- Todo texto del servidor o del modelo se inserta como texto (`textContent`), nunca como HTML.

## Cómo se prueba (tarea 2C/2D)

- Tres textos de ejemplo en celular; `null` visible como «dato faltante».
- Servidor apagado: mensaje fijo.
- Sin clave de IA: `origen: plantilla` a la vista.
- Estado `sin_verificar` por entidad ausente de la tabla.
- Prueba 2E: el enlace del bot de Telegram abre la página.
- Mapa con y sin dato: trazos o barras, con periodo y fuente.

## Pendiente por confirmar

- JR: URL oficial de SIPRES y redacción de los mensajes del semáforo.
- Equipo 1: brechas 1, 2 y 3 de arriba.
- Equipo 2: esquema de `estado_id` y fuente del SVG de estados (licencia).
- JR: si la página debe incluir ya el flujo guiado de P1 o esperar a P0 estable.
