import { useState } from 'react'
import { Link } from 'react-router-dom'
import { TIER_LIMITS } from '../lib/supabase'

interface AdminPageProps {
  selectedModel: string
  onModelChange: (model: string) => void
  canUseModel: (modelId: string) => boolean
  tier: 'free' | 'pro'
}

const ALL_MODELS = [
  { id: 'anthropic/claude-opus-4.5', name: 'Claude Opus 4.5', provider: 'Anthropic', tier: 'pro' },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'Anthropic', tier: 'pro' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', tier: 'pro' },
  { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic', tier: 'pro' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI', tier: 'pro' },
  { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'OpenAI', tier: 'pro' },
  { id: 'openai/gpt-4', name: 'GPT-4', provider: 'OpenAI', tier: 'pro' },
  { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'OpenAI', tier: 'free' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5', provider: 'Google', tier: 'pro' },
  { id: 'google/gemini-flash-1.5', name: 'Gemini Flash 1.5', provider: 'Google', tier: 'free' },
  { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B', provider: 'Meta', tier: 'pro' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'Meta', tier: 'free' },
  { id: 'meta-llama/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', provider: 'Meta', tier: 'free' },
  { id: 'mistralai/mistral-large', name: 'Mistral Large', provider: 'Mistral', tier: 'pro' },
  { id: 'mistralai/mixtral-8x7b-instruct', name: 'Mixtral 8x7B', provider: 'Mistral', tier: 'free' },
]

function AdminPage({ selectedModel, onModelChange, canUseModel, tier }: AdminPageProps) {
  const [customModel, setCustomModel] = useState('')

  // Get available models based on tier
  const freeModels = ALL_MODELS.filter(m => TIER_LIMITS.free.models.includes(m.id))
  const proModels = ALL_MODELS.filter(m => !TIER_LIMITS.free.models.includes(m.id))

  const handleModelSelect = (modelId: string) => {
    if (canUseModel(modelId)) {
      onModelChange(modelId)
      localStorage.setItem('webai_model', modelId)
    }
  }

  const handleCustomModelSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (customModel.trim() && tier === 'pro') {
      handleModelSelect(customModel.trim())
      setCustomModel('')
    }
  }

  const groupedFreeModels = freeModels.reduce((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = []
    }
    acc[model.provider].push(model)
    return acc
  }, {} as Record<string, typeof freeModels>)

  const groupedProModels = proModels.reduce((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = []
    }
    acc[model.provider].push(model)
    return acc
  }, {} as Record<string, typeof proModels>)

  return (
    <div className="admin-page">
      <h1>Settings</h1>

      {tier === 'free' && (
        <div className="tier-info-banner">
          <div className="tier-badge-large">Free Tier</div>
          <p>You have access to basic models. <Link to="/pricing">Upgrade to Pro</Link> for access to all models including GPT-4, Claude Opus, and more.</p>
        </div>
      )}

      {tier === 'pro' && (
        <div className="tier-info-banner pro">
          <div className="tier-badge-large pro">⭐ Pro</div>
          <p>You have access to all models!</p>
        </div>
      )}

      <section className="admin-section">
        <h2>Model Selection</h2>
        <p className="section-description">
          Choose which AI model to use for chat conversations.
        </p>
        
        <div className="current-model">
          <strong>Current Model:</strong> 
          <code className={!canUseModel(selectedModel) ? 'locked' : ''}>
            {!canUseModel(selectedModel) && '🔒 '}
            {selectedModel}
          </code>
          {!canUseModel(selectedModel) && (
            <span className="model-warning">
              This model requires Pro. <Link to="/pricing">Upgrade</Link>
            </span>
          )}
        </div>

        {tier === 'pro' && (
          <div className="custom-model-form">
            <h3>Custom Model</h3>
            <form onSubmit={handleCustomModelSubmit}>
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="Enter model ID (e.g., provider/model-name)"
                className="admin-input"
              />
              <button type="submit" className="admin-btn secondary">
                Use Custom Model
              </button>
            </form>
          </div>
        )}

        {/* Free Models */}
        <div className="model-list">
          <h3>
            Free Models
            <span className="model-count">Available to all users</span>
          </h3>
          {Object.entries(groupedFreeModels).map(([provider, models]) => (
            <div key={provider} className="model-group">
              <h4>{provider}</h4>
              <div className="model-options">
                {models.map((model) => (
                  <button
                    key={model.id}
                    className={`model-option ${selectedModel === model.id ? 'selected' : ''}`}
                    onClick={() => handleModelSelect(model.id)}
                  >
                    <span className="model-name">{model.name}</span>
                    <span className="model-id">{model.id}</span>
                    {selectedModel === model.id && <span className="check">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Pro Models */}
        <div className="model-list pro-models">
          <h3>
            Pro Models
            <span className="model-count">
              {tier === 'pro' ? 'Included in your plan' : '🔒 Requires Pro subscription'}
            </span>
          </h3>
          {Object.entries(groupedProModels).map(([provider, models]) => (
            <div key={provider} className="model-group">
              <h4>{provider}</h4>
              <div className="model-options">
                {models.map((model) => (
                  <button
                    key={model.id}
                    className={`model-option ${selectedModel === model.id ? 'selected' : ''} ${tier === 'free' ? 'locked' : ''}`}
                    onClick={() => handleModelSelect(model.id)}
                    disabled={tier === 'free'}
                  >
                    {tier === 'free' && <span className="lock-icon">🔒</span>}
                    <span className="model-name">{model.name}</span>
                    <span className="model-id">{model.id}</span>
                    {selectedModel === model.id && <span className="check">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          
          {tier === 'free' && (
            <div className="upgrade-prompt">
              <p>Want access to premium models like GPT-4, Claude Opus, and more?</p>
              <Link to="/pricing" className="upgrade-btn">
                Upgrade to Pro
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default AdminPage
