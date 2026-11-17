# vydo 3.2

Plataforma de código abierto para descargar contenido autorizado de YouTube con **yt-dlp y FFmpeg**. Conserva el diseño 3.1, los WebP oficiales, ambos temas y las ondas. Licencia MIT.

**Pegar enlace → Video o Audio → Descargar.** No exige contraseña ni registro.

- MP4: 360p, 480p, 720p y 1080p, solo si están disponibles.
- Audio: MP3, M4A, WAV y FLAC. El selector aparece al elegir Audio.
- Visitantes: **5 trabajos aceptados por IP en una ventana móvil de 60 minutos**.
- Cuentas gratuitas: **15 por usuario en 60 minutos**, una descarga en curso por identidad.
- Perfil opcional con preferencias e historial privado de metadatos.
- Publicidad configurable, desactivada sin proveedor real. Sin anuncios inventados, popups ni redirecciones automáticas.

## Arranque local o con Docker

Node 24.11+ o Docker Engine con Compose. No se necesita contratar un servicio.

```sh
cp .env.example .env
docker compose up --build -d
```

Abre `http://localhost:3000`. **No hay clave de acceso.** Compose persiste SQLite y la clave criptográfica en el volumen `vydo-data`. No elimines ese volumen para actualizar: contiene cuotas y sesiones. Las descargas siguen siendo temporales.

Para desarrollo:

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
export PATH="$PWD/.venv/bin:$PATH"
node --env-file=.env server.mjs
```

Instala también FFmpeg con H.264, AAC, MP3, PCM y FLAC. En Windows usa `.venv\Scripts`, variables `$env:...` y, si hace falta, rutas absolutas en `YTDLP_BIN` y `FFMPEG_BIN`. Se fijan las dependencias npm/Python en los lockfiles/configuración. Los paquetes Debian se actualizan desde su repositorio; no se promete reproducibilidad binaria exacta.

## Cuentas opcionales: estado y configuración

La integración Supabase está preparada y probada con el SDK real frente a un servicio de prueba. **No hay un proyecto VYDO configurado, credenciales reales de Auth, SMTP ni Google activados en esta entrega.** Sin configuración, las descargas anónimas funcionan y las opciones de cuenta explican que aún no están disponibles. No se ha alterado ningún proyecto Supabase de otra aplicación.

Para activarlas, sigue [la configuración de Supabase](docs/supabase-3.2.md). El frontend no recibe claves de Supabase, access tokens ni refresh tokens. Solo utiliza la API del propio servidor y una cookie opaca HttpOnly.

## Cuotas y seguridad

Las cuotas se reservan en transacciones SQLite (`BEGIN IMMEDIATE`) o PostgreSQL (transacción y advisory lock compartido). Se contabiliza la aceptación del trabajo, no cada vez que se descarga su archivo ya preparado. Recargar, cerrar sesión o reiniciar no borra las cuotas.

Los fallos internos de conversión, arranque de herramienta, límites de recursos y cierre del servidor devuelven el cupo. Los errores del origen y la cancelación del usuario consumen el trabajo aceptado. Los trabajos abandonados por un proceso se recuperan al caducar su concesión de 90 segundos, renovada cada 5 segundos. Si falla el almacenamiento, las nuevas reservas fallan de forma cerrada; un worker que no renueva su concesión cancela su trabajo.

Los visitantes comparten cupo cuando comparten IP. Las cuentas tienen cupo individual; una protección adicional admite hasta 60 trabajos/hora y 3 simultáneos por red, además de 4 reservas activas globales. IPv6 usa un guard adicional por /64. Las IP se guardan con HMAC, no en texto claro; esto es seudonimización, no anonimato absoluto. No se confía en `X-Forwarded-For` salvo desde `TRUSTED_PROXY_CIDRS` explícitos y se evalúa la cadena de derecha a izquierda.

Los trabajos se aíslan por cookie firmada de visitante o por usuario verificado, **no por IP**: otro navegador de la misma red no puede leerlos. El historial no incluye archivos multimedia. Eliminar un registro no restaura cuota. Registro/acceso/recuperación y análisis tienen límites adicionales persistentes.

La API no admite DRM, credenciales de YouTube, cookies importadas, listas, directos ni mecanismos de evasión. Solo se aceptan enlaces HTTPS de hosts exactos de YouTube. No se ejecutan comandos mediante shell ni APIs comerciales.

## Despliegue web

Consulta [la guía de despliegue y operación](docs/deployment-3.2.md). Se necesitan procesos de servidor y espacio temporal: **GitHub Pages no ejecuta yt-dlp ni FFmpeg**.

Una instancia puede utilizar SQLite con un volumen persistente. Para cuotas, sesiones y perfiles compartidos en la nube, configura `DATABASE_URL` con PostgreSQL y ejecuta la migración revisada. El código permite varias instancias compartiendo cuotas, pero la cola y los archivos todavía son locales: usa una instancia o enrutamiento persistente por worker. Una cola distribuida y almacenamiento temporal compartido serían el siguiente paso para balanceo libre.

Con HTTPS externo configura `PUBLIC_ORIGIN=https://tu-dominio` y `COOKIE_SECURE=true`. No publiques el puerto interno sin el proxy. No se ha contratado ni desplegado infraestructura. `render.yaml` es una plantilla que puede implicar costes de disco/hosting: revisa el proveedor antes de usarla.

