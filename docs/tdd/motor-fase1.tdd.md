# Evidencia TDD: motor, fase 1 (tramos 1 a 3)

`30/10/2026` · Rama local `eq1/motor` (desde `Julio`) · Sin commits

## Fuente

- Plan: `plan-n8n-agente.md`, fase 1 ("Motor con pruebas") y casos CU1, CU2 y G1 a G4.
- Decisión D3 sobre el código de `cuentasClaras`: **sin confirmar por JR**. Mientras tanto, las pruebas salen de las reglas del plan y el código es propio, sin copiar. Sirve en cualquiera de los dos caminos.
- Alcance: `sipres`, `calculo`, `semaforo`, `validar-extraccion`, `respuesta` (contexto, plantilla, verificador y mensajes fijos) y `flujo` (el orquestador `procesar`). El motor queda completo para el P0. `banxico` se difiere: nada del motor usa la tasa de CETES (ver huecos).

## Recorrido de usuario cubierto

- **CU2.** Como persona, quiero saber si una entidad está en SIPRES, para no dar mis datos a una que no aparece. Una entidad fuera de la tabla da gris, nunca rojo.
- **CU1.** Como persona, quiero el costo real y el semáforo de una oferta, con hechos y sin recomendaciones.

## Tareas

| Tarea | Prueba | Rojo | Verde |
|---|---|---|---|
| Buscar entidad y validar la tabla | `motor/sipres/sipres.test.js` (15 pruebas) | `Cannot find module './sipres'` | 15 de 15 |
| Costo real y CAT implícito | `motor/calculo/calculo.test.js` (18 pruebas) | `Cannot find module './calculo'` | 18 de 18 |
| Semáforo con razones y evidencia | `motor/semaforo/semaforo.test.js` (24 pruebas) | `Cannot find module './semaforo'` | 24 de 24 |
| Validar y normalizar la extracción del modelo | `motor/extraccion/validar-extraccion.test.js` (23 pruebas) | `Cannot find module './validar-extraccion'` | 23 de 23 |
| Contexto, plantilla, verificador y mensajes fijos | `motor/respuesta/respuesta.test.js` (32 pruebas) | `Cannot find module './respuesta'`; la de cobranza, `R.mensajes.cobranza is not a function` | 32 de 32 |
| Orquestador `procesar` | `motor/flujo/procesar.test.js` (19 pruebas) | `Cannot find module './procesar'` | 19 de 19 |

El rojo se comprobó con `node --test "motor/**/*.test.js"` antes de escribir cualquier implementación: las tres suites fallaron por falta del módulo. Es un rojo por implementación inexistente, no por dependencias ni sintaxis.

## Qué garantizan las pruebas

