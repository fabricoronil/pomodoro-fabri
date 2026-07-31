-- =====================================================================
--  Pomodoro · esquema de base de datos (multiusuario + timer en la nube)
--  Pegá TODO esto en Supabase -> SQL Editor -> New query -> Run
--
--  Se puede correr en una base nueva o sobre una que ya tenía la versión
--  anterior (de un solo usuario): todo es idempotente.
--
--  Después de correrlo:
--    1. Supabase -> Authentication -> Providers -> Email: activado.
--       (Para uso personal conviene desactivar "Confirm email" así entrás
--        sin pasar por el mail.)
--    2. Si YA tenías datos de la versión sin cuentas, mirá el bloque
--       "ADOPTAR DATOS VIEJOS" al final del archivo.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------- GRUPOS
--  kind      : qué clase de tiempo es. 'productivo' (estudio, trabajo),
--              'cuerpo' (gym, deporte) o 'despeje' (juegos, series, ocio).
--              Vive en el grupo raíz; los subgrupos heredan el del padre.
--  goal_type : 'meta' es un mínimo a alcanzar y 'limite' un máximo a no pasar.
--              Así el mismo objetivo sirve para empujar el gimnasio hacia
--              arriba y para tener a raya las horas de juego.
create table if not exists public.groups (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade default auth.uid(),
  name                text not null,
  color               text not null default '#8b5cf6',
  parent_id           uuid references public.groups(id) on delete cascade,
  kind                text not null default 'productivo',
  goal_type           text not null default 'meta',
  weekly_goal_minutes integer not null default 0,
  daily_goal_minutes  integer not null default 0,
  archived            boolean not null default false,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);
alter table public.groups
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.groups alter column user_id set default auth.uid();
alter table public.groups
  add column if not exists kind text not null default 'productivo';
alter table public.groups
  add column if not exists goal_type text not null default 'meta';
alter table public.groups
  add column if not exists daily_goal_minutes integer not null default 0;
create index if not exists groups_parent_idx on public.groups(parent_id);
create index if not exists groups_user_idx   on public.groups(user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.groups'::regclass and conname = 'groups_kind_check'
  ) then
    alter table public.groups
      add constraint groups_kind_check check (kind in ('productivo', 'cuerpo', 'despeje'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.groups'::regclass and conname = 'groups_goal_type_check'
  ) then
    alter table public.groups
      add constraint groups_goal_type_check check (goal_type in ('meta', 'limite'));
  end if;
end $$;

-- ----------------------------------------------------------- SESIONES
create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade default auth.uid(),
  group_id         uuid references public.groups(id) on delete set null,
  mode             text not null default 'focus',   -- focus | short | long | manual
  started_at       timestamptz not null,
  ended_at         timestamptz not null,
  duration_seconds integer not null,
  note             text,
  local_date       date not null,
  created_at       timestamptz not null default now()
);
alter table public.sessions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.sessions alter column user_id set default auth.uid();
create index if not exists sessions_date_idx  on public.sessions(local_date);
create index if not exists sessions_group_idx on public.sessions(group_id);
create index if not exists sessions_user_idx  on public.sessions(user_id, local_date);

-- -------------------------------------------------------------- SUEÑO
create table if not exists public.sleep_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade default auth.uid(),
  local_date date not null,
  bed_time   text,
  wake_time  text,
  hours      numeric,
  quality    integer,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.sleep_logs
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.sleep_logs alter column user_id set default auth.uid();

-- El "una fila por día" ahora es por usuario, no global.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.sleep_logs'::regclass
      and contype = 'u'
      and conname <> 'sleep_logs_user_date_key'
  loop
    execute format('alter table public.sleep_logs drop constraint %I', c.conname);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sleep_logs'::regclass and conname = 'sleep_logs_user_date_key'
  ) then
    alter table public.sleep_logs
      add constraint sleep_logs_user_date_key unique (user_id, local_date);
  end if;
end $$;