## Pruebas

```sh
npm ci
npm test
FFMPEG_BIN=/usr/bin/ffmpeg npm test
npm install --no-save playwright@1.62.1
npx playwright install chromium
node scripts/ui-check.mjs
```

Hay pruebas de cuotas móviles, concurrencia real entre procesos, reinicio de SQLite, devolución de cupo, aislamiento, API, autenticación SDK/PKCE, migración PostgreSQL y RLS, además de conversión real de un origen sintético a los cinco formatos. `TEST_DATABASE_URL` permite ejecutar el adaptador PostgreSQL con una **base desechable de pruebas**; la CI proporciona una. Nunca apuntes ese valor a datos reales: el fixture crea roles y tablas de Auth de prueba.

La prueba de navegador usa un motor y cuentas de prueba deterministas. Verifica el acceso público, ambos temas, logos, formatos, cuota, perfil, preferencias, historial, cancelación, teclado y tamaños móviles. No demuestra conexión con Google o entrega real de correos.

La prueba de YouTube es optativa y exige autorización:

```sh
VYDO_TEST_AUTHORIZED=yes VYDO_TEST_URL='https://www.youtube.com/watch?v=TU_VIDEO_ID' npm run test:live
```

Usa una base aislada de prueba, mantiene el cupo de 5 por ejecución, recupera el archivo por la API pública con su cookie y lo decodifica completo. `VYDO_TEST_FORMATS` selecciona hasta cinco variantes por ejecución; `VYDO_TEST_REPORT` guarda JSON. No se ejecuta automáticamente sobre contenido arbitrario. Consulta [la evidencia de 3.2](docs/platform-3.2.md).

## API principal

| Ruta | Acceso y función |
| --- | --- |
| `GET /api/health` | Público; herramientas y almacenamiento, 503 si falla |
| `GET /api/session` | Público; identidad, cuota, disponibilidad de cuentas y anuncio configurado |
| `POST /api/preview` | Público; `{url, authorized:true}` |
| `POST /api/jobs` | Público con cookie de visitante/cuenta; valida vista previa y reserva cuota |
| `GET /api/jobs/:id` | Solo propietario; estado, progreso y cuota |
| `DELETE /api/jobs/:id` | Solo propietario; cancelación |
| `GET /api/jobs/:id/download` | Solo propietario; streaming del archivo temporal |
| `POST /api/auth/login`, `/signup`, `/recover`, `/google` | Opcionales; Supabase configurado |
| `GET /auth/callback` | Intercambio PKCE en el mismo navegador |
| `DELETE /api/session` | Cierra sesión de cuenta; no obliga a registrarse |
| `POST /api/auth/password` | Cuenta, sesión reciente; cambia contraseña |
| `GET/PATCH /api/profile` | Cuenta; historial y preferencias propios |
| `DELETE /api/profile/history/:id` | Cuenta; elimina un registro propio |
| `DELETE /api/account` | Cuenta, sesión reciente, confirmación `ELIMINAR` y admin de Auth configurado |
| `GET /api/admin/health` | Desactivado sin `VYDO_ADMIN_TOKEN`; Bearer independiente de 32+ caracteres |

POST/PATCH requieren JSON. Los errores 429 incluyen `Retry-After`. Los recursos internos, variables de entorno, dependencias y bases de datos no se sirven como archivos públicos.
