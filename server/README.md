# Servidor Node.js

Esqueleto con **respuestas de ejemplo**: la forma de cada respuesta es la del contrato del plan (`plan-equipo.md`, `plan-build/plan-build.html`), pero ningún dato es real. Sirve para que n8n y la página se construyan en paralelo mientras el motor real sustituye a cada manejador.

Node.js 20 o más. CommonJS. Sin dependencias: no hay `npm install`.

## Correrlo

```bash
npm start                      # http://127.0.0.1:3000
npm test                       # node --test
HOST=0.0.0.0 BOT_API_KEY=cambia-esto PORT=3000 node server/index.js   # abierto a la red local, con clave para n8n
```

| Variable | Para qué |
|---|---|
| `PORT`, `HOST` | Puerto (3000) e interfaz (`127.0.0.1`; `0.0.0.0` para abrirlo a la red local) |
| `BOT_API_KEY` | Clave que n8n envía en `X-Bot-Key`. Sin ella, esas rutas no piden clave y el servidor lo avisa al arrancar |
| `OPENROUTER_API_KEY` | Solo marca `ia: true` en `/api/salud`. Esta versión todavía no llama al modelo |
| `WEB_DIR` | Carpeta de la página (`web/` por defecto) |

Las claves van en el entorno, nunca en el repo.

## Endpoints

| Ruta | La usa | Respuesta de ejemplo |
|---|---|---|
| `GET /api/salud` | página, n8n | `{ ok, modo: "ejemplo", ia, datos_al }` |
| `POST /api/procesar` | n8n (nodo "Procesar") | `{ accion: "redactar", ctx, plantilla, log, advertencias }`. Pide `salidaLLM`. Con clave |
| `POST /api/elegir-respuesta` | n8n (nodo "Elegir respuesta") | `{ texto, origen: "plantilla", motivo, fallas }`. Pide `ctx`. Con clave |
| `POST /api/consulta` | página | `{ texto, origen: "ejemplo", color, estado_sipres, motivo, advertencias }`. Pide `texto` (máx. 5000). No devuelve lo que escribió la persona |
| `GET /api/verificar?q=` | página, n8n | `{ estado, fecha_consulta, terminos_buscados, entidad, motivo, advertencias }`. Lo que no está en la tabla es `sin_verificar` |
| `GET /api/acceso/estados` | página (mapa) | `{ indicador, periodo, fuente_url, estados: [{ estado_id, nombre, valor: null }] }` |
| `GET /api/acceso?estado=` | página (mapa) | Un estado, o 404 |

Errores: `{ "error": { "codigo", "mensaje" } }` con 400 (entrada inválida), 401 (clave), 404, 405 o 413. Desconocido es `null`, nunca cero.

```bash
curl -s localhost:3000/api/verificar?q=entidad
curl -s -X POST localhost:3000/api/consulta -H 'Content-Type: application/json' -d '{"texto":"Préstamo de ejemplo"}'
```

## Para n8n

Los nodos Code "Procesar" y "Elegir respuesta" pasan a HTTP Request hacia `/api/procesar` y `/api/elegir-respuesta`, con la cabecera `X-Bot-Key`. Las expresiones exactas se verifican en el primer flujo real.

## Qué falta

- Conectar el motor real (extracción, cálculo, semáforo, SIPRES, respuesta) detrás de cada manejador de `server/routes.js`.
- Cargar y validar los datos reales (`datos/`) al arrancar.
- Llamar a OpenRouter para extraer y redactar, con la plantilla como respaldo.
- La página en `web/`.