| # | Garantía | Prueba | Tipo | Resultado |
|---|---|---|---|---|
| 1 | Lo que no está en la tabla es `sin_verificar`, nunca "no registrada" | `sipres.test.js` | unitaria | PASS |
| 2 | "No registrada" exige fecha y al menos 2 términos buscados; si no, baja a `sin_verificar` | `sipres.test.js` | unitaria | PASS |
| 3 | Acentos, mayúsculas, puntuación y sufijos legales no cambian la coincidencia | `sipres.test.js` | unitaria | PASS |
| 4 | Nombres genéricos no coinciden con nada; los parciales exigen 5 caracteres | `sipres.test.js` | unitaria | PASS |
| 5 | Coincidencias con estados contradictorios no se adivinan | `sipres.test.js` | unitaria | PASS |
| 6 | Entradas inválidas (tabla, consulta, filas) no lanzan excepciones | `sipres.test.js` | unitaria | PASS |
| 7 | El CAT iguala el valor presente de los pagos con el principal, comprobado de forma independiente | `calculo.test.js` | unitaria | PASS |
| 8 | Enganche y cargos iniciales restan del principal; los periódicos suman al pago; los finales entran al costo pero no al CAT | `calculo.test.js` | unitaria | PASS |
| 9 | Pagos menores al principal y tasas fuera de rango no inventan un CAT | `calculo.test.js` | unitaria | PASS |
| 10 | Préstamo de pago único anualiza con el plazo en días | `calculo.test.js` | unitaria | PASS |
| 11 | Dato desconocido no se toma como cero en silencio; cargo sin monto se ignora con advertencia | `calculo.test.js` | unitaria | PASS |
| 12 | Tienda: 15% es amarillo y 50% es rojo; negativo o desconocido es gris | `semaforo.test.js` | unitaria | PASS |
| 13 | `sin_verificar` nunca da rojo; confirmación incompleta tampoco | `semaforo.test.js` | unitaria | PASS |
| 14 | Las señales que extrae el modelo y el depósito menor no dan rojo salvo con `reglasDeExtraccion` | `semaforo.test.js` | unitaria | PASS |
| 15 | Las señales de texto exigen evidencia literal | `semaforo.test.js` | unitaria | PASS |
| 16 | Las razones salen ordenadas por nivel y el resumen las cuenta | `semaforo.test.js` | unitaria | PASS |
| 17 | Ninguna función modifica su entrada | todas las suites | unitaria | PASS |
| 18 | El validador deja pasar solo campos del esquema; números, enteros, periodicidad y señales inválidos pasan a null o falso con advertencia | `validar-extraccion.test.js` | unitaria | PASS |
| 19 | El plazo corto y el depósito menor al ofrecido los calcula el código, no el modelo | `validar-extraccion.test.js` | unitaria | PASS |
| 20 | Los textos del modelo se limpian y se acotan (120 y 160 caracteres, 5 evidencias) | `validar-extraccion.test.js` | unitaria | PASS |
| 21 | El verificador rechaza cifras, fechas, enlaces, colores y palabras que no salen del cálculo o que acusan o recomiendan | `respuesta.test.js` | unitaria | PASS |
| 22 | La plantilla pasa siempre su propio verificador, incluida la que cita montos del usuario como evidencia | `respuesta.test.js` | unitaria | PASS |
| 23 | Si el texto del modelo no pasa, sale la plantilla con las mismas cifras; sin contexto, el mensaje de error | `respuesta.test.js` | unitaria | PASS |
| 24 | Los mensajes fijos (incluido el de cobranza) dicen lo acordado en el plan y no usan palabras prohibidas | `respuesta.test.js` | unitaria | PASS |
| 25 | Sin modelo ni cálculo, el orquestador responde si la extracción es ilegible, es cobranza, es desconocida o tiene confianza baja | `procesar.test.js` | integración de módulos | PASS |
| 26 | Si faltan datos para calcular, pregunta lo mínimo: como máximo dos preguntas | `procesar.test.js` | integración de módulos | PASS |
| 27 | Solo consulta SIPRES en préstamos; una entidad fuera de la tabla o una tabla inválida da gris con advertencia | `procesar.test.js` | integración de módulos | PASS |
| 28 | El log y la salida no copian el texto de la persona | `procesar.test.js` | integración de módulos | PASS |
| 29 | La configuración (reglas de extracción, umbrales, confianza) llega al validador y al semáforo; las reglas están apagadas por defecto | `procesar.test.js` | integración de módulos | PASS |
| 30 | Toda plantilla que devuelve el orquestador pasa el verificador | `procesar.test.js` | integración de módulos | PASS |

## Comandos ejecutados y resultado

```text
node --test "motor/**/*.test.js"
ℹ tests 131
ℹ pass 131
ℹ fail 0
```

```text
node --test --experimental-test-coverage "motor/**/*.test.js"
calculo.js             línea 100.00 rama 85.54  funciones 100.00
validar-extraccion.js  línea 100.00 rama 99.12  funciones 100.00
procesar.js            línea 97.96  rama 93.55  funciones 83.33   (sin cubrir: 74-75)
respuesta.js           línea 100.00 rama 86.25  funciones 98.00
semaforo.js            línea 100.00 rama 90.22  funciones 100.00
sipres.js              línea 97.74  rama 93.44  funciones 100.00  (sin cubrir: 115-117)
todos                  línea 99.56  rama 90.76  funciones 98.43
```

