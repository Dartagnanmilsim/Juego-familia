# Juego familia: Cacería en familia

Un juego en línea para toda la familia. Alguien lanza un reto, por ejemplo
**"el primero que encuentre 10 perros negros"**, y el reto aparece al instante
en el móvil de todos. Cada uno sale a buscar y hace una foto cada vez que encuentra uno.
El primero que llega a la meta cierra el reto y se lleva los puntos.

- El reto lo escribe quien lo crea: cualquier cosa que se pueda fotografiar (perros negros, gente con sombrero, señales de STOP…).
- Las fotos solo se hacen en el momento con la cámara del propio juego (visor en vivo). No se puede adjuntar nada desde la galería ni desde archivos.
  La primera vez el móvil pide permiso para usar la cámara: hay que aceptarlo.
- Se pueden crear jugadores desde la app, y varias personas pueden compartir un mismo móvil cambiando de jugador.
- Cualquier jugador puede borrar una foto que no aplique mientras el reto sigue en marcha, y deja de contar.
- **Administrador (👑):** quien crea la familia es administrador y puede nombrar a otros. Con su PIN puede
  cancelar cualquier reto o eliminar retos (activos o pasados, con sus fotos y puntos).
- Puntos de cada reto: 1.º 3 pts, 2.º 2 pts y 3.º 1 pt. La clasificación suma todos los retos.
- Si se acaba el tiempo, gana quien tenga más fotos.
- La familia ve la carrera en directo, la galería de fotos y el historial de retos.

El repositorio trae dos versiones del mismo juego.

## 1. App web con Supabase (raíz del repositorio)

| Archivo | Para qué sirve |
| --- | --- |
| `index.html`, `css/retos.css`, `js/retos.js` | La app |
| `js/retos-config.js` | Aquí van la URL y la clave pública de tu proyecto de Supabase |
| `js/vendor/supabase-2.45.4.js` | Cliente de Supabase incluido en el repositorio (no depende de un CDN) |
| `supabase/retos.sql` | Tablas, reglas, funciones, bucket de fotos y tiempo real |
| `supabase/README.md` | Pasos para configurar Supabase |

Para ponerla en marcha:
1. Sigue [`supabase/README.md`](supabase/README.md): crea el proyecto, ejecuta `retos.sql` y rellena `js/retos-config.js`.
2. Publica la web, por ejemplo con **GitHub Pages**: en el repositorio ve a *Settings → Pages* y elige esta rama y la carpeta `/ (root)`.
3. Abre la web. Una persona crea la familia y comparte el código o el enlace de invitación; los demás se unen con él.

Se puede jugar desde cualquier móvil, sin cuenta: cada móvil recuerda quién es el jugador.

## 2. Artifact de Claude (`artifact/caceria-en-familia.html`)

Es la misma idea como página publicada en claude.ai. Usa la base de datos, el
almacenamiento de fotos y la identidad que ofrece el propio artifact, así que
no necesita Supabase.

- Versión publicada: https://claude.ai/artifact/P3YSfdmDn2bYVbK7PDKAbr
- Este archivo es su código fuente. Solo funciona abierto dentro de claude.ai.
- Para que alguien juegue, comparte el artifact con su correo y permiso de **Editor**.
- Limitación: dentro de claude.ai la página no puede abrir un visor de cámara propio, así que el móvil decide si ofrece cámara o galería. Para exigir fotos en el momento, usa la versión web.
