# Preparación del primer administrador de E-Pan

Fecha de revisión: 15 de noviembre de 2026.
Estado: procedimiento preparado; **ningún usuario creado** y ninguna credencial modificada.
Proyecto: C:\dev\E-pan-publicacion. Rama: chore/preparar-despliegue.

## Autenticación actual verificada

- POST /api/admin/login valida el correo con Zod, busca su versión en minúsculas
  y verifica la contraseña mediante bcryptjs.compare contra User.passwordHash.
- Solo ADMIN y BAKER pueden iniciar sesión administrativa. Las APIs protegidas
  utilizan requireStaff, que vuelve a consultar el usuario y su rol en la base.
- Sesión JWT firmada con HS256 mediante jose, con duración de ocho horas y
  AUTH_SECRET de servidor. Cookie epan_session: HttpOnly, SameSite=Lax, Path=/,
  Secure en producción y Max-Age de 28800 segundos.
- El middleware comprueba el host de Origin cuando se proporciona en mutaciones
  administrativas. No se encontró limitación de intentos en la ruta de login;
  debe resolverse antes de exponer el panel a Internet.
- No se modificó la autenticación, su interfaz ni sus permisos.

Archivos: src/lib/auth.ts, src/app/api/admin/login/route.ts,
src/app/api/admin/logout/route.ts, src/middleware.ts.

## Modelo y hash

User contiene id, name, email único, passwordHash, role, createdAt y updatedAt.
El rol predeterminado es CUSTOMER: la creación inicial debe establecer ADMIN
explícitamente. El esquema no impone unicidad del correo ignorando mayúsculas;
la herramienta normaliza el correo y comprueba colisiones sin distinguirlas.

El bootstrap antiguo está dentro de prisma/seed.ts. Usa bcrypt.hash(password,12)
y upsert, que puede reemplazar credenciales/promover un usuario. Además crea
categorías y productos demo, incluido un producto ausente del catálogo real.
**No ejecutar ese seed para crear el administrador.**

Se conserva bcrypt con coste 12 y sal aleatoria generada por bcryptjs, compatible
con el login. La nueva validación exige al menos 15 caracteres Unicode y como
máximo 72 bytes UTF-8; bcryptjs no rechaza por sí mismo las contraseñas que serían
truncadas. También bloquea ejemplos y patrones obvios, datos de identidad,
repeticiones, caracteres de control y reutilización de AUTH_SECRET.
Estas comprobaciones locales no certifican entropía ni consultan contraseñas
filtradas. Utilizar una contraseña única generada en un gestor de contraseñas.

Referencias:
- https://github.com/dcodeIO/bcrypt.js/
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://pages.nist.gov/800-63-4/sp800-63b.html

## Estado comprobado de Neon y credenciales

Se consultaron únicamente conteos de User en una transacción SERIALIZABLE con
SET TRANSACTION READ ONLY. Resultado: 0 usuarios, 0 administradores y 0
coincidencias para el correo local configurado. No se seleccionaron contraseñas,
hashes, correos ni nombres desde Neon.

Las variables ADMIN_EMAIL, ADMIN_PASSWORD y ADMIN_NAME están presentes una vez.
El correo es de ejemplo; la contraseña es predecible y menor de 15 caracteres.
El nombre cumple la validación de formato. AUTH_SECRET está configurado.
No se muestran valores ni se guardan huellas de contraseñas. No se cambió .env.
Las credenciales administrativas actuales **no son aptas para crear una cuenta**.

Identidad del destino revisado, sin contraseña:
4bfaad71324faa51cdef478223ca475217b8ef67b708e45437c74d4c9bf21bcf

## Herramienta independiente preparada

- prisma/create-admin.ts: CLI; solo lectura por defecto.
- src/lib/admin-bootstrap.ts: validaciones y bloqueo si existe cualquier usuario.
- src/lib/admin-bootstrap.test.ts: pruebas locales sin conexiones ni escrituras.

La herramienta lee el .env privado local, rechaza variables relevantes duplicadas,
verifica DIRECT_URL Neon con TLS y compara la identidad del destino cuando se
proporciona la huella. Nunca imprime credenciales, correo, nombre ni hash bcrypt.
Los errores se reducen a códigos; no se imprimen errores brutos de Prisma.

Este comando **solo consulta y valida; no crea usuarios**:

```powershell
npx.cmd --no-install tsx prisma/create-admin.ts --expected-target-sha256 4bfaad71324faa51cdef478223ca475217b8ef67b708e45437c74d4c9bf21bcf
```

Si las credenciales son inadecuadas o User no está vacía, el modo de lectura
termina con código 1 y explica los motivos mediante códigos sin valores sensibles.
No calcula hashes bcrypt en ese modo.

## Procedimiento futuro, pendiente de autorización

1. El propietario debe configurar en el .env privado un correo real, nombre y
   contraseña única segura. No enviarlos en el chat ni como argumentos del CLI.
   Esta preparación no los cambia ni genera automáticamente.
2. Ejecutar el modo de lectura anterior; exigir credenciales aptas, User=0 y
   huella del destino coincidente. Si cambia cualquier condición, detenerse.
3. Obtener autorización explícita para crear exclusivamente el primer ADMIN.
4. Solo entonces ejecutar el comando siguiente, que **NO se ejecutó durante
   esta preparación**:

```powershell
npx.cmd --no-install tsx prisma/create-admin.ts --create --expected-target-sha256 4bfaad71324faa51cdef478223ca475217b8ef67b708e45437c74d4c9bf21bcf
```

El modo de creación calcula el hash bcrypt con coste 12 en memoria y lo verifica.
Después utiliza una única transacción SERIALIZABLE: vuelve a exigir User vacía,
comprueba colisiones de correo ignorando mayúsculas, ejecuta únicamente User.create
con rol ADMIN y verifica los conteos antes del commit. No usa upsert/update/delete,
no modifica el catálogo, no rota credenciales ni crea auditorías o pedidos.
Un segundo intento se niega a actuar si ya existe cualquier usuario.
Las restricciones únicas y el aislamiento protegen frente a creaciones concurrentes.

5. Comprobar por lectura un único ADMIN y luego probar el login por separado con
   autorización. La preparación actual no inicia sesión ni crea cookies.
6. Después de crear y verificar la cuenta, retirar las variables ADMIN_* del
   entorno de despliegue según el procedimiento operativo aprobado; el login
   utiliza el hash guardado en User y no necesita esas variables.

Si falla la red al confirmar, consultar primero User: no repetir a ciegas,
no reiniciar la base y no utilizar seed como recuperación.

## Límites de esta revisión

No se ha ejecutado el modo --create ni se ha probado una escritura real.
No se han creado administradores ni tokens; no se han modificado .env, Neon,
SQLite, el proyecto original, el esquema o las migraciones. No hay commit ni push.
La protección contra fuerza bruta del login y una prueba real posterior del acceso
siguen pendientes antes de producción. MFA no está implementado en este flujo.