-- ------------------------------------------------------- TIMER ACTIVO
--  Una fila por usuario. Es la fuente de verdad del pomodoro en curso:
--  mientras corre no guarda "segundos restantes", guarda CUÁNDO TERMINA.
--  Por eso el timer sigue corriendo aunque cierres la web o cambies de
--  dispositivo: el tiempo lo pone el reloj, no el navegador.
create table if not exists public.active_timer (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  status            text not null default 'idle',      -- idle | running | paused
  mode              text not null default 'focus',     -- focus | short | long
  free_mode         boolean not null default false,    -- cronómetro libre (cuenta para arriba)
  group_id          uuid references public.groups(id) on delete set null,
  sub_group_id      uuid references public.groups(id) on delete set null,
  started_at        timestamptz,   -- inicio real del bloque (para la sesión guardada)
  ends_at           timestamptz,   -- fin previsto (cuenta regresiva corriendo)
  remaining_seconds numeric,       -- lo que quedaba al pausar
  duration_seconds  integer,       -- duración total del bloque en curso
  elapsed_seconds   numeric not null default 0,  -- modo libre: acumulado al pausar
  run_start         timestamptz,   -- modo libre: cuándo arrancó el tramo actual
  cycle             integer not null default 0,
  device_id         text,          -- quién escribió último (para ignorar el propio eco)
  updated_at        timestamptz not null default now()
);

--  Cuándo se mandó el aviso push del bloque en curso. Sirve para que el cron
--  no re-mande la notificación en cada corrida: como se compara contra
--  ends_at (que siempre está en el futuro cuando arranca un bloque nuevo),
--  cada bloque avisa exactamente una vez.
alter table public.active_timer
  add column if not exists notified_at timestamptz;

-- --------------------------------------------------------- PREFERENCIAS
--  Una fila por usuario. Antes esto vivía solo en localStorage, pero el
--  servidor necesita saber las duraciones y el "descanso largo cada N" para
--  poder cerrar el bloque y decidir qué viene después cuando la web está
--  cerrada. De paso, los ajustes ahora te siguen entre dispositivos.
--
--  time_zone es la zona horaria del navegador (Intl…resolvedOptions()). El
--  servidor la usa para calcular local_date igual que lo haría el cliente:
--  sin esto, un pomodoro que termina a las 21:30 de Argentina quedaría
--  guardado al día siguiente (UTC).
create table if not exists public.user_settings (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  focus_min          integer not null default 25,
  short_min          integer not null default 5,
  long_min           integer not null default 15,
  long_every         integer not null default 4,
  auto_start_breaks  boolean not null default true,
  auto_start_focus   boolean not null default false,
  sound              boolean not null default true,
  volume             numeric not null default 0.5,
  notifications      boolean not null default true,
  ask_note           boolean not null default true,
  sleep_goal_hours   numeric not null default 8,
  theme              jsonb   not null default '{}'::jsonb,
  time_zone          text,
  updated_at         timestamptz not null default now()
);
alter table public.user_settings add column if not exists time_zone text;
alter table public.user_settings add column if not exists theme jsonb not null default '{}'::jsonb;
alter table public.user_settings add column if not exists sleep_goal_hours numeric not null default 8;

-- --------------------------------------------------- SUSCRIPCIONES PUSH
--  Un usuario puede tener varios dispositivos suscriptos: el aviso se manda
--  a todos. El endpoint es único (lo genera el navegador), así que si te
--  volvés a suscribir en el mismo dispositivo se pisa la fila en vez de
--  duplicarla. Si un endpoint deja de existir (404/410), el cron la borra.
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  device_id  text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subscriptions(user_id);

-- ----------------------------------------------------------------- RLS
alter table public.groups             enable row level security;
alter table public.sessions           enable row level security;
alter table public.sleep_logs         enable row level security;
alter table public.active_timer       enable row level security;
alter table public.user_settings      enable row level security;
alter table public.push_subscriptions enable row level security;

