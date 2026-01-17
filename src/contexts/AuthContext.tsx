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
    let cachedUser: User | null = null
    let cachedSessionData: Session | null = null

    // Get initial session with timeout
    const initializeAuth = async () => {
      // First, try to quickly get session from localStorage cache
      const cachedSession = localStorage.getItem('open-router-ui-auth')
      if (cachedSession) {
        try {
          const parsed = JSON.parse(cachedSession)
          if (parsed?.access_token && parsed?.user) {
            // Check if token is not expired (with some buffer)
            const expiresAt = parsed.expires_at
            const now = Math.floor(Date.now() / 1000)
            const isValid = !expiresAt || expiresAt > now - 60 // Allow 60 seconds buffer
            
            if (isValid) {
              // We have a valid cached session, set it immediately for faster UX
              cachedUser = parsed.user as User
              cachedSessionData = parsed as Session
              if (isMounted) {
                setUser(cachedUser)
                setSession(cachedSessionData)
                // If we have a cached session, set loading to false quickly
                // This prevents the "sign in" popup from showing
                setLoading(false)
              }
            }
          }
        } catch {
          // Ignore parsing errors
        }
      }

      // Set a timeout to prevent infinite loading - only matters if no cached session
      const loadingTimeout = setTimeout(() => {
        if (isMounted && loading) {
          console.warn('Auth initialization timed out')
          // If we had a cached session, keep using it
          if (cachedUser && cachedSessionData) {
            console.log('Using cached session after timeout')
            setUser(cachedUser)
            setSession(cachedSessionData)
          }
          setLoading(false)
        }
      }, 15000) // 15 second timeout (increased from 5)

      try {
        // Now verify/refresh the session with Supabase in the background
        const { data: { session }, error } = await supabase.auth.getSession()
        
        clearTimeout(loadingTimeout)
        
        if (error) {
          console.error('Error getting session:', error)
          // If we have a cached session and the network request failed, keep using it
          if (cachedUser && cachedSessionData && isMounted) {
            console.log('Network error but using cached session')
            setUser(cachedUser)
            setSession(cachedSessionData)
            setLoading(false)
            
            // Still try to fetch profile with cached user
            fetchProfile(cachedUser.id).catch((profileError) => {
              console.error('Error fetching profile:', profileError)
            })
            
            getRemainingMessages(cachedUser.id).then((remaining) => {
              if (isMounted) {
                setRemainingMessages(remaining)
              }
            }).catch((err) => {
              console.error('Error fetching remaining messages:', err)
            })
            return
          }
        }
        
        if (isMounted) {
          // Update with fresh session data
          setSession(session)
          setUser(session?.user ?? null)
          setLoading(false)
          
          if (session?.user) {
            // Fetch profile in the background (non-blocking)
            fetchProfile(session.user.id).catch((profileError) => {
              console.error('Error fetching profile:', profileError)
            })
            
            getRemainingMessages(session.user.id).then((remaining) => {
              if (isMounted) {
                setRemainingMessages(remaining)
              }
            }).catch((err) => {
              console.error('Error fetching remaining messages:', err)
            })
          }
        }
      } catch (error) {
        console.error('Auth initialization error:', error)
        clearTimeout(loadingTimeout)
        
        // If we have a cached session and there was an error, keep using it
        if (cachedUser && cachedSessionData && isMounted) {
          console.log('Error occurred but using cached session')
          setUser(cachedUser)
          setSession(cachedSessionData)
          
          // Still try to fetch profile with cached user
          fetchProfile(cachedUser.id).catch((profileError) => {
            console.error('Error fetching profile:', profileError)
          })
        }
        
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
