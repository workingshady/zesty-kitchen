-- Arcade leaderboard: players claim a nickname with a PIN (no accounts), scores per game.
create table if not exists public.game_players (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  nickname_key text not null unique,
  pin_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.game_scores (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.game_players(id) on delete cascade,
  game text not null,
  score int not null check (score >= 0),
  character text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists game_scores_game_score_idx on public.game_scores (game, score desc);

alter table public.game_players enable row level security;
alter table public.game_scores enable row level security;
grant select, insert, update, delete on public.game_players, public.game_scores to service_role;
