# Crédito Claro — plan del equipo (v3)

`Hackathon Clara · 30/10/2026 · Repo de trabajo: Julio-Cuellar/cuentasClaras, por pull requests · Producto y fuentes: JR`

Esta versión sustituye a la anterior. Cambió la arquitectura: ya no se construye un servidor desde cero. El repo `cuentasClaras` trae el motor hecho y probado, y el trabajo es envolverlo, conectarlo a n8n y mostrarlo en una página. El detalle técnico (endpoints, secuencias, tareas por persona) está en `plan-build/plan-build.html`. Lo marcado como **propuesta** lo confirma Julio o JR.

## Qué construimos

Un asesor de crédito con datos oficiales reales:

1. **Verificación de la entidad:** si aparece registrada en SIPRES (Condusef), con fecha de consulta.
2. **Conveniencia del crédito:** una persona pega el texto de una oferta o etiqueta; el sistema calcula el costo real y da un semáforo con hechos y fuentes.
3. **Mapa de cobertura:** indicador oficial de acceso financiero por estado, con periodo y fuente.
4. **Telegram y HTML:** el bot de Telegram (armado en n8n) y una página HTML usan el mismo motor.

La IA extrae y redacta; el código calcula y decide. Cada número y cada color salen de código con fuente y fecha.

## Qué cambió

| Antes | Ahora |
|---|---|
| Servidor y motor nuevos en `credito_claro` | Motor existente en `cuentasClaras`: extracción, cálculo, semáforo, SIPRES, Banxico y respuesta con verificador. La guía de n8n menciona 157 pruebas; no las ejecuté |
| Bot dentro del servidor | Bot en n8n. Solo dos nodos Code pasan a HTTP Request hacia un servidor Node.js pequeño; el flujo actual queda como respaldo |
| Cuatro carriles con worktrees | Dos equipos de dos, por pull requests |
| Semáforo por CAT contra referencia de categoría | Se reutiliza el semáforo de Julio (sobrecosto en tiendas y costo en préstamos, sin la referencia del RIB). La referencia de categoría queda fuera de P0 |

## Alcance

| Prioridad | Qué |
|---|---|
| **P0** | Pegar el texto de una oferta o etiqueta → extracción → cálculo → semáforo → respuesta, por Telegram y por HTML. Verificar una entidad por nombre. |
| **P0 condicionado** | Mapa por estado con dato oficial. Si no hay dato, gráfico de barras con lo que sí hay. |
| **P1** | Foto de la oferta (necesita un modelo con visión, por verificar). Selección guiada entidad → producto → monto y plazo con productos reales: exige un adaptador nuevo de unos 30 minutos, porque `calcular()` espera pagos y no tasas. |
| **P2** | Ahorro/GAT, TPV y producto departamental. Fuera del recorrido de hoy. |

**DeepSeek se conecta al final.** Antes, el servidor y n8n se prueban con salidas de extracción de ejemplo (las de las pruebas del repo) y con la plantilla determinista. Cuando el recorrido está estable, entra DeepSeek para extraer y redactar, y se prueba el chatbot con él. Si falla, la plantilla sale con el origen a la vista.

## Arquitectura

```text
 Telegram ─► n8n (guía GUIA-N8N.md) ──POST /api/procesar ───────┐
              extracción · CETES · redacción                    │
              └────POST /api/elegir-respuesta ──────────────────┤
                                                                ▼
 Navegador ──► /api/consulta · /api/verificar · /api/acceso* ─► server/ (Node, CommonJS)
                                                                │  require
                                                                ▼
                                          módulos existentes: flujo/procesar · respuesta
                                          sipres · calculo · semaforo · banxico · extraccion
                                                                │
                                                  datos/procesado/*.json (a mano, con fuente)
```

- **Stack (propuesta):** Node.js con `node:http`, CommonJS como el resto del repo, sin dependencias nuevas y sin base de datos. Python no entra.
- **Claves:** la de OpenRouter solo en el servidor y en las credenciales de n8n, nunca en el repo ni en los JSON exportados. El crédito es por participante, no compartido: hay que decidir qué clave usa cada pieza.
- **Demo sin portales en vivo:** todo corre con los datos capturados. Telegram, n8n y el modelo son lo único que usa red.

