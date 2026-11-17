# Configuración Supabase para vydo 3.2

## Estado de esta entrega

No se ha creado ni seleccionado un proyecto Supabase dedicado a VYDO. Los proyectos conectados pertenecen a otras aplicaciones y no se modificaron. Se generó la migración con CLI 3.2.0 (`supabase migration new public_platform`) y se probó su ejecución y aislamiento RLS en PostgreSQL embebido; la CI prueba también el adaptador contra PostgreSQL 17.

La implementación utiliza `@supabase/supabase-js` 2.119.0, fijado en `package-lock.json`. Las pruebas de Auth usan el SDK real y un servidor HTTP local de prueba, sin secretos ni cuentas reales. Para afirmar registro real, envío de correo o Google operativo se necesita configurar y probar el proyecto correspondiente.

## Variables solo del servidor

| Variable | Función |
| --- | --- |
| `SUPABASE_URL` | URL HTTPS del proyecto dedicado |
| `SUPABASE_PUBLISHABLE_KEY` | Clave publicable usada únicamente por el BFF; no se transmite al navegador |
| `SUPABASE_SERVICE_ROLE_KEY` | Opcional para eliminar cuentas y revocar todas sus sesiones; nunca frontend |
| `DATABASE_URL` | Conexión PostgreSQL del proyecto, preferiblemente pooler en modo sesión; credenciales solo servidor |
| `APP_SECRET` | 32 bytes aleatorios como 64 caracteres hex; estable y común a todas las instancias |
| `PUBLIC_ORIGIN` | Origen público exacto, sin ruta ni barra final |
| `COOKIE_SECURE` | `true` bajo HTTPS |
| `GOOGLE_AUTH_ENABLED` | `true` solo después de configurar el proveedor real |

Generar el secreto: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. No copies el resultado a GitHub, tickets ni documentación. `DATABASE_URL` remoto exige `sslmode=verify-full`; configura certificados de confianza cuando corresponda. No desactives la verificación TLS.

## Migración revisable

Archivo: `supabase/migrations/20261117150125_public_platform.sql`.

1. Selecciona o crea expresamente un proyecto **dedicado a VYDO**, sin asumir un plan gratuito ni aceptar costes automáticamente.
2. Revisa la migración y haz copia de seguridad si el proyecto tiene datos. La migración requiere el esquema Auth de Supabase (`auth.users`, `auth.uid()`, roles `anon`, `authenticated`, `service_role`).
3. Inspecciona primero tablas/migraciones/advisors. Usa la CLI y sus comandos `--help` correspondientes a la versión instalada; CLI 3 cambió los valores por defecto y separa destinos locales/remotos.
4. Aplica el archivo como migración mediante la herramienta de Supabase contra ese proyecto seleccionado, o ejecuta su SQL revisado con una conexión administrativa y registra la migración con tu procedimiento habitual. **El servidor Node no migra automáticamente una base remota.**
5. Ejecuta advisors de seguridad y rendimiento y repite las pruebas sobre una rama/base de desarrollo. Configura después `DATABASE_URL` en el servidor.

El adaptador inicia una transacción y usa `SET LOCAL ROLE service_role`. La conexión de backend debe permitir asumir ese rol; utiliza la credencial PostgreSQL de backend adecuada. No conviertas roles públicos en administradores ni des permisos sobre `private` a visitantes.

## Tablas y RLS

- `public.vydo_profiles`: perfil y preferencias; SELECT y UPDATE propios con `(select auth.uid())=user_id` y WITH CHECK. No se permite cambiar `user_id` por Data API.
- `public.vydo_history`: metadatos; SELECT y DELETE propios. Los usuarios no insertan trabajos ni estados arbitrarios.
- `private.vydo_usage`: reservas, cupos y concesiones.
- `private.vydo_sessions`: estados cifrados de Auth/PKCE y sesiones.
- `private.vydo_rates`: límites de solicitudes.

Todas las tablas tienen RLS. `anon` no recibe acceso al historial ni a perfiles. El esquema privado no se expone en la Data API; solo el backend `service_role` accede a sus tablas. No hay funciones SECURITY DEFINER públicas, vistas que eviten RLS ni decisiones de cuota basadas en `user_metadata`.

`APP_SECRET` cifra access/refresh tokens y verificadores PKCE con AES-256-GCM y genera HMAC de cookies/IP. La cookie del navegador contiene un identificador aleatorio HttpOnly, SameSite=Lax y Secure en HTTPS; el backend valida al usuario con `getUser()`, no con claims decodificados. Las cuentas sin correo verificado o anónimas de Supabase no reciben el cupo ampliado.

## Proveedores y correo

1. Activa Email/Password y **Confirm email**. No habilites autoconfirm si necesitas verificar la propiedad del correo.
2. Configura Site URL con `PUBLIC_ORIGIN` y permite exactamente `https://tu-dominio/auth/callback` (incluido el callback de recuperación con `?flow=recovery` según la lista de redirecciones).
3. Configura SMTP real y sus límites. El código no inventa entrega de correo ni credenciales. Registro y recuperación devuelven mensajes genéricos para evitar enumeración.
4. Las confirmaciones usan PKCE: abrir el enlace en el mismo navegador que lo solicitó. Una cookie bloqueada o un enlace caducado exige iniciar de nuevo el flujo.
5. Para Google, configura las credenciales OAuth del proveedor en Supabase, el callback de Supabase en Google y el callback de VYDO en Supabase; activa después `GOOGLE_AUTH_ENABLED=true`.
6. Prueba correo, registro, acceso, recuperación, cierre y eliminación con cuentas de desarrollo autorizadas antes de activar producción.

El cierre de sesión elimina la sesión opaca del navegador y revoca su refresh token. La eliminación requiere una sesión reciente de menos de 10 minutos, confirmación escrita y clave administrativa de Auth; revoca sesiones globales antes de borrar el usuario. El backend consulta Auth en cada solicitud de cuenta para no confiar en un JWT antiguo tras una eliminación.

Se guarda nombre de perfil, email de Auth y preferencias. El historial conserva título, ID de video, formato, resolución, estado y fecha hasta 30 días, con opción de eliminarlo antes. No se guardan medios permanentemente. Los eventos de cuota terminales se purgan al salir de la ventana de una hora; los identificadores de abuso se purgan a las 24 horas. Eliminar historial no borra cuotas pendientes.

## Documentación consultada

- [Supabase changelog y cambio de CLI 3](https://supabase.com/changelog.md)
- [Sesiones y PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Guía avanzada de Auth del servidor](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
