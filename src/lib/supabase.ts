import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase credentials not found. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file'
  )
}

// Single Supabase client using the anon key.
// Auth is handled by Clerk — this client is used solely for database operations.
// RLS is disabled on all tables (see supabase/schema.sql).  For production,
// configure a Clerk JWT Template in Supabase and re-enable RLS policies.
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '')

// =============================================
// DATABASE TYPES
// =============================================

export interface UserProfile {
  id: string                        // Clerk user ID (TEXT)
  email: string | null
  tier: 'free' | 'pro'
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  messages_used_today: number
  last_usage_reset: string
  created_at: string
  updated_at: string
}

export interface Conversation {
  id: string
  user_id: string                   // Clerk user ID (TEXT)
  title: string
  model_id: string | null
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[]
}

// =============================================
// TIER CONFIGURATION
// =============================================

export const TIER_LIMITS = {
  free: {
    messagesPerDay: 10,
    models: [
      'meta-llama/llama-3.1-70b-instruct',
      'meta-llama/llama-3.1-8b-instruct',
      'mistralai/mixtral-8x7b-instruct',
      'google/gemini-flash-1.5',
      'openai/gpt-3.5-turbo',
    ],
    modelNames: {
      'meta-llama/llama-3.1-70b-instruct': 'Llama 3.1 70B',
      'meta-llama/llama-3.1-8b-instruct': 'Llama 3.1 8B',
      'mistralai/mixtral-8x7b-instruct': 'Mixtral 8x7B',
      'google/gemini-flash-1.5': 'Gemini Flash 1.5',
      'openai/gpt-3.5-turbo': 'GPT-3.5 Turbo',
    },
  },
  pro: {
    messagesPerDay: Infinity,
    models: 'all' as const,
  },
}

export function isModelAvailable(modelId: string, tier: 'free' | 'pro'): boolean {
  if (tier === 'pro') return true
  return TIER_LIMITS.free.models.includes(modelId)
}

// =============================================
// USER PROFILE OPERATIONS
// =============================================

/**
 * Fetch the user's profile, creating it if it doesn't exist yet.
 * Uses the Clerk user ID as the primary key.
 */
export async function upsertUserProfile(
  userId: string,
  email: string | null
): Promise<UserProfile | null> {
  // Try fetch first
  const { data: existing, error: fetchError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (fetchError) {
    console.error('Error fetching profile:', fetchError)
  }

  if (existing) {
    return existing as UserProfile
  }

  // Profile doesn't exist — create it
  const newProfile = {
    id: userId,
    email,
    tier: 'free' as const,
    messages_used_today: 0,
    last_usage_reset: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { data: created, error: insertError } = await supabase
    .from('user_profiles')
    .insert(newProfile)
    .select()
    .maybeSingle()

  if (insertError) {
    console.error('Error creating profile:', insertError)
    return null
  }

  return created as UserProfile
}

// =============================================
// USAGE TRACKING
// =============================================

export async function getRemainingMessages(userId: string): Promise<number> {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('tier, messages_used_today, last_usage_reset')
    .eq('id', userId)
    .maybeSingle()

  if (error || !profile) return 0
  if (profile.tier === 'pro') return Infinity

  // Reset counter if it's a new day
  const today = new Date().toISOString().split('T')[0]
  const lastReset = profile.last_usage_reset?.split('T')[0]

  if (lastReset !== today) {
    await supabase
      .from('user_profiles')
      .update({ messages_used_today: 0, last_usage_reset: new Date().toISOString() })
      .eq('id', userId)
    return TIER_LIMITS.free.messagesPerDay
  }

  return Math.max(0, TIER_LIMITS.free.messagesPerDay - profile.messages_used_today)
}

/**
 * Update a user's tier in Supabase (called when Clerk metadata or admin email
 * indicates a different tier than what's stored in the DB).
 */
export async function updateUserTier(
  userId: string,
  newTier: 'free' | 'pro'
): Promise<boolean> {
  const { error } = await supabase
    .from('user_profiles')
    .update({ tier: newTier, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) {
    console.error('Error updating user tier:', error)
    return false
  }
  return true
}

export async function incrementMessageUsage(userId: string): Promise<boolean> {
  const remaining = await getRemainingMessages(userId)
  if (remaining <= 0) return false

  // Fetch current count then increment
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('messages_used_today')
    .eq('id', userId)
    .maybeSingle()

  if (!profile) return false

  const { error } = await supabase
    .from('user_profiles')
    .update({
      messages_used_today: (profile.messages_used_today || 0) + 1,
      last_usage_reset: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  return !error
}

// =============================================
// CONVERSATION CRUD
// =============================================

export async function getConversations(userId: string): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('Error fetching conversations:', error)
    return []
  }
  return data || []
}

export async function getConversationWithMessages(
  conversationId: string
): Promise<ConversationWithMessages | null> {
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle()

  if (convError || !conversation) {
    console.error('Error fetching conversation:', convError)
    return null
  }

  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (msgError) {
    console.error('Error fetching messages:', msgError)
    return { ...conversation, messages: [] }
  }

  return { ...conversation, messages: messages || [] }
}

export async function createConversation(
  userId: string,
  title = 'New Chat',
  modelId?: string
): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId, title, model_id: modelId || null })
    .select()
    .maybeSingle()

  if (error) {
    console.error('Error creating conversation:', error)
    return null
  }
  return data
}

export async function updateConversationTitle(
  conversationId: string,
  title: string
): Promise<boolean> {
  const { error } = await supabase
    .from('conversations')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) {
    console.error('Error updating conversation:', error)
    return false
  }
  return true
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
  const { error } = await supabase.from('conversations').delete().eq('id', conversationId)

  if (error) {
    console.error('Error deleting conversation:', error)
    return false
  }
  return true
}

// =============================================
// MESSAGE CRUD
// =============================================

export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): Promise<Message | null> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role, content })
    .select()
    .maybeSingle()

  if (error) {
    console.error('Error adding message:', error)
    return null
  }
  return data
}

export async function addMessages(
  conversationId: string,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
): Promise<Message[]> {
  const toInsert = messages.map((m) => ({
    conversation_id: conversationId,
    role: m.role,
    content: m.content,
  }))

  const { data, error } = await supabase.from('messages').insert(toInsert).select()

  if (error) {
    console.error('Error adding messages:', error)
    return []
  }
  return data || []
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching messages:', error)
    return []
  }
  return data || []
}
