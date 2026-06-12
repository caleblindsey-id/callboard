-- Per-technician permission: allow a specific technician to create service tickets.
-- Default FALSE preserves today's behavior (only managers/coordinators/super-admins create).
ALTER TABLE users ADD COLUMN can_create_service_tickets BOOLEAN NOT NULL DEFAULT FALSE;
