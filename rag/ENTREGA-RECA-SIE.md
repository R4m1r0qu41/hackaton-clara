# Entrega RECA + SIE — Eugenio

Base revisada: `6ebdbc782cfbc04d5b851067bea77fa2d38df4cc` de Eugenio. JR autorizó integrar y hacer push únicamente a esa rama. El checkout Juan-Ramon y sus cambios locales no se modificaron.

## Resultado

- Diez contratos públicos RECA, con texto extraído por página, número de registro, URL, fecha y hashes de PDF/texto. No se incluyen carátulas en el recuperador nuevo.
- Captura SIE SF316116: 39.0809%, enero-febrero de 2026, consulta 30/10/2026. Promedio de mercado aceptado por JR como referencia ordinaria del piloto; no es CAT ni tasa individual. La comparabilidad y pertenencia de productos a esa cartera no están verificadas.
- `GET /reca/productos` enumera los registros; `POST /query` con `registroReca` devuelve fragmentos y SIE con fuentes. Ambas rutas requieren el bearer token RAG_API_KEY.
- `RAG_MODE=reca-sie` permite iniciar y consultar sin PostgreSQL ni embeddings; el modo por defecto conserva la ruta semántica existente. El corpus se valida por hash al cargarlo. La respuesta conserva CAT y tasa individual como null.
- Cinco cláusulas candidatas estructuradas: cobranza y gracia de cuatro contratos, más máximo ordinario y fórmula moratoria Banamex. No se presentan como costos personalizados verificados.

## Validación y ejecución

`npm install --ignore-scripts --no-package-lock`: dependencias declaradas instaladas; npm reportó cero vulnerabilidades en esa ejecución. No se cambian dependencias ni se genera lockfile en esta entrega.

`npm test`: suite previa e integración HTTP, catálogo, identidades de los diez contratos, citas y rechazo de texto alterado.

Arranque real probado con `node rag/server.js`, RAG_MODE=reca-sie y una clave temporal privada: readyz mostró diez registros y POST /query devolvió RECA (Banamex, p. 6) + SIE sin configurar DB ni embeddings. No se guardó esa clave.

Para conectar n8n, seguir el ejemplo en `rag/README.md`; conservar en el prompt del modelo `sourceType`, URL, página, periodo, condiciones y advertencias. La autenticación debe configurarse en las credenciales de n8n. No se cambió ni se ejecutó el flujo n8n de producción.

## Límites y siguiente paso

El proveedor de embeddings, PostgreSQL real, la ingesta vectorial y el despliegue Docker no se validaron en esta ejecución; el modo local no los requiere. El Dockerfile incluye el corpus nuevo y el Compose existente mantiene el flujo PostgreSQL por defecto.

Revisor funcional: JR / Eugenio, pendiente de prueba desde su n8n. Antes de la demo: configurar la clave, iniciar el servicio, seleccionar registro con GET /reca/productos, consultar y verificar que la respuesta del modelo conserve las fuentes y no convierta el promedio en tasa individual o CAT. El cierre de la aplicación completa sigue requiriendo ese recorrido en el entorno del equipo.