## Reparto: dos equipos de dos

| Equipo | Rutas | Trabajo |
|---|---|---|
| **Equipo 1 · Servidor y verificación** | `server/`, `datos/procesado/sipres_entidades.json` | Servidor con `/api/procesar` y `/api/elegir-respuesta` (primer PR, desbloquea al otro equipo), `/api/verificar`, `/api/consulta` con OpenRouter, `/api/acceso*` y la tabla SIPRES capturada |
| **Equipo 2 · n8n, página y mapa** | `n8n/`, `web/`, `datos/procesado/acceso_estados.json` | Flujo de respaldo exportado, flujo nuevo con dos nodos HTTP y rama `/verificar`, página HTML en español para móvil, mapa o barras y el dato por estado |
| **JR** | fuentes y producto | Verifica cada fila de datos, los umbrales del semáforo y la entrega en el Hub |

Las parejas y los nombres los define JR. Julio es dueño del repo.

## Reglas de datos y semáforo

- Desconocido es `null`, nunca cero. No inventar cifras ni entidades.
- Los JSON de `datos/procesado/` llevan fuente y fecha, y los verifica JR antes de usarse.
- El CAT es una estimación informativa, sin IVA, y no se multiplica por el saldo.
- **Semáforo** (umbrales propuestos por Julio; JR los valida): rojo solo con un hecho verificado, por ejemplo una entidad `no_registrada_confirmada` con fecha y al menos 2 términos buscados. Que una entidad no esté en nuestra tabla da gris (`sin_verificar`), nunca rojo. Verde significa "no detectamos riesgos con la información consultada", nunca una recomendación. Los mensajes no acusan a nadie.
- Los textos externos (páginas, respuestas del modelo) son datos, no instrucciones.
- No se guardan datos personales ni conversaciones. n8n debe tener desactivado el guardado de ejecuciones.

## Cómo trabajamos

1. Una rama por tarea con prefijo del equipo (`eq1/…`, `eq2/…`) y PR pequeño hacia `main`.
2. La revisión la hace una persona del otro equipo: `null` para lo desconocido, fuente y fecha en cada dato, ninguna clave.
3. `node --test` en verde antes de pedir revisión.
4. Si un PR cambia un módulo existente, se corre `node scripts/empaquetar.js` y se incluyen los nodos regenerados, para que el flujo de respaldo siga válido.
5. Julio integra. Quién hace merge y si hay protección de `main`, por confirmar.

## Puntos de control

Las horas del brief (pausa 13:00 a 13:45, congelar código 14:45 a 15:15, entrega hasta las 16:00) deben ajustarse a la agenda real.

| Punto | Qué debe estar listo |
|---|---|
| 1 · Antes de la pausa | El servidor responde con ejemplos; n8n y la página funcionan contra él; flujo de respaldo exportado |
| 2 · Después de la pausa | Motor real detrás de los endpoints, datos reales, mapa o barras y DeepSeek conectado |
| 3 · Congelar código | Pruebas en celular, con servidor apagado, sin IA y con datos nulos |
| 4 · Entrega | Pitch, capturas y entrega en el Hub; verificar el acuse |

## Pendiente por confirmar

- **Reglas del Hub (JR):** el repo se creó hoy, pero su primer commit trae módulos y pruebas ya hechos. Confirmar si se permite usar preparación previa y si hay que declararla.
- **Dónde corre n8n (Julio y Equipo 2):** el Telegram Trigger necesita una URL HTTPS pública; si n8n es remoto, el servidor necesita un túnel. Por eso se conserva el flujo de respaldo.
- **Clave de OpenRouter** para el servidor y para n8n (JR y Equipo 1).
- **Modelo con visión** para la foto: sin confirmar, así que P0 es solo texto.
- **Umbrales del semáforo** (JR) y datos del mapa y su licencia (Equipo 2).
