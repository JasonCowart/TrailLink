-- TrailLink: campsite pins (shared with the ride group like regroup points).
alter table public.shared_pins drop constraint if exists shared_pins_kind_check;
alter table public.shared_pins add constraint shared_pins_kind_check check (kind in ('regroup', 'hazard', 'note', 'photo', 'report', 'camp'));
