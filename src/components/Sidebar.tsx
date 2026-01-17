import { Link, useLocation } from 'react-router-dom'

interface Chat {
  id: string
  title: string
  createdAt: Date
}

interface SidebarProps {
  chats: Chat[]
  currentChatId: string | null
  onNewChat: () => void
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onClose?: () => void
}

function Sidebar({ chats, currentChatId, onNewChat, onSelectChat, onDeleteChat, theme, onToggleTheme, onClose }: SidebarProps) {
  const location = useLocation()

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        {onClose && (
          <button className="sidebar-close-btn" onClick={onClose} title="Close menu">
            ✕
          </button>
        )}
        <button className="new-chat-btn" onClick={onNewChat}>
          <span className="plus-icon">+</span>
          New Chat
        </button>
      </div>

      <nav className="sidebar-nav">
        <Link 
          to="/" 
          className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
          onClick={onClose}
        >
          💬 Chat
        </Link>
        <Link 
          to="/admin" 
          className={`nav-link ${location.pathname === '/admin' ? 'active' : ''}`}
          onClick={onClose}
        >
          ⚙️ Admin
        </Link>
      </nav>

      <div className="chat-list">
        <h3>Recent Chats</h3>
        {chats.length === 0 ? (
          <p className="no-chats">No chats yet</p>
        ) : (
          <ul>
            {chats.map((chat) => (
              <li 
                key={chat.id} 
                className={`chat-item ${currentChatId === chat.id ? 'active' : ''}`}
              >
                <button 
                  className="chat-item-btn"
                  onClick={() => onSelectChat(chat.id)}
                >
                  <span className="chat-title">{chat.title}</span>
                </button>
                <button 
                  className="delete-chat-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteChat(chat.id)
                  }}
                  title="Delete chat"
                >
                  🗑️
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sidebar-footer">
        <button 
          className="sidebar-theme-toggle" 
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <span>{theme === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode'}</span>
          <span className="theme-icon">{theme === 'dark' ? '☀️' : '🌙'}</span>
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
