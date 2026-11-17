-- Generated with Supabase CLI 3.2.0: migration new public_platform.
-- Apply only to a dedicated VYDO project after review; never to another application's project.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE private.vydo_usage (
 id text PRIMARY KEY, subject text NOT NULL, ip text NOT NULL, created_ms bigint NOT NULL,
 state text NOT NULL CHECK (state IN ('active','done','error','cancelled')),
 refunded integer NOT NULL DEFAULT 0 CHECK (refunded IN (0,1)), lease_ms bigint NOT NULL, worker text NOT NULL
);
CREATE INDEX usage_subject_window ON private.vydo_usage(subject,created_ms);
CREATE INDEX usage_ip_window ON private.vydo_usage(ip,created_ms);
CREATE INDEX usage_active ON private.vydo_usage(state,lease_ms);
CREATE TABLE private.vydo_sessions (
 id text PRIMARY KEY, payload text NOT NULL, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, expires_ms bigint NOT NULL, version bigint NOT NULL DEFAULT 0
);
CREATE INDEX sessions_user ON private.vydo_sessions(user_id);
CREATE TABLE private.vydo_rates (id text PRIMARY KEY, rate_key text NOT NULL, created_ms bigint NOT NULL);
CREATE INDEX rates_key_date ON private.vydo_rates(rate_key,created_ms);

CREATE TABLE public.vydo_profiles (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL DEFAULT '' CHECK (char_length(name)<=80),
 format text NOT NULL DEFAULT 'mp3' CHECK (format IN ('mp4','mp3','m4a','wav','flac')),
 quality text NOT NULL DEFAULT '720' CHECK (quality IN ('360','480','720','1080'))
);
CREATE TABLE public.vydo_history (
 id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK (char_length(title)<=300), video_id text NOT NULL CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
 format text NOT NULL CHECK (format IN ('mp4','mp3','m4a','wav','flac')),
 quality text NOT NULL CHECK (quality IN ('360','480','720','1080')),
 status text NOT NULL CHECK (status IN ('processing','done','error','cancelled')), created_ms bigint NOT NULL
);
CREATE INDEX history_user_date ON public.vydo_history(user_id,created_ms DESC);
ALTER TABLE private.vydo_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.vydo_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.vydo_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vydo_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vydo_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON private.vydo_usage, private.vydo_sessions, private.vydo_rates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.vydo_profiles, public.vydo_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.vydo_usage, private.vydo_sessions, private.vydo_rates, public.vydo_profiles, public.vydo_history TO service_role;
GRANT SELECT ON public.vydo_profiles TO authenticated;
GRANT UPDATE(name,format,quality) ON public.vydo_profiles TO authenticated;
GRANT SELECT, DELETE ON public.vydo_history TO authenticated;
CREATE POLICY profile_read_own ON public.vydo_profiles FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
CREATE POLICY profile_update_own ON public.vydo_profiles FOR UPDATE TO authenticated USING ((SELECT auth.uid())=user_id) WITH CHECK ((SELECT auth.uid())=user_id);
CREATE POLICY history_read_own ON public.vydo_history FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
CREATE POLICY history_delete_own ON public.vydo_history FOR DELETE TO authenticated USING ((SELECT auth.uid())=user_id);
-- No public write path for counters, leases, tokens, owners or history insertion.
-- Node reserves quota inside a transaction plus pg_advisory_xact_lock(86734232).
