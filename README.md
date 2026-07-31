# Pomodoro Fabri

Timer pomodoro con analítica de estudio, grupos/subgrupos, metas semanales y control de sueño.
Next.js 14 + Tailwind + Supabase. Pensado para hostear en Vercel y abrir desde cualquier dispositivo.

---

## Qué hace

- **Cuenta propia**: registro e inicio de sesión con email y contraseña. Cada cuenta ve solo sus datos.
- **Timer que no se corta**: el pomodoro vive en tu cuenta, no en el navegador. Lo arrancás en la compu, abrís el celular y sigue exactamente igual. Podés cerrar la web: al volver, si el bloque ya había terminado, la sesión queda guardada sola. **Solo se detiene si lo cancelás.**
- **Timer**: enfoque / descanso corto / descanso largo, configurables. Sigue corriendo si refrescás la pestaña.
- **Grupos y subgrupos**: ya vienen cargados *Facultad* (Física II, Paradigma y Lenguaje de Programación II, Portugués A, Sistema de Representación, Sistemas Operativos), *Inglés* y *Personal*. Podés agregar, editar y borrar los que quieras.
- **Notas por sesión**: al terminar un pomodoro te pregunta qué hiciste.
- **Metas semanales** por grupo, con barra de progreso.
- **Analítica**: día / semana / mes / año, con navegación entre períodos y comparación automática contra el período anterior.
- **Comparar fechas**: dos rangos libres (A vs B) con presets rápidos.
- **Sueño**: a qué hora te acostaste y te despertaste, promedio de 7 días, deuda de sueño y racha.
- **Sueño vs productividad**: correlación de Pearson + cuántas horas estudiás según cuánto dormiste.
- **Sonido y notificaciones** del navegador al terminar cada bloque.
- **Avisos con la web cerrada**: notificaciones push reales. Arrancás un pomodoro, cerrás todo, y el celular te avisa igual cuando termina. Se activa por dispositivo desde *Ajustes*.
- **Ajustes sincronizados**: duraciones, comportamiento, alertas y tema viven en tu cuenta, no en el navegador.
- **Apariencia**: 8 temas listos (claros y oscuros), colores editables uno por uno y 8 estilos de fondo, incluida una imagen propia con desenfoque y oscurecido.
- **Export / import** de todos tus datos en JSON.

---

## 1. Crear la base en Supabase

1. Entrá a <https://supabase.com>, creá una cuenta y un proyecto nuevo (plan gratis).
2. En el menú lateral: **SQL Editor → New query**.
3. Copiá y pegá **todo** el contenido de `supabase-schema.sql` y apretá **Run**.
   (Se puede correr de nuevo sin romper nada: sirve para una base nueva y para actualizar una vieja.)
4. **Authentication → Providers → Email**: dejalo activado.
   Para uso personal conviene **desactivar "Confirm email"**, así entrás sin pasar por el correo.
5. **Database → Replication** (o *Realtime*): asegurate de que la tabla `active_timer` esté publicada.
   El script ya la agrega; esto es solo para confirmarlo. Si no lo está, la app igual sincroniza
   (revisa el estado al volver a la pestaña y cada 20 segundos), pero tarda un poco más.
6. Andá a **Settings → API** y copiá dos cosas:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

> Cada fila lleva `user_id` y las políticas de RLS son `user_id = auth.uid()`: nadie ve los datos de otro,
> aunque tenga la clave anon.

### Si ya tenías datos de la versión sin cuentas

Con RLS por usuario, las filas viejas (con `user_id` vacío) quedan invisibles hasta que las adoptes:

1. Registrate en la app.
2. Copiá tu id en **Authentication → Users → (tu usuario)**.
3. En el SQL Editor corré las tres líneas comentadas al final de `supabase-schema.sql` con ese id.

Si en cambio venías usando la app en **modo local** (sin Supabase), entrá con tu cuenta y andá a
**Ajustes → Datos**: aparece el botón *"Subirlos a mi cuenta"* con lo que había en ese navegador.

---

## 2. Avisos push con la web cerrada

Esto es opcional: si lo salteás, la app funciona igual (el pomodoro sigue corriendo con la web
cerrada y la sesión se guarda), pero el aviso solo suena si tenés la página abierta.

### 2.1 Generar las claves VAPID

