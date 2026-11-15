# Revision de la migracion inicial PostgreSQL

Estado: SQL preparado y revisado; NO aplicado. Inspeccion remota en transaccion de solo lectura.

## Estado remoto observado
- Esquemas de usuario: public.
- Tablas de usuario: 0. Registros contados: 0.
- Historial _prisma_migrations: ausente.
- Colisiones con los objetos que se crearan: ninguna.
- No se consultaron valores de registros ni se imprimieron credenciales.

## SQL preparado
- Archivo: `prisma/migrations/20261115064314_initial_postgresql/migration.sql`.
- Generado con Prisma 6.19.3: `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`.
- Este diff usa el modelo local y un origen vacio; no aplica SQL ni requiere una shadow database.
- SHA-256 SQL: `9f73c48942ce02d48b4a6119f28032fc12b733d6431e70fb3f90b0bcaba77f6e`.
- SHA-256 schema.prisma: `5569d63ae73f082189b9f3093f0819e050f6c4539b07c697297b9d743196db4e`.
- Tablas: User, Category, Product, Order, OrderItem, Payment, OrderStatusHistory, InventoryMovement, AuditLog, StoreSettings.
- Enums: Role, OrderStatus, PaymentStatus, Fulfillment.
- Claves primarias: 10; indices unicos: 8; otros indices: 6; claves foraneas: 7.
- No contiene DROP, TRUNCATE, INSERT, UPDATE o DELETE de registros. Los ALTER TABLE solo agregan claves foraneas a las tablas nuevas.

## Riesgos y limites revisados
- Volver a comprobar el estado remoto antes de aplicar: CREATE TABLE/TYPE no debe ejecutarse sobre objetos existentes con los mismos nombres. Si aparecieran datos o historial previos, revisar el baseline; nunca resetear.
- ON DELETE CASCADE en OrderItem, Payment y OrderStatusHistory refleja el esquema: una futura eliminacion de Order borraria sus registros hijos. AuditLog.userId usa SET NULL.
- InventoryMovement.orderId y los actorId son identificadores sin FK; no se agregaron relaciones que no existan en el esquema.
- Los limites de cantidades, centavos e inventario se validan en la aplicacion; el esquema actual no declara CHECK de no negatividad.
- Los cuid y @updatedAt se gestionan desde Prisma; no se agregaron funciones o triggers propios.
- PostgreSQL no crea automaticamente indices en todas las columnas FK; se conservaron exactamente los indices del modelo. Revisar rendimiento cuando crezca el volumen.
- La migracion solo crea estructura: no importa SQLite, productos, usuarios, ajustes ni pedidos. Tampoco crea un administrador.
- No se ha aplicado ni probado este DDL ejecutandolo en una base; solo se valido y genero con Prisma. No se cambiaron esquema Prisma, .env ni el proyecto original.

## Aplicacion futura, requiere autorizacion
Desde C:\dev\E-pan-publicacion:

```powershell
npx.cmd --no-install prisma migrate deploy --schema prisma/schema.prisma
```

El esquema usa DIRECT_URL para estas operaciones. Prisma creara su tabla de control _prisma_migrations al aplicar; esa tabla no forma parte de los diez modelos comerciales. No se ejecuto este comando.
