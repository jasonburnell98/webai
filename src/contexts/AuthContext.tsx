import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useUser, useAuth as useClerkAuth, useClerk } from '@clerk/react'
import {
  getRemainingMessages,
  incrementMessageUsage,
  isModelAvailable,
  upsertUserProfile,
} from '../lib/supabase'
import type { UserProfile } from '../lib/supabase'

interface AuthContextType {
  // User identity (mapped from Clerk)
  user: { id: string; email: string | null } | null
  profile: UserProfile | null
  loading: boolean
  remainingMessages: number
  tier: 'free' | 'pro'
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
  const { user: clerkUser, isLoaded: userLoaded } = useUser()
  const { isSignedIn } = useClerkAuth()
  const { signOut: clerkSignOut } = useClerk()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [remainingMessages, setRemainingMessages] = useState(0)
  const [profileLoading, setProfileLoading] = useState(false)

  // Map Clerk user to our simplified user object
  const user = clerkUser
    ? {
        id: clerkUser.id,
        email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
      }
    : null

  const tier = profile?.tier ?? 'free'

  // Overall loading: true until Clerk is initialized
  const loading = !userLoaded || (isSignedIn === true && profileLoading)

  // Fetch or create a user profile from Supabase using Clerk user ID
  const fetchProfile = useCallback(async (userId: string, email: string | null) => {
    setProfileLoading(true)
    try {
      const userProfile = await upsertUserProfile(userId, email)
      setProfile(userProfile)
      return userProfile
    } catch (err) {
      console.error('Error fetching/creating profile:', err)
      return null
    } finally {
      setProfileLoading(false)
    }
  }, [])

  // Refresh usage count
  const refreshUsage = useCallback(async () => {
    if (!user) {
      setRemainingMessages(0)
      return
    }
    const remaining = await getRemainingMessages(user.id)
    setRemainingMessages(remaining)
  }, [user])

  // Refresh profile
  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchProfile(user.id, user.email)
      await refreshUsage()
    }
  }, [user, fetchProfile, refreshUsage])

  // When the Clerk user changes, sync the profile and usage from Supabase
  useEffect(() => {
    if (!userLoaded) return

    if (isSignedIn && clerkUser) {
      const userId = clerkUser.id
      const email = clerkUser.primaryEmailAddress?.emailAddress ?? null
      fetchProfile(userId, email).then((p) => {
        if (p?.tier === 'pro') {
          setRemainingMessages(Infinity)
        } else {
          getRemainingMessages(userId).then(setRemainingMessages)
        }
      })
    } else {
      setProfile(null)
      setRemainingMessages(0)
    }
  }, [userLoaded, isSignedIn, clerkUser?.id])

  // Consume a message (decrement counter for free tier)
  const consumeMessage = async (): Promise<boolean> => {
    if (!user) return false
    if (tier === 'pro') return true
    if (remainingMessages <= 0) return false

    const success = await incrementMessageUsage(user.id)
    if (success) {
      setRemainingMessages((prev) => Math.max(0, prev - 1))
    }
    return success
  }

  // Check if user can use a specific model
  const canUseModel = (modelId: string): boolean => {
    return isModelAvailable(modelId, tier)
  }

  const signOut = async () => {
    setProfile(null)
    setRemainingMessages(0)
    await clerkSignOut()
  }

  const value: AuthContextType = {
    user,
    profile,
    loading,
    remainingMessages,
    tier,
    signOut,
    refreshProfile,
    refreshUsage,
    consumeMessage,
    canUseModel,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
