-- Extra funny fields for dishes. Safe to run more than once.
alter table public.dishes add column if not exists job_title text not null default '';
alter table public.dishes add column if not exists catchphrase text not null default '';
alter table public.dishes add column if not exists warnings text not null default '';
alter table public.dishes add column if not exists spice_level int not null default 3 check (spice_level between 1 and 5);
alter table public.dishes add column if not exists calories int not null default 0 check (calories between 0 and 999999);
alter table public.dishes alter column name_en set default '';
