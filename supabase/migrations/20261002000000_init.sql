-- Zesty Kitchen schema. Safe to run more than once.
-- Only the server (service_role / secret key) touches these tables; RLS stays on with no
-- public policies, so the publishable key can't read or write anything.

create table if not exists public.dishes (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_en text not null,
  description text not null default '',
  price numeric(10,2) not null check (price >= 0),
  category text not null,
  badges text[] not null default '{}',
  photo_path text,
  is_visible boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  dish_id uuid not null references public.dishes(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 40),
  chili_rating int not null check (chili_rating between 1 and 5),
  awkward_rating int not null check (awkward_rating between 1 and 5),
  body text not null check (char_length(body) between 1 and 500),
  reactions jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists reviews_dish_id_idx on public.reviews (dish_id, created_at desc);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number int generated always as identity (start with 1001),
  customer_name text not null,
  items jsonb not null,
  subtotal numeric(12,2) not null,
  fees jsonb not null,
  total numeric(12,2) not null,
  payment_method text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

create table if not exists public.settings (
  key text primary key,
  value jsonb
);

alter table public.dishes enable row level security;
alter table public.reviews enable row level security;
alter table public.orders enable row level security;
alter table public.settings enable row level security;

-- Atomic emoji counter so two people reacting at once don't overwrite each other
create or replace function public.react_to_review(review_id uuid, emoji text)
returns jsonb
language sql
set search_path = ''
as $$
  update public.reviews
     set reactions = jsonb_set(reactions, array[emoji], to_jsonb(coalesce((reactions ->> emoji)::int, 0) + 1))
   where id = review_id
  returning to_jsonb(reviews.*);
$$;

-- "Automatically expose new tables" is off, so grant the server role explicitly
grant usage on schema public to service_role;
grant select, insert, update, delete on public.dishes, public.reviews, public.orders, public.settings to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on function public.react_to_review(uuid, text) from public, anon, authenticated;
grant execute on function public.react_to_review(uuid, text) to service_role;

-- Public-read bucket for dish photos; uploads only happen through the server
insert into storage.buckets (id, name, public)
values ('dishes', 'dishes', true)
on conflict (id) do nothing;

-- Example dishes (only when the menu is empty). Mirrors src/db/seed.js.
insert into public.dishes (name_ar, name_en, description, price, category, badges, sort_order)
select * from (values
  ('مندي أحمد', 'Ahmed Mandi', 'Slow-cooked since the 9am standup. يسطا ده aura +1000. Comes with rice and unsolicited opinions.', 189, 'mandi', array['popular','chefs_pick'], 0),
  ('كفتة الـ HR', 'HR Kofta', 'Grilled in every 1:1. No cap, it''s giving… performance review.', 145, 'grills', array['spicy'], 1),
  ('شاورما الدراما', 'Drama Shawarma', 'Wrapped in gossip, extra garlic, zero chill. fr fr.', 99, 'shawarma', array['new'], 2),
  ('صينية التيم كله', 'The Whole Team Tray', 'The entire team on one tray. Serves 10, argues with 12.', 1350, 'trays', array[]::text[], 3),
  ('الإنترن المقرمش', 'Crispy Intern', 'Fresh, eager, slightly undercooked. Will make you coffee.', 35, 'appetizers', array['new'], 4),
  ('الزميل اللي سافر', 'The One Who Left', 'Expired. Still in the group chat though.', 0, 'expired', array['sold_out'], 5)
) as seed(name_ar, name_en, description, price, category, badges, sort_order)
where not exists (select 1 from public.dishes);
