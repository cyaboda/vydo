# Supabase de vydo: estado 3.3

## Revisión final: motivo de «Crear cuenta» deshabilitado

La comprobación de solo lectura del 17 de noviembre de 2026 confirmó Auth accesible, Email habilitado, registros permitidos en Supabase (`disable_signup=false`), verificación obligatoria y `AUTH_PUBLIC_SIGNUP_ENABLED` ausente/false en el servidor local. Ese último interruptor es la causa inmediata: `auth.mjs` publica `signup=false` y `account.js` deshabilita el botón con «Registro público pendiente». No es un fallo del formulario ni falta la URL/clave publicable.

El código ya envía registro y recuperación mediante Supabase Auth. SMTP se configura **en Supabase**, no mediante nuevas variables SMTP del servidor Node. No se han cambiado proveedores ni enviado correos en esta revisión. El endpoint público no acredita entrega SMTP a destinatarios externos; la configuración SMTP administrativa y esa entrega quedan pendientes de verificar por el propietario.

Pasos para habilitarlo, en este orden:

1. Elegir un proveedor de correo y verificar el remitente/dominio; introducir sus valores reales Host, Port, Username, Password, Sender email y Sender name en el SMTP personalizado de Supabase. No se contrata ni configura en esta entrega.
2. Mantener Email/Password y Confirm email habilitados, y permitir registros nuevos en Supabase. El código comprueba también que `disable_signup` del proveedor sea false.
3. Al preparar producción, configurar Site URL `https://vydo.download` y Redirect URLs exactas `https://vydo.download/` y `https://vydo.download/auth/callback`. No cambiar todavía los valores locales usados por la web de desarrollo.
4. Tras configurar SMTP, poner `AUTH_PUBLIC_SIGNUP_ENABLED=true` en el entorno del servidor y reiniciarlo. Ejecutar `node --env-file=.env.production scripts/check-auth.mjs`; debe mostrar `publicSignupEnabled: true` sin revelar claves.
5. Antes de abrir al público, probar con destinatarios externos autorizados: alta, confirmación en el mismo navegador, sesión y recuperación. Si falla correo, mantener el interruptor false y corregir el proveedor. La prueba previa con la cuenta del propietario no sustituye esta validación.

El [servicio de correo por defecto](https://supabase.com/docs/guides/auth/auth-smtp) sigue sin ser una solución para altas públicas. Google y la clave administrativa para eliminar cuentas son configuraciones separadas y no son requisitos para habilitar el registro por correo.

Se creó el proyecto dedicado `vydo` en la organización **BRAINSTORMVAULT**, referencia `rxtahpernilkidmgvqhb`, región `us-east-1`, plan gratuito. El coste consultado antes de crearlo fue **0 USD/mes**; no se contrató SMTP, hosting ni un plan de pago. Los proyectos de otras aplicaciones no se modificaron.

URL API: `https://rxtahpernilkidmgvqhb.supabase.co`. La URL y clave publicable reales están únicamente en el `.env` local ignorado por Git. No se incluyen credenciales de usuario, claves ni enlaces de verificación en el repositorio. La evidencia real no contiene datos personales.

## Estado verificado

Se probaron con una cuenta y correo expresamente autorizados: registro, confirmación recibida por correo, sesión verificada con cuota 15, cierre, acceso por contraseña, recuperación recibida por correo, actualización de contraseña y nuevo acceso. La clave temporal se entrega solo en un archivo local al propietario; debe cambiarla desde su perfil.

El proveedor Email está habilitado con confirmación obligatoria. Google no está configurado. El servidor consulta `/auth/v1/settings`; no muestra proveedores simulados. Los callbacks PKCE requieren el mismo navegador que inició la solicitud y admiten tanto `/` como `/auth/callback`. Se validó el retorno real al Site URL local `http://localhost:3000`.

Se aplicaron al proyecto vacío estas migraciones revisables:

1. `20261117150125_public_platform.sql`: perfiles/historial públicos protegidos por RLS y cuotas/sesiones/rates privados.
2. `20261117162229_private_backend_policies.sql`: políticas explícitas solo para `service_role` sobre las tablas privadas. Se generó el archivo mediante `supabase migration new private_backend_policies` antes de aplicarlo.

Los advisors ya no informan de tablas privadas sin políticas. Permanece el aviso de protección de contraseñas filtradas deshabilitada: [remediación oficial](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Esa función requiere Pro; no se habilitó un plan de pago. Los índices sin uso en una base nueva son informativos; no se borraron índices útiles.

## Configuración pendiente, sin inventar secretos

| Configuración | Estado / acción |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Configuradas localmente. Permanecen en backend. |
| `PUBLIC_ORIGIN`, `COOKIE_SECURE` | Local: `http://localhost:3000`, `false`. En producción usar dominio HTTPS exacto y `true`. |
| `AUTH_PUBLIC_SIGNUP_ENABLED` | `false` por defecto. Habilitar solo después de configurar y probar SMTP para destinatarios públicos. |
| SMTP de Supabase Auth | Pendiente: Host, Port, Username, Password, Sender email y Sender name en Authentication → Email/SMTP; verificar dominio/remitente con el proveedor elegido. No se contrató ninguno. |
| `GOOGLE_AUTH_ENABLED` | `false`. Configurar Client ID y Client Secret de Google en Supabase, sus orígenes/redirects OAuth, probar y activar después. |
| `SUPABASE_SERVICE_ROLE_KEY` | Pendiente. Clave secreta administrativa obtenida por el propietario desde el proyecto; solo servidor. Hasta configurarla, «Eliminar cuenta» queda deshabilitado y explicado. |
| `DATABASE_URL` | Pendiente. Actualmente cuotas, perfiles y sesiones persisten en SQLite local. Para moverlos al PostgreSQL preparado, configurar conexión backend/pooler con `sslmode=verify-full`; planificar la migración de datos existentes. |
| `APP_SECRET` | Clave estable generada en el volumen SQLite. Si se usa PostgreSQL, configurar 64 caracteres hex aleatorios, idénticos en todas las instancias. No perderla ni regenerarla en cada despliegue. |

El [correo por defecto de Supabase](https://supabase.com/docs/guides/auth/auth-smtp) es de prueba: solo destinatarios autorizados por la organización y límites reducidos (dos correos por hora). La prueba real de la cuenta autorizada no demuestra correo para cualquier visitante. Por eso el alta pública permanece claramente deshabilitada; las descargas anónimas y el inicio de sesión de la cuenta verificada funcionan. Recuperación informa del error si el proveedor rechaza el envío, sin afirmar que envió un mensaje.

Antes de publicar: establecer Site URL al `PUBLIC_ORIGIN` real y permitir exactamente `https://tu-dominio/` y `https://tu-dominio/auth/callback` en Redirect URLs. Probar registro, confirmación, recuperación y Google desde ese dominio. Mantener Confirm email activado. No usar comodines amplios ni trasladar claves al navegador.

Comprobación de configuración sin enviar correos ni mostrar secretos:

```sh
node --env-file=.env scripts/check-auth.mjs
```

Consulta [la guía técnica de tablas, sesiones y variables](supabase-3.2.md) para el detalle de RLS, retención y eliminación. Su apartado de estado corresponde a la entrega anterior; este documento describe el proyecto actual.
