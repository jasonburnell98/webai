import { useState, useEffect, useCallback, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate, Navigate } from 'react-router-dom'
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

// Public route - redirects to home if already logged in
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

function AppContent() {
  const navigate = useNavigate()
  const { user, session, loading: authLoading, signOut, tier, canUseModel, remainingMessages, consumeMessage } = useAuth()
  
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('aiweb_theme')
    return (saved as 'light' | 'dark') || 'dark'
  })

  const [chats, setChats] = useState<Chat[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const currentChatIdRef = useRef<string | null>(null)
  const [chatsLoading, setChatsLoading] = useState(true)
  const [apiKey] = useState(() => localStorage.getItem('aiweb_api_key') || '')
  const [selectedModel, setSelectedModel] = useState(() => 
    localStorage.getItem('aiweb_model') || 'meta-llama/llama-3.1-70b-instruct'
  )
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // Start with sidebar closed on mobile
    return window.innerWidth > 768
  })

  // Load chats from Supabase when user logs in
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
      
      // Convert Supabase conversations to local Chat format
      const loadedChats: Chat[] = conversations.map((conv: Conversation) => ({
        id: conv.id,
        title: conv.title,
        messages: [], // Messages will be loaded on demand
        createdAt: new Date(conv.created_at)
      }))
      
      setChats(loadedChats)
      
      // Select the most recent chat if one exists and none is selected
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
          content: msg.content
        }))
        
        setChats(prev => prev.map(chat => 
          chat.id === currentChatId 
            ? { ...chat, messages, title: conversation.title }
            : chat
        ))
      }
    } catch (error) {
      console.error('Error loading messages:', error)
    }
  }, [currentChatId, user])

  // Load chats when auth is fully initialized and session is available
  // Must wait for authLoading to be false to ensure Supabase client has proper session
  useEffect(() => {
    // Don't do anything while auth is still loading
    if (authLoading) {
      return
    }
    
    if (session?.access_token && user) {
      loadChats()
    } else if (!user) {
      // No user, clear chats
      setChats([])
      setCurrentChatId(null)
      setChatsLoading(false)
    }
  }, [authLoading, user?.id, session?.access_token]) // Re-run when auth loading completes or user/session changes

  // Keep the ref in sync with state
  useEffect(() => {
    currentChatIdRef.current = currentChatId
  }, [currentChatId])

  // Load messages when current chat changes (skip temp chats)
  useEffect(() => {
    if (currentChatId && !currentChatId.startsWith('temp-')) {
      loadCurrentChatMessages()
    }
  }, [currentChatId]) // Only re-run when currentChatId changes

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('aiweb_theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }

  const currentChat = chats.find(c => c.id === currentChatId)
  const currentMessages = currentChat?.messages || []

  const generateChatTitle = (messages: Message[]): string => {
    if (messages.length === 0) return 'New Chat'
    const firstMessage = messages[0].content
    return firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage
  }

  const createNewChat = async () => {
    if (!user) return
    
    try {
      const newConversation = await createConversation(user.id, 'New Chat', selectedModel)
      if (newConversation) {
        const newChat: Chat = {
          id: newConversation.id,
          title: newConversation.title,
          messages: [],
          createdAt: new Date(newConversation.created_at)
        }
        setChats(prev => [newChat, ...prev])
        setCurrentChatId(newConversation.id)
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
        setChats(prev => prev.filter(c => c.id !== id))
        if (currentChatId === id) {
          const remaining = chats.filter(c => c.id !== id)
          setCurrentChatId(remaining.length > 0 ? remaining[0].id : null)
        }
      }
    } catch (error) {
      console.error('Error deleting chat:', error)
    }
  }

  const updateMessages = async (messages: Message[]) => {
    if (!user) return

    // Use ref to always get the latest currentChatId, even in stale closures
    const activeChatId = currentChatIdRef.current

    if (!activeChatId) {
      // Create new chat if none exists
      const title = generateChatTitle(messages)
      
      // Create a temporary local chat immediately so messages display right away
      const tempId = 'temp-' + Date.now()
      const tempChat: Chat = {
        id: tempId,
        title,
        messages,
        createdAt: new Date()
      }
      setChats(prev => [tempChat, ...prev])
      setCurrentChatId(tempId)
      currentChatIdRef.current = tempId

      // Then try to persist to Supabase
      try {
        const newConversation = await createConversation(user.id, title, selectedModel)
        if (newConversation) {
          // Save all messages to the new conversation
          for (const msg of messages) {
            await addMessage(newConversation.id, msg.role, msg.content)
          }
          
          // Replace temp chat with real one
          setChats(prev => prev.map(c => 
            c.id === tempId 
              ? { ...c, id: newConversation.id }
              : c
          ))
          setCurrentChatId(newConversation.id)
          currentChatIdRef.current = newConversation.id
        }
      } catch (error) {
        console.error('Error persisting chat to database:', error)
        // Messages are still visible in the UI from the temp chat
      }
    } else {
      // Update existing chat - update UI state immediately
      setChats(prev => {
        const existingChat = prev.find(c => c.id === activeChatId)
        const existingMessageCount = existingChat?.messages.length || 0
        
        // Save new messages to Supabase (fire and forget - don't block UI)
        const newMsgs = messages.slice(existingMessageCount)
        for (const msg of newMsgs) {
          addMessage(activeChatId, msg.role, msg.content).catch(err => 
            console.error('Error saving message to DB:', err)
          )
        }
        
        // Update title if it was "New Chat" and this is the first message
        const newTitle = existingChat?.title === 'New Chat' ? generateChatTitle(messages) : existingChat?.title
        if (newTitle !== existingChat?.title && newTitle) {
          updateConversationTitle(activeChatId, newTitle).catch(err =>
            console.error('Error updating title:', err)
          )
        }
        
        return prev.map(chat => {
          if (chat.id === activeChatId) {
            return {
              ...chat,
              messages,
              title: newTitle || chat.title
            }
          }
          return chat
        })
      })
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (error) {
      // Ignore AbortError that can occur during sign out
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Sign out error:', error)
      }
    }
    // Navigate happens automatically via the isAuthPage check when user becomes null
  }

  const handleSidebarClose = () => {
    if (window.innerWidth <= 768) {
      setSidebarOpen(false)
    }
  }

  // Show loading screen while auth is initializing
  // This is critical for OAuth callbacks - without this, the app would
  // redirect to /login before Supabase can exchange the ?code= parameter
  if (authLoading) {
    return (
      <div className="auth-loading-page">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    )
  }

  // Don't show sidebar layout on auth pages
  const isAuthPage = !user

  if (isAuthPage) {
    return (
      <div className="auth-layout">
        <Routes>
          <Route 
            path="/login" 
            element={
              <PublicRoute>
                <AuthPage mode="login" />
              </PublicRoute>
            } 
          />
          <Route 
            path="/signup" 
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

  return (
    <div className={`app-layout ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      {/* Mobile overlay */}
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
            <span className={`model-badge ${!canUseModel(selectedModel) ? 'locked' : ''}`} title="Current model">
              {!canUseModel(selectedModel) && '🔒 '}
              {selectedModel.split('/').pop()}
            </span>
            <div className="user-menu">
              <span className="user-email">{user.email}</span>
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
          <Route 
            path="/pricing" 
            element={
              <PricingPage />
            } 
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  )
}

export default App
