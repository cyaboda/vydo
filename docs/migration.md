# Diagnóstico y migración a vydo 3.0

Base examinada: `main`, commit `521e6e1e11aaa844c7aea21cd7cb63ed2993cf51`.

Se revisaron todos los archivos versionados antes de modificar código. No había instrucciones AGENTS.md. Se ejecutaron las seis pruebas existentes y pasaron.

## Diagnóstico previo

| Área | Hallazgo | Decisión |
| --- | --- | --- |
| `site/` | Interfaz estática para Pages, tres formatos, progreso estimado | Recuperar consentimiento y flujo; retirar duplicación |
| `worker/` | Proxy RapidAPI con host supuesto, validador duplicado | Eliminar integración comercial y sus pruebas duplicadas |
| `public/` | Interfaz para servidor local, cinco formatos, sin metadatos | Mantener como única raíz web y rediseñar |
| `server.mjs` | Motor yt-dlp útil, cola de un trabajo, tokens y TTL; sin progreso real | Separar motor y ciclo de vida; conservar patrón de servidor nativo |
| `lib.mjs` | Validación estricta de URLs y comparación constante | Preservar; añadir consentimiento y resoluciones explícitas |
| FFmpeg | Comprobado con `--version`, opción incorrecta | Usar `-version` y probar conversiones reales |
| Resolución MP4 | Selector `height<=...` podía bajar de calidad sin informarlo | Ofrecer alturas exactas analizadas y fallar si dejan de estar disponibles |
| Docker | Ejecutaba como root, yt-dlp sin fijar versión | Usuario sin privilegios, versiones Python fijadas, límites Compose |
| README | Describía exclusivamente Pages/Worker/RapidAPI | Reemplazar por instrucciones coherentes con el motor local |
| Pruebas | Solo validadores, ninguna conversión/API/ciclo de vida | Añadir API, procesos, cancelación, limpieza, navegador y FFmpeg |

## Plan presentado antes de implementar

1. Consolidar `public/` + Node, retirar `site/` y `worker/`.
2. Separar ejecución de medios en `engine.mjs` y cola/archivos en `jobs.mjs`.
3. Añadir metadatos seguros, disponibilidad exacta y progreso por fase.
4. Implementar la interfaz responsive de marca `vydo`, acceso y descarga autenticada.
5. Validar con pruebas automatizadas y descarga real autorizada, y entregar mediante rama y PR.

## Arquitectura resultante

```text
Navegador ── mismo origen / cookie HttpOnly ── server.mjs
                                              ├── lib.mjs: validación / tokens
                                              ├── engine.mjs: yt-dlp → FFmpeg
                                              └── jobs.mjs: cola → directorio temporal → TTL
```

La vista previa contiene solo título, miniatura permitida, duración y capacidades. No entrega los metadatos completos ni URLs temporales de medios. La API liga cada trabajo a una vista previa y a su propietario. Los clientes con token de API pertenecen a un propietario compartido; las sesiones del navegador están aisladas.

Se mantiene un solo proceso de aplicación por instancia. Para escalar se necesitarían una cola y almacenamiento compartidos, cuentas y cuotas por usuario; esa arquitectura distribuida queda fuera de esta primera versión. No se ha contratado ni desplegado ningún servicio.
