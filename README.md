# MEDIA STUDIO 2.1 · GitHub Pages + Cloudflare Worker + RapidAPI

Proyecto web sin VPS. Permite solicitar descargas de **contenido de YouTube que el usuario tenga derecho a descargar**, a través de una API de terceros. La compatibilidad real no está garantizada hasta realizar una prueba con una clave de RapidAPI activa.

## Qué incluye

- `site/`: página estática para GitHub Pages; admite MP4, MP3 y M4A y selección de 360p, 480p, 720p y 1080p en MP4.
- `worker/`: Cloudflare Worker que protege la clave de RapidAPI, valida YouTube, crea trabajos, consulta estados y recupera la URL temporal.
- `tests/`: pruebas básicas del validador.

## Proveedor a conectar

[YouTube Downloader - Video Audio and Shorts by FlashData (RapidAPI)](https://rapidapi.com/flashdatadev/api/youtube-downloader-video-audio-and-shorts-by-flashdata). No confundir con **YouTube Download - FlashData**, producto diferente que devuelve solo MP4. Según el proveedor, el plan Basic gratis ofrece hasta 2 GB/mes, 50 MB por archivo y hasta 1080p. La API anunciada admite `POST /rapidapi/youtube-download/jobs`, `GET /jobs/{id}` y `GET /jobs/{id}/file`. El host exacto debe confirmarse en la pestaña **Endpoints** de RapidAPI antes de probar; puede diferir del nombre visible del producto. El valor preconfigurado de `RAPIDAPI_HOST` es una hipótesis basada en el nombre y **no se ha verificado**. La API podría cambiar sus planes, parámetros o políticas. Este proyecto aún no ha hecho ninguna descarga real.

## Despliegue sin servidor propio

### 1. RapidAPI
1. Crear cuenta e inscribirse en el plan BASIC de la API **YouTube Downloader - Video Audio and Shorts by FlashData**. Revisar los posibles cargos de RapidAPI antes de activar un plan.
2. En **Endpoints**, copiar el host literal de `X-RapidAPI-Host` y la clave `X-RapidAPI-Key`. No compartir ni subir la clave a GitHub.

### 2. Cloudflare Worker
1. Abrir Cloudflare > **Workers & Pages** > **Create** > Worker. Crear `media-studio-api`.
2. En **Edit code**, pegar `worker/index.js` y desplegar. Alternativamente usar Wrangler desde la carpeta `worker`.
3. En **Settings > Variables and Secrets**, añadir:
   - `RAPIDAPI_KEY` (Secret): clave de RapidAPI.
   - `RAPIDAPI_HOST` (Text): host copiado de la pestaña Endpoints, sin `https://`.
   - `ACCESS_TOKEN` (Secret): una contraseña larga y aleatoria creada por ti para uso personal.
   - `ALLOWED_ORIGIN` (Text): origen exacto de GitHub Pages, por ejemplo `https://TUUSUARIO.github.io`, sin barra al final ni ruta. Para dominio propio usar el origen del dominio.
4. Guardar y desplegar los cambios. El Worker es un **proxy de API**: no almacena ni convierte videos.

### 3. GitHub Pages
1. Crear un repositorio, por ejemplo `media-studio`.
2. Subir **el contenido de `site/` a la raíz del repositorio** (no la carpeta `worker/` ni secretos).
3. En GitHub > Settings > Pages > Deploy from a branch > `main` / `(root)` > Save.
4. Abrir `https://TUUSUARIO.github.io/media-studio/`, entrar en **Configurar conexión** e introducir la URL pública del Worker y tu `ACCESS_TOKEN` (no la clave RapidAPI).

## Límites y notas

- Los archivos proceden del almacenamiento del proveedor, no del Worker; evitas procesar medios grandes en la cuenta gratuita de Cloudflare.
- Los enlaces devueltos son temporales; el navegador puede abrir el archivo en otra pestaña según el proveedor y los encabezados del almacenamiento. Usa Guardar como si fuera necesario.
- El frontend no recupera por sí solo trabajos pendientes después de cerrar la pestaña. La consulta se puede cancelar, pero el trabajo en el proveedor podría continuar.
- Solo está implementada la integración de MP4, MP3 y M4A. WAV y FLAC no forman parte de esta entrega.
- La contraseña de acceso del Worker es un control simple de uso personal, no un sistema de cuentas. Protege el token y rota si se filtra.
- CORS es una protección del navegador, **no autenticación**. El Worker también exige `ACCESS_TOKEN`.
- Descargas de YouTube: respeta los permisos del titular, los derechos de autor y las condiciones de la plataforma. Los proveedores de terceros pueden fallar o cambiar.
- Ejecutar pruebas: `npm test` (Node.js 20+).

## Diagnóstico

- `401`: `ACCESS_TOKEN` equivocado.
- `403 Origen no autorizado`: `ALLOWED_ORIGIN` incorrecto, revisa protocolo y dominio exactos.
- `503 Faltan secretos`: configura `ACCESS_TOKEN` y `RAPIDAPI_KEY`.
- `502` o respuesta API inesperada: confirma `RAPIDAPI_HOST` en RapidAPI.
- Error de límite: el archivo o consumo mensual superó el plan del proveedor.

> Estado: **proyecto implementado y validación de enlace probada**, pero pendiente de conectar tu cuenta RapidAPI y verificar descarga real, endpoints y calidad de respuesta.
