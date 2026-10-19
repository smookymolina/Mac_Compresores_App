# MAC Campo — Guía para usuarios

App de Android para cotizar, consultar clientes, registrar pagos y movimientos de almacén **sin internet**.
Usa tu mismo correo y contraseña de la web. Lo que captures se envía al servidor cuando hay conexión.

> ¿Problemas? Avisa al administrador. Si perdiste el teléfono, avísale **de inmediato** (sección 12).

## 1. Instalar en Android

1. En el teléfono, abre el navegador y entra a la web de MAC con tu usuario.
2. En el menú abre **«App móvil MAC Campo»** (dirección `/app`). Si no aparece, pide al administrador que active «App móvil» en tu usuario.
3. Toca **«Descargar APK»** y espera a que termine.
4. Abre el archivo descargado. Android dirá que no permite instalar apps de esa fuente:
   1. Toca **Ajustes** → activa **«Permitir de esta fuente»** (o «Instalar apps desconocidas»).
   2. Regresa y toca **Instalar**.
5. Si **Play Protect** avisa «App no reconocida», toca **Más detalles → Instalar de todas formas**. Es normal: la app es privada de MAC y no viene de la Play Store.
6. Busca el ícono **MAC Campo** en tu teléfono.

## 2. Primer inicio

1. Conéctate a **Wi-Fi** (la primera descarga es la más pesada).
2. Abre MAC Campo y toca **«Iniciar sesión»** con tu **correo y contraseña de la web**.
3. Escribe un **«Nombre del dispositivo»** si te lo pide (p. ej. «Teléfono de Juan»). Así lo verá el administrador.
4. **«Crea tu PIN»** de 4 a 6 dígitos y **«Confirma tu PIN»**. Puedes activar **«Usar huella»**.
5. Espera la **«Descarga inicial»** (catálogo, tus clientes y cotizaciones). Puede tardar unos minutos. No cierres la app.

Cada vez que abras la app te pedirá PIN o huella. **Con 5 PIN incorrectos** la app borra sus datos y vuelve a pedir inicio de sesión (lo no sincronizado se pierde).

## 3. Usar sin internet

**Sí puedes:**
- Buscar en el **Catálogo** por SKU, número de parte o descripción; ver precio, IVA y existencias.
- Crear y editar **Cotizaciones** (borradores), ver el PDF y compartirlo.
- Dar de alta y editar **Clientes**, contactos y direcciones.
- **«Convertir en venta»** una cotización aceptada (queda como venta pendiente).
- **«Registrar pago»** sobre una venta confirmada.
- **Inventario** (usuarios de almacén): entradas, salidas y ajustes.

**No puedes (necesita conexión):**
- Ver cambios que otros hicieron después de tu última sincronización.
- Confirmar una venta o descontar inventario: eso lo hace el servidor al sincronizar.
- Enviar correos: quedan «en cola» y salen al conectar.

**Límite de 7 días:** si llevas más de 7 días sin sincronizar, la app pasa a **solo consulta** hasta que sincronices.

## 4. Sincronizar

La app sincroniza sola cuando hay internet. Para forzarlo toca **«Sincronizar ahora»** (arriba a la derecha).

Barra de estado (arriba):

| Lo que ves | Qué significa |
|---|---|
| 🟢 En línea | Hay conexión; tus cambios se envían. |
| 🟠 Sin conexión | Trabajas sin internet; todo se guarda en el teléfono. |
| 🔄 Sincronizando… | Enviando y recibiendo cambios. Espera a que termine. |
| «N por enviar» | Cambios guardados que aún no llegan al servidor. |
| Aviso rojo de pendientes de más de 24 h | Tienes cambios sin enviar desde hace más de un día. Conéctate y sincroniza **hoy**: hasta entonces solo existen en tu teléfono. |
| «Llevas más de 7 días sin sincronizar…» | Solo puedes consultar hasta que sincronices. |

Consejo: sincroniza al salir y al regresar de cada visita, con Wi-Fi o datos.

## 5. Cotizar y compartir el PDF

1. **Cotizaciones** → **«Nueva cotización»**.
2. Elige el **Cliente** («Buscar cliente»).
3. Agrega productos con **«Producto: SKU o descripción»** y ajusta **Cantidad** y **Descuento %**. Los totales se calculan igual que en la web.
4. Llena **Vigencia**, **Condiciones**, **Tiempo de entrega** y **Notas** si aplica → **Guardar**.
5. Toca **«Ver PDF / Compartir»** y elige WhatsApp, correo, etc. Funciona sin internet.
6. **«Enviar por correo»** sin internet: queda «Correo en cola. Se enviará al conectar.»
7. **«Cambiar estado»**: marca como enviada, aceptada, rechazada o vencida.

Reglas que la app aplica igual que la web: descuento máximo de Ventas (más de 15 % se bloquea), precios del catálogo y reglas de IVA.
Si el precio cambió en el servidor y tu cotización tiene más de 3 días, gerencia la revisará (ver sección 10).

## 6. Folios provisionales

- La app aparta folios **C-n** del servidor cuando hay conexión. Tus cotizaciones sin internet usan esos folios y llegan a la web con el mismo número.
- Si se acaban los folios apartados, la cotización recibe un folio temporal **P-…** con la etiqueta **«Folio provisional»**.
- Al sincronizar, el servidor le asigna su folio definitivo **C-n**. Si ya compartiste el PDF con folio provisional, comparte de nuevo el PDF con el folio definitivo.

