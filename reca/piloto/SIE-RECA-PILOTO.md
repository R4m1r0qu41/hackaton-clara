# Piloto CAT e intereses: SIE y RECA

El cruce se concentra en CAT, interés ordinario y moratorio. La gracia queda fuera de este ejemplo.

## Contrato Banamex

[Contrato RECA 0300-140-000731/30-00405-0226, página 6](https://registros.condusef.gob.mx/reca/admin/contratos_anexos/140042c.pdf#page=6):

- Tasa ordinaria fija individualizada: no mayor de 50% anual. Es un máximo contractual, no una tasa ofrecida o aplicada al cliente.
- Tasa moratoria: 1.2 veces la tasa ordinaria individualizada, sobre capital vencido y días en mora, con divisor de 360 días. Al clasificarse como vencido o declararse vencimiento anticipado, el contrato prevé cálculo sobre el saldo insoluto; revisar la cláusula íntegra.
- Tasa individual y CAT: `null` por falta de condiciones del producto o del cliente verificadas.

La ficha capturada indicaba Modificado. Las condiciones requieren validación de JR y comprobación de vigencia comercial.

## Referencia SIE

SF316116 reportó 39.0809% para enero-febrero de 2026, consultado el 30 de octubre de 2026. Es la tasa promedio ponderada por saldo de la cartera comparable de créditos personales del sistema. [Cuadro CF815 y metodología](https://www.banxico.org.mx/SieInternet/consultarDirectorioInternetAction.do?sector=18&accion=consultarCuadro&idCuadro=CF815&locale=es).

No es CAT ni tasa de este producto, no demuestra inclusión del producto en la cartera y no se usa como tasa individual para calcular intereses. No se calcula una diferencia entre el promedio y el máximo contractual como medida de conveniencia. Para reconciliar costos por producto hace falta una fuente de condiciones actuales e identidad de producto, como CUP con acceso autorizado u otra evidencia oficial verificable.

```sh
node reca/sie-piloto.js '0300-140-000731/30-00405-0226'
node --test reca/test/sie-piloto.test.js
```

Es un ensamblaje local de evidencias, pendiente de validación, sin integración al servidor ni al RAG de producción.

## Criterio acordado con JR

JR acepta usar el promedio de Banxico como referencia del interés ordinario en el piloto. La salida expone `tasa_ordinaria_referencia_pct = 39.0809`, serie SF316116, periodo enero-febrero de 2026, y naturaleza de promedio ponderado de mercado. El contrato aporta el máximo ordinario y la fórmula moratoria. La tasa individual y el CAT permanecen pendientes; aceptar el promedio como referencia no lo convierte en CAT.
