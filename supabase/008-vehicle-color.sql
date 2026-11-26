-- TrailLink: a color badge for each vehicle in the Garage (the rider's choice). Safe to run more than once.
alter table public.vehicles add column if not exists color text check (color ~ '^#[0-9A-Fa-f]{6}$');
