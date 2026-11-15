# Despliegue de E-Pan en Netlify

Estado actualizado al 15 de noviembre de 2026: backend preparado y verificado;
publicación en Netlify pendiente. Esta guía describe el estado vigente de
`C:\dev\E-pan-publicacion`, rama `chore/preparar-despliegue`.

## Estado completado

| Área | Estado verificado |
| --- | --- |
| PostgreSQL | Neon conectado mediante URL agrupada y directa, ambas con TLS |
| Migraciones | Dos migraciones aplicadas correctamente y con checksums verificados |
| Catálogo real | 4 categorías, 5 productos y 1 StoreSettings importados |
| Administrador | 1 usuario con rol ADMIN y hash bcrypt de coste 12 |
| Cloudinary | Cuenta autenticada: GET /ping respondió HTTP 200 |
| Login | JWT, bcrypt, cookies y limitador persistente implementados |
| Publicación | Netlify y la URL pública HTTPS siguen pendientes |

Las verificaciones de datos al completar estas operaciones confirmaron 0 pedidos
y que el administrador y el catálogo permanecían intactos. No se repiten escrituras
sobre Neon para preparar el commit o el build.

El destino previsto utiliza Netlify Free, Neon Free y Cloudinary Image & Video API
Free. Revisar los cupos y la configuración de facturación de cada cuenta antes de
publicar; no activar planes de pago, recargas o productos adicionales sin autorización.

## Next.js, Prisma y build

`netlify.toml` configura `npm run build`, publicación desde `.next` y Node.js 22.
Netlify detecta Next.js y utiliza OpenNext. No se necesita exportación estática
ni rediseñar la aplicación. `.nvmrc` fija el mismo major de Node para desarrollo.

El build ejecuta exclusivamente `prisma generate && next build`. El esquema
PostgreSQL genera Prisma Client para `native` y `rhel-openssl-3.0.x`, necesario
para el runtime de funciones con Node 20 o posterior. Los Route Handlers mantienen
runtime Node; el middleware no incorpora Prisma ni SQLite.

No se ejecutan migraciones, seed, db push, importaciones o creación de usuarios
como parte del build o del arranque. La aplicación no utiliza SQLite como base
persistente de producción ni escribe imágenes en `public/uploads` o `/tmp`.
El SQLite original permanece fuera de esta copia y del despliegue.

No subir `.next`, `node_modules`, `.cache`, `.env` ni bases locales. Las trazas
privadas de un build local pueden referenciar `.env`; no desplegar ese artefacto
sin una revisión separada. Netlify debe compilar desde GitHub y recibir las
credenciales mediante sus variables privadas, sin un `.env` versionado.

## Base Neon y migraciones aplicadas

El esquema usa `DATABASE_URL` agrupada para consultas de la aplicación y
`DIRECT_URL` directa para herramientas Prisma expresamente autorizadas.
Las dos migraciones presentes en el proyecto ya quedaron registradas como
completadas en `_prisma_migrations`:

| Migración | Resultado |
| --- | --- |
| `20261115064314_initial_postgresql` | Creó los diez modelos comerciales |
| `20261115083609_admin_login_rate_limit` | Creó AdminLoginRateLimit, su clave primaria y el índice expiresAt |

La tabla del limitador se verificó inicialmente vacía, con columnas e índices
válidos. No altera User, categorías, productos, configuración o pedidos.
Conservar ambos SQL y `migration_lock.toml` en Git; no editar migraciones aplicadas.

El catálogo se importó desde una lectura de SQLite, preservando identificadores,
precios en centavos, relaciones, disponibilidad, imágenes y fechas. Solo se copiaron
Category, Product y StoreSettings; no se transfirieron usuarios o pedidos históricos.
El administrador se creó por separado, sin ejecutar el seed.

Para otro entorno o futuras modificaciones, revisar el destino, el historial y el
SQL y obtener autorización antes de aplicar migraciones. No ejecutar resets,
`db push`, seed o importaciones para solucionar un problema de configuración.
La existencia de estas herramientas en package.json no autoriza su ejecución.

## Administrador y protección del login

El administrador existente tiene rol ADMIN. El login compara la contraseña con
bcrypt, emite JWT HS256 de ocho horas y conserva epan_session con HttpOnly,
SameSite=Lax, Path=/ y Secure en producción. Las APIs vuelven a consultar User y
aceptan el personal autorizado ADMIN o BAKER; no hay registro público de usuarios.

