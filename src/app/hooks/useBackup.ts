import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDataSource } from '../DataSourceProvider'
import { useProfile } from './useAuth'
import { qk } from '../queryClient'
import { playFeedback } from '@/core/sound'
import {
  clearRollingBackup,
  createRollingBackup,
  readAutoBackupEnabled,
  readBackupMeta,
  restoreFromFile,
  saveBackupFile,
  startDailyBackupRunner,
  writeAutoBackupEnabled,
} from '@/services/backup'
import type { BackupMeta } from '@/core/backup'

/** آخر نسخة محفوظة على الجهاز */
export function useBackupMeta() {
  return useQuery({ queryKey: qk.backup, queryFn: () => readBackupMeta() })
}

/** هل النسخة اليومية التلقائية مفعّلة؟ */
export function useAutoBackup(role: 'customer' | 'merchant') {
  return useQuery({ queryKey: [...qk.backupAuto, role], queryFn: () => readAutoBackupEnabled(role) })
}

export function useToggleAutoBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => writeAutoBackupEnabled(enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.backupAuto })
      playFeedback('success')
    },
  })
}

/** إنشاء نسخة جديدة الآن — تستبدل النسخة السابقة */
export function useCreateBackup() {
  const ds = useDataSource()
  const profile = useProfile()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => createRollingBackup(ds, profile.data ?? null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.backup })
      playFeedback('success')
    },
    onError: () => playFeedback('error'),
  })
}

/** يحفظ/ينزّل النسخة كملف على الجهاز بأفضل طريقة يسمح بها المتصفح */
export function useDownloadBackup() {
  const ds = useDataSource()
  const profile = useProfile()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const { payload, meta } = await createRollingBackup(ds, profile.data ?? null)
      const saved = await saveBackupFile(payload)
      return { meta, saved }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.backup })
      playFeedback('success')
    },
    onError: () => playFeedback('error'),
  })
}

/** استعادة من ملف نسخة احتياطية (دمج بلا حذف وبلا تكرار) */
export function useRestoreBackup() {
  const ds = useDataSource()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (file: File) => restoreFromFile(ds, file),
    onSuccess: () => {
      void queryClient.invalidateQueries()
      playFeedback('success')
    },
    onError: () => playFeedback('error'),
  })
}

export function useClearBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => clearRollingBackup(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.backup })
      playFeedback('success')
    },
  })
}

/**
 * مشغّل النسخة اليومية: يشتغل وهو داخل التطبيق، ويأخذ نسخة اليوم إن لم تكن موجودة،
 * وعند إخفاء التطبيق (نهاية الاستخدام)، وعند حلول منتصف الليل.
 */
export function useDailyBackupRunner(onBackup?: (meta: BackupMeta) => void) {
  const ds = useDataSource()
  const profile = useProfile()
  const queryClient = useQueryClient()
  const callback = useRef(onBackup)
  callback.current = onBackup

  const role = profile.data?.role
  const id = profile.data?.id

  useEffect(() => {
    if (!id || !role) return
    const stop = startDailyBackupRunner({
      ds,
      profile: profile.data ?? null,
      onBackup: (meta) => {
        void queryClient.invalidateQueries({ queryKey: qk.backup })
        callback.current?.(meta)
      },
    })
    return stop
    // يعاد التشغيل عند تغيير المستخدم أو دوره فقط
  }, [ds, id, role, queryClient]) // eslint-disable-line react-hooks/exhaustive-deps
}
