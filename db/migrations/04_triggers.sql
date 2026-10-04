create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

drop trigger if exists trg_companies_upd on companies; create trigger trg_companies_upd before update on companies for each row execute function set_updated_at();
drop trigger if exists trg_people_upd on people; create trigger trg_people_upd before update on people for each row execute function set_updated_at();
drop trigger if exists trg_signals_upd on signals; create trigger trg_signals_upd before update on signals for each row execute function set_updated_at();
drop trigger if exists trg_events_upd on events; create trigger trg_events_upd before update on events for each row execute function set_updated_at();
drop trigger if exists trg_social_upd on social_signals; create trigger trg_social_upd before update on social_signals for each row execute function set_updated_at();
drop trigger if exists trg_scans_upd on scans; create trigger trg_scans_upd before update on scans for each row execute function set_updated_at();
drop trigger if exists trg_opps_upd on opportunities; create trigger trg_opps_upd before update on opportunities for each row execute function set_updated_at();
drop trigger if exists trg_outreach_upd on outreach; create trigger trg_outreach_upd before update on outreach for each row execute function set_updated_at();
drop trigger if exists trg_settings_upd on settings; create trigger trg_settings_upd before update on settings for each row execute function set_updated_at();
