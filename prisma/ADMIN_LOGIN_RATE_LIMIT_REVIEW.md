# Protección persistente del login administrativo

Fecha: 15 de noviembre de 2026.
Proyecto: C:\dev\E-pan-publicacion. Rama: chore/preparar-despliegue.
Estado: código y migración preparados; **migración remota NO aplicada**.

## Decisión y límites

POST /api/admin/login reserva intentos en una tabla independiente de PostgreSQL:
AdminLoginRateLimit. No utiliza contadores de proceso ni requiere otro servicio.
Con DATABASE_URL agrupada de Neon, todas las instancias comparten los contadores.

| Dimensión | Intentos admitidos | Ventana fija |
| --- | ---: | --- |
| Cuenta normalizada | 5 | 15 minutos |
| IP o prefijo IPv6 /64 | 60 | 10 minutos |

La ventana comienza con el primer intento admitido. El siguiente a la cuota
recibe 429. Las solicitudes bloqueadas no aumentan contadores ni prolongan la
caducidad. No hay bloqueos permanentes ni bandera de bloqueo en User.
El límite de IP más amplio reduce el impacto en redes compartidas; una cuenta
bloqueada no consume más cuota de sus compañeros de red al seguir reintentando.

Se cuentan todas las solicitudes con credenciales sintácticamente válidas,
antes de buscar el usuario o ejecutar bcrypt, incluidas las exitosas. No se
reinician cuotas al acertar la contraseña: evita que reinicios concurrentes
permitan intentos adicionales. JSON/correos malformados reciben 400 sin bcrypt.
No es un filtro general de tráfico ni protección contra cuerpos HTTP enormes.

## Concurrencia y caducidad

Una transacción SERIALIZABLE toma la hora de PostgreSQL, consulta ambas claves,
comprueba los límites y reserva las dos cuotas de forma atómica. Las claves se
actualizan siempre en el mismo orden. Los conflictos P2034 y las carreras de
creación P2002 se reintentan como máximo tres veces después del primer intento.
Al agotarse, el login devuelve 503, sin continuar hacia bcrypt o JWT.
No se mantienen transacciones abiertas durante el cálculo bcrypt.

La reserva se cuenta aunque una instancia falle después: fallo conservador.
Un error de commit ambiguo nunca desencadena un fallback permisivo en memoria.
Los bloqueos caducan por la hora de la base, independiente del reloj de cada
instancia. Cada intento admitido elimina como máximo 100 filas del limitador
que vencieron hace más de 24 horas, usando el índice expiresAt. Sin tráfico,
la limpieza es diferida; no se garantiza borrado por horario exacto.

## Privacidad y autenticación

Las claves son HMAC-SHA256 con AUTH_SECRET y separación de dominio por cuenta/IP;
no se guardan correos o IP en claro. No se guardan contraseñas, tokens ni hashes
bcrypt en esta tabla. Cambiar AUTH_SECRET cambiaría las claves y reiniciaría
las cuotas, además de invalidar sesiones; esta implementación NO lo cambia.

429 usa el mismo cuerpo para cualquier cuenta y Retry-After redondeado a segundos,
sin informar qué dimensión bloqueó. Todas las respuestas del login tienen
Cache-Control: no-store. Cuentas inexistentes o roles sin permiso realizan una
comparación contra un hash ficticio independiente con coste 12 y devuelven el
mismo 401 que una contraseña incorrecta. Esto reduce diferencias de tiempo, sin
prometer indistinguibilidad perfecta de toda la infraestructura.

Se conservan bcrypt, issueSession/JWT HS256, los roles ADMIN/BAKER y epan_session
HttpOnly, Secure en producción, SameSite=Lax, Path=/ y ocho horas de duración.
Los errores registran solamente la etiqueta fija admin_login_unavailable; no
se registran cuerpos, correos, IP, contraseñas, tokens ni errores brutos de Prisma.

## IP fiable y configuración obligatoria de Netlify

El Route Handler usa runtime nodejs. En producción exige la variable privada de
configuración ADMIN_LOGIN_IP_SOURCE=netlify y lee únicamente
x-nf-client-connection-ip, suministrada por Netlify al procesar la conexión.
Acepta exactamente una dirección válida: rechaza listas, puertos y zonas IPv6.
Normaliza IPv4 mapeada en IPv6 y agrupa direcciones IPv6 por /64 para evitar que
rotar identificadores de interfaz eluda fácilmente la cuota de IP.

No confía en X-Forwarded-For, X-Real-IP, Client-IP, Host ni una supuesta cabecera
NETLIFY. Tampoco deduce la plataforma de process.env.NETLIFY: Netlify no garantiza
esa variable de build durante el runtime de funciones.

1. Configurar ADMIN_LOGIN_IP_SOURCE=netlify en la UI/API de variables de entorno
   de Netlify, disponible durante la ejecución de Functions. Si se seleccionan
   ámbitos, incluir Functions. No hace falta contratar un plan para este código.
2. Mantener DATABASE_URL y AUTH_SECRET en el mecanismo privado de variables del
   hosting, sin prefijo NEXT_PUBLIC_. No modificar sus valores por esta tarea.
3. No poner la configuración exclusivamente en netlify.toml: sus variables de
   build no se suministran automáticamente a las funciones durante runtime.