**Comprobaciones de mutación**, siempre en copias temporales (el repo no se tocó):

| Cambio | Resultado |
|---|---|
| `semaforo.js`: `pct >= umbral.rojo_desde_pct` pasa a `pct >`  | Falla "tienda: 15% es amarillo y 50% es rojo" (1 fallo, 23 aciertos) |
| `respuesta.js`: el verificador deja de rechazar cifras en pesos | Fallan "se rechazan las cifras que no salen del cálculo" y "elegirRespuesta cae a la plantilla si el verificador rechaza" (2 fallos) |
| `validar-extraccion.js`: el plazo corto se toma de lo que dice el modelo | Falla "el plazo corto lo calcula el código, no el modelo" (1 fallo) |
| `procesar.js`: las reglas de extracción quedan siempre encendidas | Falla "las reglas de extracción están apagadas por defecto y se activan por configuración" (1 fallo) |
| `procesar.js`: deja de avisar cuando la entidad no se encuentra en la tabla | Fallan "una entidad que no está en la tabla da gris con su advertencia" y "una tabla de SIPRES inválida no rompe el flujo y da gris" (2 fallos) |

## Huecos conocidos

- **`banxico` diferido.** Nada del motor usa la tasa de CETES: la alternativa de ahorro es P2 en el plan. Mostrar CETES como fuente sin usarla en el cálculo sería engañoso. Además, la serie y el valor de respaldo siguen sin verificar. Si se reactiva, va con su propia prueba.
- **Líneas 74-75 de `procesar.js` sin cubrir:** la rama defensiva `calculo_invalido`, que el validador hace inalcanzable por ahora.
- **El verificador solo comprueba pesos, porcentajes y fechas.** Los conteos ("12 pagos") y los plazos que diga el modelo no se verifican.
- **Una expectativa corregida antes del verde.** En `respuesta.test.js` había escrito el orden de los hechos del mismo nivel al revés; el semáforo conserva el orden en que genera las razones. Corregí esa expectativa y agregué una prueba nueva (evidencia con montos del usuario). No se relajó ninguna comprobación.
- **Reglas de extracción apagadas por defecto.** Anticipo, permisos y depósito menor no dan rojo hasta que JR decida (G6 del plan).
- **Umbrales** del semáforo (15%, 50% en tienda; 50% en préstamo) son los propuestos; JR los valida.
- **Fuera del alcance de este tramo:** n8n (la cuenta de propietario sigue sin crearse), el agente y la página.
- **Sin commits.** Los archivos están sin versionar en la rama local `eq1/motor`.
- **Sin prueba E2E** con el agente todavía; es de la fase 3.

## Fase 2: empaquetado para n8n

Plan: fase 2 de `plan-n8n-agente.md` (sub-workflow `evaluar-oferta` y herramienta de verificación).

| Tarea | Prueba | Rojo | Verde |
|---|---|---|---|
| Empaquetador de nodos y workflows | `scripts/empaquetar.test.js` (19 pruebas) | `Cannot find module './empaquetar'` | 19 de 19 tras generar los archivos |

Entre el módulo y el verde, la prueba "los archivos generados en disco están al día" falló por `ENOENT` (18 de 19), como estaba previsto, hasta correr `node scripts/empaquetar.js`.

**Qué se generó** (por `node scripts/empaquetar.js`, no a mano):

| Archivo | Para qué |
|---|---|
| `n8n/nodos/evaluar-oferta.js` | Código del nodo Code de la herramienta `evaluar_oferta` |
| `n8n/nodos/verificar-entidad.js` | Código de `verificar_entidad` |
| `n8n/nodos/elegir-respuesta.js` | Código del verificador final (fase 3) |
| `n8n/workflows/evaluar-oferta.json` | Sub-workflow importable, con disparador entre workflows y prueba manual |
| `n8n/workflows/verificar-entidad.json` | Ídem para la verificación |

