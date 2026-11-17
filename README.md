# vydo 3.1

Aplicación web de código abierto para descargar videos de YouTube que tengas autorización para descargar y convertir su audio. Una sola aplicación Node.js sirve la interfaz y ejecuta **yt-dlp + FFmpeg**. Licencia MIT; las licencias de esas herramientas y los derechos sobre el contenido son independientes.

- MP4 con video H.264 y audio AAC: **360p, 480p, 720p y 1080p**, solo cuando esa altura está disponible. No reescala ni sustituye la resolución solicitada.
- Audio **MP3, WAV (PCM), M4A (AAC) y FLAC**. Convertir una fuente con pérdida a FLAC/WAV no restaura su calidad original.
- Miniatura, título, duración, formatos disponibles y progreso real por fase. Descarga del archivo por streaming, sin cargarlo completo en la memoria del navegador.
- Clave de instancia, sesiones HttpOnly, trabajos aislados por sesión, cola limitada, cancelación y limpieza automática.

La interfaz 3.1 sigue la referencia visual suministrada: tema claro, logos oficiales, selector compacto y modo oscuro. Consulta [el alcance y la validación del rediseño](docs/redesign-3.1.md).

## Arranque con Docker Compose

Requisitos: Docker Engine con Compose. No hace falta contratar servicios.

```sh
cp .env.example .env
# Sustituye VYDO_TOKEN por un secreto aleatorio (mínimo 24 caracteres).
# Puedes generarlo con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
docker compose up --build -d
```

Abre `http://localhost:3000`. La aplicación se vincula al loopback del host. Entra con la clave configurada. Nunca publiques `.env`.

Para publicarla en Internet, configura un proxy inverso HTTPS delante del puerto 3000, `PUBLIC_ORIGIN=https://tu-dominio` y `COOKIE_SECURE=true`, y vuelve a crear el contenedor. El origen incluye esquema y dominio, sin ruta ni barra final. No confíes en encabezados `X-Forwarded-*` para determinar el origen. `render.yaml` es una alternativa de configuración, sin contratación ni despliegue automático desde este proyecto.

**GitHub Pages no ejecuta Node, yt-dlp ni FFmpeg.** Esta aplicación necesita un servidor o contenedor con procesos y almacenamiento temporal. Los Workers convencionales tampoco sustituyen el motor de conversión.

## Desarrollo local

