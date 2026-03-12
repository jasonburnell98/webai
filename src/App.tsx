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
import {
  getConversations,
  getConversationWithMessages,
  createConversation,
  updateConversationTitle,
  deleteConversation as deleteConversationFromDb,
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
  createdAt: Date
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
  // Load conversations from Supabase once we know the user
  // ------------------------------------------------------------------
  const loadChats = useCallback(async () => {
    if (!user) {
      setChats([])
      setCurrentChatId(null)
      setChatsLoading(false)
      return
    }

    setChatsLoading(true)
    try {
      const conversations = await getConversations(user.id)
      const loadedChats: Chat[] = conversations.map((conv: Conversation) => ({
        id: conv.id,
        title: conv.title,
        messages: [],
        createdAt: new Date(conv.created_at),
      }))

      setChats(loadedChats)

      if (loadedChats.length > 0 && !currentChatId) {
        setCurrentChatId(loadedChats[0].id)
      }
    } catch (error) {
      console.error('Error loading chats:', error)
    } finally {
      setChatsLoading(false)
    }
  }, [user, currentChatId])

  // Load messages for the current chat
  const loadCurrentChatMessages = useCallback(async () => {
    if (!currentChatId || !user) return
    try {
      const conversation = await getConversationWithMessages(currentChatId)
      if (conversation) {
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
      console.error('Error loading messages:', error)
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

  // Load messages when current chat changes (skip temp chats)
  useEffect(() => {
    if (currentChatId && !currentChatId.startsWith('temp-')) {
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

  const createNewChat = async () => {
    if (!user) return
    try {
      const newConv = await createConversation(user.id, 'New Chat', selectedModel)
      if (newConv) {
        const newChat: Chat = {
          id: newConv.id,
          title: newConv.title,
          messages: [],
          createdAt: new Date(newConv.created_at),
        }
        setChats((prev) => [newChat, ...prev])
        setCurrentChatId(newConv.id)
      }
    } catch (error) {
      console.error('Error creating new chat:', error)
    }
    navigate('/')
  }

  const selectChat = (id: string) => {
    setCurrentChatId(id)
    navigate('/')
  }

  const deleteChat = async (id: string) => {
    try {
      const success = await deleteConversationFromDb(id)
      if (success) {
        setChats((prev) => prev.filter((c) => c.id !== id))
        if (currentChatId === id) {
          const remaining = chats.filter((c) => c.id !== id)
          setCurrentChatId(remaining.length > 0 ? remaining[0].id : null)
        }
      }
    } catch (error) {
      console.error('Error deleting chat:', error)
    }
  }

  const updateMessages = async (messages: Message[]) => {
    if (!user) return

    const activeChatId = currentChatIdRef.current

    if (!activeChatId) {
      const title = generateChatTitle(messages)
      const tempId = 'temp-' + Date.now()
      const tempChat: Chat = { id: tempId, title, messages, createdAt: new Date() }
      setChats((prev) => [tempChat, ...prev])
      setCurrentChatId(tempId)
      currentChatIdRef.current = tempId

      try {
        const newConv = await createConversation(user.id, title, selectedModel)
        if (newConv) {
          for (const msg of messages) {
            await addMessage(newConv.id, msg.role, msg.content)
          }
          setChats((prev) =>
            prev.map((c) => (c.id === tempId ? { ...c, id: newConv.id } : c))
          )
          setCurrentChatId(newConv.id)
          currentChatIdRef.current = newConv.id
        }
      } catch (error) {
        console.error('Error persisting chat:', error)
      }
    } else {
      setChats((prev) => {
        const existing = prev.find((c) => c.id === activeChatId)
        const existingCount = existing?.messages.length || 0

        // Persist new messages to Supabase in the background
        const newMsgs = messages.slice(existingCount)
        for (const msg of newMsgs) {
          addMessage(activeChatId, msg.role, msg.content).catch((err) =>
            console.error('Error saving message:', err)
          )
        }

        const newTitle =
          existing?.title === 'New Chat' ? generateChatTitle(messages) : existing?.title
        if (newTitle !== existing?.title && newTitle) {
          updateConversationTitle(activeChatId, newTitle).catch((err) =>
            console.error('Error updating title:', err)
          )
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
