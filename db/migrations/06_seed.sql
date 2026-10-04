insert into settings (key, value, description) values
('icp', '{"company_sizes":["50-100","101-200","201-500"],"personas":["cto","vp_rnd","vp_engineering","head_of_devops","head_of_platform"],"use_cases":["cloud","platform","devops_transformation"],"countries":["US","GB","DE","NL","FR","IL","CA","AU","SE"]}', 'ICP defaults')
on conflict (key) do nothing;

insert into settings (key, value, description) values
('keywords', '{"market":["devops","platform engineering","kubernetes","aws","azure","gcp","cloud migration","sre","ci/cd","idp","internal developer platform"],"hiring":["devops","platform engineer","sre","infrastructure","cloud engineer"]}', 'Keywords')
on conflict (key) do nothing;

insert into settings (key, value, description) values
('guardrails', '{"require_approval_before_outreach":true,"human_in_loop":true,"require_why_now":true,"require_evidence":true,"min_confidence":0.70}', 'Guardrails')
on conflict (key) do nothing;
