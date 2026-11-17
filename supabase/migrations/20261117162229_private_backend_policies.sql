-- Backend-only tables are intentionally unavailable to anon/authenticated users.
-- Explicit policies document service access without weakening the schema grants.
CREATE POLICY usage_backend_only ON private.vydo_usage FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY sessions_backend_only ON private.vydo_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY rates_backend_only ON private.vydo_rates FOR ALL TO service_role USING (true) WITH CHECK (true);
