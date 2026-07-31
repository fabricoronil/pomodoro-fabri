-- Meta de sueño por usuario (antes estaba clavada en 8 h en el front).
-- Es aditiva y idempotente: se puede correr sobre una base ya andando.
alter table public.user_settings
  add column if not exists sleep_goal_hours numeric not null default 8;
