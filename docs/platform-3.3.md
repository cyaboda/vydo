# vydo 3.3: diagnóstico, cambios y validación

## Diagnóstico y migración

La rama más reciente era `codex/vydo-3.2`, PR #3, aún sin fusionar. La rama 3.3 parte de ella; no modifica `main`. La arquitectura ya estaba consolidada en Node, `public/`, yt-dlp y FFmpeg: no se reintroducen `site/`, workers paralelos ni APIs comerciales. SQLite/PostgreSQL, cuotas, perfiles y cinco formatos existentes se conservan.

El tamaño excesivo procedía de dimensiones CSS: logo central de 450 px, formulario de 103 px y márgenes amplios. Se redujeron a 335 px, 76 px y separaciones compactas. No se utiliza zoom, transformación de escala ni ocultación del desbordamiento de la página. Las ondas permanecen dentro de su contenedor. Un banner opcional dispone de una variante compacta que también cabe en escritorio.

Auth estaba implementado con SDK/PKCE, pero sin proyecto real. Ahora se consulta la disponibilidad real del proveedor al arrancar, se gestionan callbacks en `/` y `/auth/callback`, se detectan errores de correo y se deshabilitan individualmente las funciones pendientes. El proyecto dedicado y su configuración se detallan en [Supabase 3.3](supabase-3.3.md).

## Publicidad y bloqueadores

`public/ads.js` ofrece un componente configurable con proveedor, imagen y destino HTTPS. Sin las tres variables no muestra anuncios, marcadores ni detección. No inyecta SDK publicitario, seguimiento, ventanas ni redirecciones. Los anuncios de las pruebas son fixtures interceptados en un navegador aislado, nunca anuncios de producción.

El aviso aprobado solo se considera después de una respuesta de archivo completada por el servidor; no basta preparar el archivo o pulsar el enlace. Esto acredita la transferencia HTTP, no que el usuario guardase el archivo en su disco. La detección exige dos señales coincidentes (ocultación cosmética y bloqueo de un recurso propio), repetidas dos veces, con un control del servidor que responde correctamente. Señales parciales, red caída, tiempos de espera, pestaña oculta o almacenamiento bloqueado no muestran mensajes. Ninguna detección garantiza identificar una extensión; se usa lenguaje de posibilidad.

El aviso se presenta dentro del resultado, sin modal ni bloqueo. «Permitir anuncios» abre instrucciones y nunca afirma cambiar el bloqueador. «Seguir con VYDO», X y Escape lo cierran. Se registra su presentación y decisión durante 30 días en ese navegador; las cuotas permanecen exclusivamente en el backend. Si no puede persistir la decisión, no se presenta. Se corrigió además el manejo de `sessionStorage` para que su bloqueo no impida descargar.

## Pruebas ejecutadas

- 33 pruebas Node: 32 aprobadas localmente y una omitida porque requiere PostgreSQL externo. Incluyen concurrencia entre procesos, cuotas 5/15, ventana móvil, reinicio, aislamiento por cuenta/navegador, sesiones cifradas, validación SDK, errores de correo y migraciones/RLS en PostgreSQL embebido.
- FFmpeg real: conversión de una fuente sintética a MP4, MP3, M4A, WAV y FLAC y decodificación de los resultados. WAV/FLAC no recuperan información perdida de una fuente comprimida.
- Chromium: zoom/escala 1, sin scroll inicial innecesario en 1366 × 768 y 1920 × 1080, móvil 390 × 844 y anchos adicionales 320/768/1024; ambos logos oficiales, temas, preferencias, formatos, perfil, progreso y recuperación de trabajo.
- Chromium/publicidad: banner compacto; ausencia de proveedor; detección incierta; almacenamiento bloqueado; transferencia HTTP requerida; instrucciones; cierre y persistencia con recarga; caducidad de 30 días; X/Escape; ambos temas; descarga siempre disponible.
- Supabase real: registro autorizado, correo verificado, sesión real con cupo 15, cierre, acceso por contraseña, correo de recuperación, cambio de contraseña y acceso con contraseña actualizada. [Evidencia sin datos personales ni secretos](evidence/auth-3.3.json).

La CI ejecuta además el adaptador contra PostgreSQL 17, ambos scripts de navegador y construcción/arranque Docker. Las pruebas de navegador usan fixtures para ser reproducibles; la evidencia Auth real es independiente. Se repitió una descarga real del video de YouTube autorizado por el usuario: MP4 360p, MP3, M4A, WAV y FLAC, todos recuperados por la API y decodificados completamente con FFmpeg. La vista previa ofreció 360/480/720/1080p. [Evidencia 3.3](evidence/live-3.3.json). Las resoluciones superiores ya se verificaron en [3.2](platform-3.2.md). No se generaliza esta prueba a cualquier video o restricción del origen.

## Pendientes explícitos

SMTP público, Google y eliminación de cuenta administrativa requieren configuración; sus controles no se anuncian como operativos. No hay proveedor publicitario ni hosting público contratado. `http://localhost:3000` requiere mantener el proceso local en ejecución. Los archivos multimedia caducan a los 20 minutos; el historial solo conserva metadatos hasta 30 días. No se exige registro, pago ni publicidad para descargar dentro del cupo.
