-- Emergency roll call

-- A personal roll call link for each fire warden (only a hash of the key is stored).
ALTER TABLE staff ADD COLUMN rollcall_key_hash text UNIQUE;
ALTER TABLE staff ADD COLUMN rollcall_key_created_at timestamptz;

CREATE TABLE roll_calls (
  id            serial PRIMARY KEY,
  client_id     text NOT NULL UNIQUE,          -- made by the device that started it, so offline starts sync safely
  site_id       int REFERENCES sites(id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  started_by    text NOT NULL,
  ended_at      timestamptz,
  ended_by      text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX roll_calls_active ON roll_calls (started_at DESC) WHERE ended_at IS NULL;

CREATE TABLE roll_call_entries (
  id            bigserial PRIMARY KEY,
  roll_call_id  int NOT NULL REFERENCES roll_calls(id) ON DELETE CASCADE,
  person_key    text NOT NULL,                 -- visit:<uuid> | staff:<id> | extra:<uuid>
  kind          text NOT NULL,                 -- visitor | staff | extra
  name          text NOT NULL,
  detail        text,
  mobile        text,
  status        text NOT NULL DEFAULT 'missing',  -- missing | safe
  marked_by     text,
  marked_at     timestamptz,
  UNIQUE (roll_call_id, person_key)
);
