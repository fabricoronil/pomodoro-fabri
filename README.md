# Pomodoro Fabri

Timer pomodoro con analítica de estudio, grupos/subgrupos, metas semanales y control de sueño.
Next.js 14 + Tailwind + Supabase. Pensado para hostear en Vercel y abrir desde cualquier dispositivo.

---

## Qué hace

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
4. Andá a **Settings → API** y copiá dos cosas:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

> La app es de un solo usuario (vos), así que las políticas de RLS del script son abiertas para la clave anon.
> No pongas datos sensibles ahí. Si algún día querés login, hay que reemplazar esas políticas por unas basadas en `auth.uid()`.

---

## 2. Probarla en tu compu

```bash
npm install
cp .env.local.example .env.local   # y pegá tus dos claves adentro
npm run dev
```

Abrí <http://localhost:3000>.

> Si no configurás Supabase, la app igual funciona: guarda todo en el navegador (localStorage).
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
  Timer.jsx         pomodoro, selección de grupo, notas
  Analytics.jsx     resumen, comparar fechas, sueño vs estudio, sesiones
  Sleep.jsx         registro y gráficos de sueño
  GroupsManager.jsx alta/edición de grupos, subgrupos y metas
  Settings.jsx      duraciones, alertas, export/import
  Appearance.jsx    temas, colores y fondo (sección Apariencia)
  ui.jsx            piezas compartidas
lib/
  db.js             capa de datos (Supabase o localStorage)
  supabase.js       cliente
  utils.js          fechas, formatos, correlación
  theme.js          presets, derivación de paleta y aplicación del tema
supabase-schema.sql esquema de la base
```

## Atajos

- **Espacio**: iniciar / pausar
- **R**: reiniciar el bloque actual
