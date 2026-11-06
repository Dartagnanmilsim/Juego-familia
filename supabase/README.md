# Retos en familia: puesta en marcha

El juego (`index.html`) guarda familias, jugadores, retos, fotos y puntos en
**Supabase** (Postgres + almacenamiento de fotos + tiempo real). El plan gratuito alcanza de sobra para una familia.

## 1. Crear el proyecto
1. Entra en https://supabase.com y crea un proyecto nuevo (cualquier región cercana).
2. Abre **SQL Editor → New query**, pega el contenido de [`retos.sql`](retos.sql) y pulsa **Run**.
   Esto crea las tablas, las reglas, el bucket de fotos `retos-fotos` y activa el tiempo real.

## 2. Conectar la app
En **Project Settings → API** copia:
- **Project URL**
- **Publishable key** (o la clave *anon public*)

y pégalas en [`js/retos-config.js`](../js/retos-config.js):

```js
window.RETOS_CONFIG = {
  supabaseUrl: "https://xxxxxxxx.supabase.co",
  supabaseKey: "sb_publishable_..."
};
```

No pongas nunca la clave `service_role` / secret.

## 3. Jugar
1. Una persona abre **Retos en familia**, crea la familia y comparte el código (o el botón *Invitar*).
2. Cada miembro entra con el código y elige nombre y avatar.
3. Alguien lanza un reto: qué buscar (ej. 🐕 perros negros), cuántos (10) y la duración.
4. El reto aparece al instante en los móviles de todos. Cada vez que alguien encuentra uno pulsa **📸 ¡Encontré uno!** y hace la foto.
5. El primero que llega a la meta cierra el reto para todos. Si se acaba el tiempo, gana quien tenga más fotos.
   Puntos de cada reto: 1º 3 pts, 2º 2 pts y 3º 1 pt. La clasificación suma todos los retos.

## Reglas que aplica la base de datos
- Solo puede haber un reto activo por familia.
- Las fotos se registran con un bloqueo sobre el reto, así que si dos personas llegan a la meta casi a la vez solo gana la primera.
- Si se acaba el tiempo, ya no se aceptan más fotos.
- Cada jugador puede borrar sus propias fotos mientras el reto sigue activo, y quien creó el reto puede cancelarlo (en ese caso no se reparten puntos).
- La app solo puede leer las tablas. Todas las escrituras pasan por funciones SQL que comprueban las reglas.

## Limitaciones conocidas
- No hay cuentas con contraseña: el jugador se recuerda en cada móvil (localStorage), y el código de familia funciona como invitación.
  Quien tenga la clave pública de la web podría leer los datos, así que no subas nada privado. Más adelante se puede añadir inicio de sesión con Supabase Auth.
- Las fotos no se revisan automáticamente: la familia ve todas las fotos del reto en la galería.
