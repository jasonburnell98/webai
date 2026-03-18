import { useState, useEffect, useCallback, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate, Navigate } from 'react-router-dom'
import { ClerkProvider } from '@clerk/react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Sidebar from './components/Sidebar'
import UsageIndicator from './components/UsageIndicator'
import ChatPage from './pages/ChatPage'
import AdminPage from './pages/AdminPage'
import AuthPage from './pages/AuthPage'
import PricingPage from './pages/PricingPage'
import TransfersPage from './pages/TransfersPage'
import {
  getConversations,
  getConversationWithMessages,
  createConversation,
  updateConversationTitle,
  deleteConversation as deleteConversationFromDb,
  toggleSaveConversation,
  addMessage,
  type Conversation,
  type Message as DbMessage,
} from './lib/supabase'
import './App.css'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!CLERK_PUBLISHABLE_KEY) {
  console.error(
    'Missing VITE_CLERK_PUBLISHABLE_KEY. Add it to your .env file. ' +
      'Get one at https://dashboard.clerk.com'
  )
}

// -------------------------------------------------------
// Types
// -------------------------------------------------------

interface Attachment {
  type: 'image'
  url: string
  name: string
}

interface GeneratedImage {
  url: string
  index: number
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
  reasoning?: string
  generatedImages?: GeneratedImage[]
}

interface Chat {
  id: string
  title: string
  messages: Message[]
  isSaved: boolean
  createdAt: Date
}

// -------------------------------------------------------
// localStorage helpers – primary persistence layer
// -------------------------------------------------------

interface StoredChat {
  id: string
  title: string
  messages: Message[]
  isSaved: boolean
  createdAt: string // ISO string
}

function storageKey(userId: string) {
  return `aiweb_chats_${userId}`
}

function loadChatsFromStorage(userId: string): Chat[] {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return []
    const parsed: StoredChat[] = JSON.parse(raw)
    return parsed.map((c) => ({ ...c, createdAt: new Date(c.createdAt) }))
  } catch {
    return []
  }
}

function saveChatsToStorage(userId: string, chats: Chat[]) {
  try {
    const toStore: StoredChat[] = chats.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    }))
    localStorage.setItem(storageKey(userId), JSON.stringify(toStore))
  } catch (err) {
    console.error('[aiWeb] Error saving chats to localStorage:', err)
  }
}

// -------------------------------------------------------
// ClerkProvider wired up to React Router's navigate
// Must be rendered inside <Router> so useNavigate is available
// -------------------------------------------------------
function ClerkProviderWithRouter({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
    >
      {children}
    </ClerkProvider>
  )
}

// -------------------------------------------------------
// Public route – redirects authenticated users away from /login and /signup
// -------------------------------------------------------
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="auth-loading-page">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

