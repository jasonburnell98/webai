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
  is_saved: boolean
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
      'openai/gpt-4o-mini',
      'openai/gpt-3.5-turbo',
    ],
    modelNames: {
      'meta-llama/llama-3.1-70b-instruct': 'Llama 3.1 70B',
      'meta-llama/llama-3.1-8b-instruct': 'Llama 3.1 8B',
      'mistralai/mixtral-8x7b-instruct': 'Mixtral 8x7B',
      'google/gemini-flash-1.5': 'Gemini Flash 1.5',
      'openai/gpt-4o-mini': 'GPT-4o Mini',
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

/**
 * Toggle the saved/bookmarked state of a conversation.
 * Returns the new is_saved value, or null on error.
 */
export async function toggleSaveConversation(
  conversationId: string,
  currentlySaved: boolean
): Promise<boolean | null> {
  const newValue = !currentlySaved
  const { error } = await supabase
    .from('conversations')
    .update({ is_saved: newValue, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) {
    console.error('Error toggling save state:', error)
    return null
  }
  return newValue
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

// =============================================
// FILE TRANSFER TYPES
// =============================================

export interface FileTransfer {
  id: string
  sender_id: string
  sender_email: string
  recipient_email: string
  message: string | null
  status: 'pending' | 'accepted' | 'expired'
  created_at: string
  expires_at: string
  files?: TransferFile[]
}

export interface TransferFile {
  id: string
  transfer_id: string
  file_name: string
  file_size: number | null
  storage_path: string
  content_type: string | null
  created_at: string
}

// =============================================
// FILE TRANSFER OPERATIONS
// =============================================

const STORAGE_BUCKET = 'file-transfers'
const SIGNED_URL_EXPIRES_IN = 3600   // 1 hour
const CHUNK_SIZE = 45 * 1024 * 1024  // 45 MB — safely under Supabase's free-tier 50 MB limit

/** Returns true if the storage path represents a chunked (multi-part) file. */
export function isChunkedStoragePath(storagePath: string): boolean {
  return storagePath.includes('::chunks::')
}

function parseChunkedPath(storagePath: string): { basePath: string; totalChunks: number } {
  const sep = '::chunks::'
  const idx = storagePath.indexOf(sep)
  return {
    basePath: storagePath.slice(0, idx),
    totalChunks: parseInt(storagePath.slice(idx + sep.length), 10),
  }
}

/**
 * Upload a file to Supabase Storage.
 *
 * • Files ≤ 45 MB  →  uploaded as a single object (standard free-tier upload).
 * • Files  > 45 MB →  automatically split into 45 MB chunks, each uploaded
 *                     individually (all under the 50 MB free-tier limit).
 *                     The returned path encodes the chunk count so the
 *                     download side can reassemble them byte-for-byte.
 *
 * No compression or re-encoding is performed — the file is restored to its
 * exact original state on download.
 */
export async function uploadTransferFile(
  file: File,
  senderId: string,
  transferId: string,
  onProgress?: (percentage: number) => void
): Promise<string | null> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const basePath = `${senderId}/${transferId}/${safeName}`

  // ── Single file (≤ 45 MB) ─────────────────────────────────────────────
  if (file.size <= CHUNK_SIZE) {
    onProgress?.(0)
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(basePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })
    if (error) {
      console.error('Error uploading file:', error)
      return null
    }
    onProgress?.(100)
    return basePath
  }

  // ── Chunked upload (> 45 MB) ──────────────────────────────────────────
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const chunk = file.slice(start, end) // Blob.slice — raw bytes, no copying yet

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(`${basePath}_chunk_${i}`, chunk, {
        contentType: 'application/octet-stream',
        upsert: false,
      })

    if (error) {
      console.error(`Error uploading chunk ${i + 1}/${totalChunks}:`, error)
      return null
    }

    onProgress?.(Math.round(((i + 1) / totalChunks) * 100))
  }

  // Encode chunk count in the path so the download side can reassemble
  return `${basePath}::chunks::${totalChunks}`
}

/**
 * Download a chunked file by fetching every part and concatenating them in
 * the browser. The resulting file is byte-for-byte identical to the original.
 */
