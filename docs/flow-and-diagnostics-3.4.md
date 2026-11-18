# vydo 3.4: flujo directo, diagnósticos y registro

## Flujo de descarga

Se elimina el diálogo de autorización, su casilla y el campo `authorized` de las solicitudes web. `POST /api/preview` recibe `{url}`; los trabajos siguen requiriendo la vista previa válida del propietario, formato/resolución disponibles y reserva atómica de cuota. No cambian los límites 5/15 por hora, simultaneidad, aislamiento, temporales ni controles de contenido privado, DRM, cuentas, miembros, región o edad. No se incorporan cookies de YouTube, credenciales, proxies de evasión ni clientes alternativos.

La herramienta optativa de pruebas conserva una confirmación del operador para no probar contenido arbitrario. Esa variable de pruebas no forma parte de las solicitudes ni del flujo del visitante.

## Diagnóstico de YouTube

Se reprodujo el 18-11-2026 el fallo de análisis en producción con el enlace previamente autorizado por el propietario: respuesta 422 con el mensaje genérico anterior. El código anterior descartaba stderr; por ello los logs históricos no bastan para atribuirlo específicamente a 403, 429, autenticación o bot checks.

La versión fijada es yt-dlp **2026.10.26**, también la última versión estable publicada al consultar la API oficial de releases en esta revisión. No se cambia de versión ni se intenta sortear bloqueos. El servidor registra la versión realmente instalada al arrancar mediante `media_versions`.

Los fallos nuevos producen registros estructurados `media_tool_failure`: herramienta, etapa, versión, categoría, código HTTP de origen si existe y código de salida. No se registra stderr, URLs, identificadores/títulos del video, argumentos, cookies, cabeceras, tokens, nombres, correos ni rutas. Los mensajes mostrados al usuario provienen de una lista fija, nunca de stderr sin filtrar.

| Código | Interpretación |
| --- | --- |
| `YOUTUBE_HTTP_403` | Acceso HTTP rechazado; no atribuye por sí solo una causa concreta |
| `YOUTUBE_RATE_LIMIT` | YouTube limita peticiones / 429, distinto del cupo de VYDO |
| `YOUTUBE_BOT_CHECK` | YouTube exige verificación de usuario para esta conexión |
| `YOUTUBE_LOGIN_REQUIRED` | Exige cuenta de YouTube; no se intenta autenticar |
| `YOUTUBE_AGE_RESTRICTED`, `YOUTUBE_PRIVATE`, `YOUTUBE_MEMBERS_ONLY`, `YOUTUBE_DRM`, `YOUTUBE_GEO_RESTRICTED` | Restricción técnica específica del contenido/acceso |
| `YOUTUBE_UNAVAILABLE`, `YOUTUBE_FORMAT_UNAVAILABLE` | Contenido retirado/no disponible o formato desaparecido |
| `YOUTUBE_NETWORK` | Fallo de comunicación con origen |
| `YTDLP_EXTRACTOR`, `YTDLP_FAILURE`, `FFMPEG_FAILURE`, `TOOL_START_FAILURE`, `TOOL_TIMEOUT`, `TOOL_OUTPUT_LIMIT` | Fallo técnico interno diferenciado |

Los fallos internos conservan el mecanismo existente de devolución de cupo. Los rechazos del origen no se etiquetan como errores internos ni se devuelven por confundir códigos de diagnóstico con códigos del sistema operativo. Un fallo de análisis nunca reserva una descarga.

Prueba real desde `https://vydo.download`, 18-11-2026: el video autorizado falló durante `inspect` con **HTTP 429** de YouTube. El registro seguro fue `YOUTUBE_RATE_LIMIT`, `upstreamStatus:429`, `exitCode:1`, yt-dlp `2026.10.26`. Render confirmó también FFmpeg `5.1.9-0+deb12u1` y Node `v24.11.0`. El análisis falló antes de crear un trabajo: no se reservó descarga ni se obtuvo un archivo real. Se distinguió así la limitación del origen del cupo de VYDO, de un 403, de autenticación y de un fallo interno.

