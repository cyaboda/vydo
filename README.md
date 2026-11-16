# MEDIA STUDIO · Web personal

Interfaz + servidor web Node.js sin dependencias npm. Convierte **videos de YouTube que tengas derecho a descargar** a MP4, MP3, WAV, FLAC o M4A. Incluye clave privada, cola y limpieza automática de los archivos temporales.

## Arquitectura

```
Navegador → Node.js (interfaz/API privada) → yt-dlp → FFmpeg → descarga autenticada
```

Se trata de una **página web**, no una aplicación de escritorio. La página y la API se sirven desde la misma dirección para evitar problemas de CORS y configuración. Para acceder desde cualquier dispositivo, despliega el servicio Node.js en un hosting con procesos persistentes y espacio temporal (VPS/servicio Docker). **GitHub Pages por sí solo no puede ejecutar el procesamiento de enlaces.**

## Requisitos del servidor

- Node.js 22+ (para integración moderna con yt-dlp)
- `yt-dlp` actualizado con `yt-dlp-ejs`, disponible en `PATH` (https://github.com/yt-dlp/yt-dlp)
- `ffmpeg` instalado y disponible en `PATH` (https://ffmpeg.org/)
- Espacio temporal para archivos; los trabajos se eliminan tras ~20 minutos

## Iniciar y probar

**macOS/Linux:**

```bash
export MEDIA_STUDIO_TOKEN='elige-una-clave-privada-de-al-menos-16-caracteres'
node server.mjs
```

**PowerShell (Windows):**

```powershell
$env:MEDIA_STUDIO_TOKEN='elige-una-clave-privada-de-al-menos-16-caracteres'
node server.mjs
```

Abre `http://127.0.0.1:3000` (solo para prueba local). Si falta alguna de las herramientas, la web se muestra pero la API avisa que debes instalarla. `npm install` **no es necesario**. yt-dlp actual necesita un motor JavaScript y el componente EJS; el Dockerfile ya incluye Node.js 22 y `yt-dlp-ejs`.

## Publicación web

1. Sube el proyecto completo a un repositorio privado de GitHub.
2. Elige hosting que permita ejecutar Node.js, `yt-dlp` y FFmpeg. Una VPS o contenedor con disco temporal es adecuado. No funcionará como descargador en GitHub Pages ni en una plataforma exclusivamente estática.
3. Configura `MEDIA_STUDIO_TOKEN` como **secreto** en el proveedor. No lo añadas al código ni al repositorio.
4. Ejecuta `node server.mjs` e indica `HOST=0.0.0.0` y el puerto asignado por el proveedor.
5. Publica el servicio detrás de HTTPS. Es necesario para enviar la clave privada y utilizar el portapapeles con seguridad.
6. Revisa las políticas del proveedor: algunos prohíben determinadas descargas, o limitan uso de CPU, ancho de banda o tráfico multimedia.

### Desplegar en Render con Docker

1. Crea un **repositorio privado** de GitHub y sube estos archivos (sin comprimir).
2. En [Render](https://dashboard.render.com/), elige **New → Blueprint** y conecta ese repositorio. Render leerá `render.yaml`.
3. Selecciona el servicio y configura el secreto `MEDIA_STUDIO_TOKEN` con una contraseña fuerte de al menos 16 caracteres, distinta de tus contraseñas habituales.
4. Confirma el despliegue. Una vez activo, Render proporciona una URL `https://....onrender.com` que abre tanto la interfaz como la API.
5. Abre `/api/health` y verifica que `ytDlp` y `ffmpeg` sean `true`.
6. Prueba con un video propio o autorizado, primero uno corto y pequeño.

**Importante:** el archivo Blueprint solicita el plan `starter`, que es **de pago**. No actives un plan sin revisar previamente su precio. Para experimentar, puedes cambiarlo a `free` en `render.yaml`, pero Render Free tiene 512 MB de RAM, suspensión por inactividad y límites de ancho de banda, insuficientes para muchas conversiones. El servicio en la nube no garantiza que YouTube permita descargar desde las IP de Render. <https://render.com/docs/free>

### Ejemplo Docker

```bash
docker build -t media-studio .
docker run --rm -p 3000:3000 -e MEDIA_STUDIO_TOKEN='TU_CLAVE_PRIVADA_LARGA' media-studio
```

## Seguridad y límites

- Los enlaces se normalizan a videos individuales de dominios oficiales de YouTube; no se aceptan URLs arbitrarias, listas ni hosts externos (reduce SSRF).
- Las operaciones requieren clave, enviada en cabecera `Authorization`; la interfaz guarda la clave solo en `sessionStorage` del navegador.
- No se manipulan cookies de YouTube, sesiones de terceros, firmas ni verificaciones de acceso.
- Cola pequeña: 1 procesamiento a la vez, hasta 3 en espera. Límite de archivo solicitado: 500 MB; límite de tiempo del proceso: 10 minutos.
- Las descargas completas se almacenan temporalmente en el servidor. El navegador recibe el archivo al finalizar; algunos navegadores pueden necesitar memoria considerable para archivos grandes.
- El estado del trabajo se mantiene en RAM. Un reinicio del servidor cancela trabajos, y los temporales antiguos deberían limpiarse en el despliegue o mediante cron.
- La descarga solo es viable si YouTube permite recuperar el medio en ese entorno. Los videos pueden fallar por bloqueos, cambios de YouTube, formatos indisponibles o limitaciones del proveedor.

## Comandos

```bash
npm test
npm run check
npm start
```

## Uso

Utiliza únicamente videos propios, con licencias que permitan descargarlos o con autorización del titular. YouTube puede imponer restricciones adicionales según el contenido y sus condiciones de servicio.
