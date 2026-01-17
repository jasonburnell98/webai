import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { TIER_LIMITS } from '../lib/supabase'

const PRICING_PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Perfect for trying out the service',
    features: [
      `${TIER_LIMITS.free.messagesPerDay} messages per day`,
      'Basic AI models',
      'Llama 3.1, Mixtral, GPT-3.5',
      'Chat history saved locally',
    ],
    limitations: [
      'Limited to basic models',
      'Daily message limit',
    ],
    cta: 'Current Plan',
    popular: false,
  },
  {
    id: 'pro_monthly',
    name: 'Pro Monthly',
    price: '$9.99',
    period: '/month',
    description: 'For power users who need more',
    features: [
      'Unlimited messages',
      'All AI models',
      'GPT-4, Claude Opus, Gemini Pro',
      'Priority support',
      'Chat history saved locally',
    ],
    limitations: [],
    cta: 'Upgrade to Pro',
    popular: true,
    priceId: 'price_pro_monthly', // Replace with your Stripe price ID
  },
  {
    id: 'pro_yearly',
    name: 'Pro Yearly',
    price: '$99.99',
    period: '/year',
    description: 'Best value - save 17%',
    features: [
      'Everything in Pro Monthly',
      '2 months free',
      'Unlimited messages',
      'All AI models',
      'Priority support',
    ],
    limitations: [],
    cta: 'Upgrade to Pro',
    popular: false,
    priceId: 'price_pro_yearly', // Replace with your Stripe price ID
  },
]

function PricingPage() {
  const { user, tier, profile } = useAuth()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState('')

  const handleSubscribe = async (priceId: string, planId: string) => {
    if (!user) {
      window.location.href = '/login'
      return
    }

    setLoading(planId)
    setError('')

    try {
      // Create checkout session via your backend
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId,
          userId: user.id,
          email: user.email,
          customerId: profile?.stripe_customer_id,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create checkout session')
      }

      const { url } = await response.json()
      
      // Redirect to Stripe Checkout
      if (url) {
        window.location.href = url
      } else {
        setError('Failed to get checkout URL')
      }
    } catch (err) {
      console.error('Checkout error:', err)
      setError('Failed to start checkout. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  const handleManageSubscription = async () => {
    if (!user || !profile?.stripe_customer_id) return

    setLoading('manage')
    setError('')

    try {
      const response = await fetch('/api/create-portal-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: profile.stripe_customer_id,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create portal session')
      }

      const { url } = await response.json()
      window.location.href = url
    } catch (err) {
      console.error('Portal error:', err)
      setError('Failed to open subscription management. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="pricing-page">
      <div className="pricing-header">
        <h1>Choose Your Plan</h1>
        <p>Get unlimited access to all AI models with Pro</p>
        {tier === 'pro' && (
          <div className="current-plan-banner">
            ✓ You're on the Pro plan
            <button 
              onClick={handleManageSubscription}
              className="manage-btn"
              disabled={loading === 'manage'}
            >
              {loading === 'manage' ? 'Loading...' : 'Manage Subscription'}
            </button>
          </div>
        )}
      </div>

      {error && <div className="pricing-error">{error}</div>}

      <div className="pricing-grid">
        {PRICING_PLANS.map((plan) => (
          <div 
            key={plan.id} 
            className={`pricing-card ${plan.popular ? 'popular' : ''} ${tier === 'pro' && plan.id === 'free' ? 'disabled' : ''}`}
          >
            {plan.popular && <div className="popular-badge">Most Popular</div>}
            
            <div className="plan-header">
              <h2>{plan.name}</h2>
              <div className="plan-price">
                <span className="price">{plan.price}</span>
                <span className="period">{plan.period}</span>
              </div>
              <p className="plan-description">{plan.description}</p>
            </div>

            <ul className="plan-features">
              {plan.features.map((feature, index) => (
                <li key={index} className="feature">
                  <span className="check">✓</span>
                  {feature}
                </li>
              ))}
              {plan.limitations.map((limitation, index) => (
                <li key={`limit-${index}`} className="limitation">
                  <span className="x">✗</span>
                  {limitation}
                </li>
              ))}
            </ul>

            <div className="plan-cta">
              {plan.id === 'free' ? (
                <button 
                  className="cta-btn free" 
                  disabled
                >
                  {tier === 'free' ? 'Current Plan' : 'Free Tier'}
                </button>
              ) : (
                <button
                  className={`cta-btn ${plan.popular ? 'primary' : 'secondary'}`}
                  onClick={() => handleSubscribe(plan.priceId!, plan.id)}
                  disabled={loading === plan.id || tier === 'pro'}
                >
                  {loading === plan.id ? 'Loading...' : tier === 'pro' ? 'Current Plan' : plan.cta}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="pricing-faq">
        <h2>Frequently Asked Questions</h2>
        
        <div className="faq-item">
          <h3>What models are included in the free tier?</h3>
          <p>Free users have access to Llama 3.1 70B, Mixtral 8x7B, Gemini Flash, and GPT-3.5 Turbo.</p>
        </div>
        
        <div className="faq-item">
          <h3>What models are included in Pro?</h3>
          <p>Pro users have access to all models including GPT-4, GPT-4o, Claude Opus, Claude Sonnet, Gemini Pro, and many more.</p>
        </div>
        
        <div className="faq-item">
          <h3>Can I cancel my subscription anytime?</h3>
          <p>Yes, you can cancel your subscription at any time. You'll continue to have Pro access until the end of your billing period.</p>
        </div>
        
        <div className="faq-item">
          <h3>Is my payment information secure?</h3>
          <p>Yes, all payments are processed securely through Stripe. We never store your credit card information.</p>
        </div>
      </div>
    </div>
  )
}

export default PricingPage
