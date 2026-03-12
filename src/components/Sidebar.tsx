import { Link, useLocation } from 'react-router-dom'

interface Chat {
  id: string
  title: string
  isSaved: boolean
  createdAt: Date
}

interface SidebarProps {
  chats: Chat[]
  currentChatId: string | null
  onNewChat: () => void
  onSelectChat: (id: string) => void
  onToggleSaveChat: (id: string) => void
  onDeleteChat: (id: string) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onClose?: () => void
  isLoading?: boolean
}

function Sidebar({ chats, currentChatId, onNewChat, onSelectChat, onToggleSaveChat, onDeleteChat, theme, onToggleTheme, onClose, isLoading }: SidebarProps) {
  const location = useLocation()

  const savedChats = chats.filter((c) => c.isSaved)
  const recentChats = chats.filter((c) => !c.isSaved)

  const renderChatItem = (chat: Chat) => (
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
        className={`save-chat-btn ${chat.isSaved ? 'saved' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggleSaveChat(chat.id)
        }}
        title={chat.isSaved ? 'Remove from saved' : 'Save this chat'}
      >
        {chat.isSaved ? '🔖' : '📌'}
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
  )

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
        {isLoading ? (
          <div className="chats-loading">
            <div className="loading-spinner-small"></div>
            <p>Loading chats...</p>
          </div>
        ) : chats.length === 0 ? (
          <p className="no-chats">No chats yet</p>
        ) : (
          <>
            {savedChats.length > 0 && (
              <div className="chat-list-section">
                <h3>
                  <span className="section-icon">🔖</span> Saved
                </h3>
                <ul>
                  {savedChats.map(renderChatItem)}
                </ul>
              </div>
            )}

            {recentChats.length > 0 && (
              <div className="chat-list-section">
                <h3>
                  <span className="section-icon">🕒</span> Recent
                </h3>
                <ul>
                  {recentChats.map(renderChatItem)}
                </ul>
              </div>
            )}
          </>
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
