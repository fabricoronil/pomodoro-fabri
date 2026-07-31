-- Tipos de actividad y objetivos por grupo.
--
--  kind                -> productivo | cuerpo | despeje
--  goal_type           -> meta (mínimo a alcanzar) | limite (máximo a no pasar)
--  daily_goal_minutes  -> el mismo objetivo pero por día (0 = sin objetivo)
--
-- Aditiva e idempotente: se puede correr sobre una base ya andando. Los grupos
-- que ya existían quedan como "productivo" con meta, que es como se comportaban
-- hasta ahora.
alter table public.groups
  add column if not exists kind text not null default 'productivo';
alter table public.groups
  add column if not exists goal_type text not null default 'meta';
alter table public.groups
  add column if not exists daily_goal_minutes integer not null default 0;

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