## 7. Clientes

1. **Clientes** → **«Nuevo cliente»** (Razón social, RFC, Correo, Teléfono, Días de crédito…) → **Guardar**.
2. Para cambiar datos: abre el cliente → **Editar** → **Guardar**. Puedes **«Agregar contacto»** y **«Agregar dirección»**.
3. Verás «Cliente guardado en el teléfono; se enviará al sincronizar.»
4. Solo ves **tus clientes** y los que no tienen vendedor. Si reasignan un cliente a otro vendedor, desaparece de tu teléfono al sincronizar.
5. Si otra persona editó otro dato del mismo cliente en la web, se conservan **los dos** cambios.

## 8. Ventas pendientes y cobros

**Convertir en venta**
1. Abre una cotización **aceptada** → **«Convertir en venta»** → elige **«Almacén de salida»** → **Convertir**.
2. Sin internet queda como **«Por confirmar»** (venta pendiente). Al sincronizar, el servidor la confirma y descuenta el inventario.
3. Si no hay existencia suficiente, queda **«En revisión»** y gerencia decide (otro almacén, reintentar o rechazar).

**Registrar pago**
1. **Ventas** → abre una venta **Confirmada** → **«Registrar pago»**.
2. Captura **Monto (MXN)**, **Método** (Efectivo, Transferencia, Cheque, Tarjeta…) y **Referencia** → **«Guardar pago»**.
3. Un pago **mayor al saldo** se rechaza. Para pagar todo el saldo toca **«Usar saldo completo»**.

## 9. Almacén

Solo para usuarios de almacén (pestañas Catálogo · Inventario · Más).

1. **Inventario** → elige almacén → **«Registrar movimiento»**.
2. Elige **Tipo** (Entrada, Salida o Ajuste), **Producto**, **Cantidad** y **Motivo** → **Guardar**.
3. En Ajuste la cantidad lleva signo: positivo suma, negativo resta (p. ej. -2).
4. Una salida sin existencia en el servidor queda **«En revisión»**.

## 10. Incidencias

Revísalas en **Más → «Pendientes / incidencias»**. Toca una para abrirla.

| Etiqueta | Qué significa | Qué hacer |
|---|---|---|
| **Pendiente** | Guardado en el teléfono, aún no enviado. | Sincroniza. |
| **En revisión** · «Los precios cambiaron desde que la capturaste» | El precio del catálogo cambió. | Nada; gerencia decide si respeta tu precio, aplica el actual o la rechaza. |
| **En revisión** · «Sin existencia suficiente…» | No hay inventario para la venta o salida. | Nada; gerencia decide (otro almacén, reintentar o rechazar). |
| **En revisión** · «Ya existe otro cliente con el RFC…» | El cliente ya existe. | Busca el cliente existente y úsalo. |
| **Rechazado** | El servidor no lo aceptó (p. ej. pago mayor al saldo, descuento no permitido). | Lee el mensaje. En cotizaciones: corrígela con «Editar» y guarda para reenviarla. En pagos y ventas pendientes rechazadas: toca **Descartar** y vuelve a capturar si aplica. |

Si no entiendes una incidencia, toma captura y envíala al administrador. **No desinstales la app** con pendientes.

## 11. Actualizar la app

- Si hay versión nueva verás **«Nueva versión X disponible · Actualizar»**. Toca **Actualizar**, descarga el APK e instálalo **encima** (no desinstales). Tus datos y pendientes se conservan.
- Si ves **«Actualización obligatoria»**, tu versión ya no es compatible. La app **primero envía tus pendientes** y luego pide instalar la nueva. Toca **«Descargar actualización»**. Si no hay enlace, pídelo al administrador.
- También puedes descargarla en la web: **«App móvil MAC Campo»** → **«Descargar APK»**.
- Tu versión aparece en **Más → Aplicación → Versión**.

## 12. Teléfono perdido o robado

1. **Avisa al administrador de inmediato** para que **revoque** el dispositivo en la web (Sincronización → Revocar).
2. Cambia tu contraseña de la web.
3. Los datos del teléfono están cifrados y protegidos con PIN. Al revocar, si alguien conecta el teléfono, la app borra sus datos.
4. Lo que no se sincronizó en ese teléfono se pierde. Por eso: sincroniza seguido.

Cambio de teléfono: sincroniza el viejo, toca **Más → «Cerrar sesión»** e instala la app en el nuevo.

## 13. Preguntas frecuentes

**¿Necesito datos móviles?** No para trabajar. Sí para sincronizar (Wi-Fi o datos).

**¿Se pierde lo que capturé si se cierra la app o se apaga el teléfono?** No. Se guarda al tocar Guardar.

**Dice «Tu usuario no tiene acceso a la app móvil».** Pide al administrador que active «App móvil» en tu usuario.

**No veo un cliente.** Puede estar asignado a otro vendedor. Sincroniza; si sigue sin aparecer, consulta al administrador.

**No veo el costo de los productos.** Es correcto: Ventas no ve costos, igual que en la web.

**Olvidé mi PIN.** Si tienes la huella activada, usa **«Usar huella»**. Si no, avisa al administrador antes de seguir intentando: con 5 PIN incorrectos la app borra sus datos, vuelves a iniciar sesión y lo no sincronizado se pierde.

**¿Puedo desinstalar y volver a instalar?** Solo si **no** tienes pendientes («No hay cambios por enviar» en Más). Si no, se pierden.

**¿Funciona en iPhone?** Todavía no; está en preparación.
