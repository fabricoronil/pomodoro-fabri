-- =====================================================================
--  Pomodoro Fabri · esquema de base de datos (multiusuario + timer en la nube)
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
create table if not exists public.groups (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade default auth.uid(),
  name                text not null,
  color               text not null default '#8b5cf6',
  parent_id           uuid references public.groups(id) on delete cascade,
  weekly_goal_minutes integer not null default 0,
  archived            boolean not null default false,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);
alter table public.groups
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.groups alter column user_id set default auth.uid();
create index if not exists groups_parent_idx on public.groups(parent_id);
create index if not exists groups_user_idx   on public.groups(user_id);

-- ----------------------------------------------------------- SESIONES
create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade default auth.uid(),
  group_id         uuid references public.groups(id) on delete set null,
  mode             text not null default 'focus',   -- focus | short | long
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

-- ----------------------------------------------------------------- RLS
alter table public.groups       enable row level security;
alter table public.sessions     enable row level security;
alter table public.sleep_logs   enable row level security;
alter table public.active_timer enable row level security;

-- Fuera las políticas abiertas de la versión de un solo usuario
drop policy if exists "open groups"     on public.groups;
drop policy if exists "open sessions"   on public.sessions;
drop policy if exists "open sleep_logs" on public.sleep_logs;

drop policy if exists "own groups"       on public.groups;
drop policy if exists "own sessions"     on public.sessions;
drop policy if exists "own sleep_logs"   on public.sleep_logs;
drop policy if exists "own active_timer" on public.active_timer;

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
