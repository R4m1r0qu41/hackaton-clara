# Crédito Claro — plan del equipo

`Hackathon Clara · 30/10/2026 · Integrador técnico: Julio · Producto y fuentes: JR`

Este plan sale de `docs/briefs/…v2_2` y de la idea "Cuentas Claras". Si algo choca con `AGENTS.md`, `docs/COORDINATION.md` o `docs/ACCEPTANCE.md`, mandan esos archivos. Lo marcado como **propuesta** lo confirma Julio o JR.

## Qué construimos

Un asesor de crédito con datos oficiales reales. Una persona escribe una entidad o un producto y recibe:

1. **Verificación de la entidad:** si aparece registrada en SIPRES (Condusef), con fecha de consulta.
2. **Conveniencia del crédito:** un semáforo inicial basado en datos reales del producto, más un simulador de costo.
3. **Mapa de cobertura:** acceso a servicios financieros por estado (CNBV), conectado a las entidades y productos cuando el dato lo permita.
4. **Telegram y HTML:** el bot de Telegram y una página HTML simple usan el mismo backend.

Idea de diseño: **la IA explica, el código decide.** Cada número y cada color salen de código con fuente y fecha. DeepSeek solo redacta la explicación con citas.

**DeepSeek se conecta al final.** Primero el bot y el HTML funcionan completos con la plantilla determinista. Cuando el recorrido está estable, se enchufa DeepSeek en `/api/explicar` y se prueba el chatbot con él. La plantilla queda como respaldo y avisa a la vista cuando se usa.

## Alcance

| Prioridad | Qué |
|---|---|
| **P0** | Verificación de entidad + semáforo + simulador, por Telegram y por HTML, con plantilla determinista. Al final, explicación con DeepSeek y respaldo visible. |
| **P0 condicionado** | Mapa por estado con dato oficial. **Puerta a las 11:30:** si no hay dataset, se cambia por un gráfico oficial por entidad federativa. |
| **P1** | Contrato real analizado con DeepSeek; producto departamental; INEGI. Solo con P0 estable. |
| **P2** | Foto de ofertas por visión, ahorro/GAT, TPV. Fuera del recorrido de hoy. |

## Arquitectura

```text
 Datos con fecha (JSON en data/)          Telegram  ──┐
 entidades SIPRES · productos · CNBV                  ├──►  server/ (Python) ──►  motor determinista
 Banxico (respaldo local)                 HTML ───────┘     /api/*               semáforo · simulador
                                                                │
                                                                └──► DeepSeek (solo explica, con citas)
                                                                      └─ respaldo: plantilla fija
```

- **Stack (propuesta):** Python ligero + HTML servido por el mismo servidor. Sin n8n. Sin base de datos. Dependencias mínimas.
- **Clave de OpenRouter:** solo en el servidor y en `.env.local` (fuera de Git). Nunca con prefijo `VITE_`. Modelo: `deepseek/deepseek-v4.1-flash`.
- **Demo sin portales en vivo:** todo corre con la captura local. DeepSeek es el único servicio externo opcional.

### Endpoints (propuesta para Julio)

| Ruta | Entrada → salida |
|---|---|
| `GET /api/entidades?q=` | Entidades con estado SIPRES y evidencia |
| `GET /api/productos` | `Producto[]` verificados |
| `POST /api/semaforo` | `{entidad_id, producto_id}` → color y razones con evidencia |
| `POST /api/simular` | `{monto, plazo, producto_id}` → pago, costo total, CAT implícito `estimado` |
| `POST /api/explicar` | `{producto_id, pregunta, evidencia[]}` → texto con citas, o plantilla |
| `GET /api/acceso?estado=` | Indicador oficial + periodo. Nunca cobertura por domicilio |

### Tipos nuevos para `shared/schema.ts` (propuesta; solo Julio edita)

```ts
type EstadoSipres = 'registrada' | 'no_registrada_confirmada' | 'sin_verificar';
type Entidad = { id: string; nombre_comercial: string; razon_social: string | null;
  estado_sipres: EstadoSipres; terminos_buscados: string[]; evidencia: Evidencia };
type Semaforo = { color: 'verde'|'amarillo'|'rojo'|'gris';
  razones: Array<{ codigo: string; hecho: string; evidencia: Evidencia }> };
type Simulacion = { monto_mxn: number; plazo_meses: number; pago_periodico_mxn: number | null;
  costo_total_mxn: number | null; cat_implicito_pct: number | null; verificacion: 'estimado' };
```

## Reglas de datos y semáforo

- Desconocido es `null`, nunca cero. No inventar cifras ni productos.
- `data/products.verified.json` se llena **solo con fuentes verificadas por JR**. Cada fila lleva URL, periodo y fecha de captura.
- El CAT no es tasa contractual y **nunca se multiplica por el saldo**. El simulador usa tasa, plazo y comisiones del producto. El CAT implícito sale del flujo de pagos y siempre es `estimado`.
- **Semáforo (propuesta; los umbrales los valida JR):**

