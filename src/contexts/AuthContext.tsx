import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { User, Session, AuthError } from '@supabase/supabase-js'
import { supabase, getRemainingMessages, incrementMessageUsage, isModelAvailable } from '../lib/supabase'
import type { UserProfile } from '../lib/supabase'

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  remainingMessages: number
  tier: 'free' | 'pro'
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signInWithGoogle: () => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  refreshUsage: () => Promise<void>
  consumeMessage: () => Promise<boolean>
  canUseModel: (modelId: string) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [remainingMessages, setRemainingMessages] = useState(0)

  const tier = profile?.tier || 'free'

  // Fetch user profile from database
  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Error fetching profile:', error)
      // Profile doesn't exist, create one
      if (error.code === 'PGRST116') {
        const { data: userData } = await supabase.auth.getUser()
        if (userData.user) {
          const newProfile = {
            id: userId,
            email: userData.user.email || '',
            tier: 'free' as const,
            messages_used_today: 0,
            last_usage_reset: new Date().toISOString(),
          }
          
          const { data: createdProfile, error: createError } = await supabase
            .from('user_profiles')
            .insert(newProfile)
            .select()
            .single()

          if (!createError && createdProfile) {
            setProfile(createdProfile)
            return createdProfile
          }
        }
      }
      return null
    }

    setProfile(data)
    return data
  }

  // Refresh usage count
  const refreshUsage = async () => {
    if (!user) {
      setRemainingMessages(0)
      return
    }
    const remaining = await getRemainingMessages(user.id)
    setRemainingMessages(remaining)
  }

  // Refresh profile
  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id)
      await refreshUsage()
    }
  }

  // Use a message (decrement counter)
  const useMessage = async (): Promise<boolean> => {
    if (!user) return false
    
    if (tier === 'pro') return true
    
    if (remainingMessages <= 0) return false
    
    const success = await incrementMessageUsage(user.id)
    if (success) {
      setRemainingMessages(prev => Math.max(0, prev - 1))
    }
    return success
  }

  // Check if user can use a specific model
  const canUseModel = (modelId: string): boolean => {
    return isModelAvailable(modelId, tier)
  }

  // Initialize auth state
  useEffect(() => {
    let isMounted = true
    const profileSubscription: ReturnType<typeof supabase.channel> | null = null

    // Get initial session
    const initializeAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('Error getting session:', error)
        }
        
        if (isMounted) {
          setSession(session)
          setUser(session?.user ?? null)
          
          if (session?.user) {
            try {
              await fetchProfile(session.user.id)
              const remaining = await getRemainingMessages(session.user.id)
              if (isMounted) {
                setRemainingMessages(remaining)
              }
            } catch (profileError) {
              console.error('Error fetching profile:', profileError)
            }
          }
          
          setLoading(false)
        }
      } catch (error) {
        console.error('Auth initialization error:', error)
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    initializeAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!isMounted) return
        
        setSession(session)
        setUser(session?.user ?? null)
        
        if (session?.user) {
          try {
            await fetchProfile(session.user.id)
            const remaining = await getRemainingMessages(session.user.id)
            if (isMounted) {
              setRemainingMessages(remaining)
            }
          } catch (error) {
            console.error('Error in auth state change:', error)
          }
        } else {
          setProfile(null)
          setRemainingMessages(0)
        }
        
        setLoading(false)
      }
    )

    return () => {
      isMounted = false
      subscription.unsubscribe()
      if (profileSubscription) {
        supabase.removeChannel(profileSubscription)
      }
    }
  }, [])

  // Subscribe to realtime profile changes (tier updates from Supabase)
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel(`profile-changes-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          console.log('Profile updated:', payload)
          const newProfile = payload.new as UserProfile
          setProfile(newProfile)
          // If tier changed to pro, set remaining messages to infinity
          if (newProfile.tier === 'pro') {
            setRemainingMessages(Infinity)
          } else {
            // Refresh usage for free tier
            refreshUsage()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  // Auth methods
  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      },
    })
    return { error }
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { error }
  }

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    })
    return { error }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setProfile(null)
    setRemainingMessages(0)
  }

  const value = {
    user,
    session,
    profile,
    loading,
    remainingMessages,
    tier,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    refreshProfile,
    refreshUsage,
    consumeMessage: useMessage,
    canUseModel,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

// HOC for protected routes
export function withAuth<P extends object>(
  WrappedComponent: React.ComponentType<P>
) {
  return function WithAuthComponent(props: P) {
    const { user, loading } = useAuth()

    if (loading) {
      return (
        <div className="auth-loading">
          <div className="loading-spinner"></div>
          <p>Loading...</p>
        </div>
      )
    }

    if (!user) {
      // Redirect to login
      window.location.href = '/login'
      return null
    }

    return <WrappedComponent {...props} />
  }
}
