# E-Pan

Tienda para panadería mexicana con Next.js 15, React 19, TypeScript y Prisma 6.

## Estado actual

Estado verificado durante la preparación del 15 de noviembre de 2026:

- Neon PostgreSQL configurado: conexión agrupada para la aplicación y directa
  para las herramientas administrativas.
- Dos migraciones aplicadas y verificadas: esquema inicial y limitador de login.
- Catálogo real importado: 4 categorías, 5 productos y 1 configuración de tienda.
- Primer administrador creado con rol ADMIN y contraseña almacenada como hash
  bcrypt de coste 12. No hay credenciales predeterminadas que deban publicarse.
- Cloudinary autenticado mediante GET /ping, con respuesta HTTP 200. La subida
  real desde el panel sigue pendiente de una prueba expresamente autorizada.
- Protección de login implementada con contadores persistentes en PostgreSQL:
  5 intentos por cuenta en 15 minutos y 60 por IP en 10 minutos.
- Despliegue en Netlify pendiente. No se ha comprobado ninguna URL pública.

La guía vigente es [DEPLOYMENT.md](./DEPLOYMENT.md). Los informes de preparación
bajo `prisma/` conservan el estado que existía al redactarlos; no sustituyen este
estado actual ni autorizan repetir importaciones, migraciones o creación de usuarios.

El proyecto original `C:\dev\E-pan` conserva SQLite y sus datos. Esta copia utiliza
PostgreSQL para funcionar. [SQLITE.md](./SQLITE.md) es una referencia histórica,
no el procedimiento de despliegue. El importador SQLite es una herramienta manual,
no una dependencia de las rutas de producción.

## Configuración y desarrollo

1. Usar Node.js 22, como indican `.nvmrc` y `netlify.toml`.
2. Instalar las dependencias con `npm ci`.
3. Copiar `.env.example` a un `.env` privado y configurar las variables necesarias
   para un entorno autorizado. Nunca incluir credenciales en Git, chat o logs.
4. Para una base nueva, revisar y autorizar por separado las migraciones y los
   datos necesarios. La base Neon de esta preparación ya tiene su esquema y catálogo.
   No reiniciarla, ejecutar seed o repetir importaciones para iniciar la aplicación.
5. Iniciar `npm run dev` cuando la base de desarrollo esté lista.

Sin una base accesible, el catálogo muestra un error con reintento; no se usan
productos demo para aparentar disponibilidad. Ningún pedido se simula como guardado.

## Variables para Netlify

Configurar los valores mediante la UI/API privada del hosting. Las variables del
servidor deben estar disponibles para Functions; las necesarias para el build
Prisma también deben estar disponibles durante la compilación. No basta con
`build.environment` de `netlify.toml` para suministrar variables al runtime.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión PostgreSQL agrupada de Neon con TLS |
| `DIRECT_URL` | Conexión directa con TLS para herramientas Prisma |
| `AUTH_SECRET` | Secreto existente y seguro de firma de sesiones y HMAC |
| `CLOUDINARY_CLOUD_NAME` | Entorno de imágenes |
| `CLOUDINARY_API_KEY` | Identificador utilizado por las subidas firmadas |
| `CLOUDINARY_API_SECRET` | Secreto de firma, exclusivamente en el servidor |
| `ADMIN_LOGIN_IP_SOURCE` | Configurar `netlify` únicamente detrás de Netlify |
| `NEXT_PUBLIC_SITE_URL` | URL pública HTTPS definitiva, sin secretos |
| `STORE_PHONE` | Reservada; actualmente no consumida por el código de la aplicación |
| `MERCADOPAGO_ACCESS_TOKEN` | Opcional, solo al habilitar pagos reales |
| `MERCADOPAGO_WEBHOOK_SECRET` | Necesaria junto con el token al habilitar pagos |

El código de Cloudinary utiliza las tres variables separadas; `CLOUDINARY_URL`
por sí sola no basta. No configurar `ADMIN_EMAIL`, `ADMIN_PASSWORD` ni `ADMIN_NAME`
permanentemente en Netlify: el administrador ya existe y el login usa su hash en Neon.

`.env`, sus variantes privadas, `.next`, `.cache`, `node_modules` y bases locales
están excluidos de Git. `.env.example` solo contiene campos vacíos y ejemplos públicos.
No subir ni desplegar directamente el build local: sus trazas privadas pueden
referenciar `.env`. Netlify debe compilar desde el código de GitHub.

## Panel administrativo y seguridad

- `/admin`: acceso del personal y atención de pedidos.
- `/admin/productos`: catálogo, precios, categorías existentes y existencias.
- Las APIs verifican el JWT y consultan el rol actual ADMIN o BAKER en la base.
- Sesión de ocho horas; cookie HttpOnly, SameSite=Lax y Secure en producción.
- El login reserva cuotas por cuenta e IP de forma atómica antes de comprobar
  credenciales. Responde 429 con Retry-After al alcanzar el límite; los intentos
  bloqueados no prolongan la ventana. La identidad se almacena como HMAC.
- En producción exige `ADMIN_LOGIN_IP_SOURCE=netlify` y la IP de conexión que
  suministra Netlify; no usa X-Forwarded-For o X-Real-IP como alternativa.
  Si falta la configuración o falla el almacenamiento, devuelve 503.
- Las imágenes se suben directamente a Cloudinary con autorización firmada de
  servidor; el API Secret no llega al navegador y no se escribe en disco serverless.
- Mercado Pago requiere configuración y verificación independiente antes de
  considerarse disponible para pagos reales.

No existe registro público de usuarios. `prisma/create-admin.ts` solo consulta por
defecto y se niega a crear el primer administrador si ya hay usuarios. No volver
a ejecutar su modo de creación en esta base. `db:seed` puede crear datos demo y
actualizar credenciales: no forma parte del despliegue y no debe utilizarse como
recuperación del acceso o sustituto del catálogo real.

## Ubicación de recogida

La dirección y el punto confirmado por la panadería están centralizados en
`src/lib/pickup-location.ts`. Visítanos, el checkout PICKUP y el seguimiento usan
esa configuración. El mapa OpenStreetMap y el enlace Google Maps conservan el
punto oficial, sin controles públicos para cambiarlo.

## Verificaciones y build

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`: genera Prisma Client y compila Next.js; no migra ni carga datos.
- `npm start`: inicia el build de producción local; las pruebas de login deben
  respetar la configuración de confianza de IP y la autorización del entorno.

La última revisión completa aprobó TypeScript, ESLint, 65 pruebas en 12 archivos
y el build. La advertencia previa por el plugin específico de Next.js ausente
en ESLint no impide compilar. No añadir migraciones, `db:push` o `db:seed` al build
ni al arranque automático.

## Antes de publicar

Revisar [DEPLOYMENT.md](./DEPLOYMENT.md), configurar las variables del hosting y
comprobar en un entorno autorizado el login, la IP fiable, la concurrencia real del
limitador y una subida Cloudinary. Revisar también el catálogo, navegación, mapa y
URL HTTPS pública. El build local por sí solo no demuestra un despliegue exitoso.

`public/sw.js` solo responde a registros antiguos de service worker: no intercepta
peticiones ni crea caché, y no habilita funcionamiento offline.
