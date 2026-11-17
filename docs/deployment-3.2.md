# Despliegue y operación de vydo 3.2

No se ha contratado un servicio ni publicado una instancia externa en esta entrega. Las plantillas no equivalen a un despliegue. Revisa precios y condiciones antes de activar cualquier hosting; `render.yaml` solicita disco persistente y puede implicar pago.

## Preparación de producción: vydo.download (3.3)

Dominio oficial: **https://vydo.download**. Se reutilizan `Dockerfile`, `compose.yaml` y `.env.example`; no se necesita una segunda arquitectura. El diseño y motor permanecen intactos. No se ha ejecutado un despliegue ni cambiado Cloudflare.

Preparación local, sin arrancar servicios:

```sh
cp .env.example .env.production
# Editar .env.production: conservar secretos fuera de Git.
docker compose --env-file .env.production config --quiet
```

Valores de producción:

```dotenv
PUBLIC_ORIGIN=https://vydo.download
COOKIE_SECURE=true
DATABASE_URL=
AUTH_PUBLIC_SIGNUP_ENABLED=false
GOOGLE_AUTH_ENABLED=false
```

Completar las claves Supabase reales en ese archivo mediante un canal privado. `DATA_DIR=/data` ya lo fija Compose. `DATABASE_URL` vacío conserva SQLite en el volumen `vydo-data`: usar una instancia con disco persistente, mantener el mismo volumen/nombre de proyecto Compose y respaldar `/data` junto con `secret.key`. No ejecutar `docker compose down -v`. Esto preserva cuotas 5/15, sesiones y preferencias al actualizar. Si se cambia a PostgreSQL, migrar primero y definir `APP_SECRET` estable; no se activa automáticamente por usar Supabase Auth.

La configuración existente publica el puerto 3000 solo en loopback. En un servidor propio se necesita un proxy HTTPS en ese mismo host que termine TLS con certificado válido para `vydo.download`, redirija HTTP a HTTPS y reenvíe a `http://127.0.0.1:3000`. En hosting administrado, conectar el dominio al servicio Docker, habilitar TLS del proveedor y montar `/data` de forma persistente. No exponer directamente el puerto de Node. No utilizar hosting estático/GitHub Pages.

El proxy debe mantener el Host, normalizar `X-Forwarded-For` y permitir streaming y tiempos de preparación de hasta 10 minutos. No cachear API, callbacks, respuestas con cookies ni retornos `/?code=...`. Establecer `TRUSTED_PROXY_CIDRS` con las redes **reales del salto que conecta al contenedor**, que dependen del hosting/red Docker; no inventarlas ni confiar en todos los orígenes. Comprobar que las cuotas no agrupen a todos los visitantes bajo la IP del proxy antes de publicar. Mantener sin cambios los límites de concurrencia actuales.

DNS a preparar en Cloudflare **después de elegir hosting** (no crear todos a la vez):

| Modalidad | Tipo / nombre | Valor pendiente |
| --- | --- | --- |
| Servidor con IPv4 | A / `@` | IPv4 pública asignada al servidor |
| Servidor con IPv6 funcional | AAAA / `@` | IPv6 pública asignada; omitir si no existe |
| Hosting con destino DNS | CNAME / `@` | Hostname exacto indicado por el proveedor; usar flattening del apex si corresponde |
| Verificación de propiedad | TXT / nombre indicado | Token exacto entregado por el hosting, solo si lo requiere |
| `www`, opcional | CNAME / `www` | `vydo.download`, con certificado y redirección HTTPS hacia el dominio oficial |

Usar la modalidad A/AAAA o CNAME indicada por el hosting; no publicar direcciones de ejemplo. Inicialmente validar DNS/certificado conforme a las instrucciones del proveedor. Si se activa el proxy Cloudflare, usar [Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/) y certificado válido en el origen, nunca Flexible. Configurar bypass de caché para rutas dinámicas. No reemplazar registros de correo existentes. SPF/DKIM/DMARC y verificaciones SMTP se añadirán con los valores reales del proveedor de correo, cuando se elija.

Antes del lanzamiento verificar desde HTTPS: cookie `Secure` y HttpOnly, callback Auth, descarga Unicode, streaming, cuota compartida por red correcta y persistencia tras recrear el contenedor. La configuración se ha revisado, pero el dominio, DNS, TLS y hosting **no están probados en producción**.

## Recursos y aislamiento

Recomendación inicial para una instancia de poco tráfico: 2 vCPU, 1–2 GiB RAM, 1 GiB temporal y al menos 1 GiB persistente para metadatos. No son garantías de rendimiento: transcodificar 1080p consume CPU. Se admite un proceso de medios activo por worker, tres en cola local y cuatro reservas globales; no escales procesos sin revisar CPU, memoria y temporales.

El contenedor usa un usuario sin privilegios. Compose aplica filesystem de solo lectura, volumen `/data`, tmpfs de 1 GiB, sin capacidades y límites de memoria, procesos y CPU. La ruta `/data` debe pertenecer al UID 1000 y mantener SQLite, su WAL y `secret.key` entre recreaciones. No pongas la base SQLite en un filesystem de red que no respete sus bloqueos.

