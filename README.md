# aiWeb

A modern AI chat interface with authentication, subscription tiers, and usage limits. Access multiple AI models through a unified, beautiful interface.

## Features

- 🔐 **Authentication** - Sign up/sign in with email or Google (via Supabase)
- 💎 **Freemium Model** - Free tier (10 messages/day, basic models) and Pro tier (unlimited)
- 🤖 **Multiple AI Models** - Access to GPT-4, Claude, Gemini, Llama, and more
- 💬 **Chat History** - Persistent chat history stored locally
- 💳 **Stripe Integration** - Subscription payments for Pro tier
- 🎨 **Modern UI** - Dark theme, responsive design

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Authentication**: Supabase Auth
- **Database**: Supabase (PostgreSQL)
- **Payments**: Stripe
- **AI**: Multi-model API backend

## Setup Instructions

### 1. Clone and Install

```bash
git clone <your-repo>
cd aiweb
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Settings > API** and copy your:
   - Project URL
   - Anon public key
3. Go to **SQL Editor** and run the schema in `supabase/schema.sql`
4. Enable Email auth in **Authentication > Providers**
5. (Optional) Enable Google OAuth in **Authentication > Providers > Google**

### 3. Set Up Stripe (for payments)

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Create two products/prices:
   - Pro Monthly ($9.99/month)
   - Pro Yearly ($99.99/year)
3. Copy the price IDs and update them in `src/pages/PricingPage.tsx`
4. Copy your publishable key

### 4. Set Up Backend API (for Stripe webhooks)

You'll need a backend server to handle Stripe checkout sessions and webhooks. Create these endpoints:

**POST /api/create-checkout-session**
```javascript
// Creates a Stripe checkout session
// Returns: { url: string }
```

**POST /api/create-portal-session**
```javascript
// Creates a Stripe customer portal session
// Returns: { url: string }
```

**POST /api/webhook (Stripe webhook)**
```javascript
// Handles subscription events
// Updates user tier in Supabase when subscription changes
```

### 5. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```env
# AI API Key
VITE_OPENROUTER_API_KEY=sk-or-v1-your-key

# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Stripe Configuration
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your-key
```

### 6. Run the App

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Tier System

### Free Tier
- 10 messages per day
- Access to basic models:
  - Llama 3.1 70B & 8B
  - Mixtral 8x7B
  - Gemini Flash 1.5
  - GPT-3.5 Turbo

### Pro Tier ($9.99/month or $99.99/year)
- Unlimited messages
- Access to all models:
  - GPT-4, GPT-4o, GPT-4 Turbo
  - Claude Opus, Sonnet
  - Gemini Pro
  - Llama 3.1 405B
  - Mistral Large
  - And more...

## Project Structure

```
src/
├── components/
│   ├── Sidebar.tsx        # Navigation sidebar
│   └── UsageIndicator.tsx # Shows usage/tier status
├── contexts/
│   └── AuthContext.tsx    # Authentication context
├── lib/
│   └── supabase.ts        # Supabase client & tier logic
├── pages/
│   ├── AdminPage.tsx      # Settings/model selection
│   ├── AuthPage.tsx       # Login/signup
│   ├── ChatPage.tsx       # Main chat interface
│   └── PricingPage.tsx    # Subscription plans
├── App.tsx                # Main app with routing
├── App.css                # Styles
└── main.tsx               # Entry point

supabase/
└── schema.sql             # Database schema
```

## Stripe Webhook Setup

Configure your Stripe webhook to listen for:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

When a subscription is created/updated, update the user's tier in Supabase:

```sql
SELECT update_user_tier(
  'user-uuid',
  'pro',
  'cus_xxx',
  'sub_xxx'
);
```

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

## Deployment

### Vercel/Netlify
1. Connect your repository
2. Set environment variables
3. Deploy

### Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["npm", "run", "preview"]
```

## License

MIT
