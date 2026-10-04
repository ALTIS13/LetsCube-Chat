-- Fictional parser/privilege characterization only. No production inputs.
CREATE SCHEMA restore_control AUTHORIZATION fixture_owner;
CREATE FUNCTION restore_control.allow_quantity(value integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT value >= 0 $$;
CREATE SCHEMA restore_shadow AUTHORIZATION fixture_owner;
CREATE FUNCTION restore_shadow.allow_quantity(value integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT value > 0 $$;
CREATE TABLE restore_control.samples(
  id integer PRIMARY KEY,
  discarded text,
  quantity integer NOT NULL,
  other_quantity integer,
  label text,
  CONSTRAINT quantity_check CHECK (quantity >= 0 AND (label = 'alpha' OR label = 'beta')),
  CONSTRAINT quantity_unique UNIQUE(quantity) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE restore_control.samples DROP COLUMN discarded;
ALTER TABLE restore_control.samples ADD CONSTRAINT pending_check CHECK (other_quantity >= 0) NOT VALID;
ALTER TABLE restore_control.samples ADD CONSTRAINT bound_check
  CHECK (restore_control.allow_quantity(quantity));
ALTER TABLE restore_control.samples OWNER TO fixture_owner;
ALTER TABLE restore_control.samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE restore_control.samples FORCE ROW LEVEL SECURITY;
CREATE POLICY sample_policy ON restore_control.samples FOR ALL
  TO fixture_alpha,fixture_omega USING (quantity <= 10) WITH CHECK (other_quantity <= 20);
GRANT USAGE ON SCHEMA restore_control TO fixture_alpha,fixture_omega;
GRANT SELECT,INSERT ON restore_control.samples TO fixture_alpha,fixture_omega;
ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner IN SCHEMA restore_control
  GRANT SELECT ON TABLES TO fixture_alpha,fixture_omega;
ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner IN SCHEMA restore_control
  GRANT EXECUTE ON FUNCTIONS TO fixture_alpha,fixture_omega;
ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner IN SCHEMA restore_control
  GRANT USAGE ON SEQUENCES TO fixture_alpha,fixture_omega;
ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner GRANT SELECT ON TABLES TO fixture_alpha;
