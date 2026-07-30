-- =====================================================================
--  Pomodoro Fabri · esquema de base de datos
--  Pegá TODO esto en Supabase -> SQL Editor -> New query -> Run
-- =====================================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------- GRUPOS
create table if not exists public.groups (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  color               text not null default '#8b5cf6',
  parent_id           uuid references public.groups(id) on delete cascade,
  weekly_goal_minutes integer not null default 0,
  archived            boolean not null default false,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists groups_parent_idx on public.groups(parent_id);

-- ----------------------------------------------------------- SESIONES
create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid references public.groups(id) on delete set null,
  mode             text not null default 'focus',   -- focus | short | long
  started_at       timestamptz not null,
  ended_at         timestamptz not null,
  duration_seconds integer not null,
  note             text,
  local_date       date not null,
  created_at       timestamptz not null default now()
);
create index if not exists sessions_date_idx  on public.sessions(local_date);
create index if not exists sessions_group_idx on public.sessions(group_id);

-- -------------------------------------------------------------- SUEÑO
create table if not exists public.sleep_logs (
  id         uuid primary key default gen_random_uuid(),
  local_date date not null unique,
  bed_time   text,
  wake_time  text,
  hours      numeric,
  quality    integer,
  note       text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- RLS
-- App personal de un solo usuario: se habilita RLS con políticas abiertas
-- para la clave anon. Si algún día querés multiusuario, reemplazá estas
-- políticas por unas basadas en auth.uid().
alter table public.groups     enable row level security;
alter table public.sessions   enable row level security;
alter table public.sleep_logs enable row level security;

drop policy if exists "open groups"     on public.groups;
drop policy if exists "open sessions"   on public.sessions;
drop policy if exists "open sleep_logs" on public.sleep_logs;

create policy "open groups"     on public.groups     for all using (true) with check (true);
create policy "open sessions"   on public.sessions   for all using (true) with check (true);
create policy "open sleep_logs" on public.sleep_logs for all using (true) with check (true);
