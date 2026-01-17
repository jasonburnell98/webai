import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ChatPageProps {
  messages: Message[]
  onMessagesUpdate: (messages: Message[]) => void
  apiKey: string
  selectedModel: string
  onNeedApiKey: () => void
  canUseModel: (modelId: string) => boolean
  remainingMessages: number
  consumeMessage: () => Promise<boolean>
  tier: 'free' | 'pro'
}

function ChatPage({ 
  messages, 
  onMessagesUpdate, 
  apiKey, 
  selectedModel, 
  onNeedApiKey,
  canUseModel,
  remainingMessages,
  consumeMessage,
  tier
}: ChatPageProps) {
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

    // Check if user can use the selected model
    if (!canUseModel(selectedModel)) {
      onMessagesUpdate([
        ...messages,
        { role: 'user', content: input },
        { 
          role: 'assistant', 
          content: `🔒 The model "${selectedModel}" is only available to Pro users. Please upgrade to Pro or select a free model in Settings.` 
        },
      ])
      setInput('')
      return
    }

    // Check if user has remaining messages (for free tier)
    if (tier === 'free' && remainingMessages <= 0) {
      onMessagesUpdate([
        ...messages,
        { role: 'user', content: input },
        { 
          role: 'assistant', 
          content: '⚠️ You have reached your daily message limit. Upgrade to Pro for unlimited messages, or wait until tomorrow for your limit to reset.' 
        },
      ])
      setInput('')
      return
    }

    const effectiveApiKey = apiKey || import.meta.env.VITE_OPENROUTER_API_KEY

    if (!effectiveApiKey) {
      onNeedApiKey()
      return
    }

    // Use a message (decrement counter for free users)
    const canSend = await consumeMessage()
    if (!canSend && tier === 'free') {
      onMessagesUpdate([
        ...messages,
        { role: 'user', content: input },
        { 
          role: 'assistant', 
          content: '⚠️ Unable to send message. You may have reached your daily limit.' 
        },
      ])
      setInput('')
      return
    }

    const userMessage: Message = { role: 'user', content: input }
    const newMessages = [...messages, userMessage]
    onMessagesUpdate(newMessages)
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${effectiveApiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'aiWeb',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: newMessages.map(m => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.choices[0].message.content,
      }
      onMessagesUpdate([...newMessages, assistantMessage])
    } catch (error) {
      console.error('Error:', error)
      onMessagesUpdate([
        ...newMessages,
        { role: 'assistant', content: 'Sorry, there was an error processing your request. Please check your API key and try again.' },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const modelLocked = !canUseModel(selectedModel)
  const noMessages = tier === 'free' && remainingMessages <= 0

  return (
    <div className="chat-page">
      {/* Tier/Usage Warning Banners */}
      {modelLocked && (
        <div className="tier-warning model-locked">
          🔒 The selected model requires a Pro subscription.{' '}
          <Link to="/pricing">Upgrade to Pro</Link> or{' '}
          <Link to="/admin">select a free model</Link>.
        </div>
      )}
      {noMessages && !modelLocked && (
        <div className="tier-warning no-messages">
          ⚠️ You've used all {tier === 'free' ? '10' : 'your'} messages for today.{' '}
          <Link to="/pricing">Upgrade to Pro</Link> for unlimited messages.
        </div>
      )}

      <div className="chat-container">
        <div className="messages">
          {messages.length === 0 && (
            <div className="welcome-message">
              <h2>Welcome to aiWeb!</h2>
              <p>Start a conversation by typing a message below.</p>
              <p className="model-info">
                Using model: <code className={modelLocked ? 'locked' : ''}>{selectedModel}</code>
                {modelLocked && <span className="lock-badge">🔒 Pro Only</span>}
              </p>
              {tier === 'free' && (
                <p className="usage-info">
                  You have <strong>{remainingMessages}</strong> messages remaining today.
                </p>
              )}
            </div>
          )}
          {messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>
              <div className="message-content">
                {message.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="message assistant">
              <div className="message-content loading">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-container">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={
              modelLocked 
                ? "Model requires Pro subscription..." 
                : noMessages 
                  ? "Daily message limit reached..." 
                  : "Type your message..."
            }
            disabled={isLoading || modelLocked || noMessages}
            rows={1}
          />
          <button 
            onClick={sendMessage} 
            disabled={isLoading || !input.trim() || modelLocked || noMessages}
            className="send-btn"
          >
            {isLoading ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChatPage
