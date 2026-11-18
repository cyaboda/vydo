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

La prueba final desde Render y su categoría observada se registran en la entrega/PR. Un arranque saludable, una vista previa o pruebas sintéticas no acreditan que YouTube permita una descarga. Solo se puede declarar resuelto después de recuperar y decodificar un archivo real desde producción. Si YouTube exige autenticación/verificación o bloquea su red, se documenta ese límite sin intentar evadirlo.

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

Se cubren análisis sin declaración, cuotas/aislamiento, clasificación de errores y no filtración de stderr, verificación HTTP de Turnstile (respuesta exitosa y rechazos), nombre/confirmación del lado servidor, persistencia de nombre sin sobreescritura, SDK Supabase y navegador (formulario, contraseñas, temas, móvil, flujo directo, formatos). Las pruebas automatizadas de navegador interceptan Cloudflare con un fixture solo en el entorno aislado; no afirman haber superado un challenge real. En producción debe comprobarse el widget real y una solicitud inválida debe fallar antes de enviar correo; la confirmación positiva de un nuevo registro requiere una interacción autorizada con el widget.

Fuentes: [Cloudflare Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [renderizado explícito](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/), [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases), [Supabase Auth](https://supabase.com/docs/guides/auth).
