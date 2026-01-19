-- aiWeb - Supabase Database Schema
-- Run this in your Supabase SQL Editor to set up the required tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User Profiles Table
-- Stores user subscription tier and usage information
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  messages_used_today INTEGER NOT NULL DEFAULT 0,
  last_usage_reset TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_stripe_customer ON user_profiles(stripe_customer_id);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_profiles
-- Users can only read their own profile
CREATE POLICY "Users can read own profile" ON user_profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile (except tier and stripe fields)
CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow insert for new users (via trigger)
CREATE POLICY "Enable insert for authenticated users" ON user_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, tier, messages_used_today)
  VALUES (NEW.id, NEW.email, 'free', 0)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to reset daily message usage (run via cron job)
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

-- Function to increment message usage
CREATE OR REPLACE FUNCTION public.increment_message_usage(user_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
  user_tier TEXT;
  current_usage INTEGER;
  max_messages INTEGER := 10;
BEGIN
  -- Get user's tier and current usage
  SELECT tier, messages_used_today 
  INTO user_tier, current_usage
  FROM user_profiles 
  WHERE id = user_uuid;
  
  -- Pro users have unlimited messages
  IF user_tier = 'pro' THEN
    RETURN TRUE;
  END IF;
  
  -- Check if user has messages left
  IF current_usage >= max_messages THEN
    RETURN FALSE;
  END IF;
  
  -- Increment usage
  UPDATE user_profiles
  SET messages_used_today = messages_used_today + 1,
      last_usage_reset = NOW()
  WHERE id = user_uuid;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update user tier (called from webhook)
CREATE OR REPLACE FUNCTION public.update_user_tier(
  user_uuid UUID,
  new_tier TEXT,
  customer_id TEXT DEFAULT NULL,
  subscription_id TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE user_profiles
  SET tier = new_tier,
      stripe_customer_id = COALESCE(customer_id, stripe_customer_id),
      stripe_subscription_id = COALESCE(subscription_id, stripe_subscription_id),
      updated_at = NOW()
  WHERE id = user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Usage Logs Table (optional - for analytics)
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for usage analytics
CREATE INDEX IF NOT EXISTS idx_usage_logs_user ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_date ON usage_logs(created_at);

-- RLS for usage_logs
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own usage logs" ON usage_logs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own usage logs" ON usage_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Grant permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON user_profiles TO authenticated;
GRANT ALL ON usage_logs TO authenticated;
GRANT EXECUTE ON FUNCTION increment_message_usage TO authenticated;

-- =============================================
-- CHAT PERSISTENCE TABLES
-- =============================================

-- Conversations Table
-- Stores chat conversation metadata for each user
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat',
  model_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at DESC);

-- Enable Row Level Security
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for conversations
-- Users can only see their own conversations
CREATE POLICY "Users can read own conversations" ON conversations
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own conversations
CREATE POLICY "Users can insert own conversations" ON conversations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own conversations
CREATE POLICY "Users can update own conversations" ON conversations
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own conversations
CREATE POLICY "Users can delete own conversations" ON conversations
  FOR DELETE
  USING (auth.uid() = user_id);

-- Messages Table
-- Stores individual messages within conversations
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

-- Enable Row Level Security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for messages
-- Users can only see messages from their own conversations
CREATE POLICY "Users can read own messages" ON messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations 
      WHERE conversations.id = messages.conversation_id 
      AND conversations.user_id = auth.uid()
    )
  );

-- Users can insert messages to their own conversations
CREATE POLICY "Users can insert own messages" ON messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations 
      WHERE conversations.id = messages.conversation_id 
      AND conversations.user_id = auth.uid()
    )
  );

-- Users can update messages in their own conversations
CREATE POLICY "Users can update own messages" ON messages
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM conversations 
      WHERE conversations.id = messages.conversation_id 
      AND conversations.user_id = auth.uid()
    )
  );

-- Users can delete messages from their own conversations
CREATE POLICY "Users can delete own messages" ON messages
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM conversations 
      WHERE conversations.id = messages.conversation_id 
      AND conversations.user_id = auth.uid()
    )
  );

-- Function to update conversation's updated_at timestamp
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations 
  SET updated_at = NOW() 
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-update conversation timestamp when messages are added
DROP TRIGGER IF EXISTS on_message_added ON messages;
CREATE TRIGGER on_message_added
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_timestamp();

-- Grant permissions for conversations and messages
GRANT ALL ON conversations TO authenticated;
GRANT ALL ON messages TO authenticated;

-- Comments
COMMENT ON TABLE user_profiles IS 'User profile data including subscription tier and usage tracking';
COMMENT ON TABLE usage_logs IS 'Log of AI model usage for analytics';
COMMENT ON TABLE conversations IS 'Chat conversation metadata for each user';
COMMENT ON TABLE messages IS 'Individual messages within conversations';
COMMENT ON FUNCTION increment_message_usage IS 'Safely increment message usage counter with tier check';
COMMENT ON FUNCTION reset_daily_usage IS 'Reset daily message counters for free users';
COMMENT ON FUNCTION update_conversation_timestamp IS 'Auto-update conversation timestamp when messages are added';