No se declara resuelta la descarga de YouTube. Un 429 acredita limitación de peticiones para esa conexión, pero no permite afirmar por sí solo que exista un bloqueo permanente de todas las IP de Render. Será necesario repetir una prueba autorizada cuando el origen admita peticiones; no se configuran proxies, cookies, cuentas ni otros mecanismos de evasión. Un health check 200 o pruebas sintéticas no sustituyen recuperar y decodificar un archivo real desde producción.

## Registro opcional

Nombre obligatorio (1–80 caracteres, Unicode normalizado, sin controles), confirmación de contraseña validada también en backend y botón mostrar/ocultar. El nombre se envía en metadatos de Supabase Auth y, tras obtener una identidad verificada con `getUser()`, se usa solo como nombre visible al crear su perfil. No se usa metadata para permisos ni cuotas y no se sobrescriben perfiles existentes. Las consultas son parametrizadas y la UI usa texto/valores de inputs, no HTML del usuario. No hay migraciones ni cambios de RLS.

Turnstile carga únicamente al abrir el registro. El servidor llama por HTTPS a Siteverify antes de invocar Supabase: exige éxito, hostname del origen público y acción `signup`. Rechaza tokens ausentes, caducados, repetidos, de otro sitio/acción y errores de red. El frontend descarta tokens usados y limpia contraseñas al cerrar. Los errores de validación local no consumen un token. No se imprime ni transmite al navegador la clave secreta.

Variables de Render (guardadas por el propietario, sin incorporarlas a Git):

- `TURNSTILE_SITE_KEY`: clave pública del widget real.
- `TURNSTILE_SECRET_KEY`: clave secreta, solo backend.
- `PUBLIC_ORIGIN`: origen HTTPS exacto, actualmente `https://vydo.download`.
- `AUTH_PUBLIC_SIGNUP_ENABLED=true`: conserva el alta por correo ya configurada con Supabase/Resend.

Widget Managed, hostnames `vydo.download` y `vydo.onrender.com`, acción suministrada por la aplicación. No usar claves de prueba en producción: la aplicación las rechaza. Sin configuración válida, solo el registro queda deshabilitado claramente; las descargas de visitantes siguen disponibles. Esta integración valida Turnstile en el BFF de VYDO; no cambia los ajustes externos de CAPTCHA de Supabase. No consumir dos veces el mismo token si se decide habilitar además una validación nativa en Supabase.

CSP permite únicamente el origen oficial `https://challenges.cloudflare.com` para script, conexión e iframe cuando la integración está configurada; no se añade `unsafe-inline` ni `unsafe-eval`.

## Pruebas

Se cubren análisis sin declaración, cuotas/aislamiento, clasificación de errores y no filtración de stderr, verificación HTTP de Turnstile (respuesta exitosa y rechazos), nombre/confirmación del lado servidor, persistencia de nombre sin sobreescritura, SDK Supabase y navegador (formulario, contraseñas, temas, móvil, flujo directo, formatos). CI: **47/47 pruebas aprobadas**, más navegador y Docker. Las pruebas automatizadas de navegador interceptan Cloudflare con un fixture solo en el entorno aislado; no afirman haber superado un challenge real.

En producción se comprobó Siteverify con un token inválido: HTTP 400, «La verificación de seguridad no es válida», antes de invocar el registro/enviar correo. La primera carga real del SDK reveló que su callback DOM-ready no resolvía en carga tardía; se cambió a su callback explícito `onload`, con fallback de evento load y timeout de 15 segundos. La regresión de navegador usa un SDK fixture cuyo callback ready nunca se ejecuta. La creación positiva de una cuenta nueva y la recepción del correo no se deducen de un test de rechazo ni de ese fixture.

Fuentes: [Cloudflare Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [renderizado explícito](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/), [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases), [Supabase Auth](https://supabase.com/docs/guides/auth).