`node scripts/empaquetar.js --verificar` sale con error si algo quedó desactualizado.

| # | Garantía | Prueba | Resultado |
|---|---|---|---|
| 31 | El código empaquetado es autocontenido: sin `require` del sistema, sin archivos ni `process` | `empaquetar.test.js` | PASS |
| 32 | Corriendo el código como lo haría el nodo Code (en `vm`), `evaluar_oferta`, `verificar_entidad` y `elegir_respuesta` dan lo mismo que los módulos | `empaquetar.test.js` | PASS |
| 33 | La tabla de SIPRES se embebe; si no es válida, no se empaqueta nada | `empaquetar.test.js` | PASS |
| 34 | Los workflows no guardan ejecuciones, no llevan credenciales, y los datos fijados son de ejemplo y solo están en la prueba manual | `empaquetar.test.js` | PASS |
| 35 | Lo generado en disco coincide con lo que produce el motor y la tabla actuales | `empaquetar.test.js` | PASS |

**Validación en un n8n real.** En un contenedor temporal (`docker.n8n.io/n8nio/n8n:2.44.5`, base de datos propia y efímera, sin tocar el n8n del equipo) se importaron y ejecutaron con `n8n execute`:

- `evaluar-oferta`: estado `success`; con la entrada de ejemplo devolvió `accion: redactar`, color verde, la plantilla completa y la fecha del log `30/10/2026`. Sin entrada devolvió `error_formato`, como se espera.
- `verificar-entidad`: estado `success`; con la tabla vacía devolvió `sin_verificar`.

Comprobación de mutación (copia temporal): hacer que el resolver del paquete deje de subir de carpeta rompe 5 pruebas de `evaluar_oferta`.

Cobertura de todo el repo: 97.48% de líneas, 91.28% de ramas. `empaquetar.js`: 87.15% de líneas; lo no cubierto es la interfaz de línea de comandos (`principal`).

**Huecos de la fase 2**

- **La tabla de SIPRES está vacía.** Toda entidad da gris hasta que JR capture y verifique las filas en `datos/procesado/sipres_entidades.json` y se regenere.
- **No se importó nada en el n8n del equipo.** Se validó en un contenedor temporal.
- **Falta probarlo como herramienta del agente** ("Call n8n Workflow Tool"): es de la fase 3.
- **La CLI ignora los datos fijados.** La validación completa usó una copia temporal con un nodo Code de ejemplo; los workflows entregados conservan los datos fijados para el editor.
- **Faltaban** el workflow principal (Telegram, Switch, agente) y las credenciales: son la fase 3, abajo.

## Fase 3: workflow principal con agente

Plan: fase 3 de `plan-n8n-agente.md`. La decisión de diseño que salió del plan: el verificador solo sabe comparar contra un cálculo, pero el agente también conversa. Por eso la salida la decide el código (`elegirSalida`), no el modelo.

| Tarea | Prueba | Rojo | Verde |
|---|---|---|---|
| Clasificar el mensaje de Telegram | `motor/flujo/mensaje.test.js` (12) | `Cannot find module './mensaje'` | 12 de 12 |
| Elegir la salida tras el agente | `motor/flujo/salida.test.js` (16) | `Cannot find module './salida'` | 16 de 16 |
| Verificación de texto sin cálculo y mensaje de `/verificar` sin nombre | `motor/respuesta/respuesta.test.js` (+3) | `verificarConversacion` y `verificarSinNombre` inexistentes | 35 de 35 |
| Workflow principal y nodos nuevos | `scripts/empaquetar.test.js` (de 19 a 33) | 17 fallos (nodos, `bot.json`, instrucciones, archivos al día) | 33 de 33 tras generar |

