# RAG de servicios financieros

Este servicio ingiere los PDF de data/pdfs, guarda fragmentos y embeddings en PostgreSQL + pgvector, y expone una API HTTP de búsqueda semántica para n8n. La API devuelve texto y referencias de origen; no llama a ningún modelo de lenguaje. n8n puede pasar los resultados al modelo que el equipo elija.

## Flujo

1. npm run db:setup aplica rag/schema.sql.
2. npm run ingest extrae texto página por página, crea chunks con source, page y chunkIndex, pide embeddings al endpoint configurado y reemplaza el índice en una transacción.
3. npm start expone POST /query para n8n.

La ingesta toma todos los archivos PDF de data/pdfs. Los PDF escaneados sin capa de texto detienen la ingesta con un error; no se ejecuta OCR.

## Configuración

Copia .env.example a .env y completa:

- DATABASE_URL: URL PostgreSQL; la base debe tener pgvector disponible y el usuario debe poder conectarse y crear la extensión durante db:setup.
- EMBEDDINGS_API_URL: endpoint que implementa el contrato indicado abajo.
- EMBEDDINGS_API_KEY: opcional; se envía como bearer token solo al endpoint de embeddings.
- RAG_API_KEY: clave de al menos 32 caracteres que n8n enviará a esta API. Genérala y guárdala en el almacén de credenciales de n8n; no la subas al repositorio.
- HOST y PORT: por defecto 127.0.0.1:3000. Para n8n en otro contenedor, usa una dirección accesible dentro de una red privada controlada y limita el acceso con firewall o proxy TLS.
- PDF_DIR, CHUNK_SIZE, CHUNK_OVERLAP y TOP_K: configuración del corpus y recuperación. El tamaño de chunk se expresa en caracteres, no tokens.
- EMBEDDINGS_TIMEOUT_MS y PGCONNECT_TIMEOUT_MS: límites de espera de red.

El contrato de embeddings es un POST JSON {"texts":["texto 1","texto 2"]} y una respuesta JSON {"embeddings":[[0.1,0.2],[0.3,0.4]]}, con un vector no vacío, finito y de igual dimensión por texto. El proveedor/modelo no está elegido aquí. Debe usarse la misma configuración en ingesta y consulta.

## Conectar n8n

Usa el nodo HTTP Request:

- Método: POST
- URL: http://<host-accesible>:3000/query
- Autenticación: bearer token guardado como credencial de n8n, con valor RAG_API_KEY
- Cuerpo JSON:

    {
      "query": "¿Qué requisitos tiene este producto?",
      "topK": 5
    }

La respuesta tiene la forma:

    {
      "results": [
        {
          "text": "Fragmento recuperado...",
          "source": "TarjetasOro.pdf",
          "page": 2,
          "chunkIndex": 0,
          "similarity": 0.82
        }
      ]
    }

n8n debe conservar source y page al presentar citas. similarity sirve para ordenar, no representa certeza ni una recomendación financiera.

GET /healthz comprueba que el proceso responda. GET /readyz comprueba que PostgreSQL y rag_chunks estén accesibles. /query requiere bearer token. Errores de autenticación, cuerpo, método, tamaño, servicio y consulta se responden con códigos HTTP distintos; los errores internos no revelan detalles de conexión.

## Comandos

    npm install
    npm run db:setup
    npm run ingest
    npm test
    npm start

rag/data queda reservado para datos procesados locales y está excluido de Git. La tabla rag_chunks se considera dedicada a este corpus: cada ingesta completa la reemplaza dentro de una transacción.

## Pendientes antes de producción

- Elegir y documentar el proveedor/modelo de embeddings, URL, dimensiones, límites, costo, retención y condiciones de uso. No se incluyen credenciales.
- Confirmar la dimensión y usarla de forma consistente; la aplicación detecta incompatibilidades al ingerir y consultar. El esquema mantiene VECTOR sin dimensión fija hasta esa decisión.
- Decidir e implementar el índice ANN (HNSW o IVFFlat) después de confirmar dimensión y medir el volumen. Hoy la búsqueda es exacta y puede ser lenta con corpus grandes.
- Configurar TLS, red privada, rotación de RAG_API_KEY, límites de tasa y monitoreo para el despliegue real.
- Ejecutar la ingesta y una consulta de aceptación con PostgreSQL/pgvector y el endpoint de embeddings reales en el entorno de despliegue.
- Generar y versionar package-lock.json con npm install en el entorno que hará la instalación.

## Seguridad del parser PDF

Los PDF se consideran entradas no confiables. PDF.js se invoca con isEvalSupported=false. La dependencia declarada pdfjs-dist ^4.10.38 queda fuera de los rangos de GHSA-wgrm-67xf-hhpq (hasta 4.1.392) y GHSA-hq66-cqwq-w95j (desde 5.6.83); aun así, el repositorio no tiene package-lock.json y no se ejecutó npm audit. En el entorno de instalación hay que generar y versionar el lockfile y revisar las dependencias transitivas.

- https://github.com/advisories/GHSA-wgrm-67xf-hhpq
- https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j

El corpus actual contiene seis PDF cuyos nombres apuntan a productos de tarjetas. Para responder con respaldo sobre entidades oficiales de préstamos, habrá que incorporar las fuentes oficiales correspondientes. La API cita archivo y página; si la demo necesita URL oficial y fecha de consulta, esos metadatos deben añadirse al registro de cada documento.

## Docker Desktop

The repository includes a Node 24 image build and a Compose stack with PostgreSQL + pgvector. Docker pulls the official Node base image during build and creates named PostgreSQL and RAG data volumes. Node itself is an image/container, not a data volume.

1. Copy .env.example to .env. Set POSTGRES_PASSWORD, set DATABASE_URL to use host db and the same database/user/password, set RAG_API_KEY, and configure EMBEDDINGS_API_URL when the embedding endpoint is chosen. Special characters in the database password must be URL-encoded inside DATABASE_URL.
2. Pull PostgreSQL + pgvector and build the Node image:

       docker compose pull db
       docker compose build --pull rag
3. Start PostgreSQL:

       docker compose up -d db
4. Apply the schema and ingest the PDFs:

       docker compose run --rm rag npm run db:setup
       docker compose run --rm rag npm run ingest
5. Start the RAG API:

       docker compose up -d rag

The API is published on host loopback at port 3000 by default. n8n running on this host can call http://localhost:3000/query. For n8n in another container, attach that container to the hackaton-clara-rag network and call http://rag:3000/query. Store the bearer key in an n8n credential.

Use Docker Desktop Linux containers with WSL 2. Before the first real run, configure the missing WSL 2 prerequisites and accept Docker Desktop's terms in its own UI. Do not expose the API to a public network without TLS and firewall controls.
