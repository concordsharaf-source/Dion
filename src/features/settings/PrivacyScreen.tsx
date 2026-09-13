import { Database, Eye, Fingerprint, Lock, ShieldCheck, WifiOff } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, SectionTitle } from '@/components/ui'
import { useDataSourceKind } from '@/app/DataSourceProvider'

/** الخصوصية والأمان — شرح مبسّط لما يحدث فعلًا في التطبيق */
export function PrivacyScreen() {
  const kind = useDataSourceKind()

  return (
    <div className="pb-8">
      <PageHeader title="الخصوصية والأمان" />

      <div className="space-y-4 px-4 pt-4">
        <Card className="space-y-2">
          <p className="flex items-center gap-2 font-extrabold">
            <ShieldCheck size={18} className="text-brand-600" /> مبادئ ثابتة
          </p>
          <ul className="space-y-2 text-[0.8125rem] leading-6 text-ink-600 dark:text-ink-300">
            <Li icon={<Eye size={15} />}>لا نطلب أي صلاحية لا يحتاجها الدفتر (لا جهات اتصال، لا موقع، لا ملفات).</Li>
            <Li icon={<Fingerprint size={15} />}>العملية المالية لا تُعتمد بالاسم أو رقم الهاتف، بل بحساب الطرف الحقيقي ووقت التأكيد.</Li>
            <Li icon={<Lock size={15} />}>لا يستطيع من سجّل العملية تأكيدها بنفسه، ولا يمكن تأكيد عملية نيابة عن الطرف الآخر.</Li>
            <Li icon={<Database size={15} />}>لا حذف للتاريخ المالي: التصحيح بقيد عكسي مرتبط بالعملية الأصلية، ويبقى السجل كاملًا.</Li>
          </ul>
        </Card>

        <section>
          <SectionTitle>أين تُخزَّن بياناتك؟</SectionTitle>
          <Card className="space-y-2 text-[0.8125rem] leading-6 text-ink-600 dark:text-ink-300">
            {kind === 'local' ? (
              <p>
                في النسخة الحالية يعمل التطبيق بمحرّك محلي كامل: تُخزَّن السجلات والعمليات على جهازك في قاعدة بيانات
                داخل المتصفح (IndexedDB)، ولا تُرسَل إلى أي خادم. هذا يجعل التطبيق يعمل بلا إنترنت وبلا حساب، مع
                الحفاظ على كل قواعد الأمان بين الطرفين.
              </p>
            ) : (
              <p>
                تُخزَّن بياناتك في قاعدة بيانات آمنة على الخادم مع نسخة محلية على جهازك للعمل بلا إنترنت. كل جدول
                محمي بسياسات وصول (RLS) تمنع أي مستخدم من قراءة أو تعديل بيانات غيره، والكتابة المالية تتم عبر دوال
                مؤمّنة تتحقق من الملكية والحالة قبل أي تغيير.
              </p>
            )}
            <p>
              لا تُخزَّن أي مفاتيح إدارية أو أسرار في الواجهة أو في الجهاز. الواجهة تتحدث فقط بالصلاحيات المسموح بها
              لحسابك.
            </p>
          </Card>
        </section>

        <section>
          <SectionTitle>الديناميكية بين الطرفين</SectionTitle>
          <Card className="space-y-2 text-[0.8125rem] leading-6 text-ink-600 dark:text-ink-300">
            <p>
              أي طرف يمكنه تسجيل العملية. العملية لا تدخل الرصيد المؤكد إلا بموافقة الطرف الآخر. الرصيد =
              مجموع الديون المؤكدة − مجموع السدادات المؤكدة، والمعلّق لا يُحتسب مطلقًا.
            </p>
            <p>
              ربط الحسابين اختياري، ويتطلب موافقة الطرفين، ورمزه عشوائي قصير العمر ويُستخدم مرة واحدة ولا يحتوي أي
              بيانات مالية.
            </p>
          </Card>
        </section>

        <section>
          <SectionTitle>العمل بلا إنترنت</SectionTitle>
          <Card className="space-y-2 text-[0.8125rem] leading-6 text-ink-600 dark:text-ink-300">
            <p className="flex items-center gap-2">
              <WifiOff size={16} /> التطبيق مُثبَّت ويعمل بلا اتصال.
            </p>
            <p>
              العمليات المسجّلة بلا اتصال تظهر «بانتظار الاتصال والمزامنة»، ولا تُرسل مرتين، ولا تُحتسب لدى الطرف الآخر
              قبل وصولها وتأكيده.
            </p>
          </Card>
        </section>

        <p className="px-1 text-[0.6875rem] leading-5 text-ink-400">
          دفتر الديون — نسخة 1.0.0. لأي ملاحظة أمنية: راجع الإعدادات ← البيانات لتنزيل نسخة احتياطية قبل أي تغيير كبير.
        </p>
      </div>
    </div>
  )
}

function Li({ children, icon }: { children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-brand-600">{icon}</span>
      <span>{children}</span>
    </li>
  )
}