Dos pruebas anteriores cambiaron porque su contrato evolucionó (no se relajó ninguna comprobación): "elegir_respuesta" ahora recibe la salida del agente, y la de conexiones se limitó a los dos sub-workflows.

| # | Garantía | Prueba | Resultado |
|---|---|---|---|
| 36 | Texto libre va al agente; `/verificar nombre` a la búsqueda; el resto, a respuestas fijas; sin chat se ignora; no se copian datos de quien escribe | `mensaje.test.js` | PASS |
| 37 | Si el agente falló, aviso de servicio; si la herramienta de cálculo pidió un dato, sale su pregunta, diga lo que diga el modelo; si hubo cálculo, texto del modelo solo si pasa el verificador, si no la plantilla; si verificó una entidad, el mensaje de la herramienta | `salida.test.js` | PASS |
| 38 | Solo se lee lo que devolvió la herramienta (`observation`), no lo que el modelo le pidió (`toolInput`): un resultado falsificado no se usa | `salida.test.js` | PASS |
| 39 | Sin herramientas, un texto con cifras, colores de semáforo, enlaces o palabras prohibidas se rechaza | `respuesta.test.js`, `salida.test.js` | PASS |
| 40 | `bot.json`: nodos, tipos y versiones; conexiones principales y de IA; herramientas ligadas a los sub-workflows por su identificador; agente con pasos intermedios, reintento y `continueRegularOutput`; Telegram sin la firma de n8n y al chat de origen | `empaquetar.test.js` | PASS |

Mutaciones en copias temporales: `salida.js` leyendo también `toolInput` rompe 2 pruebas; mandar `/verificar` sin nombre a la búsqueda rompe 1.

**Validación en un n8n 2.44.5 temporal** (contenedor aparte, sin tocar el del equipo):

- Los tres workflows se importan tal como se entregan y conservan sus identificadores.
- Ruteo y salida, ejecutados con el nodo Switch y los nodos Code reales (solo se sustituyeron Telegram, el agente y el envío por nodos de prueba):

| Entrada | Camino | Resultado |
|---|---|---|
| `/start` | Mensaje fijo | Bienvenida |
| `/verificar Entidad de ejemplo` | Verificar entidad | `sin_verificar` (tabla vacía) |
| `/verificar` | Mensaje fijo | Explica cómo usarlo |
| Foto | Mensaje fijo | "Por ahora solo leo texto" |
| Texto, agente correcto | Elegir respuesta | Sale el texto del agente |
| Texto, agente inventa `$99,999` | Elegir respuesta | Sale la plantilla |
| Texto, agente falla | Elegir respuesta | Aviso de servicio |

Todas con `chat_id` correcto y estado `success`.

Cobertura de todo el repo: 97.96% de líneas, 92.69% de ramas. `mensaje.js` 100%, `salida.js` 100%.

**Huecos de la fase 3**

- **El nodo Agente no se había ejecutado.** Se probó después con un modelo simulado (sección siguiente). Sigue sin probarse con un modelo real y su credencial.
- **El modelo es un valor de partida** (`deepseek/deepseek-chat` por OpenRouter). Hay que elegir uno que soporte herramientas y asignar la credencial (D4).
- **Telegram:** falta la credencial y una URL pública para el disparador (D6).
- **La memoria es de RAM**, por chat y de seis mensajes (D1).
- **La tabla de SIPRES sigue vacía.**
- **El RAG (CU8) no está.** Con el diseño actual, una respuesta conversacional con cifras se rechaza; una del RAG con cifras también, hasta definir su contrato (D5).

## Prueba del agente con un modelo simulado