// -------------------------------------------------------
// Main app content (rendered when auth state is resolved)
// -------------------------------------------------------
function AppContent() {
  const navigate = useNavigate()
  const { user, loading: authLoading, signOut, tier, canUseModel, remainingMessages, consumeMessage } =
    useAuth()

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('aiweb_theme')
    return (saved as 'light' | 'dark') || 'dark'
  })

  const [chats, setChats] = useState<Chat[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const currentChatIdRef = useRef<string | null>(null)
  const [chatsLoading, setChatsLoading] = useState(true)
  const [apiKey] = useState(() => localStorage.getItem('aiweb_api_key') || '')
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem('aiweb_model') || 'meta-llama/llama-3.1-70b-instruct'
  )
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768)

  // ------------------------------------------------------------------
  // Persist chats to localStorage whenever they change
  // ------------------------------------------------------------------
  useEffect(() => {
    if (user && !chatsLoading) {
      saveChatsToStorage(user.id, chats)
    }
  }, [chats, user, chatsLoading])

  // ------------------------------------------------------------------
  // Load conversations – localStorage first (instant), then Supabase sync
  // ------------------------------------------------------------------
  const loadChats = useCallback(async () => {
    if (!user) {
      setChats([])
      setCurrentChatId(null)
      setChatsLoading(false)
      return
    }

    setChatsLoading(true)

    // ① Load from localStorage immediately so the UI is responsive right away
    const localChats = loadChatsFromStorage(user.id)
    if (localChats.length > 0) {
      setChats(localChats)
      setCurrentChatId((prev) => prev ?? localChats[0].id)
    }

    // ② Try to sync with Supabase in the background
    try {
      const conversations = await getConversations(user.id)
      if (conversations.length > 0) {
        // Merge: use Supabase metadata, keep locally-cached messages
        const merged: Chat[] = conversations.map((conv: Conversation) => {
          const local = localChats.find((c) => c.id === conv.id)
          return {
            id: conv.id,
            title: conv.title,
            messages: local?.messages ?? [],
            isSaved: conv.is_saved ?? false,
            createdAt: new Date(conv.created_at),
          }
        })

        // Also keep any locally-created chats that aren't in Supabase yet
        // (temp IDs that start with 'local-')
        const unseenLocal = localChats.filter(
          (lc) => lc.id.startsWith('local-') && !merged.find((m) => m.id === lc.id)
        )

        const finalChats = [...unseenLocal, ...merged]
        setChats(finalChats)
        setCurrentChatId((prev) => prev ?? finalChats[0]?.id ?? null)
      }
    } catch (error) {
      console.error('[aiWeb] Supabase unavailable – using localStorage chats:', error)
      // Keep the local chats that were already set above
    } finally {
      setChatsLoading(false)
    }
  }, [user])

  // Load messages for the current chat from Supabase (best-effort)
  const loadCurrentChatMessages = useCallback(async () => {
    if (!currentChatId || !user) return
    if (currentChatId.startsWith('local-')) return // local-only chat, no DB record

    try {
      const conversation = await getConversationWithMessages(currentChatId)
      if (conversation && conversation.messages.length > 0) {
        const messages: Message[] = conversation.messages.map((msg: DbMessage) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }))
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === currentChatId ? { ...chat, messages, title: conversation.title } : chat
          )
        )
      }
    } catch (error) {
      console.error('[aiWeb] Could not load messages from Supabase – using cached:', error)
    }
  }, [currentChatId, user])

  // Load chats once auth resolves and user is present
  useEffect(() => {
    if (authLoading) return
    if (user) {
      loadChats()
    } else {
      setChats([])
      setCurrentChatId(null)
      setChatsLoading(false)
    }
  }, [authLoading, user?.id])

  // Keep ref in sync with state
  useEffect(() => {
    currentChatIdRef.current = currentChatId
  }, [currentChatId])

  // Load messages when current chat changes (skip temp/local chats)
  useEffect(() => {
    if (currentChatId && !currentChatId.startsWith('local-') && !currentChatId.startsWith('temp-')) {
      loadCurrentChatMessages()
    }
  }, [currentChatId])

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('aiweb_theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))

  const currentChat = chats.find((c) => c.id === currentChatId)
  const currentMessages = currentChat?.messages || []

  const generateChatTitle = (messages: Message[]): string => {
    if (messages.length === 0) return 'New Chat'
    const first = messages[0].content
    return first.length > 30 ? first.substring(0, 30) + '...' : first
  }

  // ------------------------------------------------------------------
  // Create a new chat – local-first, then sync to Supabase
  // ------------------------------------------------------------------
  const createNewChat = async () => {
    if (!user) return

    // Create a local chat immediately so the UI responds instantly
    const localId = 'local-' + crypto.randomUUID()
    const newChat: Chat = {
      id: localId,
      title: 'New Chat',
      messages: [],
      isSaved: false,
      createdAt: new Date(),
    }
    setChats((prev) => [newChat, ...prev])
    setCurrentChatId(localId)
    currentChatIdRef.current = localId
    navigate('/')

    // Background: persist to Supabase and replace temp ID with real one
    try {
      const newConv = await createConversation(user.id, 'New Chat', selectedModel)
      if (newConv) {
        setChats((prev) =>
          prev.map((c) =>
            c.id === localId
              ? { ...c, id: newConv.id, createdAt: new Date(newConv.created_at) }
              : c
          )
        )
        // Only update the active chat pointer if we're still on that chat
        if (currentChatIdRef.current === localId) {
          setCurrentChatId(newConv.id)
          currentChatIdRef.current = newConv.id
        }
      }
    } catch (error) {
      console.error('[aiWeb] Could not persist new chat to Supabase:', error)
      // Chat already exists locally – that's fine
    }
  }

  const selectChat = (id: string) => {
    setCurrentChatId(id)
    navigate('/')
  }

  const toggleSaveChat = async (id: string) => {
    const chat = chats.find((c) => c.id === id)
    if (!chat) return

    // Optimistically update local state
    const newValue = !chat.isSaved
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, isSaved: newValue } : c)))

    // Sync to Supabase (best-effort, skip local-only chats)
    if (!id.startsWith('local-')) {
      const result = await toggleSaveConversation(id, chat.isSaved)
      if (result === null) {
        // Revert on failure
        setChats((prev) => prev.map((c) => (c.id === id ? { ...c, isSaved: chat.isSaved } : c)))
      }
    }
  }

  const deleteChat = async (id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id))
    if (currentChatId === id) {
      const remaining = chats.filter((c) => c.id !== id)
      setCurrentChatId(remaining.length > 0 ? remaining[0].id : null)
    }

    // Sync deletion to Supabase (best-effort)
    if (!id.startsWith('local-')) {
      try {
        await deleteConversationFromDb(id)
      } catch (error) {
        console.error('[aiWeb] Error deleting from Supabase:', error)
      }
    }
  }

  // ------------------------------------------------------------------
  // Update messages – save to localStorage immediately, sync to Supabase
  // ------------------------------------------------------------------
  const updateMessages = async (messages: Message[]) => {
    if (!user) return

    const activeChatId = currentChatIdRef.current

    if (!activeChatId) {
      // No active chat – create one locally right away
      const title = generateChatTitle(messages)
      const localId = 'local-' + crypto.randomUUID()
      const tempChat: Chat = { id: localId, title, messages, isSaved: false, createdAt: new Date() }

      setChats((prev) => [tempChat, ...prev])
      setCurrentChatId(localId)
      currentChatIdRef.current = localId

      // Background: persist to Supabase
      try {
        const newConv = await createConversation(user.id, title, selectedModel)
        if (newConv) {
          for (const msg of messages) {
            await addMessage(newConv.id, msg.role, msg.content)
          }
          setChats((prev) =>
            prev.map((c) => (c.id === localId ? { ...c, id: newConv.id } : c))
          )
          if (currentChatIdRef.current === localId) {
            setCurrentChatId(newConv.id)
            currentChatIdRef.current = newConv.id
          }
        }
      } catch (error) {
        console.error('[aiWeb] Error persisting chat to Supabase:', error)
      }
    } else {
      // Update existing chat – local state first
      setChats((prev) => {
        const existing = prev.find((c) => c.id === activeChatId)
        const existingCount = existing?.messages.length || 0
        const newMsgs = messages.slice(existingCount)
        const newTitle =
          existing?.title === 'New Chat' ? generateChatTitle(messages) : existing?.title

        // Background: persist new messages to Supabase (real IDs only)
        if (!activeChatId.startsWith('local-') && newMsgs.length > 0) {
          for (const msg of newMsgs) {
            addMessage(activeChatId, msg.role, msg.content).catch((err) =>
              console.error('[aiWeb] Error saving message to Supabase:', err)
            )
          }
          if (newTitle && newTitle !== existing?.title) {
            updateConversationTitle(activeChatId, newTitle).catch((err) =>
              console.error('[aiWeb] Error updating title in Supabase:', err)
            )
          }
        }

        return prev.map((chat) =>
          chat.id === activeChatId
            ? { ...chat, messages, title: newTitle || chat.title }
            : chat
        )
      })
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Sign out error:', error)
      }
    }
  }

  const handleSidebarClose = () => {
    if (window.innerWidth <= 768) setSidebarOpen(false)
  }

  // Show loading screen while Clerk (and profile) are initializing
  if (authLoading) {
    return (
      <div className="auth-loading-page">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    )
  }

  // Not signed in → show auth routes only
  if (!user) {
    return (
      <div className="auth-layout">
        <Routes>
          <Route
            path="/login/*"
            element={
              <PublicRoute>
                <AuthPage mode="login" />
              </PublicRoute>
            }
          />
          <Route
            path="/signup/*"
            element={
              <PublicRoute>
                <AuthPage mode="signup" />
              </PublicRoute>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </div>
    )
  }

  // Signed in → full app
  return (
    <div className={`app-layout ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar
        chats={chats}
        currentChatId={currentChatId}
        onNewChat={() => {
          createNewChat()
          handleSidebarClose()
        }}
        onSelectChat={(id) => {
          selectChat(id)
          handleSidebarClose()
        }}
        onToggleSaveChat={toggleSaveChat}
        onDeleteChat={deleteChat}
        theme={theme}
        onToggleTheme={toggleTheme}
        onClose={() => setSidebarOpen(false)}
        isLoading={chatsLoading}
      />

      <main className="main-content">
        <header className="header">
          <button
            className="menu-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Close menu' : 'Open menu'}
          >
            ☰
          </button>
          <h1>aiWeb</h1>
          <div className="header-actions">
            <span
              className={`model-badge ${!canUseModel(selectedModel) ? 'locked' : ''}`}
              title="Current model"
            >
              {!canUseModel(selectedModel) && '🔒 '}
              {selectedModel.split('/').pop()}
            </span>
            <div className="user-menu">
              <span className="user-email">{user.email ?? 'User'}</span>
              <button onClick={handleSignOut} className="sign-out-btn" title="Sign out">
                Sign Out
              </button>
            </div>
          </div>
        </header>

        <UsageIndicator />

        <Routes>
          <Route
            path="/"
            element={
              <ChatPage
                messages={currentMessages}
                onMessagesUpdate={updateMessages}
                apiKey={apiKey}
                selectedModel={selectedModel}
                onNeedApiKey={() => navigate('/admin')}
                canUseModel={canUseModel}
                remainingMessages={remainingMessages}
                consumeMessage={consumeMessage}
                tier={tier}
              />
            }
          />
          <Route
            path="/admin"
            element={
              <AdminPage
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                canUseModel={canUseModel}
                tier={tier}
              />
            }
          />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

// -------------------------------------------------------
// Root app – Router → ClerkProvider → AuthProvider → content
// -------------------------------------------------------
function App() {
  return (
    <Router>
      <ClerkProviderWithRouter>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ClerkProviderWithRouter>
    </Router>
  )
}

export default App
