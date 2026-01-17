import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Sidebar from './components/Sidebar'
import UsageIndicator from './components/UsageIndicator'
import ChatPage from './pages/ChatPage'
import AdminPage from './pages/AdminPage'
import AuthPage from './pages/AuthPage'
import PricingPage from './pages/PricingPage'
import './App.css'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Chat {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
}

// Protected Route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="auth-loading-page">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
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
  const { user, signOut, tier, canUseModel, remainingMessages, consumeMessage } = useAuth()
  
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('webai_theme')
    return (saved as 'light' | 'dark') || 'dark'
  })

  const [chats, setChats] = useState<Chat[]>(() => {
    const saved = localStorage.getItem('webai_chats')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        return parsed.map((chat: Chat) => ({
          ...chat,
          createdAt: new Date(chat.createdAt)
        }))
      } catch {
        return []
      }
    }
    return []
  })
  const [currentChatId, setCurrentChatId] = useState<string | null>(() => {
    return localStorage.getItem('webai_current_chat') || null
  })
  const [apiKey] = useState(() => localStorage.getItem('webai_api_key') || '')
  const [selectedModel, setSelectedModel] = useState(() => 
    localStorage.getItem('webai_model') || 'meta-llama/llama-3.1-70b-instruct'
  )
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Save chats to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('webai_chats', JSON.stringify(chats))
  }, [chats])

  // Save current chat ID
  useEffect(() => {
    if (currentChatId) {
      localStorage.setItem('webai_current_chat', currentChatId)
    } else {
      localStorage.removeItem('webai_current_chat')
    }
  }, [currentChatId])

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('webai_theme', theme)
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

  const createNewChat = () => {
    const newChat: Chat = {
      id: Date.now().toString(),
      title: 'New Chat',
      messages: [],
      createdAt: new Date()
    }
    setChats(prev => [newChat, ...prev])
    setCurrentChatId(newChat.id)
    navigate('/')
  }

  const selectChat = (id: string) => {
    setCurrentChatId(id)
    navigate('/')
  }

  const deleteChat = (id: string) => {
    setChats(prev => prev.filter(c => c.id !== id))
    if (currentChatId === id) {
      const remaining = chats.filter(c => c.id !== id)
      setCurrentChatId(remaining.length > 0 ? remaining[0].id : null)
    }
  }

  const updateMessages = (messages: Message[]) => {
    if (!currentChatId) {
      // Create new chat if none exists
      const newChat: Chat = {
        id: Date.now().toString(),
        title: generateChatTitle(messages),
        messages,
        createdAt: new Date()
      }
      setChats(prev => [newChat, ...prev])
      setCurrentChatId(newChat.id)
    } else {
      setChats(prev => prev.map(chat => {
        if (chat.id === currentChatId) {
          return {
            ...chat,
            messages,
            title: chat.title === 'New Chat' ? generateChatTitle(messages) : chat.title
          }
        }
        return chat
      }))
    }
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className={`app-layout ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <Sidebar
        chats={chats}
        currentChatId={currentChatId}
        onNewChat={createNewChat}
        onSelectChat={selectChat}
        onDeleteChat={deleteChat}
        theme={theme}
        onToggleTheme={toggleTheme}
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
          <h1>webAI</h1>
          <div className="header-actions">
            <span className={`model-badge ${!canUseModel(selectedModel) ? 'locked' : ''}`} title="Current model">
              {!canUseModel(selectedModel) && '🔒 '}
              {selectedModel.split('/').pop()}
            </span>
            {user && (
              <div className="user-menu">
                <span className="user-email">{user.email}</span>
                <button onClick={handleSignOut} className="sign-out-btn" title="Sign out">
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </header>

        {user && <UsageIndicator />}

        <Routes>
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
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
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin" 
            element={
              <ProtectedRoute>
                <AdminPage 
                  selectedModel={selectedModel}
                  onModelChange={setSelectedModel}
                  canUseModel={canUseModel}
                  tier={tier}
                />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/pricing" 
            element={
              <ProtectedRoute>
                <PricingPage />
              </ProtectedRoute>
            } 
          />
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