`prisma/create-admin.ts` es una herramienta separada, en modo de lectura por
defecto. Su modo de creación exige autorización y User vacía; no sirve para
sobrescribir usuarios ni restablecer contraseñas. El primer administrador ya
existe: no volver a ejecutarlo con --create en esta base ni utilizar el seed
para actualizar el acceso.

El limitador reserva las cuotas de cuenta e IP en una única transacción
SERIALIZABLE con hora de PostgreSQL y reintentos acotados ante conflictos:

| Dimensión | Cuota | Ventana fija |
| --- | ---: | --- |
| Cuenta normalizada | 5 intentos | 15 minutos |
| IP o prefijo IPv6 /64 | 60 intentos | 10 minutos |

Cuenta solicitudes con credenciales sintácticamente válidas, incluidas las
exitosas. No reinicia cuotas al acertar ni prolonga ventanas al recibir intentos
bloqueados. Devuelve 429 genérico con Retry-After sin revelar si existe el correo.
Las claves se almacenan como HMAC, sin IP ni correo en claro. El proceso no
mantiene contadores en memoria y no abre transacciones durante bcrypt.

En producción requiere `ADMIN_LOGIN_IP_SOURCE=netlify` y lee únicamente
x-nf-client-connection-ip suministrada por Netlify. No usa X-Forwarded-For,
X-Real-IP, Client-IP o Host para deducir una IP fiable. No habilitar esta confianza
en un servidor público directo o en otro proveedor. En desarrollo se utiliza
una cuota local compartida sin confiar en las cabeceras del cliente.

Si falta una IP fiable, la variable de configuración o el almacenamiento, el login
responde 503: no omite el limitador. La tabla ya existe en Neon; lo pendiente es
configurar y verificar la plataforma de destino. La concurrencia y las cabeceras
reales de Netlify requieren una prueba en un entorno aislado autorizado.

## Cloudinary y catálogo

Cloudinary se autenticó sin subir archivos ni modificar recursos, usando GET /ping.
Esto confirma las credenciales, pero no sustituye una prueba real de subida.

POST /api/admin/uploads verifica sesión y permisos y recibe tipo/tamaño declarados.
El servidor genera una firma SHA-256 con formatos permitidos, ID aleatorio,
marca temporal y overwrite=false. El navegador sube directamente a Cloudinary,
sin transferir el binario por la función serverless. El API Secret permanece en
el servidor; la API key es el identificador necesario para la petición firmada.

La interfaz y la solicitud de autorización validan hasta 10 MB y formatos de
imagen enumerados, excluyendo SVG. El servidor de E-Pan recibe metadatos, no
inspecciona los bytes del archivo; Cloudinary valida la subida. Las firmas son
autorizaciones temporales y no deben registrarse en logs o caché.

Los cinco productos importados conservan imágenes externas de Unsplash. No hubo
imágenes locales referenciadas por ese catálogo que trasladar. Hay cuatro archivos
estáticos en public/uploads sin esas referencias; revisar su pertinencia y derechos
antes de publicar, sin eliminarlos o sustituirlos automáticamente.
La carga real desde el panel y cualquier traslado adicional necesitan autorización.

## Variables de Netlify

Configurar las variables con la UI/API protegida del hosting. Las variables de
servidor deben estar disponibles para Functions y las que valida Prisma durante
el build también para Build. Si la cuenta permite seleccionar ámbitos, incluir
los necesarios. No basta con declarar valores en build.environment de netlify.toml.
Separar producción y previews; no utilizar la base real para pruebas de escritura
sin autorización y no compartir secretos con previews no confiables.

| Variable | Necesidad |
| --- | --- |
| `DATABASE_URL` | Conexión PostgreSQL agrupada de Neon con TLS para la aplicación |
| `DIRECT_URL` | Conexión directa con TLS para herramientas Prisma; no autoriza migraciones |
| `AUTH_SECRET` | Secreto existente y seguro, exclusivo del entorno; no rotarlo por el despliegue |
| `CLOUDINARY_CLOUD_NAME` | Entorno de imágenes utilizado por el código |
| `CLOUDINARY_API_KEY` | Identificador de API para las subidas firmadas |
| `CLOUDINARY_API_SECRET` | Secreto de firma, exclusivamente de servidor |
| `ADMIN_LOGIN_IP_SOURCE` | Configurar `netlify` para el runtime de Functions detrás de Netlify |
| `NEXT_PUBLIC_SITE_URL` | URL pública HTTPS definitiva; no contiene secretos |
| `STORE_PHONE` | Reservada; sin consumo actual en las rutas o componentes de la aplicación |
| `MERCADOPAGO_ACCESS_TOKEN` | Opcional, solo después de habilitar pagos reales |
| `MERCADOPAGO_WEBHOOK_SECRET` | Requerida junto con el token cuando se habiliten pagos |

