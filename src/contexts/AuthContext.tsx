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

// Local storage key for caching profile
const PROFILE_CACHE_KEY = 'open-router-ui-profile'

// Helper to cache profile to localStorage
const cacheProfile = (profile: UserProfile | null) => {
  if (profile) {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile))
  } else {
    localStorage.removeItem(PROFILE_CACHE_KEY)
  }
}

// Helper to get cached profile from localStorage
const getCachedProfile = (): UserProfile | null => {
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY)
    if (cached) {
      return JSON.parse(cached) as UserProfile
    }
  } catch {
    // Ignore parsing errors
  }
  return null
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Initialize profile from cache to prevent flash of wrong tier
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(() => getCachedProfile())
  const [loading, setLoading] = useState(true)
  const [remainingMessages, setRemainingMessages] = useState(0)

  const tier = profile?.tier || 'free'

  // Fetch user profile from database using direct REST API to avoid AbortController issues
  const fetchProfile = async (userId: string, emailFromSession?: string, accessToken?: string) => {
    console.log('🔍 Fetching profile for user ID:', userId)
    
    const userEmail = emailFromSession
    console.log('📧 User email:', userEmail)
    
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    
    // Get the current session's access token for RLS authentication
    let authToken = accessToken
    if (!authToken) {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession()
        authToken = currentSession?.access_token
      } catch (e) {
        console.warn('⚠️ Could not get access token:', e)
      }
    }
    console.log('🔐 Auth token available:', !!authToken)
    
    // Use direct fetch to bypass Supabase client's AbortController
    const fetchProfileDirect = async (filter: string): Promise<UserProfile | null> => {
      // IMPORTANT: We must have a valid auth token to pass RLS policies
      // Do NOT fall back to supabaseKey as it won't authenticate the user
      if (!authToken) {
        console.warn('⚠️ No auth token available for profile fetch')
        return null
      }
      
      try {
        const response = await fetch(
          `${supabaseUrl}/rest/v1/user_profiles?${filter}&select=*`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json',
            },
          }
        )
        
        if (!response.ok) {
          console.warn('⚠️ Profile fetch response not ok:', response.status, await response.text())
          return null
        }
        
        const data = await response.json()
        console.log('📊 Direct fetch result:', data)
        
        if (Array.isArray(data) && data.length > 0) {
          return data[0] as UserProfile
        }
        return null
      } catch (e) {
        console.error('❌ Direct fetch error:', e)
        return null
      }
    }
    
    // First try to fetch by user ID
    let profileData = await fetchProfileDirect(`id=eq.${userId}`)
    
    if (profileData) {
      console.log('✅ Found profile by ID with tier:', profileData.tier)
      setProfile(profileData)
      cacheProfile(profileData)
      return profileData
    }

    // Try to find by email (in case user signed in via different auth method)
    if (userEmail) {
      console.log('🔍 Trying to find profile by email:', userEmail)
      profileData = await fetchProfileDirect(`email=eq.${encodeURIComponent(userEmail)}`)
      
      if (profileData) {
        console.log('✅ Found profile by email with tier:', profileData.tier)
        setProfile(profileData)
        cacheProfile(profileData)
        return profileData
      }
    }

    // Profile doesn't exist by ID or email, create one
    // IMPORTANT: Profile creation requires a valid auth token for RLS
    console.log('📝 Creating new profile for user...')
    if (userEmail && authToken) {
      try {
        const newProfile = {
          id: userId,
          email: userEmail,
          tier: 'free' as const,
          messages_used_today: 0,
          last_usage_reset: new Date().toISOString(),
        }
        
        const response = await fetch(
          `${supabaseUrl}/rest/v1/user_profiles`,
          {
            method: 'POST',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation',
            },
            body: JSON.stringify(newProfile),
          }
        )
        
        if (response.ok) {
          const data = await response.json()
          if (Array.isArray(data) && data.length > 0) {
            console.log('✅ Created new profile with tier:', data[0].tier)
            const createdProfile = data[0] as UserProfile
            setProfile(createdProfile)
            cacheProfile(createdProfile)
            return createdProfile
          }
        } else {
          console.error('❌ Error creating profile:', response.status, await response.text())
        }
      } catch (e) {
        console.error('❌ Error creating profile:', e)
      }
    } else if (userEmail && !authToken) {
      console.warn('⚠️ Cannot create profile - no auth token available')
    }
    
    return null
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
      await fetchProfile(user.id, user.email)
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
              // We have a valid cached session, set user/session immediately
              // but DON'T set loading=false yet - wait for profile to load
              cachedUser = parsed.user as User
              cachedSessionData = parsed as Session
              if (isMounted) {
                setUser(cachedUser)
                setSession(cachedSessionData)
                // Note: We intentionally don't set loading=false here anymore
                // to ensure profile (and tier) is loaded before UI renders
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
            
            // Still try to fetch profile with cached user (pass email from cached user)
            fetchProfile(cachedUser.id, cachedUser.email).catch((profileError: unknown) => {
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
          
          if (session?.user) {
            // Fetch profile BEFORE setting loading to false
            // This ensures tier is correctly loaded before UI renders
            try {
              await fetchProfile(session.user.id, session.user.email, session.access_token)
              const remaining = await getRemainingMessages(session.user.id)
              if (isMounted) {
                setRemainingMessages(remaining)
              }
            } catch (profileError) {
              console.error('Error fetching profile:', profileError)
            }
          }
          
          // Only set loading to false AFTER profile is fetched
          setLoading(false)
        }
      } catch (error) {
        console.error('Auth initialization error:', error)
        clearTimeout(loadingTimeout)
        
        // If we have a cached session and there was an error, keep using it
        if (cachedUser && cachedSessionData && isMounted) {
          console.log('Error occurred but using cached session')
          setUser(cachedUser)
          setSession(cachedSessionData)
          
          // Still try to fetch profile with cached user (pass email from cached user)
          fetchProfile(cachedUser.id, cachedUser.email).catch((profileError: unknown) => {
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
            await fetchProfile(session.user.id, session.user.email, session.access_token)
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
          cacheProfile(newProfile)
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
    // Clear state first to trigger immediate UI update
    setUser(null)
    setSession(null)
    setProfile(null)
    setRemainingMessages(0)
    
    // Clear cached session and profile from localStorage
    localStorage.removeItem('open-router-ui-auth')
    cacheProfile(null)
    
    // Sign out from Supabase (don't await - we've already cleared local state)
    // This prevents AbortError from being thrown when component unmounts
    supabase.auth.signOut().catch(() => {
      // Ignore any errors during sign out
    })
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
