# Preparación de importación del catálogo SQLite a Neon

Estado: revisado en modo de solo lectura. **Importación NO ejecutada.**

Origen: `C:\dev\E-pan\prisma\dev.db`, abierto con `DatabaseSync(..., { readOnly: true })`.
Destino: Neon PostgreSQL, mediante `DIRECT_URL` del `.env` privado de la copia.
Solo se seleccionan columnas explícitas de `Category`, `Product` y `StoreSettings`.
No se consultan ni copian usuarios, hashes de contraseñas, pedidos, pagos o historiales.
No se generan dumps de SQLite ni archivos con las credenciales o URLs de conexión.

## Registros encontrados

| Entidad | SQLite | Neon al comprobar | Creaciones previstas |
| --- | ---: | ---: | ---: |
| Category | 4 | 0 | 4 |
| Product | 5 | 0 | 5 |
| StoreSettings | 1 | 0 | 1 |

Categorías: Pan dulce (3 productos), Antojitos (2), Pan blanco (0) y Pasteles (0).
Se mantienen las categorías vacías. No se añade el bolillo ni ningún otro producto
ausente del catálogo SQLite, aunque exista en el seed.

| Producto existente | Categoría | Precio MXN | Descripción existente |
| --- | --- | ---: | --- |
| Concha de vainilla | Pan dulce | 18.00 | Suave, esponjosa y cubierta con costra de vainilla. |
| Cuernito de mantequilla | Pan dulce | 24.00 | Hojaldrado con mantequilla, recién salido del horno. |
| Dona glaseada | Antojitos | 25.00 | Masa tierna con glaseado clásico hecho en casa. |
| Galletas de mantequilla | Antojitos | 48.00 | Paquete de seis galletas crujientes. |
| Oreja crujiente | Pan dulce | 20.00 | Capas doradas con el punto justo de azúcar. |

Los cinco productos están activos, tienen `inventory = NULL` (sin control de
cantidad, no inventario cero) y `madeToOrder = false`. Se conservarán los IDs,
slugs, asociaciones a categorías, descripciones y URLs originales.

## Configuración de tienda

- Registro `store`: recogida habilitada, entrega a domicilio deshabilitada.
- Tarifa de entrega: 0 centavos.
- `address` y `hours`: NULL. No se rellenan con valores inventados.
- La ubicación oficial del mapa continúa en `src/lib/pickup-location.ts`.
  Esta importación no modifica ni duplica esa configuración en la base.

## Imágenes

Los cinco productos referencian URLs HTTPS de `images.unsplash.com`, sin
credenciales incrustadas ni parámetros de acceso temporal detectados.
Se conservan exactamente; no se reemplazan con imágenes del seed o de Cloudinary.
No se comprobó su disponibilidad remota ni se subió ningún archivo a un proveedor.

**Imágenes locales referenciadas por el catálogo que requieran traslado: 0.**

Existen cuatro archivos en `public/uploads` no referenciados por estos productos:

- `4c55189f-c77d-4aa3-a94d-14f20e598726.jpg`
- `5a68801a-64f1-404a-b195-54dff108013b.jpg`
- `7758965e-e19d-46f0-b9d6-4e3a005094c5.jpg`
- `a5272428-d4a1-4104-abdc-9b49a3d62877.jpg`

No se eliminan ni se incluyen automáticamente en una migración a Cloudinary.
La elección de imágenes comerciales definitivas es una decisión independiente.

## Compatibilidad comprobada

- Booleanos SQLite 0/1 convertidos de forma explícita a booleanos PostgreSQL.
- Marcas de tiempo SQLite en milisegundos convertidas a `Date` UTC, manteniendo
  precisión de milisegundos y valores históricos de createdAt/updatedAt.
- Precios conservados como enteros en centavos; no se almacenan importes flotantes.
- Validación de rangos PostgreSQL y de las reglas administrativas del producto.
- IDs únicos, slugs únicos, nombres de categoría únicos y categorías referenciadas
  válidas. No se regeneran identificadores ni se crean categorías implícitas.
- Valores NULL preservados. Los campos desconocidos se rechazan.
- Los datos actuales superan las comprobaciones, sin incompatibilidades detectadas.

## Procedimiento preparado

Código: `prisma/import-catalog.ts` y `src/lib/catalog-import.ts`.
Probado con Node.js 22.23.5 y las dependencias existentes; no requiere instalar
otra biblioteca SQLite. En Node 22, `node:sqlite` emite un aviso de API experimental.

Desde `C:\dev\E-pan-publicacion`, este comando **solo comprueba y no importa**:

```powershell
npx.cmd --no-install tsx prisma/import-catalog.ts
```

1. Leer un snapshot coherente de las tres tablas desde SQLite en solo lectura.
2. Validar campos y relaciones; comprobar que la lectura no cambió el archivo.
3. Revisar imágenes y calcular una huella determinista solo del catálogo elegido.
4. Comprobar el destino con una transacción PostgreSQL READ ONLY.
5. Preparar un plan por ID: crear faltantes, omitir idénticos y bloquear diferencias,
   colisiones únicas o registros de catálogo ajenos al lote.
6. Después de autorización expresa, aplicar las creaciones en una única transacción
   Serializable, en orden Category → Product → StoreSettings.
7. Verificar todos los campos antes de confirmar. Ante error, la transacción revierte
   sus creaciones. Nunca se actualizan o eliminan registros existentes.

El procedimiento es idempotente si el destino ya coincide exactamente: el segundo
intento no crea duplicados ni modifica fechas. Es una importación inicial, no un
sincronizador que sobrescriba ediciones posteriores del administrador.

Si se produce un error de red durante una futura confirmación, ejecutar primero
el modo de lectura para determinar el estado; nunca hacer reset ni reintentar a ciegas.

## Huellas de la revisión

- Catálogo de origen: `602032cd5d374d20c9dd6274d461c0d2466739409c8c6761a1801db1466ff101`
- Identidad del destino: `4bfaad71324faa51cdef478223ca475217b8ef67b708e45437c74d4c9bf21bcf`

La huella del destino no contiene la contraseña y permite rotarla sin cambiar la
identidad del destino aprobado. Si cambia el catálogo o el destino, se requiere
una nueva revisión. No se incluyen secretos en las huellas mostradas.

**Comando futuro, NO ejecutado y pendiente de autorización:**

```powershell
npx.cmd --no-install tsx prisma/import-catalog.ts --apply --expected-source-sha256 602032cd5d374d20c9dd6274d461c0d2466739409c8c6761a1801db1466ff101 --expected-target-sha256 4bfaad71324faa51cdef478223ca475217b8ef67b708e45437c74d4c9bf21bcf
```

## Verificaciones realizadas

- TypeScript: correcto.
- ESLint de los tres archivos nuevos de código: correcto.
- Vitest: 31 pruebas correctas, incluidas ocho nuevas pruebas en memoria.
- Comprobación real del importador: transacción READ ONLY, sin conflictos,
  4/5/1 creaciones planificadas y 0/0/0 registros actuales en destino.
- SQLite se abrió únicamente en lectura; se verificó su huella antes y después.
- No se ejecutaron el modo apply, seed, db push, migraciones, commits ni push.

La transacción de escritura preparada no se ha ejercitado contra una base real:
ejecutarla requerirá autorización. La importación tampoco creará administradores,
movimientos de inventario, registros de auditoría o configuración de Cloudinary.