Por trabajo: 30 minutos de contenido, 512 MiB para origen y salida sumados y 10 minutos por proceso de descarga/conversión. El análisis tiene 2 minutos. Se informa progreso real por pista/fase. El monitor de disco comprueba cada segundo; puede existir un exceso breve, acotado adicionalmente por tmpfs.

## HTTPS y proxies

Publica frontend y API bajo el mismo origen. El frontend está separado en `public/`, pero servirlo junto al backend evita CORS y mantiene cookies seguras sin exponer tokens.

Configura un proxy HTTPS (o terminación TLS del proveedor), `PUBLIC_ORIGIN=https://tu-dominio` y `COOKIE_SECURE=true`. Redirige HTTP a HTTPS en el proxy. No caches respuestas `/api/`, `/auth/callback` ni `Set-Cookie`. Se emiten CSP, no-store, nosniff y HSTS bajo HTTPS.

`TRUSTED_PROXY_CIDRS` está vacío por defecto. Si hay un proxy, configura **sus redes reales** y bloquea el acceso directo al backend desde Internet. El proxy debe sobrescribir/normalizar X-Forwarded-For. La aplicación solo acepta la cadena si el peer inmediato es de confianza y la recorre de derecha a izquierda hasta el primer salto no confiable. No configures `0.0.0.0/0` ni `::/0`.

Mantén sincronizados los relojes de las instancias. No registres cuerpos de Auth, cookies, tokens, URLs firmadas ni IP en texto claro en el proxy o APM.

## Persistencia y nube

- SQLite: persistencia completa de cuotas, rate limits, preferencias, historial y sesiones para **una instancia**. BEGIN IMMEDIATE coordina escrituras incluso entre procesos locales. No hay contadores en localStorage.
- PostgreSQL: `DATABASE_URL` después de aplicar la migración. Las reservas atómicas usan un advisory lock de transacción común a todos los workers. APP_SECRET debe ser igual y estable en todos. PostgreSQL remoto exige TLS con verificación completa.
- La cola y los archivos de descarga siguen en la memoria/directorio temporal del worker. Para varias instancias, usa afinidad al worker para crear/consultar/descargar cada trabajo, o implementa después cola distribuida y almacenamiento compartido. No se afirma balanceo arbitrario de medios en esta versión.
- Un fallo de base de datos impide aceptar nuevos trabajos. Si el heartbeat de una concesión falla, se cancela el proceso. Las reservas abandonadas se devuelven después de 90 segundos. La supervisión de producción debe reiniciar procesos no saludables para evitar workers congelados.
- No elimines la base o cambies APP_SECRET para desplegar una actualización: perderías sesiones/identificadores o la continuidad de cuotas. Para rotación del secreto, prepara una migración y ventana de cierre de sesiones.

Los archivos se eliminan 20 minutos después de finalizar (comprobación cada 30 s); fallidos y cancelados se limpian al terminar. El cierre ordenado cancela y devuelve cupo de trabajos interrumpidos. Una descarga abierta mantiene su archivo hasta cerrar la respuesta. Un reinicio pierde la cola/archivos pero conserva las cuotas, sesiones y metadatos; no promete reanudar medios incompletos.

`GET /api/health` comprueba herramientas y almacenamiento. `GET /api/admin/health` solo existe con un `VYDO_ADMIN_TOKEN` independiente de 32+ caracteres y exige Bearer; no es el acceso público ni debe publicarse en el frontend.

## Publicidad

El componente no muestra nada mientras falte alguno de `AD_PROVIDER`, `AD_IMAGE_URL` y `AD_TARGET_URL`. Solo al configurar un proveedor real aprobado aparece una imagen con etiqueta **Publicidad** debajo del formulario. La imagen y destino deben ser HTTPS sin credenciales. No se ejecutan scripts de terceros, no hay anuncios de prueba visibles, ni redirecciones automáticas ni obligación de verlos para descargar. La política CSP solo amplía img-src al origen de la imagen configurada.

Compose no activa un proveedor. Si se habilita publicidad, revisa autorización de marca, privacidad/consentimiento, políticas de la red y dimensionamiento del banner. Los valores configurados son URLs públicas; no introduzcas secretos en ellas. La integración de una red que requiera SDK/script necesitará revisión adicional.

## Operación responsable

Mantén actualizados yt-dlp/EJS juntos, FFmpeg y las dependencias fijadas; repite pruebas con contenido autorizado. Los controles no permiten DRM, autenticación de YouTube ni evasión de restricciones. Un video válido puede dejar de estar disponible según región, fecha o red.

Las copias de seguridad de `/data`/PostgreSQL contienen datos personales y sesiones cifradas: protégelas junto al secreto fuera del repositorio. El historial puede eliminarse por usuario; establece un procedimiento operativo de eliminación/exportación antes de ofrecer el servicio a gran escala.