Son el par de claves con el que el servidor firma los avisos. Se generan una sola vez:

```bash
node scripts/vapid.mjs
```

Imprime tres líneas. La **pública** va al front, la **privada** a Supabase. La privada no se
sube al repo nunca.

> Si más adelante rotás las claves, todas las suscripciones viejas dejan de servir:
> vaciá `push_subscriptions` y volvé a activarlo en cada dispositivo.

### 2.2 Cargar los secretos

En el front (`.env.local`, y también en Vercel):

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=B...      # la pública
```

En Supabase (necesitás el CLI: `npm i -g supabase`, después `supabase login` y `supabase link`):

```bash
supabase secrets set VAPID_PUBLIC_KEY=B...
supabase secrets set VAPID_PRIVATE_KEY=...
supabase secrets set VAPID_SUBJECT=mailto:tu@email.com
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya vienen dadas dentro de las Edge Functions: no hay
que cargarlas. La **service role key** sí la vas a necesitar en el paso 2.4 (está en
*Settings → API → service_role*). **Nunca** la pongas en el front.

### 2.3 Deployar la Edge Function

```bash
supabase functions deploy notify-timers
```

Podés probarla a mano (tiene que responder un JSON con el resumen):

```bash
curl -i -X POST "https://TU-REF.supabase.co/functions/v1/notify-timers" \
  -H "Authorization: Bearer TU-SERVICE-ROLE-KEY"
```

### 2.4 Programar el cron

En el SQL Editor de Supabase, primero las extensiones (ya están en `supabase-schema.sql`):

```sql
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;
```

Y después el job (está comentado al final de `supabase-schema.sql`, reemplazá los dos placeholders):

```sql
select cron.schedule(
  'notify-timers',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := 'https://TU-REF.supabase.co/functions/v1/notify-timers',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer TU-SERVICE-ROLE-KEY'
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 25000
    );
  $cron$
);
```

Para ver si corre: `select * from cron.job_run_details order by start_time desc limit 20;`
Para apagarlo: `select cron.unschedule('notify-timers');`

### 2.5 Activarlo en cada dispositivo

Abrí la app → **Ajustes** → *Avisarme aunque la web esté cerrada* → **Activar en este dispositivo**.
Hay que hacerlo una vez por dispositivo; el aviso después llega a todos.

- **Requiere HTTPS** (o `localhost`). En una IP de red local sin certificado no funciona.
- **iPhone/iPad**: solo desde **iOS 16.4** y con la app **agregada a la pantalla de inicio**
  (Safari → compartir → *Agregar a inicio*). Desde la pestaña normal de Safari no se puede.

### Cuánto tarda el aviso

**Hasta ~60 segundos.** El cron corre una vez por minuto y `pg_cron` no baja de ese intervalo, así
que un pomodoro que termina a las 10:00:05 se avisa en la corrida de las 10:01:00.

Lo que **no** se atrasa es el registro: la sesión se guarda con `ends_at`, la hora real en la que
terminó el bloque, no con la hora en que corrió el cron. Los números de la analítica quedan exactos.

Si querés precisión al segundo hay que dejar de usar cron y pasar a un scheduler que dispare en el
instante exacto (un worker con timers, o una cola con delay tipo QStash / pg_boss). Es otra
infraestructura y otro costo; con el aviso a "hasta un minuto" el pomodoro funciona bien.

---

## 3. Probarla en tu compu

```bash
npm install
cp .env.local.example .env.local   # y pegá tus claves adentro
npm run dev
```

Abrí <http://localhost:3000>.

La primera vez te va a pedir **crear una cuenta**. Después queda la sesión iniciada en ese dispositivo.

> Si no configurás Supabase, la app igual funciona sin cuentas: guarda todo en el navegador
> (localStorage) y el timer sobrevive a los refrescos, pero no se comparte entre dispositivos.
> En **Ajustes** vas a ver un cartel que te dice en qué modo estás.

---

## 4. Subirla a Vercel

**Opción A — con GitHub (recomendada, así podés seguir editándola)**

1. Creá un repo en GitHub y subí esta carpeta:
   ```bash
   git init
   git add .
   git commit -m "pomodoro"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/pomodoro-fabri.git
   git push -u origin main
   ```
