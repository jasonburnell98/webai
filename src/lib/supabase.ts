import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not found. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file')
}

export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || ''
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
