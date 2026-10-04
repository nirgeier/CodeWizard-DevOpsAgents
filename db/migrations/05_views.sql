create or replace view v_opportunities_qualified as
select o.*, c.domain, c.employees_est
from opportunities o
left join companies c on c.id = o.company_id
where o.status <> 'rejected' and o.confidence >= 0.70
order by o.confidence desc, o.created_at desc;

create or replace view v_daily_signal_counts as
select date_trunc('day', ingested_at) d, type, count(*) c
from signals
group by 1,2
order by 1 desc;

create or replace view v_company_activity as
select c.id, c.name, c.domain, count(distinct s.id) signals, max(s.occurred_at) last_signal
from companies c
left join signals s on s.company_id=c.id
group by 1,2,3
order by signals desc;
