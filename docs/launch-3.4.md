# vydo 3.4: preparación y estado de lanzamiento

## Versión y datos

Los PR se integran en orden #1 → #2 → #3 → #4 mediante merges, retargetando cada sucesor a `main` después de integrar su base. Se conservan los commits y todas las etapas; no se fuerza ninguna rama. La versión 3.3 contiene el favicon oficial y nombres basados en el título analizado, limitados a 180 bytes UTF-8, con `filename` y `filename*` en Content-Disposition. Diseño, estilos, logos y motor permanecen intactos.

Se corrigió una carrera de CI: el test consultaba `transferCount` antes del evento HTTP `finish`; ahora espera acotadamente ese evento. La aplicación conserva su comportamiento. El despliegue efímero exige `REQUIRE_POSTGRES=true` y rechaza arrancar sin `DATABASE_URL`, evitando SQLite que perdería cuotas al reiniciar.

La base Supabase dedicada `rxtahpernilkidmgvqhb` tiene las cinco tablas VYDO con RLS confirmado mediante consulta de solo lectura. No se aplican migraciones ni se elimina información durante este lanzamiento. El SQLite local y su clave permanecen intactos. No se copia ni importa automáticamente al servidor: antes del cambio definitivo respaldar ambos y planificar una importación transaccional revisada de cuotas/sesiones/preferencias, sin sobrescribir filas existentes y conservando la misma clave criptográfica. No restaurar fixtures de pruebas sobre Supabase.

## Render

`render.yaml` reutiliza el Dockerfile: plan **free** explícito, sin disco de pago, una instancia, rama `main`, despliegues automáticos desactivados, puerto 10000, Host 0.0.0.0, `/api/health`, `/tmp`, origen HTTPS y cookies Secure. Es una configuración de prueba pública, no una promesa de servicio permanente: Free duerme tras 15 minutos sin tráfico, tiene CPU/RAM limitados y no sirve como garantía para conversiones 1080p.

El Dockerfile instala Node 24.11, yt-dlp/FFmpeg y dependencias fijadas. Incluye dos diagnósticos sin modificaciones de datos:

```sh
node scripts/check-production.mjs
node scripts/check-auth.mjs
```

El primero valida herramientas y SELECT de tablas con `service_role` a través de la conexión PostgreSQL, sin imprimir secretos. Un fallo impide afirmar que la persistencia está configurada. Si la herramienta de creación directa de Render no permite fijar healthcheck o dominios, completar esos campos en Settings; el Blueprint los declara.

Variables que debe recibir Render por su panel de secretos, nunca por GitHub ni mensajes:

- `DATABASE_URL`: copiar el **Session pooler** IPv4 desde Connect del proyecto Supabase, usuario y host exactos del panel, contraseña existente de la base codificada para URL y `sslmode=verify-full`. No adivinar el hostname ni resetear la contraseña. La clave publicable/`service_role` de Auth no sustituye la contraseña PostgreSQL. El usuario de conexión debe poder asumir `service_role`.
- `APP_SECRET`: 64 caracteres hex estables. Para una migración de la instalación local conservar el valor de su `data/secret.key`, sin publicarlo. No regenerarlo durante actualizaciones.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`: las del proyecto dedicado, solo backend. `SUPABASE_SERVICE_ROLE_KEY` solo si se habilita eliminación administrativa.
- `PUBLIC_ORIGIN=https://vydo.download`, `COOKIE_SECURE=true`, `REQUIRE_POSTGRES=true`, `HOST=0.0.0.0`, `PORT=10000`, `TMPDIR=/tmp`.
- `TRUSTED_PROXY_CIDRS`: redes reales del proxy inmediato, comprobadas en el entorno Render; nunca `0.0.0.0/0`. Verificar dos redes de clientes distintas antes de abrir las descargas para evitar agruparlas bajo el proxy. No inventar rangos.
- Registro y Google permanecen false hasta completar SMTP/OAuth y probarlos; véase [Auth 3.3](supabase-3.3.md).

Si se utiliza primero la URL asignada `onrender.com`, usar temporalmente ese origen HTTPS exacto para probar POST y cookies, y actualizarlo al dominio oficial después de validar DNS/certificado. No admitir varios orígenes arbitrarios ni desactivar CSRF. No activar varias instancias: cola y archivos son locales, aunque las cuotas sean compartidas en PostgreSQL.

## Dominio y DNS

En Render añadir primero **vydo.download** como Custom Domain; así Render añade **www.vydo.download** y lo redirige al principal. Render emite/renueva TLS y redirige HTTP a HTTPS.

Cloudflare necesita dos CNAME: `@` y `www`, ambos al **hostname onrender.com realmente asignado al servicio**, inicialmente DNS only. No introducir el nombre ilustrativo de ningún tutorial. No publicar AAAA para estos hosts: Render documenta que no soporta IPv6. Revisar conflictos con registros existentes sin borrar otros servicios ni registros de correo. Cuando Render confirme certificado válido se puede evaluar proxy Cloudflare con Full (strict), sin cachear API, cookies ni callbacks.

Los valores exactos solo pueden entregarse después de crear el servicio. No se declara el dominio conectado por preparar estos pasos.

## Validación y bloqueo de lanzamiento

Antes de anunciar publicación deben pasar desde una URL pública: `/api/health` 200; página sin contraseña; POST con origen real; MP4/MP3/WAV/FLAC recuperados y decodificados; nombre Unicode correcto; cuotas 5/15 y persistencia después de reiniciar; aislamiento de sesiones; móvil y ambos temas. Las pruebas locales/CI y evidencias reales anteriores no sustituyen probar el hosting elegido: YouTube puede restringir su red y no se intentará eludirlo.

La prueba FFmpeg local de esta revisión encontró `Permission denied` al crear su salida en Windows; no se cambió el motor por un problema del entorno. La construcción Docker y las conversiones se validan en CI Linux. Se conserva la evidencia autorizada previa en `docs/evidence/live-3.3.json`.

## Costes consultados el 17 de noviembre de 2026

- Render Free: 0 USD de cómputo, con suspensión por inactividad; no equivale a disponibilidad permanente. La cuenta debe revisar límites de gasto/uso antes de recibir tráfico.
- Render 0.5c-512mb: 7 USD/mes; 512 MB no garantiza conversiones hasta 1080p. 1c-2g: 25 USD/mes, sujeto a medir carga.
- Hobby incluye 5 GB/mes de salida; exceso público: 0,15 USD/GB. Ejemplo: 100 GB de salida total implica aproximadamente 14,25 USD adicionales. Los archivos multimedia hacen importante ese coste.
- Supabase Free: sin pago dentro de límites, puede pausarse por baja actividad; Pro desde 25 USD/mes si se aprueba. SMTP y renovación del dominio son independientes y aún no se ha elegido una tarifa de correo.
- No se activa ningún plan de pago ni se promete un coste fijo ilimitado. Un punto de partida permanente con 1c-2g y Supabase Free es 25 USD/mes más exceso de tráfico, correo y renovación; con Supabase Pro, desde 50 USD/mes más esos conceptos.

Fuentes oficiales: [Render precios](https://render.com/pricing), [Free](https://render.com/docs/free), [ancho de banda](https://render.com/docs/outbound-bandwidth), [Cloudflare DNS](https://render.com/docs/configure-cloudflare-dns), [dominios](https://render.com/docs/custom-domains), [Blueprint](https://render.com/docs/blueprint-spec), [Supabase precios](https://supabase.com/pricing).
