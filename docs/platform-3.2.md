# VYDO 3.2 — diagnóstico, plan y validación

Base: rama de desarrollo `codex/vydo-3.1`, commit `a9c7d3cf1cbfd52b1cb34e4bbe15c0ee60869511`. Se revisó el servidor, motor, cola, frontend, configuración y pruebas antes de modificar código.

## Diagnóstico y fases

Ya existían MP4 en cuatro resoluciones, cuatro formatos de audio, miniatura/metadatos, progreso real, cancelación, seguridad de procesos, archivos temporales, Docker y el diseño 3.1. No había cuentas reales, perfiles, cuotas persistentes ni acceso público.

Se implementó por fases: (1) acceso público y cuota transaccional; (2) Auth Supabase opcional con BFF y cookies opacas; (3) perfil/preferencias/historial privado; (4) selector compacto y publicidad apagada; (5) migración, despliegue y regresión. No se reconstruyó el diseño, ni se reemplazaron los logos ni el motor.

## Completado en código

- Sin barrera de contraseña. Las cuentas nunca son necesarias para descargar.
- Ventana móvil de 60 minutos: 5 por IP visitante, 15 por cuenta verificada; una reserva simultánea por identidad. Las cuotas y límites sobreviven al reinicio.
- Reservas atómicas, rechazo con Retry-After, protección adicional por red y límite global. Solo se consume al aceptar; se libera por fallos internos o abandono, no por cancelar ni borrar historial.
- Supabase SDK: correo/contraseña, registro, verificación PKCE, recuperación, Google configurable, renovación, cierre, cambio de contraseña y eliminación reciente con revocación de sesiones.
- Perfiles y metadatos propios, sin conservar medios permanentemente. RLS y privilegios separados; no se usan claims user_metadata para cuotas.
- Selector de audio compacto, cuota visible, encabezado discreto y perfil solo al solicitarlo. Componente publicitario sin contenido ni altura visible si está desactivado.
- Docker, volumen persistente, PostgreSQL opcional para nube, HTTPS/proxies y guía operativa.

## Verificación local

- Pruebas de backend, ventanas móviles y persistencia; rechazo del sexto/deci­mosexto trabajo y de solicitudes simultáneas. Concurrencia SQLite entre procesos Node independientes.
- Devolución por errores internos, cancelación sin devolución y recuperación de concesiones abandonadas.
- SDK Supabase real contra servidor local de prueba: identidad validada con getUser, sesión HttpOnly opaca/cifrada, renovación, correo no verificado, PKCE y revocación previa a eliminación. Sin credenciales reales.
- Migración ejecutada en PostgreSQL embebido (PGlite); pruebas RLS entre dos identidades, tablas privadas y permisos de columna. La CI añade PostgreSQL 17 real y múltiples adaptadores conectados simultáneamente.
- Conversiones reales de una fuente sintética a MP4, MP3, WAV, M4A y FLAC.
- Navegador Chrome/Playwright: uso público sin modal de clave, temas y persistencia, logos originales, anchos 320–1753px, cuota, cinco formatos, registro/acceso de prueba, preferencias, historial/eliminación de registros, cierre y cancelación. El motor y las cuentas de navegador son simulados para reproducibilidad.
- Prueba real de YouTube repetida con el enlace autorizado proporcionado por el usuario: `https://www.youtube.com/watch?v=LY43o01dkU4`. MP4 360p: 12 359 836 bytes. MP3: 4 866 332 bytes. Ambos se descargaron por la API pública con cookie de visitante y FFmpeg los decodificó completos. Informe en `docs/evidence/vydo-3.2-live-check.json`.

## Pendiente de configuración externa, sin fingir activación

No se encontró un proyecto Supabase VYDO entre los conectados, y no se modificaron los proyectos de otras aplicaciones. La migración se entrega revisable y probada localmente, pero no se ejecutó en una base remota del usuario. No hay SMTP real, credenciales Google ni proveedor publicitario configurados; las cuentas y los anuncios no se anuncian como activados. No se contrató ni desplegó infraestructura de pago ni se publicaron cambios directamente en producción.

La validación de un video autorizado no garantiza todos los videos, servidores o regiones. La cola/archivos siguen siendo locales al worker; PostgreSQL coordina metadatos y cuotas, y el escalado de medios requiere afinidad o una evolución distribuida posterior.