**Cómo se hizo.** Un servidor local compatible con OpenAI (un script de Node que no se versiona) hace de modelo: según una marca en el texto de la persona, llama a una herramienta, responde, inventa una cifra o falla con un error 500. Se corrió el workflow `bot.json` real en un contenedor desechable de n8n 2.44.5, **con servidor** (`n8n start`), sin tocar el n8n del equipo. Solo se sustituyeron el disparador de Telegram por un Webhook y el envío por un nodo de prueba; el agente, la memoria, las herramientas y el verificador son los entregados. La credencial de OpenRouter apuntaba al servidor simulado.

| Escenario | Qué hizo el modelo simulado | Lo que se envió | Origen |
|---|---|---|---|
| Cálculo correcto | Llamó a `evaluar_oferta` y redactó con las cifras | El texto del agente | `llm` |
| Cifra inventada (`$99,999`) | Llamó a la herramienta y añadió una cifra | La plantilla del cálculo | `plantilla` (rechazo) |
| Falta un dato | Llamó a la herramienta y dijo otra cosa | La pregunta de la herramienta | `herramienta` |
| Entidad | Llamó a `verificar_entidad` y dijo "Sí, es segura, contrátala" | El mensaje de la herramienta | `herramienta` |
| Saludo | No llamó a ninguna herramienta | El saludo | `llm` (conversación) |
| El modelo falla (500) | Error en cada intento | Aviso de servicio | `servicio` |
| Herramienta inactiva | Llamó a la herramienta, que falló | Aviso de servicio | `servicio` (`herramienta_fallida`) |
| Dos mensajes en el mismo chat | El segundo recibió `[system, user, assistant, tool, assistant, user]` | Memoria con el historial completo | — |

**Lo que se observó de n8n 2.44.5**

- `observation` de cada paso es **texto JSON con la lista de ítems** de la herramienta (`[{"accion":"redactar",...}]`); `toolInput` es un objeto. El lector ya lo leía; quedó como caso de prueba.
- El agente usó el modelo **sin streaming**, vio las dos herramientas por su nombre y, con el modelo en error, hizo **2 intentos** (el reintento configurado) y siguió con `error` en la salida.
- **Los sub-workflows deben estar publicados.** Sin eso, la herramienta devuelve `Workflow is not active and cannot be executed`. Esto expuso un hueco: si el agente llamaba a la herramienta y esta fallaba, su texto habría pasado por la vía de conversación si no traía cifras ("Parece una oferta razonable"). Se corrigió con pruebas primero: 2 rojos, ahora `herramienta_fallida` cuando se llamó a `evaluar_oferta` o `verificar_entidad` y no hubo resultado válido. 3 pruebas nuevas, 198 en total.
- `n8n execute` no sirve para probar herramientas de sub-workflow (corre sin el gestor de workflows activos); hace falta el servidor.
- Un webhook llamado justo al arrancar el servidor da 404 aunque `/healthz` responda; hay que esperar o reintentar.

**Lo que esta prueba no cubre.** Un modelo simulado no dice nada de cómo extrae o redacta un modelo real. Tampoco prueba Telegram, la URL pública, las credenciales reales, ni el streaming con otros modelos.

### Para ponerlo en marcha en el n8n del equipo

1. Crear la cuenta de propietario e importar los tres JSON de `n8n/workflows/` (menú ⋯, "Import from file").
2. **Publicar `evaluar_oferta` y `verificar_entidad`** (sin esto, el bot responde siempre con el aviso de servicio).
3. En `bot.json`, asignar la credencial de Telegram al disparador y al envío, y la de DeepSeek al nodo Modelo (`deepseek-chat`; debe llamar bien a las herramientas).
4. Publicar `bot.json`. El disparador de Telegram necesita una URL HTTPS pública (D6).
5. Tras cambiar el motor o la tabla de SIPRES: `node scripts/empaquetar.js` y volver a importar.

## RAG como herramienta del agente

El bot tiene una tercera herramienta, `consultar_rag`, que llama al servicio RAG de la rama `Eugenio` (contrato de su README): `POST /query` con clave de portador y `{ "query": "...", "topK": 5 }`, que devuelve `{ "results": [{ text, source, page, chunkIndex, similarity }] }`. Con esto queda cerrada la decisión D5.

