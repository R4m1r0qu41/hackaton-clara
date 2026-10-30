# RECA y Banxico: condiciones del piloto

JR indicó concentrar RECA en las cláusulas útiles de los contratos y reconciliar costos por producto con el Comparador de Banxico. Las carátulas con campos vacíos no aportan una tasa o CAT aplicable. La lista estructurada [clausulas-candidatas.json](clausulas-candidatas.json) conserva fuente, página y SHA-256 y requiere validación de JR; no es recomendación ni una oferta individual.

## Hallazgos en los contratos

- **CREDICHIC FLEX — cobranza:** 5% más IVA sobre saldo vencido al incurrir en mora; la cláusula indica que es independiente de los intereses moratorios. [Contrato, p. 5](https://registros.condusef.gob.mx/reca/admin/contratos_anexos/144572c.pdf#page=5).
- **CPSJI EXTRA — cobranza:** 20% del saldo insoluto más intereses ordinarios, cuando el pago se omite por más de 89 días de mora y la cuenta se canaliza a un despacho externo. [Contrato, p. 9](https://registros.condusef.gob.mx/reca/admin/contratos_anexos/143929c.pdf#page=9). No presupone que ambos porcentajes se calculen sobre la misma base.
- **Préstamo Clásico — gracia para domiciliación:** dos días hábiles después de la fecha de pago, sin comisión por falta de pago cuando el retraso no es atribuible al cliente y el pago se procesa durante ese plazo. No se deduce que se suspendan intereses. [Contrato, p. 4](https://registros.condusef.gob.mx/reca/admin/contratos_anexos/140008c.pdf#page=4).
- **Crédito Sustitución Efectivo — gracia de capital:** el contrato contempla que una promoción pueda incluir un periodo para no pagar capital; el periodo concreto se remite al plan o tabla y durante ese periodo corresponde pagar intereses según la solicitud. No se asume que la promoción esté disponible ni se inventa duración. [Contrato, p. 5](https://registros.condusef.gob.mx/reca/admin/contratos_anexos/073460c.pdf#page=5).

Estas son lecturas candidatas, no validación de vigencia o legalidad. Falta revisar los demás contratos en forma íntegra y buscar límites de intereses con sus condiciones; no encontrar un tope todavía no prueba que no exista. La gracia de cancelación es una figura distinta de la gracia de pago.

## Datos de Banxico y reconciliación

El [Comparador de crédito personal](https://comparador.banxico.org.mx/ComparadorCrediticio/credito-en-efectivo.jsp) solicita un escenario de edad, ingreso, monto y periodicidad. Sus resultados son informativos y dependen del escenario; no se han capturado valores de productos ni confirmado correspondencias en esta revisión.

La [API oficial del Catálogo Único de Productos (CUP)](https://comparador.banxico.org.mx/ComparadorCrediticio/apiHtml/index.jsp) incluye características, elegibilidad, CAT, tasas, comisiones y seguros. [Banxico requiere solicitud, autorización, credenciales y contrato](https://comparador.banxico.org.mx/ComparadorCrediticio/apiHtml/autorizacion.jsp); no hay acceso validado en este repositorio. Sus [políticas](https://comparador.banxico.org.mx/ComparadorCrediticio/apiHtml/politicas_uso.jsp) regulan actualización, almacenamiento, secuencia de consultas y presentación al público; el piloto de diez no demuestra cumplimiento de cobertura del comparador público.

Antes de vincular un registro, confirmar institución, producto, modalidad, fecha y escenario con evidencia de ambas fuentes. Los identificadores de producto, subproducto y operativos sirven para asociar tablas dentro del CUP; no se ha demostrado que sean una llave directa al número RECA. Sin correspondencia revisada, los valores de Banxico y la relación con el contrato permanecen `null`. Diferencias de tasa o comisión se conservan con sus fuentes y fechas, no se resuelven automáticamente.
