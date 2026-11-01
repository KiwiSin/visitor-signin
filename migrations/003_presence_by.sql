-- Record who changed a staff member's in/out status (a tablet, or an admin by name).
ALTER TABLE staff_presence ADD COLUMN changed_by text;