export async function downloadChunkedFile(
  storagePath: string,
  fileName: string,
  onProgress?: (percentage: number) => void
): Promise<void> {
  const { basePath, totalChunks } = parseChunkedPath(storagePath)
  const chunks: Blob[] = []

  for (let i = 0; i < totalChunks; i++) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(`${basePath}_chunk_${i}`, SIGNED_URL_EXPIRES_IN)

    if (error || !data?.signedUrl) {
      throw new Error(`Failed to get signed URL for chunk ${i}`)
    }

    const response = await fetch(data.signedUrl)
    if (!response.ok) throw new Error(`Failed to fetch chunk ${i}`)

    chunks.push(await response.blob())
    onProgress?.(Math.round(((i + 1) / totalChunks) * 100))
  }

  // Concatenate — Blob constructor preserves exact bytes, no quality loss
  const combined = new Blob(chunks)
  const url = URL.createObjectURL(combined)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Create a file_transfers row plus transfer_files rows for each uploaded file.
 */
export async function createFileTransfer(
  senderId: string,
  senderEmail: string,
  recipientEmail: string,
  message: string,
  files: Array<{ name: string; size: number; storagePath: string; contentType: string }>
): Promise<FileTransfer | null> {
  // Insert the transfer header
  const { data: transfer, error: transferError } = await supabase
    .from('file_transfers')
    .insert({
      sender_id: senderId,
      sender_email: senderEmail,
      recipient_email: recipientEmail.toLowerCase().trim(),
      message: message || null,
    })
    .select()
    .maybeSingle()

  if (transferError || !transfer) {
    console.error('Error creating file transfer:', transferError)
    return null
  }

  // Insert each file record
  const fileRows = files.map((f) => ({
    transfer_id: transfer.id,
    file_name: f.name,
    file_size: f.size,
    storage_path: f.storagePath,
    content_type: f.contentType || null,
  }))

  const { error: filesError } = await supabase.from('transfer_files').insert(fileRows)

  if (filesError) {
    console.error('Error saving transfer file records:', filesError)
    // Clean up the transfer header if files failed
    await supabase.from('file_transfers').delete().eq('id', transfer.id)
    return null
  }

  return transfer as FileTransfer
}

/**
 * Fetch all transfers sent by the current user.
 */
export async function getSentTransfers(senderId: string): Promise<FileTransfer[]> {
  const { data, error } = await supabase
    .from('file_transfers')
    .select('*, files:transfer_files(*)')
    .eq('sender_id', senderId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching sent transfers:', error)
    return []
  }
  return (data || []) as FileTransfer[]
}

/**
 * Fetch all transfers addressed to the current user's email.
 */
export async function getInboxTransfers(recipientEmail: string): Promise<FileTransfer[]> {
  const { data, error } = await supabase
    .from('file_transfers')
    .select('*, files:transfer_files(*)')
    .eq('recipient_email', recipientEmail.toLowerCase().trim())
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching inbox transfers:', error)
    return []
  }
  return (data || []) as FileTransfer[]
}

/**
 * Generate a time-limited signed URL for downloading a file.
 */
export async function getSignedDownloadUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_IN)

  if (error || !data?.signedUrl) {
    console.error('Error generating signed URL:', error)
    return null
  }
  return data.signedUrl
}

/**
 * Delete a file transfer (and its storage files) — sender only.
 * Handles both single files and chunked files.
 */
export async function deleteFileTransfer(
  transferId: string,
  files: TransferFile[]
): Promise<boolean> {
  // Expand chunked paths into individual chunk paths
  const allPaths: string[] = []
  for (const f of files) {
    if (isChunkedStoragePath(f.storage_path)) {
      const { basePath, totalChunks } = parseChunkedPath(f.storage_path)
      for (let i = 0; i < totalChunks; i++) {
        allPaths.push(`${basePath}_chunk_${i}`)
      }
    } else {
      allPaths.push(f.storage_path)
    }
  }

  if (allPaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(allPaths)
    if (storageError) {
      console.error('Error removing files from storage:', storageError)
    }
  }

  // Delete DB row (cascades to transfer_files)
  const { error } = await supabase.from('file_transfers').delete().eq('id', transferId)
  if (error) {
    console.error('Error deleting transfer:', error)
    return false
  }
  return true
}
