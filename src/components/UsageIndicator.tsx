import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { TIER_LIMITS } from '../lib/supabase'

function UsageIndicator() {
  const { user, tier, remainingMessages } = useAuth()

  if (!user) return null

  const maxMessages = TIER_LIMITS.free.messagesPerDay
  const usedMessages = tier === 'pro' ? 0 : maxMessages - remainingMessages
  const percentUsed = tier === 'pro' ? 0 : (usedMessages / maxMessages) * 100

  return (
    <div className="usage-indicator">
      <div className="usage-header">
        <span className="tier-badge">{tier === 'pro' ? '⭐ Pro' : 'Free'}</span>
        {tier === 'free' && (
          <Link to="/pricing" className="upgrade-link">Upgrade</Link>
        )}
      </div>
      
      {tier === 'free' ? (
        <>
          <div className="usage-bar">
            <div 
              className={`usage-fill ${percentUsed >= 80 ? 'warning' : ''} ${percentUsed >= 100 ? 'depleted' : ''}`}
              style={{ width: `${Math.min(100, percentUsed)}%` }}
            />
          </div>
          <div className="usage-text">
            <span>{remainingMessages} messages left today</span>
            <span className="usage-max">/ {maxMessages}</span>
          </div>
        </>
      ) : (
        <div className="usage-text pro">
          <span>Unlimited messages</span>
        </div>
      )}
    </div>
  )
}

export default UsageIndicator