Node.js 22+ (validado con 24.22.1), Python 3.10+, FFmpeg con `libx264`, `libmp3lame`, AAC y FLAC. Instala yt-dlp con sus componentes EJS:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
export PATH="$PWD/.venv/bin:$PATH"
export VYDO_TOKEN="tu-clave-aleatoria-de-al-menos-24-caracteres"
npm start
```

En PowerShell usa `.venv\Scripts\pip.exe`, añade `.venv\Scripts` al `PATH` y configura `$env:VYDO_TOKEN`. También puedes indicar rutas absolutas en `YTDLP_BIN` y `FFMPEG_BIN`. yt-dlp usa el mismo ejecutable Node que el servidor. El binario FFmpeg debe estar instalado en el servidor, no en el navegador.

El Dockerfile fija la versión de Node y `requirements.txt` fija las dependencias Python. Los paquetes del sistema Debian reciben sus actualizaciones del repositorio de la distribución; no se promete una imagen idéntica byte a byte. No hay dependencias npm de producción. Actualiza yt-dlp y EJS juntos y repite la prueba autorizada cuando YouTube cambie.

## Uso y límites

1. Accede con la clave de la instancia.
2. Pega un enlace a un video individual y selecciona Video (MP4) o Audio (MP3).
3. Pulsa Descargar y confirma tu autorización. La vista previa caduca a los 10 minutos.
4. Para video, elige una resolución disponible y confirma la descarga. Audio comienza tras el análisis; M4A, WAV y FLAC están en Ajustes y opciones de audio.
5. Espera a que terminen la descarga y la conversión, y guarda el archivo.

La descarga puede informar porcentajes separados para video y audio; la conversión informa su propio porcentaje de FFmpeg. Las fases de preparación sin medición se muestran indeterminadas. Puedes cancelar un trabajo; recargar recupera su identificador en la misma sesión/pestaña.

Valores predeterminados: **1 trabajo activo + 3 en espera**, 1 análisis simultáneo, 30 minutos de duración por video, 512 MiB de espacio por trabajo (origen y salida sumados), 10 minutos por proceso de descarga/conversión y 2 minutos por análisis. El monitor de disco se ejecuta cada segundo, por lo que puede existir un pequeño exceso transitorio; Compose además limita `/tmp` a 1 GiB. Hay un máximo de 32 registros de trabajos y 128 sesiones. No es un servicio multiusuario de gran escala.

Los archivos se eliminan 20 minutos después de finalizar, con comprobación cada 30 segundos. Los fallidos/cancelados se limpian al terminar sus procesos. Una descarga abierta impide borrar su archivo hasta cerrar la respuesta. Al apagar se cancelan procesos y se limpia el directorio de la instancia. Al arrancar se limpian directorios `vydo-*` abandonados de más de 24 horas; el contenedor usa almacenamiento temporal sin persistencia. Reiniciar pierde sesiones, cola y archivos.

La sesión dura 8 horas. La clave compartida proporciona acceso personal o de un equipo de confianza; no hay cuentas, recuperación de contraseña ni facturación. Para automatizar se admite `Authorization: Bearer <VYDO_TOKEN>`; esos clientes comparten un propietario de trabajos. El navegador usa una cookie HttpOnly y no guarda la clave en localStorage/sessionStorage. Solo guarda el ID del trabajo en sessionStorage.

No se admiten listas, directos, contenido privado, DRM ni contenido que requiera autenticación o eludir una restricción. No hay cookies importadas, credenciales de YouTube, proxies de evasión ni APIs comerciales. Un bloqueo de YouTube devuelve un error y no se intenta sortearlo.

## Pruebas

```sh
npm test
# Prueba adicional de los cinco formatos con un origen sintético real:
FFMPEG_BIN=/usr/bin/ffmpeg npm test
# Navegador, con motor de prueba aislado:
npm install --no-save playwright@1.62.1
npx playwright install chromium
node scripts/ui-check.mjs
```

El chequeo de navegador cubre acceso, vista previa, progreso, descarga y pantalla móvil; usa un motor simulado y no demuestra conexión con YouTube. `BROWSER_BIN` permite seleccionar un Chrome/Chromium instalado. `UI_OUTPUT_DIR` cambia la ubicación de las capturas.

La prueba de red es **optativa** y requiere contenido autorizado:

```sh
VYDO_TEST_AUTHORIZED=yes VYDO_TEST_URL='https://www.youtube.com/watch?v=TU_VIDEO_ID' npm run test:live
# Todas las variantes, en una sola ejecución:
VYDO_TEST_AUTHORIZED=yes VYDO_TEST_URL='https://www.youtube.com/watch?v=TU_VIDEO_ID' \
VYDO_TEST_FORMATS='mp4:360,mp4:480,mp4:720,mp4:1080,mp3,wav,m4a,flac' npm run test:live
```

El script comprueba análisis, API de trabajos, descarga HTTP, tamaño y decodificación completa con FFmpeg. Verifica la altura solicitada en MP4. Limpia los archivos al salir. `VYDO_TEST_REPORT` permite guardar el informe JSON. La prueba no debe ejecutarse automáticamente sobre enlaces arbitrarios.

La CI ejecuta pruebas, conversiones sintéticas, navegador y arranque Docker. Consulta [el diagnóstico y la migración](docs/migration.md) y [la evidencia de validación](docs/validation.md).

## API

| Método y ruta | Resultado |
| --- | --- |
| `GET /api/health` | Herramientas instaladas, 503 si falta alguna |
| `POST /api/session` | `{password}` crea cookie de sesión |
| `GET /api/session` / `DELETE /api/session` | Comprueba/cierra sesión |
| `POST /api/preview` | `{url, authorized:true}` devuelve `preview` |
| `POST /api/jobs` | `{url, previewId, format, quality, authorized:true}` devuelve `job` |
| `GET /api/jobs/:id` | Estado y progreso de fase |
| `DELETE /api/jobs/:id` | Cancela trabajo |
| `GET /api/jobs/:id/download` | Archivo adjunto con autenticación |

Los POST requieren JSON. La API solo acepta enlaces HTTPS canónicos de hosts exactos de YouTube y los normaliza antes de pasarlos como argumentos a yt-dlp, sin shell. Hay límites de cuerpo, salida de procesos, consultas de metadatos, intentos de acceso y trabajos. No se ofrecen URLs firmadas del proveedor al navegador.

## Diagnóstico de fallos

- **401:** inicia sesión de nuevo o revisa el token.
- **403:** revisa `PUBLIC_ORIGIN`; si el error es de YouTube, respeta la restricción.
- **429:** espera a que se libere capacidad o termine la ventana de un minuto.
- **503:** faltan yt-dlp/FFmpeg o no se pueden ejecutar.
- **Formato no disponible:** analiza de nuevo; la disponibilidad puede cambiar entre análisis y descarga.
- **Error de procesamiento:** revisa versiones de las herramientas, espacio y conectividad. No se garantiza disponibilidad universal ni futura para todos los videos, regiones o servidores.
