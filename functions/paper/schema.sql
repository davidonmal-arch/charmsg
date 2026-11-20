CREATE SCHEMA IF NOT EXISTS charmsg;
CREATE TABLE IF NOT EXISTS charmsg.paper_control (
  id boolean PRIMARY KEY DEFAULT true CHECK(id), halted boolean NOT NULL DEFAULT false,
  heartbeat timestamptz, worker_error text
);
INSERT INTO charmsg.paper_control(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS charmsg.paper_bots (
  id text PRIMARY KEY, config jsonb NOT NULL, state jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('paused','running','stopped','risk-stopped','archived')),
  revision integer NOT NULL DEFAULT 1, next_run timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), last_error text
);
CREATE INDEX IF NOT EXISTS paper_bots_due ON charmsg.paper_bots(next_run) WHERE status='running';
CREATE TABLE IF NOT EXISTS charmsg.paper_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, bot_id text NOT NULL REFERENCES charmsg.paper_bots(id),
  kind text NOT NULL CHECK(kind IN ('order','decision','equity','admin')), at timestamptz NOT NULL DEFAULT now(),
  dedupe text UNIQUE, data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_events_history ON charmsg.paper_events(bot_id,at DESC,id DESC);
CREATE INDEX IF NOT EXISTS paper_events_kind_time ON charmsg.paper_events(kind,at DESC);
ALTER TABLE charmsg.paper_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE charmsg.paper_bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE charmsg.paper_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON charmsg.paper_control,charmsg.paper_bots,charmsg.paper_events FROM PUBLIC;
