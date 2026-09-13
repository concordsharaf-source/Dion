/**
 * قسم «الحساب السحابي» في الإعدادات.
 *
 * التطبيق محلي أولًا: من لا يريد سحابةً يبقى دفتره على جهازه.
 * ومن يريد المزامنة بين الأجهزة، والعمليات المشتركة بين التاجر والعميل،
 * وإشعارات فورية تصل والتطبيق مغلق — يربط حسابًا سحابيًا من هنا.
 */

import { useState } from 'react'
import { Cloud, CloudOff } from 'lucide-react'
import { Button, Card, ConfirmDialog, SectionTitle, useToast } from '@/components/ui'
import { useDataSourceKind } from '@/app/DataSourceProvider'
import { isSupabaseConfigured } from '@/data/load'
import { disableCloudMode, enableCloudMode } from '@/core/cloudMode'

export function CloudAccountSection() {
  const toast = useToast()
  const kind = useDataSourceKind()
  const [confirmOff, setConfirmOff] = useState(false)
  const [busy, setBusy] = useState(false)

  // إن لم تُضبط مفاتيح المشروع في بيئة النشر فلا شيء لعرضه
  if (!isSupabaseConfigured()) return null

  const active = kind === 'supabase'

  function connect() {
    enableCloudMode()
    toast.show('جارٍ تشغيل الحساب السحابي…', 'info')
    // إعادة تحميل واحدة ليعمل التطبيق بالمحرّك السحابي ثم يُطلب إنشاء الحساب
    window.setTimeout(() => window.location.reload(), 150)
  }

  function disconnect() {
    setBusy(true)
    disableCloudMode()
    setConfirmOff(false)
    window.setTimeout(() => window.location.reload(), 150)
  }

  return (
    <section>
      <SectionTitle>الحساب السحابي</SectionTitle>
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
            {active ? <Cloud size={20} /> : <CloudOff size={20} />}
          </span>
          <div className="flex-1">
            <p className="text-[0.875rem] font-bold">
              {active ? 'مُفعّل — المزامنة تعمل' : 'غير مُفعّل — دفترك على هذا الجهاز'}
            </p>
            <p className="mt-1 text-[0.75rem] leading-5 text-ink-600 dark:text-ink-300">
              {active
                ? 'بيانات المستخدم موحّدة على حسابك، وتُزامَن بين أجهزتك، وتعمل العمليات المشتركة والإشعارات بين التاجر والعميل.'
                : 'اربط حسابًا سحابيًا لتُزامَن بياناتك بين أجهزتك، ولتعمل العمليات المشتركة بين التاجر والعميل، ووصول الإشعارات حتى والتطبيق مغلق.'}
            </p>
          </div>
        </div>

        {active ? (
          <Button
            block
            variant="ghost"
            className="text-danger-600"
            icon={<CloudOff size={17} />}
            loading={busy}
            onClick={() => setConfirmOff(true)}
          >
            فصل الحساب السحابي
          </Button>
        ) : (
          <div className="space-y-2">
            <Button block icon={<Cloud size={17} />} onClick={connect}>
              ربط حساب سحابي (مزامنة + إشعارات)
            </Button>
            <Button
              block
              variant="ghost"
              onClick={() => {
                enableCloudMode()
                window.setTimeout(() => {
                  window.location.hash = '#/signin'
                  window.location.reload()
                }, 150)
              }}
            >
              لديّ حساب سحابي — تسجيل الدخول
            </Button>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOff}
        title="فصل الحساب السحابي"
        message="سيتوقف التطبيق عن المزامنة وتعود للعمل على هذا الجهاز وحده. دفترك المحلي لا يُحذف، وبياناتك السحابية تبقى في حسابك."
        confirmLabel="فصل"
        tone="danger"
        loading={busy}
        onCancel={() => setConfirmOff(false)}
        onConfirm={disconnect}
      />
    </section>
  )
}
