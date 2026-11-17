# Validación de vydo 3.0

Fecha: **16 de noviembre de 2026**, zona horaria del usuario America/Guayaquil.

## Pruebas locales

- 15 pruebas automatizadas: validación de enlaces y consentimiento, autenticación, CSRF, propiedad de trabajos, límites de cola, cancelación, caducidad y limpieza, entrega HTTP, disponibilidad exacta, metadatos seguros y procesos con cancelación, límites de salida y timeout.
- Conversiones reales de un video sintético a MP4, MP3, WAV, M4A y FLAC; FFmpeg decodificó las cinco salidas.
- Navegador Chrome mediante Playwright: inicio de sesión, análisis, selección, progreso, descarga de archivo y vista móvil de 390 px. Sin errores de JavaScript ni desbordamiento horizontal. En esta prueba el motor de medios está simulado.
- Se corrigieron dos fallos encontrados durante la validación: el selector de formato buscaba controles habilitados dentro de un fieldset temporalmente deshabilitado; el estado terminal de cancelación se publicaba antes de finalizar la limpieza. También se acotó la terminación de procesos en Windows.

Entorno local: Windows, Node 24.22.1, yt-dlp 2026.10.26, yt-dlp-ejs 0.8.0 y FFmpeg 9.0.2. La configuración Linux de producción se verifica mediante la CI Docker, que debe evaluarse por separado de los resultados locales.

## Descarga real autorizada

El usuario proporcionó expresamente el enlace para la prueba después de solicitarle un video suyo o que tuviera autorización para descargar:

`https://www.youtube.com/watch?v=LY43o01dkU4`

Título recuperado: **Brainstorm - Don't Call Me (Music Video)**. Duración: 180 segundos.

Se ejecutó `scripts/live-check.mjs` en dos pasadas a través del servidor y sus endpoints de vista previa, creación de trabajo, consulta y descarga autenticada. Cada archivo se decodificó completo con FFmpeg. No se usaron cookies de YouTube, credenciales, proxies de evasión ni APIs comerciales.

| Salida | Resolución/códec de origen de la salida | Bytes descargados desde la API | Decodificación |
| --- | --- | ---: | --- |
| MP4 360p | 640×360, H.264 + AAC | 12 359 836 | Correcta |
| MP4 480p | 854×480, H.264 + AAC | 16 712 784 | Correcta |
| MP4 720p | 1280×720, H.264 + AAC | 27 423 001 | Correcta |
| MP4 1080p | 1920×1080, H.264 + AAC | 48 667 194 | Correcta |
| MP3 | MP3, 48 kHz, estéreo | 4 866 332 | Correcta |
| WAV | PCM s16le, 48 kHz, estéreo | 34 524 622 | Correcta |
| M4A | AAC, 48 kHz, estéreo | 4 402 503 | Correcta |
| FLAC | FLAC, 48 kHz, estéreo | 30 276 157 | Correcta |

Los archivos de medios se limpiaron al cerrar cada instancia de prueba. Los informes JSON se conservan en `docs/evidence/` y no contienen secretos ni URLs firmadas de medios.

Estos resultados confirman funcionamiento para ese video y ese entorno en la fecha indicada. No garantizan funcionamiento de todos los enlaces ni en otras regiones, redes o fechas.

## Despliegue

No se ha desplegado públicamente ni contratado ningún servicio. El contenedor y los tests de Linux forman parte del workflow `tests`. Su estado visible en el PR es la evidencia de construcción y arranque Docker; el entorno local no tiene Docker instalado.
