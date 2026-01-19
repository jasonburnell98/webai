import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not found. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file')
}

export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || '',
  {
    auth: {
      // Persist session in localStorage for longer sessions
      persistSession: true,
      // Use localStorage for better persistence across browser sessions
      storage: localStorage,
      // Unique storage key for this app
      storageKey: 'open-router-ui-auth',
      // Auto-refresh tokens before they expire
      autoRefreshToken: true,
      // Detect session from URL (for OAuth callbacks)
      detectSessionInUrl: true,
      // Flow type for PKCE
      flowType: 'pkce',
    },
  }
)

// Database types
export interface UserProfile {
  id: string
  email: string
  tier: 'free' | 'pro'
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  messages_used_today: number
  last_usage_reset: string
  created_at: string
  updated_at: string
}

export interface UsageLog {
  id: string
  user_id: string
  messages_count: number
  date: string
  created_at: string
}

// Chat types
export interface Conversation {
  id: string
  user_id: string
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

// Tier limits
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
    }
  },
  pro: {
    messagesPerDay: Infinity,
    models: 'all' as const,
  }
}

// Check if a model is available for a tier
export function isModelAvailable(modelId: string, tier: 'free' | 'pro'): boolean {
  if (tier === 'pro') return true
  return TIER_LIMITS.free.models.includes(modelId)
}

// Get remaining messages for today
export async function getRemainingMessages(userId: string): Promise<number> {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('tier, messages_used_today, last_usage_reset')
    .eq('id', userId)
    .single()

  if (error || !profile) return 0

  if (profile.tier === 'pro') return Infinity

  // Check if we need to reset daily usage
  const today = new Date().toISOString().split('T')[0]
  const lastReset = profile.last_usage_reset?.split('T')[0]

  if (lastReset !== today) {
    // Reset the counter for new day
    await supabase
      .from('user_profiles')
      .update({ 
        messages_used_today: 0, 
        last_usage_reset: new Date().toISOString() 
      })
      .eq('id', userId)
    
    return TIER_LIMITS.free.messagesPerDay
  }

  return Math.max(0, TIER_LIMITS.free.messagesPerDay - profile.messages_used_today)
}

// Increment message usage
export async function incrementMessageUsage(userId: string): Promise<boolean> {
  const remaining = await getRemainingMessages(userId)
  
  if (remaining <= 0) return false

  const { error } = await supabase
    .from('user_profiles')
    .update({ 
      messages_used_today: supabase.rpc('increment_messages'),
      last_usage_reset: new Date().toISOString()
    })
    .eq('id', userId)

  if (error) {
    // Fallback: direct increment
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('messages_used_today')
      .eq('id', userId)
      .single()

    if (profile) {
      await supabase
        .from('user_profiles')
        .update({ 
          messages_used_today: (profile.messages_used_today || 0) + 1,
          last_usage_reset: new Date().toISOString()
        })
        .eq('id', userId)
    }
  }

  return true
}

// =============================================
// CONVERSATION CRUD OPERATIONS
// =============================================

// Get all conversations for a user (ordered by most recent)
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

// Get a single conversation with all its messages
export async function getConversationWithMessages(conversationId: string): Promise<ConversationWithMessages | null> {
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single()

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

// Create a new conversation
export async function createConversation(
  userId: string, 
  title: string = 'New Chat',
  modelId?: string
): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      title,
      model_id: modelId || null,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating conversation:', error)
    return null
  }

  return data
}

// Update conversation title
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

// Delete a conversation (messages are cascade deleted)
export async function deleteConversation(conversationId: string): Promise<boolean> {
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)

  if (error) {
    console.error('Error deleting conversation:', error)
    return false
  }

  return true
}

// =============================================
// MESSAGE CRUD OPERATIONS
// =============================================

// Add a message to a conversation
export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): Promise<Message | null> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
    })
    .select()
    .single()

  if (error) {
    console.error('Error adding message:', error)
    return null
  }

  return data
}

// Add multiple messages at once (for batch saving)
export async function addMessages(
  conversationId: string,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
): Promise<Message[]> {
  const messagesToInsert = messages.map(msg => ({
    conversation_id: conversationId,
    role: msg.role,
    content: msg.content,
  }))

  const { data, error } = await supabase
    .from('messages')
    .insert(messagesToInsert)
    .select()

  if (error) {
    console.error('Error adding messages:', error)
    return []
  }

  return data || []
}

// Get messages for a conversation
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
