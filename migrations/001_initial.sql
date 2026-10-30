-- Visitor Sign-In: initial schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE sites (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key            text PRIMARY KEY,
  value          jsonb NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_users (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  email          text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  role           text NOT NULL DEFAULT 'admin',       -- admin | reception
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE sessions (
  token_hash     text PRIMARY KEY,
  user_id        int NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id             serial PRIMARY KEY,
  name           text NOT NULL UNIQUE,
  email          text,                                 -- optional shared mailbox for the team
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  email          text,
  mobile         text,
  team_id        int REFERENCES teams(id) ON DELETE SET NULL,
  role           text NOT NULL DEFAULT 'staff',        -- staff | warden
  show_on_kiosk  boolean NOT NULL DEFAULT true,
  active         boolean NOT NULL DEFAULT true,
  source         text NOT NULL DEFAULT 'manual',       -- manual | csv | ad | m365 | google
  external_id    text,
  presence       text NOT NULL DEFAULT 'out',          -- in | out
  presence_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_email_unique ON staff (lower(email)) WHERE email IS NOT NULL AND email <> '';

CREATE TABLE staff_presence (
  id             bigserial PRIMARY KEY,
  staff_id       int NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  state          text NOT NULL,                        -- in | out
  kiosk_id       int,
  at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE visitor_types (
  id                  serial PRIMARY KEY,
  key                 text NOT NULL UNIQUE,
  name                text NOT NULL,
  sort                int NOT NULL DEFAULT 0,
  ask_company         boolean NOT NULL DEFAULT true,
  ask_email           boolean NOT NULL DEFAULT true,
  ask_rego            boolean NOT NULL DEFAULT true,
  ask_induction_no    boolean NOT NULL DEFAULT false,
  require_host        boolean NOT NULL DEFAULT true,
  require_signature   boolean NOT NULL DEFAULT true,
  active              boolean NOT NULL DEFAULT true
);

INSERT INTO visitor_types (key, name, sort, ask_induction_no, require_host, require_signature) VALUES
  ('visitor',    'Visitor / Meeting',  1, false, true,  true),
  ('contractor', 'Contractor',         2, true,  true,  true),
  ('delivery',   'Courier / Delivery', 3, false, false, false),
  ('interview',  'Interview',          4, false, true,  true);

CREATE TABLE safety_questions (
  id             serial PRIMARY KEY,
  text           text NOT NULL,
  flag_answer    text NOT NULL DEFAULT 'yes',          -- the answer that raises a flag: yes | no
  sort           int NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true
);

INSERT INTO safety_questions (text, flag_answer, sort) VALUES
  ('Are you feeling unwell or do you have cold or flu symptoms?', 'yes', 1),
  ('Have you been told where the emergency exits are?',          'no',  2),
  ('Will you wear the required PPE in operational areas?',        'no',  3);

CREATE TABLE kiosks (
  id               serial PRIMARY KEY,
  site_id          int REFERENCES sites(id) ON DELETE CASCADE,
  name             text NOT NULL,
  default_type     text,                               -- visitor type key to show first
  pairing_code     text,
  pairing_expires  timestamptz,
  token_hash       text UNIQUE,
  paired_at        timestamptz,
  last_seen_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE visitors (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  company        text,
  mobile         text,
  email          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX visitors_lookup ON visitors (lower(name), mobile);

CREATE TABLE visits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        text UNIQUE,                        -- set by the kiosk so a retried sign-in is not duplicated
  site_id          int REFERENCES sites(id),
  visitor_id       int REFERENCES visitors(id) ON DELETE SET NULL,
  type_id          int REFERENCES visitor_types(id),
  host_staff_id    int REFERENCES staff(id) ON DELETE SET NULL,
  host_name        text,                               -- kept even if the staff member is removed later
  kiosk_id         int REFERENCES kiosks(id) ON DELETE SET NULL,
  signed_in_at     timestamptz NOT NULL DEFAULT now(),
  signed_out_at    timestamptz,
  signed_out_by    text,                               -- kiosk | admin | auto
  answers          jsonb NOT NULL DEFAULT '[]',
  flagged          boolean NOT NULL DEFAULT false,
  agreed_hs        boolean NOT NULL DEFAULT false,
  hs_version       int,
  signature_file   text,
  extra            jsonb NOT NULL DEFAULT '{}',        -- rego, induction number
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX visits_onsite ON visits (signed_in_at) WHERE signed_out_at IS NULL;
CREATE INDEX visits_signed_in ON visits (signed_in_at DESC);

CREATE TABLE notifications (
  id               bigserial PRIMARY KEY,
  visit_id         uuid REFERENCES visits(id) ON DELETE CASCADE,
  channel          text NOT NULL DEFAULT 'email',
  kind             text NOT NULL,                      -- host | reception | flagged | test
  recipient        text NOT NULL,
  subject          text NOT NULL,
  body_html        text NOT NULL,
  body_text        text NOT NULL,
  status           text NOT NULL DEFAULT 'pending',    -- pending | sent | failed
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);
CREATE INDEX notifications_due ON notifications (next_attempt_at) WHERE status = 'pending';

CREATE TABLE audit_log (
  id             bigserial PRIMARY KEY,
  user_id        int REFERENCES admin_users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  detail         jsonb,
  at             timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sites (name) VALUES ('Main site');
