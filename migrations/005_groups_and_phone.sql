-- Staff groups (Fire warden, First aider, Management, and any the business adds)
-- and personal phone sign-in links.

CREATE TABLE staff_groups (
  id           serial PRIMARY KEY,
  business_id  int NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key          text,                 -- built-in groups: fire_warden | first_aider | management
  name         text NOT NULL,
  color        text NOT NULL DEFAULT '#374151',
  sort         int NOT NULL DEFAULT 100,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_groups_business_name ON staff_groups (business_id, lower(name));
CREATE UNIQUE INDEX staff_groups_business_key ON staff_groups (business_id, key) WHERE key IS NOT NULL;

CREATE TABLE staff_group_members (
  staff_id  int NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  group_id  int NOT NULL REFERENCES staff_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, group_id)
);

-- Built-in groups for every existing business.
INSERT INTO staff_groups (business_id, key, name, color, sort)
SELECT b.id, g.key, g.name, g.color, g.sort
  FROM businesses b,
       (VALUES ('fire_warden', 'Fire warden', '#B91C1C', 1),
               ('first_aider', 'First aider', '#15803D', 2),
               ('management',  'Management',  '#7C3AED', 3)) AS g(key, name, color, sort);

-- Existing wardens join the Fire warden group.
INSERT INTO staff_group_members (staff_id, group_id)
SELECT s.id, g.id FROM staff s JOIN staff_groups g ON g.business_id = s.business_id AND g.key = 'fire_warden'
 WHERE s.role = 'warden';

-- Personal phone sign-in. The emailed link holds a one-time invite; opening it on a phone
-- swaps it for a device key, so the link only ever works on that one phone.
ALTER TABLE staff ADD COLUMN phone_invite_hash text UNIQUE;
ALTER TABLE staff ADD COLUMN phone_invite_expires timestamptz;
ALTER TABLE staff ADD COLUMN phone_key_hash text UNIQUE;
ALTER TABLE staff ADD COLUMN phone_linked_at timestamptz;
ALTER TABLE staff ADD COLUMN phone_device text;
ALTER TABLE staff ADD COLUMN phone_last_used_at timestamptz;

-- The old separate warden links are replaced by the staff phone app.
UPDATE staff SET rollcall_key_hash = NULL, rollcall_key_created_at = NULL;