El código usa las tres variables separadas de Cloudinary; `CLOUDINARY_URL` local
por sí sola no configura la aplicación. No publicar ninguno de sus valores reales.
Solo NEXT_PUBLIC_SITE_URL es una variable pública de esta tabla por su prefijo;
no usar NEXT_PUBLIC_ para secretos, tokens o conexiones.

ADMIN_EMAIL, ADMIN_PASSWORD y ADMIN_NAME se reservaron para el bootstrap manual
ya completado. No importarlas permanentemente al hosting: el login utiliza el
hash guardado en Neon y no las necesita. No copiar el .env completo a Git o a
comandos que impriman sus valores. .env.example solo contiene ejemplos seguros.

Mercado Pago no está configurado para pagos reales. Esto no impide consultar el
catálogo, pero sus pagos y webhooks necesitan configuración y revisión separadas,
incluida la forma de registrar errores. No declarar pagos operativos sin probarlos.

## GitHub y publicación pendiente

Repositorio: https://github.com/Os-Car0/e-pan.git.
El trabajo está en chore/preparar-despliegue. Se autorizó preparar un commit
local de los cambios revisados; push, merge y despliegue permanecen pendientes
y no forman parte de esta preparación. No modificar main ni su historial.

Antes de publicar:

1. Comprobar que el plan de Netlify es Free y revisar si conectar Git o un push
   puede iniciar automáticamente un despliegue o un preview.
2. Revisar y autorizar por separado el push de la rama de preparación. No usar force.
3. Configurar o verificar las variables privadas y la URL pública definitiva.
4. Autorizar la vinculación y el despliegue cuando se conozcan sus efectos.
5. En un entorno autorizado, comprobar login, cookie, IP fiable, cabeceras
   falsificadas, caducidad y concurrencia del limitador y una subida Cloudinary.
6. Comprobar la URL HTTPS pública, catálogo real, productos, navegación, Visítanos,
   mapa y funcionamiento responsive. No modificar pedidos o inventario reales
   para una prueba sin autorización específica.

La ubicación oficial permanece centralizada en src/lib/pickup-location.ts;
Visítanos, PICKUP y seguimiento reutilizan ese punto sin edición pública.
No declarar éxito basándose solo en el build local o el ping de Cloudinary.

## Verificaciones y auditoría

La revisión completa previa, realizada con Node 22.23.5, aprobó Prisma validate,
TypeScript, ESLint, 65 pruebas en 12 archivos y npm run build. El build incluye
prisma generate y el motor Linux requerido. Las comprobaciones locales usan
URLs de proceso inalcanzables para impedir consultas a Neon durante build/tests.

La auditoría de dependencias de producción reportó cero vulnerabilidades; no es
una auditoría de las dependencias exclusivamente de desarrollo. La advertencia
previa del plugin específico de Next.js ausente en ESLint no impide compilar.

El análisis de los archivos candidatos y del historial Git accesible local/remoto
no detectó credenciales reales. Los bundles públicos tampoco contenían los
secretos comprobados. Este resultado no certifica historia inaccesible o alertas
privadas de GitHub. .env, sus variantes privadas, .next, .cache, node_modules,
claves y bases locales permanecen fuera de Git.

## Informes históricos y referencias

Los informes bajo prisma documentan la revisión previa a cada operación. Sus
frases de pendiente o no ejecutado corresponden a esa etapa; no son el estado
actual ni autorización para repetir operaciones ya completadas:

- [MIGRATION_REVIEW.md](prisma/MIGRATION_REVIEW.md)
- [CATALOG_IMPORT_REVIEW.md](prisma/CATALOG_IMPORT_REVIEW.md)
- [ADMIN_BOOTSTRAP_REVIEW.md](prisma/ADMIN_BOOTSTRAP_REVIEW.md)
- [ADMIN_LOGIN_RATE_LIMIT_REVIEW.md](prisma/ADMIN_LOGIN_RATE_LIMIT_REVIEW.md)

Referencias primarias de configuración; comprobar los términos vigentes de los
planes en los paneles antes de habilitar servicios o gastos:

- https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
- https://docs.netlify.com/build/functions/environment-variables/
- https://www.prisma.io/docs/orm/v6/prisma-client/deployment/serverless/deploy-to-netlify
- https://neon.com/pricing
- https://cloudinary.com/pricing
