import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'

interface Attachment {
  type: 'image'
  url: string  // base64 data URL
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
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach(file => {
      // Only support images for now
      if (!file.type.startsWith('image/')) {
        alert(`"${file.name}" is not a supported file type. Only images are currently supported.`)
        return
      }

      // Max 20MB per file
      if (file.size > 20 * 1024 * 1024) {
        alert(`"${file.name}" is too large. Maximum file size is 20MB.`)
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        const base64Url = reader.result as string
        setAttachments(prev => [...prev, {
          type: 'image',
          url: base64Url,
          name: file.name,
        }])
      }
      reader.readAsDataURL(file)
    })

    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const buildApiContent = (text: string, messageAttachments: Attachment[]) => {
    if (messageAttachments.length === 0) {
      return text
    }

    // Build multimodal content array for OpenRouter/OpenAI format
    const contentParts: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > = []

    if (text.trim()) {
      contentParts.push({ type: 'text', text })
    }

    messageAttachments.forEach(attachment => {
      contentParts.push({
        type: 'image_url',
        image_url: { url: attachment.url },
      })
    })

    return contentParts
  }

  const sendMessage = async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return

    // Check if user can use the selected model
    if (!canUseModel(selectedModel)) {
      onMessagesUpdate([
        ...messages,
        { role: 'user', content: input, attachments: attachments.length > 0 ? attachments : undefined },
        { 
          role: 'assistant', 
          content: `🔒 The model "${selectedModel}" is only available to Pro users. Please upgrade to Pro or select a free model in Settings.` 
        },
      ])
      setInput('')
      setAttachments([])
      return
    }

