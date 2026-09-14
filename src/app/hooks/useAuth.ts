import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDataSource } from '../DataSourceProvider'
import { qk } from '../queryClient'
import type { AuthSession, SignUpInput } from '@/data/port'
import type { Profile, Role } from '@/core/domain'

/** الجلسة الحالية */
export function useSession() {
  const ds = useDataSource()
  return useQuery<AuthSession | null>({
    queryKey: qk.session,
    queryFn: () => ds.auth.getSession(),
    staleTime: 10_000,
  })
}

/** الملف الشخصي (null قبل إتمام الإعداد) */
export function useProfile() {
  const ds = useDataSource()
  const session = useSession()
  return useQuery<Profile | null>({
    queryKey: qk.profile,
    queryFn: () => ds.auth.getProfile(),
    enabled: session.data !== null && session.data !== undefined,
    staleTime: 10_000,
  })
}

export function useAuth() {
  const ds = useDataSource()
  const queryClient = useQueryClient()

  return {
    async signUp(input: SignUpInput) {
      const result = await ds.auth.signUp(input)
      await queryClient.invalidateQueries({ queryKey: qk.session })
      return result
    },
    async signIn(email: string, password: string) {
      const session = await ds.auth.signIn({ email, password })
      queryClient.setQueryData(qk.session, session)
      await queryClient.invalidateQueries({ queryKey: qk.session })
      return session
    },
    /** دخول بحساب محفوظ على هذا الجهاز (وضع الدفتر المحلي) — بلا كلمة مرور */
    async signInDevice(accountId: string) {
      if (!ds.auth.signInAsDeviceAccount) throw new Error('غير متاح في هذا الوضع')
      const session = await ds.auth.signInAsDeviceAccount(accountId)
      queryClient.setQueryData(qk.session, session)
      await queryClient.invalidateQueries({ queryKey: qk.session })
      await queryClient.invalidateQueries({ queryKey: qk.profile })
      return session
    },
    async signOut() {
      await ds.auth.signOut()
      queryClient.clear()
    },
    /**
     * إنشاء حساب على الجهاز: الاسم + رقم الهاتف (بلا كلمة مرور).
     * يُحفظ الحساب فيعود إليه صاحبه برقمه بلا إعادة كتابة بيانات.
     */
    async signUpOnDevice(input: { fullName: string; phone: string; role: Role }) {
      if (!ds.auth.signUpDevice) throw new Error('إنشاء الحساب على الجهاز غير متاح في هذا الوضع')
      const session = await ds.auth.signUpDevice(input)
      queryClient.setQueryData(qk.session, session)
      await queryClient.invalidateQueries({ queryKey: qk.session })
      await queryClient.invalidateQueries({ queryKey: qk.profile })
      return session
    },
    /** فتح حساب محفوظ على الجهاز برقم الهاتف (بلا كلمة مرور) */
    async openDeviceAccount(identifier: string) {
      if (!ds.auth.signInDevice) throw new Error('الدخول على الجهاز غير متاح في هذا الوضع')
      const session = await ds.auth.signInDevice({ identifier })
      queryClient.setQueryData(qk.session, session)
      await queryClient.invalidateQueries({ queryKey: qk.session })
      await queryClient.invalidateQueries({ queryKey: qk.profile })
      return session
    },
    /** إرسال رابط استعادة كلمة المرور إلى البريد (الوضع السحابي) */
    async resetPassword(email: string) {
      if (!ds.auth.resetPassword) throw new Error('الاستعادة عبر البريد غير متاحة في هذا الوضع')
      await ds.auth.resetPassword(email)
    },
    /** بدء سريع على الجهاز (الوضع المحلي) — بلا بريد ولا كلمة مرور */
    async quickStart(input: { fullName: string; role: Role }) {
      if (!ds.auth.signInQuick) throw new Error('البدء السريع غير متاح في هذا الوضع')
      const session = await ds.auth.signInQuick(input)
      queryClient.setQueryData(qk.session, session)
      await queryClient.invalidateQueries({ queryKey: qk.session })
      await queryClient.invalidateQueries({ queryKey: qk.profile })
      return session
    },
    async createProfile(input: { fullName: string; role: Role; currency?: string; phone?: string | null }) {
      const profile = await ds.auth.createProfile(input)
      await queryClient.invalidateQueries({ queryKey: qk.profile })
      return profile
    },
    async updateProfile(patch: Parameters<typeof ds.auth.updateProfile>[0]) {
      const profile = await ds.auth.updateProfile(patch)
      await queryClient.setQueryData(qk.profile, profile)
      return profile
    },
  }
}

/** هل الواجهة في وضع سريع (بلا حساب سحابي)؟ */
export function useIsLocalMode(): boolean {
  const ds = useDataSource()
  return ds.kind === 'local'
}
