# Juego familia: Cacería en familia

Un juego en línea para toda la familia. Alguien lanza un reto, por ejemplo
**"el primero que encuentre 10 perros negros"**, y el reto aparece al instante
en el móvil de todos. Cada uno sale a buscar y hace una foto cada vez que encuentra uno.
El primero que llega a la meta cierra el reto y se lleva los puntos.

Tres módulos (pestañas abajo de la cabecera):

- **👥 Usuarios:** cada persona crea su usuario y clave (y puede crear usuarios para otros). Lista de jugadores y perfil.
- **🎯 Retos:** puede haber **varios retos a la vez**. Quien crea un reto elige si es **para todos** o **solo para algunos** jugadores, y elige un **juez**. El juez no compite: acepta ✅ o elimina 🗑️ las fotos.
  **Solo cuentan las fotos aceptadas por el juez.** Los competidores marcan las fotos de otros con 👍 aceptar o 🚩 denunciar
  para avisar al juez. Fotos solo en el momento, con la cámara del juego.
- **Avisos por WhatsApp:** al crear un reto aparece «Avisar por WhatsApp» con el mensaje ya escrito (reto, juez,
  participantes, hora de fin y enlace directo al reto). También se puede recordar un reto en marcha y compartir el resultado.
- **🏆 Torneos:** el administrador crea un torneo con su nombre y sus participantes. Reglas (se ven en la app y se
  comparten por WhatsApp): 1) cada participante propone **1 solo reto**; 2) solo empieza **1 reto por día** (si el día ya
  tiene reto, el aprobado se programa para el siguiente día libre a la hora de inicio); 3) un reto propuesto necesita
  **5 votos a favor** de otros participantes para empezar; si en 24 horas no los tiene se elimina y su autor puede
  proponer otro; 4) **podio por torneo** con la suma de puntos de sus retos.
  Cada torneo tiene **fecha de inicio y de fin** (los retos aprobados solo se programan dentro de esas fechas) y
  **premio para el campeón**, con premios opcionales para el 2.º y el 3.º. Al terminar se muestra el campeón y su premio.
  **Desempate** si hay los mismos puntos: 1) más fotos aceptadas; 2) menos denuncias recibidas (cuentan aunque el juez
  haya borrado la foto denunciada; si quien denunció cambia a 👍, deja de contar).
  Cada reto muestra su **configuración**: quién lo propuso, quién votó para aceptarlo, juez, duración, horario (desde/hasta) y quién compite.
- **⏰ Regla de horario:** los retos solo se pueden crear de 8:00 a 18:00 (hora de Colombia al principio). Fuera de ese
  horario el botón «Crear reto» se bloquea y la base de datos también lo impide. Los retos en marcha no se ven afectados.
  El administrador puede cambiar las horas y la zona horaria en «Reglas».
- **Zoom en la cámara:** pellizcar con dos dedos, botones 1×/2×/3×/5× o la barra. La foto sale con el zoom de la pantalla
  (zoom real del móvil si lo permite; si no, zoom digital recortando el centro).
- **Denuncias con motivo:** al denunciar una foto hay que decir por qué (motivos rápidos o texto propio, hasta 200
  caracteres). El juez y los jugadores ven debajo de la foto quién la denunció y por qué.
- **Almacenamiento:** al eliminar un reto, un usuario o una foto se borran también los archivos de las fotos, con la
  función de servidor `supabase/functions/limpiar-fotos` (Supabase Edge Function). El panel del administrador muestra
  cuánto ocupan las fotos y permite borrar las fotos sin usar.
- **🚔 Calabozo:** el juez de un reto (hasta 1 semana) o el administrador (hasta 30 días) puede mandar a alguien al
  calabozo **en un reto concreto**, con un delito obligatorio. En ese reto no puede hacer fotos, marcarlas ni denunciar;
  en los demás juega normal. Libertad anticipada: el administrador o el juez que lo encarceló.
- **🗳️ Libertad por el pueblo:** el preso puede poner su caso a votación una vez por condena (dura 1 hora). Votan todos
  menos el preso y quien lo encarceló. Con 5 votos a favor sale libre; si no, sigue preso.
- **🛡️ Administrador:** con clave (inicial **1234**, cámbiala en el panel). Elimina usuarios y retos y restablece claves.

Puntos de cada reto: 1.º 3 pts, 2.º 2 pts y 3.º 1 pt. Si se acaba el tiempo, gana quien tenga más fotos aceptadas.

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
1. Sigue [`supabase/README.md`](supabase/README.md). Para instalar desde el móvil usa `supabase/instalar.sql` (sin comentarios: funciona aunque al pegar se pierdan los saltos de línea): crea el proyecto, ejecuta `retos.sql` y rellena `js/retos-config.js`.
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