    // Check if user has remaining messages (for free tier)
    if (tier === 'free' && remainingMessages <= 0) {
      onMessagesUpdate([
        ...messages,
        { role: 'user', content: input, attachments: attachments.length > 0 ? attachments : undefined },
        { 
          role: 'assistant', 
          content: '⚠️ You have reached your daily message limit. Upgrade to Pro for unlimited messages, or wait until tomorrow for your limit to reset.' 
        },
      ])
      setInput('')
      setAttachments([])
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
        { role: 'user', content: input, attachments: attachments.length > 0 ? attachments : undefined },
        { 
          role: 'assistant', 
          content: '⚠️ Unable to send message. You may have reached your daily limit.' 
        },
      ])
      setInput('')
      setAttachments([])
      return
    }

    const currentAttachments = [...attachments]
    const userMessage: Message = { 
      role: 'user', 
      content: input,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    }
    const newMessages = [...messages, userMessage]
    onMessagesUpdate(newMessages)
    setInput('')
    setAttachments([])
    setIsLoading(true)

    try {
      // Build API messages with multimodal content where needed
      const apiMessages = newMessages.map(m => ({
        role: m.role,
        content: m.attachments && m.attachments.length > 0
          ? buildApiContent(m.content, m.attachments)
          : m.content,
      }))

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
          messages: apiMessages,
        }),
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      console.log('[aiWeb] Full API response:', JSON.stringify(data, null, 2).substring(0, 2000))
      
      const choice = data.choices?.[0]
      if (!choice) {
        throw new Error('No choices in API response')
      }
      const msg = choice.message
      console.log('[aiWeb] Message keys:', Object.keys(msg || {}))
      console.log('[aiWeb] content:', JSON.stringify(msg?.content)?.substring(0, 200))
      console.log('[aiWeb] reasoning:', msg?.reasoning ? 'present (' + msg.reasoning.length + ' chars)' : 'absent')
      console.log('[aiWeb] images:', msg?.images ? 'present (' + msg.images.length + ' items)' : 'absent')

      // Extract generated images from the response
      const generatedImages: GeneratedImage[] = []
      if (msg.images && Array.isArray(msg.images)) {
        msg.images.forEach((img: { image_url?: { url: string }; url?: string; index?: number }, idx: number) => {
          const url = img?.image_url?.url || img?.url
          if (url) {
            generatedImages.push({ url, index: img.index ?? idx })
          }
        })
      }

      const rawContent = msg.content || ''
      const reasoning = msg.reasoning || ''

      // Build a display content: if content is empty, use reasoning as the visible text
      // This ensures something is always saved to DB and displayed
      let displayContent = rawContent
      if (!displayContent && reasoning) {
        displayContent = reasoning
      }
      if (!displayContent && generatedImages.length > 0) {
        displayContent = `🖼️ Generated ${generatedImages.length} image${generatedImages.length > 1 ? 's' : ''}`
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: displayContent,
        reasoning: (reasoning && reasoning !== displayContent) ? reasoning : undefined,
        generatedImages: generatedImages.length > 0 ? generatedImages : undefined,
      }
      
      console.log('[aiWeb] Assistant message:', {
        contentLength: assistantMessage.content.length,
        hasReasoning: !!assistantMessage.reasoning,
        imageCount: assistantMessage.generatedImages?.length || 0,
      })
      
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

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue

        const reader = new FileReader()
        reader.onload = () => {
          const base64Url = reader.result as string
          setAttachments(prev => [...prev, {
            type: 'image',
            url: base64Url,
            name: `pasted-image-${Date.now()}.png`,
          }])
        }
        reader.readAsDataURL(file)
      }
    }
  }

  const modelLocked = !canUseModel(selectedModel)
  const noMessages = tier === 'free' && remainingMessages <= 0
  const canSendMessage = !isLoading && !modelLocked && !noMessages && (input.trim() || attachments.length > 0)

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
                {/* Show user attachments if present */}
                {message.attachments && message.attachments.length > 0 && (
                  <div className="message-attachments">
                    {message.attachments.map((attachment, aIdx) => (
                      <div key={aIdx} className="message-attachment-item">
                        <img 
                          src={attachment.url} 
                          alt={attachment.name}
                          className="message-attachment-image"
                          onClick={() => window.open(attachment.url, '_blank')}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Show reasoning in a collapsible section */}
                {message.reasoning && (
                  <details className="reasoning-section">
                    <summary className="reasoning-toggle">💭 Show reasoning</summary>
                    <div className="reasoning-content">{message.reasoning}</div>
                  </details>
                )}

                {/* Show text content */}
                {message.content && <div>{message.content}</div>}

                {/* Show generated images */}
                {message.generatedImages && message.generatedImages.length > 0 && (
                  <div className="generated-images">
                    {message.generatedImages.map((img, imgIdx) => (
                      <div key={imgIdx} className="generated-image-item">
                        <img
                          src={img.url}
                          alt={`Generated image ${img.index + 1}`}
                          className="generated-image"
                          onClick={() => window.open(img.url, '_blank')}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Fallback: if no content, no reasoning, and no images, show a note */}
                {!message.content && !message.reasoning && (!message.generatedImages || message.generatedImages.length === 0) && message.role === 'assistant' && (
                  <div className="empty-response">⚠️ The model returned an empty response.</div>
                )}
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

        {/* Attachment Preview */}
        {attachments.length > 0 && (
          <div className="attachment-preview-bar">
            {attachments.map((attachment, index) => (
              <div key={index} className="attachment-preview-item">
                <img 
                  src={attachment.url} 
                  alt={attachment.name} 
                  className="attachment-preview-thumb"
                />
                <span className="attachment-preview-name">{attachment.name}</span>
                <button 
                  className="attachment-remove-btn"
                  onClick={() => removeAttachment(index)}
                  title="Remove attachment"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="input-container">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          
          {/* Attachment button */}
          <button
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || modelLocked || noMessages}
            title="Attach image"
          >
            📎
          </button>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            onPaste={handlePaste}
            placeholder={
              modelLocked 
                ? "Model requires Pro subscription..." 
                : noMessages 
                  ? "Daily message limit reached..." 
                  : "Type your message... (paste images with Ctrl+V)"
            }
            disabled={isLoading || modelLocked || noMessages}
            rows={1}
          />
          <button 
            onClick={sendMessage} 
            disabled={!canSendMessage}
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