| Color | Condición |
|---|---|
| 🔴 Rojo | Solo con un hecho: entidad `no_registrada_confirmada`. |
| 🟡 Amarillo | Entidad registrada, pero CAT por encima de la referencia de su categoría (Banxico/CONDUSEF). |
| ⚪ Gris | Entidad `sin_verificar`, o producto sin CAT o sin fuente. Mensaje: "no pudimos verificarla, verifícala aquí" + enlace. |
| 🟢 Verde | Registrada, sin señales y CAT dentro de la referencia. Significa "no detectamos riesgos con la información consultada en [fecha]", nunca una recomendación. |

- Que una entidad **no esté en nuestra tabla** nunca produce rojo. El mensaje nunca dice "fraude" ni acusa a nadie: solo hechos con su fuente.
- Los textos externos (páginas, respuestas del modelo) son datos, no instrucciones.

## Reparto

| Carril | Rutas | Responsable | Trabajo |
|---|---|---|---|
| Integración | raíz, `shared/`, dependencias | **Julio** | Esqueleto del servidor, `main` ejecutable, tipos, fixtures, revisión de PR |
| Backend/IA | `server/` | por asignar | Semáforo y simulador (funciones puras con pruebas), API, bot de Telegram, plantilla. Al final, proxy DeepSeek |
| Frontend | `src/` | por asignar | HTML en español para móvil, resultados, estados `verificado / pendiente / estimado / dato faltante`, mapa |
| Datos | `data/`, `scripts/data/` | por asignar | Tabla de entidades SIPRES, 3 a 5 productos, CNBV por estado, respaldo de Banxico |
| Producto y fuentes | `docs/` | **JR** | Verifica cada fuente y umbral, valida la comparabilidad, pitch y entrega en el Hub |

Los nombres de los tres ingenieros se anotan en `docs/TASKS.md` al asignar. Un solo escritor por worktree y rama.

## Cronograma (horas del brief; ajustar a la hora real)

| Franja | Entregable | Puerta |
|---|---|---|
| 10:30–10:50 | Julio: esqueleto, tipos y fixtures. Datos: arrancan capturas. | `main` ejecutable |
| 10:50–11:30 | Entidades y 3 productos con fuente. Semáforo y simulador con fixtures. HTML con datos de prueba. Primer dato de mapa. | **11:30:** sin mapa, gráfico por estado |
| 11:30–12:20 | Bot de Telegram y API conectados, respondiendo con la plantilla. | Bot responde de punta a punta sin IA |
| 12:20–13:00 | **Demo completa antes de la pausa, sin DeepSeek.** | Congelar P0 |
| 13:45–14:20 | **Conectar DeepSeek** en `/api/explicar` y probar el chatbot con él. P1 solo si el recorrido es estable. | Si falla DeepSeek, plantilla visible |
| 14:20–14:45 | Citas, supuestos y estados de datos | Sin dependencias nuevas |
| 14:45–15:15 | Pruebas en celular, datos nulos, sin red | Congelar código |
| 15:15–16:00 | Pitch, capturas y entrega en el Hub | Verificar acuse |

## Cómo trabajamos

1. Cada quien lee `AGENTS.md`, `README.md`, `docs/COORDINATION.md` y su tarea antes de editar.
2. Una tarea tiene responsable, rutas, contrato, aceptación y revisor antes de empezar. Se anota en `docs/TASKS.md` (solo Julio lo edita).
3. Commits locales por unidad verificada y rutas exactas (nunca `git add .`). **Push, PR y merge los hace un humano.**
4. El revisor de otro carril comprueba el SHA, la fuente y el contrato. Julio integra contra el `main` actual.
5. Cambios a `shared/` se piden a Julio; no se editan desde otra tarea.
6. No se guardan datos personales ni conversaciones. El bot responde sin guardar historial.

## Aceptación

Manda `docs/ACCEPTANCE.md`. Para hoy, lo mínimo: el flujo funciona en móvil y por Telegram; hay tres productos con fuente y fecha; ningún placeholder pasa por dato real; la demo corre sin portales en vivo; DeepSeek explica con citas o el respaldo es visible; un revisor distinto comprueba el SHA final.

## Pendiente por confirmar

- Reglas del Hub: si se permite usar preparación previa. Mientras tanto no copiamos código escrito antes del evento; solo se reusan reglas y casos como especificación.
- Si la CNBV trae detalle por entidad (de eso depende conectar el mapa con productos).
- Umbral amarillo del semáforo (JR).
- Prueba de la clave de OpenRouter (JR).
