-- aiWeb - Supabase Database Schema (Clerk Auth Edition)
-- Run this in your Supabase SQL Editor to set up the required tables.
--
-- IMPORTANT: This schema uses Clerk for authentication instead of Supabase Auth.
-- User IDs are TEXT (Clerk format: "user_xxxxxxxxxxxx") rather than UUIDs.
--
-- RLS Strategy:
--   Because Clerk JWTs are not automatically trusted by Supabase, RLS policies
--   that rely on auth.uid() will NOT work out of the box. Two options:
--
--   Option A (Quick / Development): Disable RLS and rely on app-level auth.
--     → This schema does Option A by default.
--
--   Option B (Production): Set up a Clerk JWT Template in your Clerk dashboard:
--     1. In Clerk dashboard → JWT Templates → New Template → Supabase
--     2. Copy the signing key and add it to Supabase Auth → JWT Secret
--     3. Then replace the anon policies below with auth.uid() policies.
--
-- ----------------------------------------------------------------

-- Enable UUID extension (still used for table PKs where not user IDs)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- DROP old Supabase-auth-dependent tables if they exist
-- (safe to run on a fresh project; on an existing one, back up data first)
-- =============================================
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS usage_logs CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;

-- =============================================
-- USER PROFILES
-- =============================================
CREATE TABLE user_profiles (
  id TEXT PRIMARY KEY,              -- Clerk user ID (e.g. "user_2abc...")
  email TEXT,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  messages_used_today INTEGER NOT NULL DEFAULT 0,
  last_usage_reset TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_email ON user_profiles(email);
CREATE INDEX idx_user_profiles_stripe_customer ON user_profiles(stripe_customer_id);

-- Disable RLS (Option A). Re-enable and add policies when using Clerk JWT Template.
ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;


-- =============================================
-- CONVERSATIONS
-- =============================================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,            -- Clerk user ID
  title TEXT NOT NULL DEFAULT 'New Chat',
  model_id TEXT,
  is_saved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_created ON conversations(created_at DESC);

ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;


-- =============================================
-- MESSAGES
-- =============================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_created ON messages(created_at);

ALTER TABLE messages DISABLE ROW LEVEL SECURITY;


-- =============================================
-- USAGE LOGS  (optional analytics)
-- =============================================
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,            -- Clerk user ID
  model_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_logs_user ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_date ON usage_logs(created_at);

ALTER TABLE usage_logs DISABLE ROW LEVEL SECURITY;


-- =============================================
-- MIGRATION: Add is_saved to existing conversations table
-- (Only run this if you already have the conversations table and
--  do NOT want to drop and recreate it from the schema above)
-- =============================================
-- ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_saved BOOLEAN NOT NULL DEFAULT FALSE;


-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Auto-update conversation timestamp when a message is added
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_message_added ON messages;
CREATE TRIGGER on_message_added
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_timestamp();

-- Reset daily message usage (can be called via Supabase cron or pg_cron)
CREATE OR REPLACE FUNCTION public.reset_daily_usage()
RETURNS void AS $$
BEGIN
  UPDATE user_profiles
  SET messages_used_today = 0,
      last_usage_reset = NOW()
  WHERE tier = 'free'
    AND last_usage_reset < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================
-- GRANT permissions to anon role (for Option A)
-- =============================================
GRANT USAGE ON SCHEMA public TO anon;
GRANT ALL ON user_profiles TO anon;
GRANT ALL ON conversations TO anon;
GRANT ALL ON messages TO anon;
GRANT ALL ON usage_logs TO anon;


-- =============================================
-- FILE TRANSFERS
-- =============================================

-- Each "package" a sender sends to a recipient (identified by email)
CREATE TABLE IF NOT EXISTS file_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id TEXT NOT NULL,            -- Clerk user ID of sender
  sender_email TEXT NOT NULL,
  recipient_email TEXT NOT NULL,      -- email of the intended recipient
  message TEXT,                       -- optional note from sender
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_file_transfers_sender    ON file_transfers(sender_id);
CREATE INDEX IF NOT EXISTS idx_file_transfers_recipient ON file_transfers(recipient_email);
CREATE INDEX IF NOT EXISTS idx_file_transfers_created   ON file_transfers(created_at DESC);

ALTER TABLE file_transfers DISABLE ROW LEVEL SECURITY;

-- Individual files within a transfer package
CREATE TABLE IF NOT EXISTS transfer_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_id UUID NOT NULL REFERENCES file_transfers(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  storage_path TEXT NOT NULL,   -- path in Supabase Storage: {sender_id}/{transfer_id}/{filename}
  content_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_files_transfer ON transfer_files(transfer_id);

ALTER TABLE transfer_files DISABLE ROW LEVEL SECURITY;

-- Grant anon role access (matches Option A strategy in use for other tables)
GRANT ALL ON file_transfers TO anon;
GRANT ALL ON transfer_files TO anon;


-- =============================================
-- SUPABASE STORAGE SETUP
-- =============================================

-- Step 1: Create the private bucket (run this OR create it via the dashboard)
INSERT INTO storage.buckets (id, name, public)
VALUES ('file-transfers', 'file-transfers', false)
ON CONFLICT (id) DO NOTHING;

-- Step 2: Storage RLS policies for the anon key (matches Option A strategy)
-- These are REQUIRED because storage.objects has RLS enabled by default.

-- Allow uploads
CREATE POLICY "anon can upload to file-transfers"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'file-transfers');

-- Allow downloads / signed-URL generation
CREATE POLICY "anon can read from file-transfers"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'file-transfers');

-- Allow deletions (sender deleting their own transfers)
CREATE POLICY "anon can delete from file-transfers"
ON storage.objects FOR DELETE
TO anon
USING (bucket_id = 'file-transfers');


-- =============================================
-- COMMENTS
-- =============================================
COMMENT ON TABLE user_profiles IS 'User profiles keyed by Clerk user ID. Stores tier and usage data.';
COMMENT ON TABLE conversations IS 'Chat conversation metadata keyed by Clerk user ID.';
COMMENT ON TABLE messages IS 'Individual messages within conversations.';
COMMENT ON TABLE usage_logs IS 'Optional analytics log of model usage per user.';
COMMENT ON TABLE file_transfers IS 'Secure file transfer packages sent from one user to another by recipient email.';
COMMENT ON TABLE transfer_files IS 'Individual files within a file_transfers package, stored in Supabase Storage bucket "file-transfers".';
