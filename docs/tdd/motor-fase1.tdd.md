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
- **Faltan** el workflow principal (Telegram, Switch, agente) y las credenciales.
