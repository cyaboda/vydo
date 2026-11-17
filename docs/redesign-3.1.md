# vydo 3.1 — rediseño de interfaz

Fecha de validación: 17 de noviembre de 2026 (America/Guayaquil).

## Frontend y alcance

El servidor sirve `public/`. El rediseño conserva `engine.mjs`, `jobs.mjs`, `lib.mjs` y todos los contratos de API, la autenticación, la cola y la limpieza de archivos. El único ajuste del servidor es permitir `theme.js` y los dos WebP oficiales en su lista explícita de recursos estáticos y declarar `image/webp`.

La referencia se implementa con HTML/CSS: fondo blanco, logo protagonista, subtítulo, barra redondeada con acción integrada, selector compacto de Video/Audio y ondas SVG decorativas. No se utiliza una captura como fondo. Se retiraron la sección promocional, el footer y todos los enlaces públicos al repositorio. La licencia y la documentación permanecen.

## Logos originales

Los archivos suministrados se copian sin modificar, manteniendo sus proporciones y transparencia. La selección depende del contraste de las letras, no del nombre ambiguo del archivo:

- `public/LOGO_BLACK.webp`: letras oscuras, tema claro. SHA-256: `665f6dfd1b9c9508b4d1becd78ed1d106f93d8bff1fa1e8d06061f29f3e0221a`.
- `public/LOGO_WHITE.webp`: letras blancas, tema oscuro. SHA-256: `84475a5bc3fb4c92af201faccd13fb97cd645dd4d15154e91e0049239c64b6f5`.

Las sumas coinciden con los originales entregados. Se muestran mediante imágenes con ancho responsive y altura automática. El favicon también utiliza el recurso oficial.

## Temas y flujo

`theme.js` se ejecuta antes de cargar la hoja de estilos para evitar el parpadeo del tema. Usa `vydo_theme` en localStorage para la elección explícita; si no existe, respeta `prefers-color-scheme`, también cuando cambia durante la sesión. El valor base es claro. La política CSP sigue sin permitir scripts ni estilos inline.

El usuario selecciona Video o Audio y pulsa Descargar. La confirmación de autorización aparece en un diálogo antes del primer análisis de cada enlace. Video muestra solo las resoluciones que devuelve el backend; Audio comienza la preparación del formato seleccionado tras el análisis. M4A, WAV y FLAC permanecen en Ajustes y en las opciones secundarias de audio. No se inventan resoluciones ni porcentajes.

Se conservan acceso mediante cookie HttpOnly, progreso, recuperación del trabajo al recargar, cancelación y descarga por streaming autenticado. Ante un fallo de conexión se puede reanudar la consulta del mismo trabajo sin crear otro.

## Verificación

- 15 pruebas Node aprobadas, incluidas conversiones reales de un origen sintético a los cinco formatos con FFmpeg y comprobación de las rutas/MIME de los nuevos recursos.
- Prueba de navegador Chrome/Playwright: ambos temas, persistencia, preferencia del sistema, logos, autorización previa al análisis, resoluciones exactas, recuperación al recargar, cinco formatos y descarga HTTP autenticada. Se cubren navegación por teclado, validación de enlaces, cancelación y anchos de 320, 390, 768, 1024 y 1753 px.
- Inspección visual de capturas de escritorio, tablet y móvil, en claro y oscuro. Sin desbordamiento horizontal ni errores de JavaScript o recursos faltantes.
- Prueba real repetida con el enlace autorizado previamente suministrado (`LY43o01dkU4`): MP4 360p de 12 359 836 bytes y MP3 de 4 866 332 bytes. Ambos archivos se recuperaron desde la API y FFmpeg los decodificó completos. Informe en `docs/evidence/vydo-3.1-live-check.json`.

La prueba de navegador usa un motor simulado para cubrir estados de forma determinista; la prueba real de API se ejecuta por separado. No se afirma compatibilidad universal con YouTube.

## Archivos del cambio

| Archivo | Cambio |
| --- | --- |
| `public/index.html` | Nueva estructura minimalista, logos, barra integrada y diálogos |
| `public/style.css` | Diseño responsive, temas, ondas, foco y estados |
| `public/app.js` | Nuevo flujo visual sobre la API existente |
| `public/theme.js` | Selección y persistencia del tema antes del primer render |
| `public/LOGO_BLACK.webp`, `public/LOGO_WHITE.webp` | Logos originales sin modificaciones |
| `server.mjs` | Tres rutas estáticas y MIME WebP; API sin cambios |
| `scripts/ui-check.mjs` | Regresión visual y funcional ampliada |
| `tests/api.test.mjs` | Acceso a los nuevos recursos estáticos |
| `README.md`, `package.json`, este documento e informe JSON | Versión, instrucciones y evidencia |