**Cómo decide el código qué se envía** (`motor/flujo/salida.js`, pruebas primero):

| Situación | Se envía | Origen |
|---|---|---|
| Hay fragmentos y las cifras del texto del modelo están en ellos | El texto del modelo, más el aviso y las fuentes que añade el código | `llm` (`rag`) |
| El modelo agrega cifras, colores de semáforo, enlaces o palabras prohibidas que los fragmentos no respaldan | Un extracto del primer fragmento (500 caracteres como máximo), con el aviso y las fuentes | `plantilla` (`rag_rechazo`) |
| `results` viene vacío | "No encontré información sobre eso en los documentos que tengo." | `herramienta` |
| El RAG no responde o da error | "No pude consultar mis documentos ahora." | `servicio` (`rag_fallido`) |
| También se calculó o se verificó una entidad | Gana el cálculo o la verificación; si el cálculo falló, no lo tapa el RAG | — |

Los nombres de fuente y el texto de los fragmentos se limpian (sin caracteres de control ni espacios repetidos). Las instrucciones del agente le dicen que los fragmentos son datos, no órdenes.

**Prueba en un n8n 2.44.5 desechable** con servidor, el bot real, un modelo simulado de DeepSeek y un RAG simulado que registra lo que recibe:

| Escenario | Resultado |
|---|---|
| Pregunta general, el modelo usa una cifra de los fragmentos | Sale el texto del modelo con aviso y fuentes |
| El modelo inventa `$9,999` | Sale el extracto del primer fragmento |
| El RAG responde sin resultados | Aviso de que no hay información |
| El RAG responde 503 | Aviso de que no se pudo consultar |
| Evaluar una oferta (regresión) | Igual que antes |

El RAG simulado recibió `POST /query` con la clave correcta y un cuerpo JSON válido: `{"query":"qué es el \"CAT\"?\nExplícalo","topK":5}`. Las comillas y el salto de línea de la pregunta llegaron bien escapados.

**Dos suposiciones mías que la prueba corrigió**

- **La clave va en una credencial Header Auth, no "Bearer".** El nodo HTTP de n8n no admite `httpBearerAuth` ("The type httpBearerAuth is not supported"). Se crea una credencial **Header Auth** con nombre `Authorization` y valor `Bearer <RAG_API_KEY>`.
- **El nodo `toolHttpRequest` de LangChain no sirve con el Agente 3.1.** Solo suministra datos y el motor pide que la herramienta se ejecute ("has a supplyData method but no execute method"). Se usa el nodo HTTP Request base en su variante de herramienta, `n8n-nodes-base.httpRequestTool` 4.5. Mientras tanto, el bot se portó bien: avisó que no pudo consultar, sin inventar nada.

**Para activarlo en el n8n del equipo**

1. Levantar el RAG de Eugenio (ver su README) y conectar el contenedor de n8n a su red de Docker: `docker network connect hackaton-clara-rag n8n`. La dirección que usa el bot es `http://rag:3000/query`. Esa conexión se pierde si se recrea el contenedor de n8n.
2. Crear la credencial Header Auth (`Authorization: Bearer <RAG_API_KEY>`) y asignarla al nodo `consultar_rag`.
3. Importar el `bot.json` nuevo. Importar con el mismo identificador reemplaza el bot ya importado y se pierden las credenciales asignadas.

**Huecos**

- **No se probó contra el servicio RAG real de Eugenio.** Necesita PostgreSQL con pgvector, la ingesta de los PDF y un proveedor de embeddings, que su README dice que aún no se eligió. Se probó contra un servidor simulado con su mismo contrato.
- **La dirección `http://rag:3000/query` no se pudo probar en el desechable.** Allí se usó una dirección del host; el nombre `rag` depende de la red de Docker de su compose.
- **El corpus actual solo cubre tarjetas**, no préstamos.
- **Las cifras del RAG se comprueban solo en pesos y porcentajes**, y solo contra el texto de los fragmentos recuperados.

