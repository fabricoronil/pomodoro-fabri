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

## 2. Probarla en tu compu

```bash
npm install
cp .env.local.example .env.local   # y pegá tus dos claves adentro
npm run dev
```

Abrí <http://localhost:3000>.

La primera vez te va a pedir **crear una cuenta**. Después queda la sesión iniciada en ese dispositivo.

> Si no configurás Supabase, la app igual funciona sin cuentas: guarda todo en el navegador
> (localStorage) y el timer sobrevive a los refrescos, pero no se comparte entre dispositivos.
> En **Ajustes** vas a ver un cartel que te dice en qué modo estás.

---

## 3. Subirla a Vercel

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
3. En **Environment Variables** agregá las dos:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. **Deploy**. En ~1 minuto tenés tu URL.

**Opción B — sin GitHub**

```bash
npm i -g vercel
vercel
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
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
  Appearance.jsx    temas, colores y fondo (sección Apariencia)
  ui.jsx            piezas compartidas
lib/
  db.js             capa de datos (Supabase o localStorage)
  supabase.js       cliente
  auth.jsx          sesión de usuario (registro, login, logout)
  timerSync.js      el pomodoro en curso: nube + copia local
  utils.js          fechas, formatos, correlación
  theme.js          presets, derivación de paleta y aplicación del tema
supabase-schema.sql esquema de la base
```

## Cómo hace para no cortarse

Mientras corre, el timer **no guarda "segundos restantes"**: guarda en la base el instante en que
termina (`ends_at`). Cualquier dispositivo que abra la app mira el reloj y resta, así que todos ven
el mismo número sin hablar entre ellos. Si el bloque vence con la web cerrada, el primero que vuelve
lo detecta, registra la sesión con la hora real en la que terminó y pasa al descanso. Cuando hay
varios dispositivos abiertos, el cierre se reclama con un update condicional: gana uno solo y la
sesión nunca se guarda dos veces.

Lo único que no puede pasar con la web cerrada es el **sonido y la notificación** del final: para eso
el navegador necesita tener la página abierta (aunque sea en otra pestaña). El tiempo y la sesión no
se pierden igual.

## Atajos

- **Espacio**: iniciar / pausar
- **R**: cancelar el bloque actual