2. Entrá a <https://vercel.com> → **Add New → Project** → importá el repo.
3. En **Environment Variables** agregá las tres:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (si querés los avisos con la web cerrada)
4. **Deploy**. En ~1 minuto tenés tu URL.

**Opción B — sin GitHub**

```bash
npm i -g vercel
vercel
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY
vercel --prod
```

> Importante: si agregás o cambiás variables de entorno después del primer deploy, hay que **redeployar** para que tomen efecto.

En el celular, abrí la URL y usá "Agregar a pantalla de inicio" para que quede como una app.

---

## Estructura

```
app/
  layout.jsx        metadata y estilos globales
  page.jsx          shell: header, pestañas, estado compartido
  globals.css       variables del tema, fondos y clases base
components/
  Welcome.jsx       animación de entrada "Bienvenido Fabri"
  Auth.jsx          registro / inicio de sesión
  Timer.jsx         pomodoro sincronizado, selección de grupo, notas
  Analytics.jsx     resumen, comparar fechas, sueño vs estudio, sesiones
  Sleep.jsx         registro y gráficos de sueño
  GroupsManager.jsx alta/edición de grupos, subgrupos y metas
  Settings.jsx      duraciones, alertas, export/import
  PushCard.jsx      "avisarme aunque la web esté cerrada"
  Appearance.jsx    temas, colores y fondo (sección Apariencia)
  ui.jsx            piezas compartidas
lib/
  db.js             capa de datos (Supabase o localStorage) + ajustes sincronizados
  supabase.js       cliente
  auth.jsx          sesión de usuario (registro, login, logout)
  timerSync.js      el pomodoro en curso: nube + copia local
  push.js           suscripción a los avisos push (API del navegador, sin dependencias)
  utils.js          fechas, formatos, correlación
  theme.js          presets, derivación de paleta y aplicación del tema
public/
  sw.js             service worker: recibe el push con la web cerrada
scripts/
  vapid.mjs         genera el par de claves VAPID
supabase/
  functions/notify-timers/index.ts   el que mira el reloj del lado del servidor
supabase-schema.sql esquema de la base
```

## Cómo hace para no cortarse

Mientras corre, el timer **no guarda "segundos restantes"**: guarda en la base el instante en que
termina (`ends_at`). Cualquier dispositivo que abra la app mira el reloj y resta, así que todos ven
el mismo número sin hablar entre ellos. Si el bloque vence con la web cerrada, el primero que vuelve
lo detecta, registra la sesión con la hora real en la que terminó y pasa al descanso. Cuando hay
varios dispositivos abiertos, el cierre se reclama con un update condicional: gana uno solo y la
sesión nunca se guarda dos veces.

## Cómo hace para avisarte con la web cerrada

Una vez por minuto, un `pg_cron` despierta a la Edge Function `notify-timers`. Esa función busca las
filas de `active_timer` con `status='running'` y `ends_at <= now()`, y por cada una:

1. **Reclama el bloque** con el mismo UPDATE condicional que usa el cliente
   (`status='running' AND ends_at = <ese mismo valor>`). Si vos tenías la web abierta y el cliente
   llegó primero, acá no entra ninguna fila y el servidor se va sin hacer nada: ni sesión duplicada
   ni notificación de más. Es literalmente el mismo candado en los dos lados.
2. **Guarda la sesión** con `ended_at = ends_at` (la hora real del final) y `local_date` calculado en
   tu zona horaria, que el front guarda en `user_settings.time_zone`.
3. **Avanza al descanso** aplicando tus reglas de `user_settings` (duraciones, "descanso largo cada
   N", auto-start). Por eso los ajustes tuvieron que dejar de vivir solo en el navegador: si el
   servidor no los conoce, no puede saber qué bloque viene después.
4. **Manda el push** a todas las suscripciones de tu cuenta. El service worker, antes de mostrarlo,
   revisa si hay alguna ventana visible: si la app está a la vista no muestra nada, porque la página
   ya te avisó con el sonido. Los endpoints que devuelven 404/410 se borran solos.

El cronómetro **libre** queda afuera de todo esto: no tiene `ends_at`, no se notifica y no se cierra
nunca. **Cancelar** tampoco dispara nada: deja `status='idle'` y `ends_at` en `null`, así que la
consulta ni lo ve.

## Atajos

- **Espacio**: iniciar / pausar
- **R**: cancelar el bloque actual