## RECA y SIPRES consultables desde el agente

Petición: "quiero que RECA y SIPRES sean consultables desde el agente".

**SIPRES.** El JSON de Eugenio (`data/sipres-entidades.json`, 2,596 entidades) se convierte con `scripts/importar-sipres.js` a la tabla del bot (`datos/procesado/sipres_entidades.json`): 2,594 filas convertidas y 2 omitidas por no tener nombre utilizable. El conjunto solo trae entidades autorizadas o en operación, así que una entidad ausente sigue siendo `sin_verificar`, nunca "no registrada". Antes de cargar los datos reales se endureció el buscador:

- Una coincidencia exacta gana sobre las parciales.
- Si quedan varias entidades distintas, no se elige una: `sin_verificar` con motivo `varias_coincidencias` y la lista de candidatas, y el mensaje le pide a la persona el nombre completo.
- Un resultado `registrada` añade sector y estatus. SIPRES confirma el registro, no que el producto esté autorizado.

**RECA.** Dos herramientas HTTP nuevas en el agente, ambas con la credencial Header Auth del RAG:

| Herramienta | Llamada | Salida al usuario |
|---|---|---|
| `listar_reca` | `GET http://rag:3000/reca/productos` | Lista fija escrita en código (máx. 12 líneas), con el registro de cada contrato |
| `consultar_reca` | `POST http://rag:3000/query` con `{query, registroReca, topK}` | Texto del modelo si pasa el verificador, o extracto de los fragmentos; siempre con aviso y fuentes (`AVISO_RECA`, `AVISO_SIE`) |

**RED y GREEN**

| Paso | Comando | Resultado |
|---|---|---|
| RED del importador | `node --test scripts/importar-sipres.test.js` | Falla: `Cannot find module './importar-sipres'` |
| GREEN del importador | el mismo | 7 pruebas pasan |
| RED de las herramientas | `node --test scripts/empaquetar.test.js` | 5 fallan (nodos, conexiones, descripciones, instrucciones del agente) |
| GREEN | el mismo, tras generar los archivos | 37 pasan |
| Suite completa | `node --test "motor/**/*.test.js" "scripts/**/*.test.js"` | 250 pasan, 0 fallan |

**Cobertura** (`--experimental-test-coverage`): total 98.05% líneas, 92.39% ramas. `importar-sipres.js` 96.91%, `empaquetar.js` 93.43%, `sipres.js` 98.11%, `salida.js` 100%.

**Prueba contra el RAG real de Eugenio.** El bot real corrió en un n8n 2.44.5 desechable conectado a la red `hackaton-clara-rag`, con las direcciones reales `http://rag:3000/...` y la clave real en una credencial Header Auth. El modelo fue simulado:

| Escenario | Resultado |
|---|---|
| Pedir los contratos | El agente llamó `listar_reca`; la persona recibió la lista de 10 contratos con su registro |
| Preguntar por comisiones de un contrato | Llamó `listar_reca` y luego `consultar_reca` con el registro `17102-140-044679/01-02644-1026`; salió el texto del modelo con aviso RECA, aviso de Banxico y fuentes con páginas |

**Huecos**

- **El modelo fue simulado.** No se probó que un modelo real (Gemini o DeepSeek) elija bien entre `listar_reca` y `consultar_reca`; el prompt lo pide, pero falta verlo en Telegram.
- **Los textos del RECA son evidencia candidata**, pendiente de validación, y la cifra de Banxico es un promedio de mercado, no el CAT del producto. Ambos avisos salen siempre.
- **El buscador de SIPRES es por nombre**: un nombre muy distinto al registrado no coincide y queda `sin_verificar`.
- **Los embeddings siguen siendo léxicos** (`embeddings-local`), no semánticos. Las consultas por registro RECA no los usan.
- **Nada está commiteado.**