4. Habilitar esa confianza solo detrás de la infraestructura real de Netlify.
   No habilitarla en next start expuesto directamente ni en otro proveedor: allí
   un cliente sí podría fabricar esa cabecera. En desarrollo/tests se ignoran
   todas las cabeceras y se utiliza una cuota local compartida, persistente en DB.
5. Si se añade un proxy delante de Netlify, revisar la identidad observada: puede
   ser la del proxy y agrupar demasiados clientes. No cambiar a cabeceras públicas
   reenviadas como atajo.
6. Verificar en un despliegue aislado autorizado que el adaptador OpenNext conserva
   la cabecera de Netlify y que enviar valores falsos desde el cliente no cambia
   la cuota. Esta propiedad depende de la plataforma y no queda demostrada por
   los mocks locales. No realizar pruebas de ataque contra el administrador real.

## Migración preparada y pendiente

Archivo: prisma/migrations/20261115083609_admin_login_rate_limit/migration.sql.
Generado con Prisma migrate diff entre dos modelos locales, usando URLs locales
inalcanzables en el proceso para impedir accesos remotos.
SHA-256: dd4cb4962090db5f8bd3ea1fe914d332743795b0c887f853e7bd8d8419b1fd24.

Solo contiene CREATE TABLE AdminLoginRateLimit y CREATE INDEX sobre expiresAt.
No hay DROP, ALTER, inserciones ni modificaciones de tablas existentes. No tiene
relaciones con User, el catálogo o pedidos. La migración inicial no se editó.
Se validó el esquema y se regeneró Prisma Client localmente, sin aplicar SQL.

**Antes de aplicar hace falta autorización explícita.** Revisar nuevamente las
migraciones pendientes, el destino y el SQL. Si solo está pendiente esta migración,
el comando futuro sería:

```powershell
npx.cmd --no-install prisma migrate deploy --schema prisma/schema.prisma
```

No se ejecutó. No incorporarlo al build, seed ni arranque automático.
Hasta crear esta tabla, el código nuevo responde 503 al intentar iniciar sesión;
no hay modo de desactivar silenciosamente el limitador. Esto no elimina al
administrador ni invalida sus credenciales o sesiones ya emitidas.

## Pruebas y límites pendientes

- Claves sin PII, normalización, cabeceras no fiables e IPv6.
- Intentos fallidos, 429 genérico, Retry-After, límites por cuenta/IP, ventanas
  fijas, expiración exacta y recuperación sin bloqueos prolongados.
- Reservas paralelas en una base simulada compartida; reintentos de conflictos,
  rollback de ambas cuotas y limpieza limitada sin borrar cuotas activas.
- Errores de tabla/almacenamiento cerrados con 503, sin fuga de datos.
- Login válido ADMIN/BAKER conserva JWT y atributos de cookie; no se envía la
  contraseña al almacenamiento del limitador.

Los tests usan fixtures/mocks y URLs de proceso locales inalcanzables. No crean
intentos reales en Neon. La concurrencia y el SQL reales deben comprobarse después
en PostgreSQL de pruebas autorizado, antes de la validación final del despliegue.

Riesgos restantes: un atacante distribuido todavía puede provocar bloqueos
temporales de una cuenta; las cuotas no sustituyen MFA, alertas ni filtrado de
tráfico del proveedor. El volumen de escrituras y filas consume recursos de Neon
Free. Supervisar su cuota; no se activaron servicios ni planes de pago.

No se cambiaron administrador, contraseñas, secretos, catálogo, pedidos, SQLite o
el proyecto original. No se hicieron migraciones remotas, seed, db push, commit
ni push. El archivo .env local no fue modificado.

## Referencias primarias consultadas

- https://answers.netlify.com/t/upcoming-change-stripping-exposed-netlify-headers-from-function-and-proxy-requests/52665
- https://docs.netlify.com/build/functions/environment-variables/
- https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions

## Archivos de esta implementaci?n

- src/app/api/admin/login/route.ts
- src/lib/admin-login-rate-limit.ts
- src/lib/admin-login-rate-limit-store.ts
- src/lib/admin-login-rate-limit.test.ts
- src/lib/admin-login-rate-limit-store.test.ts
- src/lib/admin-login.test.ts
- prisma/schema.prisma
- prisma/migrations/20261115083609_admin_login_rate_limit/migration.sql
- .env.example
- DEPLOYMENT.md
- prisma/ADMIN_LOGIN_RATE_LIMIT_REVIEW.md

## Resultado final de verificaciones locales

- Prisma validate y generaci?n del cliente: correctos, sin conexi?n remota.
- TypeScript y ESLint completos: correctos.
- Vitest: 65 pruebas correctas en 12 archivos; 26 pruebas nuevas de esta funci?n.
- Build de producci?n Next.js: correcto, con URLs locales inalcanzables.
- Aviso previo de Next.js: falta su plugin espec?fico en ESLint; no impide el build.
- Consulta final Neon READ ONLY: 1 usuario ADMIN, 4 categor?as, 5 productos,
  1 configuraci?n y 0 pedidos/pagos/historiales/movimientos/auditor?as.
- Cat?logo con huella id?ntica a la importaci?n revisada.
- La tabla AdminLoginRateLimit no existe todav?a; permanece una ?nica migraci?n
  remota aplicada. La migraci?n inicial conserva su huella original.
- Ning?n registro remoto escrito durante esta implementaci?n.