-- Fuera las políticas abiertas de la versión de un solo usuario
drop policy if exists "open groups"     on public.groups;
drop policy if exists "open sessions"   on public.sessions;
drop policy if exists "open sleep_logs" on public.sleep_logs;

drop policy if exists "own groups"       on public.groups;
drop policy if exists "own sessions"     on public.sessions;
drop policy if exists "own sleep_logs"   on public.sleep_logs;
drop policy if exists "own active_timer" on public.active_timer;
drop policy if exists "own user_settings"      on public.user_settings;
drop policy if exists "own push_subscriptions" on public.push_subscriptions;

create policy "own groups" on public.groups
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own sessions" on public.sessions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own sleep_logs" on public.sleep_logs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own active_timer" on public.active_timer
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own user_settings" on public.user_settings
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own push_subscriptions" on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------ REALTIME
--  Para que el timer se refleje al toque en los otros dispositivos.
do $$
begin
  begin
    alter publication supabase_realtime add table public.active_timer;
  exception
    when duplicate_object then null;
    when undefined_object then null;  -- no existe la publicación: se ignora
  end;
end $$;

-- =====================================================================
--  AVISOS PUSH CON LA WEB CERRADA  ·  cron que despierta a notify-timers
--
--  El navegador no puede avisar nada si no está abierto, así que el que
--  mira el reloj es el servidor: cada minuto una Edge Function busca los
--  bloques vencidos, los cierra igual que lo haría el cliente y manda el
--  push a todos los dispositivos suscriptos.
--
--  RETRASO MÁXIMO: ~60 segundos (el cron corre cada minuto y no puede
--  correr más seguido). En la práctica el aviso llega entre 0 y 60 s
--  después de que el pomodoro termina. La sesión, en cambio, siempre queda
--  guardada con la hora real de fin (ends_at), no con la hora del aviso.
--
--  Antes de correr esto:
--    1. Deployá la function:  supabase functions deploy notify-timers
--    2. Cargá los secretos VAPID (ver README).
--  Después reemplazá TU-REF y TU-SERVICE-ROLE-KEY abajo y descomentá.
-- =====================================================================

--  Se instalan sin abortar el script: si tu plan o tus permisos no las
--  habilitan, el resto del esquema (que es lo que hace andar la app) igual
--  queda aplicado. Sin estas dos no hay avisos push, nada más.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron no se pudo instalar: %', sqlerrm;
  end;
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net no se pudo instalar: %', sqlerrm;
  end;
end $$;

-- Volver a programarlo es seguro: primero se borra el job anterior si existe.
--
--  do $$
--  begin
--    perform cron.unschedule('notify-timers');
--  exception when others then null;
--  end $$;
--
--  select cron.schedule(
--    'notify-timers',
--    '* * * * *',                      -- cada minuto
--    $cron$
--      select net.http_post(
--        url     := 'https://TU-REF.supabase.co/functions/v1/notify-timers',
--        headers := jsonb_build_object(
--                     'Content-Type',  'application/json',
--                     'Authorization', 'Bearer TU-SERVICE-ROLE-KEY'
--                   ),
--        body    := '{}'::jsonb,
--        timeout_milliseconds := 25000
--      );
--    $cron$
--  );

-- Para ver si está corriendo:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
-- Para apagarlo:
--   select cron.unschedule('notify-timers');

-- =====================================================================
--  ADOPTAR DATOS VIEJOS  (solo si ya usabas la versión sin cuentas)
--  Con RLS por usuario, las filas con user_id NULL quedan invisibles.
--    1. Registrate en la app.
--    2. Copiá tu id en Supabase -> Authentication -> Users -> (tu usuario).
--    3. Descomentá estas tres líneas con tu id y corrélas:
--
--  update public.groups     set user_id = 'PEGA-TU-USER-ID' where user_id is null;
--  update public.sessions   set user_id = 'PEGA-TU-USER-ID' where user_id is null;
--  update public.sleep_logs set user_id = 'PEGA-TU-USER-ID' where user_id is null;
-- =====================================================================
