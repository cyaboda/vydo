# Gestión de HTTP 429 de YouTube

## Diagnóstico verificable

Los logs de producción del 18-11-2026 confirmaron `YOUTUBE_RATE_LIMIT`, `upstreamStatus:429`, etapa `inspect`, yt-dlp `2026.10.26`. Esto acredita limitación por el origen para las solicitudes observadas desde Render; no demuestra un bloqueo permanente de todos sus servidores. No es un error de FFmpeg, del registro o de TLS de PostgreSQL. Un 403, contenido privado, autenticación y un extractor incompatible conservan categorías distintas y no activan por sí solos la pausa 429.

Antes, el análisis heredaba un timeout de 120 segundos, socket de 20 segundos, un reintento HTTP y los reintentos de extractor predeterminados de yt-dlp. Ahora el análisis tiene **45 segundos como máximo**, socket de **10 segundos**, reintentos HTTP/fragmentos/extractor **0** y un segundo entre peticiones de extracción. Un 429 explícito en stderr detiene el proceso inmediatamente, incluso si la herramienta aún no había terminado. No se prueban cookies, cuentas, proxies, IP alternativas ni clientes destinados a evadir restricciones.

## Pausa compartida y duplicados

- Ante un HTTP 429 confirmado se suspenden **nuevos análisis de origen**. Se responde 503 con código `YOUTUBE_RATE_LIMIT` inicialmente y `YOUTUBE_COOLDOWN` durante la pausa, cabecera HTTP `Retry-After` y segundos restantes en JSON.
- Mensaje breve: «YouTube limita las solicitudes. Prueba de nuevo en …». No se confunde con las 5/15 descargas por usuario.
- Si yt-dlp expone un `Retry-After` válido, se aceptan segundos o fecha HTTP. No se inicia otra consulta antes de ese plazo y una señal posterior nunca acorta una pausa ya vigente.
- **Limitación de observabilidad:** la CLI de yt-dlp no garantiza exponer las cabeceras HTTP. No se activa `--print-traffic` ni debug de cabeceras privadas. Si el plazo no está disponible o es inválido, VYDO usa su política: 30 minutos, 1 hora, 2 horas, 4 horas y máximo 6 horas. Es una espera conservadora propia, no una promesa de recuperación de YouTube.
- La pausa y su progresión sobreviven a reinicios. Se reutilizan dos filas de control reservadas del almacenamiento de rate limits existente, bajo sus transacciones/bloqueos atómicos. **No hay tablas nuevas, migraciones, cambios de configuración ni credenciales de Supabase.**
- Una concesión temporal compartida impide lanzar análisis distintos simultáneamente entre workers. Caduca para recuperarse de procesos interrumpidos; un propietario antiguo no puede liberar la concesión de otro.
- Solicitudes concurrentes del mismo enlace comparten un único proceso. Cancelar un visitante no cancela a los demás; cancelar todos detiene el proceso.
- Solo los metadatos exitosos se reutilizan durante 60 segundos, con caché acotada a 128 entradas. No se cachean respuestas 429 ni errores. Cada solicitante recibe su propia vista previa con su propietario; no se comparten cookies ni permisos. Leer metadatos ya obtenidos no genera una nueva petición al origen, incluso durante la pausa.
- Tras expirar la pausa no hay una tarea automática de reintentos: una nueva solicitud puede realizar una única prueba. Un resultado exitoso reinicia la progresión, sin borrar una pausa más reciente de otro worker.

Un 429 en una descarga ya admitida también se registra como señal para pausar futuros análisis. No se cancelan trabajos existentes, no se cambia la conversión ni se alteran sus reglas de cuota. Las cuentas, perfiles, registro, Turnstile y health checks siguen disponibles. El análisis ocurre antes de reservar un trabajo: si falla o está pausado, consume **cero descargas**, tanto para visitantes como para registrados.

## Pruebas y alcance

Pruebas de concurrencia/coalescencia, expiración de caché, cancelación independiente, Retry-After numérico/fecha/inválido, interrupción rápida del subproceso, progresión tras pausa, persistencia tras reinicio, concesiones caducadas, aislamiento de vistas previas, cuotas intactas 5/15 y cuentas/health funcionando durante la pausa. La CI comprueba también las operaciones de control en PostgreSQL real entre dos adaptadores y el contenedor Docker. Las pruebas unitarias no consultan YouTube.

Los logs solo contienen códigos, etapa, versión, tiempo de espera y si el plazo procede del origen o del fallback. No incluyen stderr completo, URLs, video IDs, tokens, cookies, correos ni información privada. La evidencia productiva final se adjunta al PR/entrega sin realizar bucles de consultas durante una pausa.

## Viabilidad de Render

Render puede servir VYDO y mantener sus cuotas en el almacenamiento persistente ya conectado. Esto **no garantiza que YouTube acepte su tráfico**. La disponibilidad, reputación y limitación aplicada por el origen quedan fuera del control de la aplicación; ampliar RAM/CPU o comprar un plan no prueba que desaparezca un 429. El plan Free además duerme por inactividad y limita recursos para conversión. No se cambia de plan, región, IP, proveedor o infraestructura.

No se declara resuelto el acceso hasta recuperar y decodificar un archivo real desde producción. Si continúan los 429, la mejora entregada es la gestión responsable y rápida de esa limitación, no su evasión. Sin acceso estable al origen no puede prometerse un descargador de YouTube fiable en ese hosting.

Referencias: [HTTP 429](https://www.rfc-editor.org/rfc/rfc6585#section-4), [Retry-After](https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3), [opciones de yt-dlp](https://github.com/yt-dlp/yt-dlp#usage-and-options), [Render Free](https://render.com/docs/free).
