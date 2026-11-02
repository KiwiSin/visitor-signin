-- Many businesses on one install.
-- Every existing row becomes part of business 1 (the company that was already set up),
-- and existing admins become Host Admins (they installed the platform).

CREATE TABLE businesses (
  id                 serial PRIMARY KEY,
  slug               text NOT NULL UNIQUE,        -- web address part: /b/<slug>/admin
  name               text NOT NULL,
  status             text NOT NULL DEFAULT 'active',  -- active | suspended
  setup_token_hash   text UNIQUE,                 -- one-time link for the company to create its first admin
  setup_expires      timestamptz,
  last_auto_signout  date,                        -- last day the automatic sign-out ran (business's local date)
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Platform-wide settings (Host Admin): e.g. the default H&S text new businesses start with.
CREATE TABLE platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Business 1 = the existing company (named from its branding, if set).
INSERT INTO businesses (id, slug, name)
SELECT 1,
       coalesce(nullif(trim(both '-' from regexp_replace(lower(coalesce(s.value->>'companyName', '')), '[^a-z0-9]+', '-', 'g')), ''), 'my-company'),
       coalesce(nullif(s.value->>'companyName', ''), 'My Company')
  FROM (SELECT 1) one LEFT JOIN settings s ON s.key = 'branding';
SELECT setval('businesses_id_seq', 1);

-- Add business_id to every table that holds a business's data.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites','teams','staff','visitor_types','safety_questions','kiosks','visitors','visits',
                           'notifications','roll_calls','audit_log','staff_presence']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN business_id int REFERENCES businesses(id) ON DELETE CASCADE', t);
    EXECUTE format('UPDATE %I SET business_id = 1', t);
  END LOOP;
END $$;

-- Rows that must always belong to a business.
ALTER TABLE sites            ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE teams            ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE staff            ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE visitor_types    ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE safety_questions ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE kiosks           ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE visitors         ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE visits           ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE roll_calls       ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE staff_presence   ALTER COLUMN business_id SET NOT NULL;
-- notifications and audit_log may be platform-level (business_id NULL).

-- Settings: one set per business.
ALTER TABLE settings ADD COLUMN business_id int REFERENCES businesses(id) ON DELETE CASCADE;
UPDATE settings SET business_id = 1;
ALTER TABLE settings ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE settings DROP CONSTRAINT settings_pkey;
ALTER TABLE settings ADD PRIMARY KEY (business_id, key);

-- Admin accounts: business admins belong to one business; Host Admins run the platform.
ALTER TABLE admin_users ADD COLUMN business_id int REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE admin_users ADD COLUMN is_host boolean NOT NULL DEFAULT false;
UPDATE admin_users SET business_id = 1, is_host = true;

-- Names and keys only need to be unique inside one business.
ALTER TABLE teams DROP CONSTRAINT teams_name_key;
CREATE UNIQUE INDEX teams_business_name ON teams (business_id, name);
DROP INDEX staff_email_unique;
CREATE UNIQUE INDEX staff_business_email ON staff (business_id, lower(email)) WHERE email IS NOT NULL AND email <> '';
ALTER TABLE visitor_types DROP CONSTRAINT visitor_types_key_key;
CREATE UNIQUE INDEX visitor_types_business_key ON visitor_types (business_id, key);
DROP INDEX visitors_lookup;
CREATE INDEX visitors_lookup ON visitors (business_id, lower(name), mobile);

CREATE INDEX staff_business ON staff (business_id) WHERE active;
CREATE INDEX visits_business_time ON visits (business_id, signed_in_at DESC);
CREATE INDEX kiosks_business ON kiosks (business_id);
CREATE INDEX notifications_business ON notifications (business_id);
