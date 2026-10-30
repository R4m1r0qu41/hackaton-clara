# Piloto RECA: recuperación exploratoria

Esta carpeta contiene diez registros de crédito personal RECA y sus contratos, carátulas y anexos seleccionados, capturados el 30 de octubre de 2026. `piloto/manifest.json` registra URLs, identificadores, versión que la ficha declara actual, código de estatus, fecha de consulta en UTC y hashes SHA-256 de PDF y texto. Las fechas de consulta corresponden a la verificación de las fichas, no al período de validez de los costos. Los archivos son documentos modelo públicos, no ofertas personalizadas ni productos verificados por JR.

Los documentos se extrajeron con `pdftotext -layout`; cada separador de formulario conserva una página PDF. Para regenerar un texto: `pdftotext -layout documento.pdf documento.txt`. Los hashes de PDF y texto se verifican antes de cualquier consulta; si cambia uno, revisar la fuente y actualizar el manifiesto después de una nueva captura, nunca corregir el hash a ciegas. Se generó OCR para la carátula de Banamex: el texto PDF omitía partes visibles como imágenes. El OCR está identificado y pendiente de revisión humana. En la tabla de amortización de Banamex, la página 2 se inspeccionó y está en blanco. No se revisaron visualmente todas las páginas; una extracción con texto no garantiza integridad ni exactitud.

```sh
node reca/consulta.js '17102-140-044679/01-02644-1026' 'tasa de interés'
node reca/verificar.js
node --test reca/test/consulta.test.js
```

Un periodo de gracia puede referirse a cancelar el contrato, no a diferir el pago: leer siempre la cláusula completa. Devuelve fragmentos candidatos con fuente, página y hash, o un estado sin evidencia. La búsqueda es léxica, no semántica: puede omitir evidencia y no confirma si un valor es aplicable. Verificar el PDF original, las condiciones, la versión y documentos complementarios. Las carátulas pueden contener ejemplos o espacios vacíos. No se extraen cifras financieras ni se genera una respuesta en lenguaje natural; no conectar estos resultados como datos verificados ni usarlos para recomendar productos. Los campos desconocidos no deben convertirse en cero.

Todas las fichas consultadas declaran que la versión seleccionada coincide con la versión actual; esto no demuestra disponibilidad comercial. Una ficha Banamex muestra estado `Modificado` (código 3), y el significado de los demás códigos aún requiere revisión. El piloto mezcla crédito de consumo y productivo: no se asume comparabilidad. Se incorporaron siete tablas de amortización y dos anexos de comisiones. Dos tablas se excluyeron: una por contener códigos de barras asociados a una cuenta y otra por posibles datos bancarios en texto. Tres contratos que incluían números bancarios se retiraron y se sustituyeron, junto con sus carátulas y anexos. La búsqueda de secuencias no descarta identificadores en imágenes ni en formatos no detectados. Faltan otros anexos y revisión por JR. RECA advierte que el registro no implica necesariamente revisión o autorización de CONDUSEF.

La rama `Joseph` contiene un recuperador de datos estructurados y la de `Eugenio` un experimento distinto con PostgreSQL y embeddings. Este piloto no cambia sus archivos ni los integra al servidor P0. Antes de una integración real: validar fuentes y condiciones por JR, acordar interfaz con el equipo, incluir anexos necesarios, evaluar recuperación con preguntas y citas revisadas, y establecer un cálculo determinista separado que requiera datos suficientes.

`piloto/catalogo-documentos.json` inventaría los documentos de cada ficha, incluyendo los no descargados. `piloto/revision-imagenes.json` registra candidatos detectados por una heurística de imágenes; no es una garantía de cobertura. Los campos en `revision-candidatos.json` son material de revisión sin validar.

La [lectura preliminar de carátulas](piloto/LECTURA-CARATULAS.md) identifica campos sin completar y requiere validación de JR. `verificar.js` comprueba integridad, páginas, reproducción de texto y una criba parcial de números bancarios; requiere `pdftotext` y `pdfinfo` de Poppler. El resultado no sustituye una revisión visual o de privacidad.

La [criba de códigos](piloto/revision-codigos.json) cubre 124 páginas con `pdftoppm` y `zbarimg`, sin conservar valores. Se puede repetir con `node reca/revisar-codigos.js` (requiere Poppler y ZBar); `verificar.js` comprueba que cada resultado corresponda al hash y a la página actuales. No detectar códigos no garantiza que no existan ni sustituye la revisión de privacidad.

Una [criba OCR de privacidad](piloto/revision-ocr-privacidad.json) revisó las 124 páginas renderizadas con Tesseract en español sin guardar texto o números detectados. Hubo una coincidencia, revisada como dos teléfonos contiguos. El OCR y la expresión de búsqueda pueden omitir identificadores, así que falta revisión humana integral.

Para comprobar si cambió el número de versión o código de estado en las fichas públicas, ejecutar `node reca/actualidad.js` con acceso a RECA y `curl` disponible. La consulta no verifica que los PDF ni los costos sigan iguales y no reemplaza la revisión de JR. [Último resultado capturado](piloto/actualidad-consulta.json), ligado al hash del manifiesto; errores de red, redirecciones o formato desconocido producen `no_comprobado`.

Para comparar los bytes de los PDF con sus fuentes RECA ejecutar `node reca/origen.js` con acceso a Internet y `curl`; el comando no conserva los bytes descargados. El [último resultado](piloto/origen-consulta.json) incluye fecha, hashes y hash del manifiesto. No declara vigencia comercial ni valida las condiciones. Un cambio o error requiere revisión antes de usar el documento.
