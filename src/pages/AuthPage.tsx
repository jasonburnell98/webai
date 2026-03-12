import { SignIn, SignUp } from '@clerk/react'

interface AuthPageProps {
  mode: 'login' | 'signup'
}

function AuthPage({ mode }: AuthPageProps) {
  return (
    <div className="auth-page">
      <div className="auth-clerk-wrapper">
        {mode === 'login' ? (
          <SignIn
            routing="path"
            path="/login"
            signUpUrl="/signup"
            fallbackRedirectUrl="/"
            appearance={{
              elements: {
                rootBox: 'clerk-root',
                card: 'clerk-card',
              },
            }}
          />
        ) : (
          <SignUp
            routing="path"
            path="/signup"
            signInUrl="/login"
            fallbackRedirectUrl="/"
            appearance={{
              elements: {
                rootBox: 'clerk-root',
                card: 'clerk-card',
              },
            }}
          />
        )}
      </div>
    </div>
  )
}

export default AuthPage
