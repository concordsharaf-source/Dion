import { useRef, useState } from 'react'
import { ContactRound, Search } from 'lucide-react'
import { Button, Input, Sheet, useToast } from '@/components/ui'
import { hasContactsPicker, parseContactsFile, type ImportedContact } from '@/core/contacts'

interface NativeContact {
  name?: string[]
  tel?: string[]
}

interface ContactsManagerLike {
  select(properties: string[], options?: { multiple?: boolean }): Promise<NativeContact[]>
}

const PICKABLE_EXTENSIONS = '.vcf,.vcard,.csv,text/vcard,text/x-vcard,text/csv'

/**
 * زر «استيراد من جهات الاتصال» بجانب حقل الهاتف.
 *
 * المسار الأول: منتقي جهات الاتصال الأصلي في النظام (Contact Picker API —
 * كروم على أندرويد)، فيُملأ الاسم والرقم بلمسة واحدة بلا كتابة.
 * المسار الثاني (كل الأجهزة الأخرى): يختار المستخدم ملف جهات اتصال
 * (.vcf من أندرويد/آيفون أو .csv من Google) ويُقرأ محليًا داخل الجهاز.
 * الملف لا يُرفع لأي خادم — التحليل يجري في المتصفح فقط.
 */
export function ContactImportButton({
  onPick,
  label = 'استيراد من جهات الاتصال',
  disabled = false,
}: {
  onPick: (contact: ImportedContact) => void
  label?: string
  disabled?: boolean
}) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [options, setOptions] = useState<ImportedContact[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  async function openNativePicker(): Promise<boolean> {
    const contacts = (navigator as Navigator & { contacts?: ContactsManagerLike }).contacts
    if (!hasContactsPicker(navigator) || !contacts) return false

    try {
      const picked = await contacts.select(['name', 'tel'], { multiple: false })
      const first = picked?.[0]
      if (!first) return true // أُلغيت العملية
      const name = first.name?.[0]?.trim() || null
      const phone = first.tel?.[0]?.trim() || null
      if (!name && !phone) {
        toast.show('جهة الاتصال لا تحتوي على اسم أو رقم', 'error')
        return true
      }
      onPick({ name, phone })
      toast.show('تم استيراد جهة الاتصال', 'ok')
      return true
    } catch (error) {
      // إلغاء المستخدم لنافذة النظام ليس خطأً
      const name = error instanceof DOMException ? error.name : ''
      if (name === 'AbortError' || name === 'InvalidStateError') return true
      return false // ننتقل إلى اختيار ملف
    }
  }

  async function handleClick() {
    setBusy(true)
    const handled = await openNativePicker()
    setBusy(false)
    if (!handled) fileRef.current?.click()
  }

  async function handleFile(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    try {
      const contacts = parseContactsFile(await file.text())
      if (contacts.length === 0) {
        toast.show('لم يُعثر على اسم أو رقم هاتف في الملف', 'error')
        return
      }
      if (contacts.length === 1) {
        apply(contacts[0]!)
        return
      }
      setOptions(contacts)
      setSearch('')
    } catch {
      toast.show('تعذّر قراءة الملف', 'error')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function apply(contact: ImportedContact) {
    onPick(contact)
    setOptions([])
    toast.show('تم استيراد جهة الاتصال', 'ok')
  }

  const filtered = search.trim()
    ? options.filter((c) => `${c.name ?? ''} ${c.phone ?? ''}`.includes(search.trim()))
    : options

  return (
    <>
      <Button
        type="button"
        variant="soft"
        block
        loading={busy}
        disabled={disabled}
        icon={<ContactRound size={18} />}
        onClick={() => void handleClick()}
        aria-label={label}
      >
        {label}
      </Button>
      <p className="px-1 text-[0.6875rem] leading-4 text-ink-400">
        من جهات اتصال الجهاز مباشرة، أو من ملف .vcf/.csv — يُقرأ داخل جهازك ولا يُرسل لأي خادم.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept={PICKABLE_EXTENSIONS}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => void handleFile(e.target.files)}
      />

      <Sheet open={options.length > 0} onClose={() => setOptions([])} title="اختر جهة اتصال">
        {options.length > 8 ? (
          <div className="relative mb-3">
            <Search size={18} className="absolute end-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو الرقم..." className="pe-10" aria-label="بحث" autoFocus />
          </div>
        ) : null}

        <div className="space-y-2 pb-2">
          <p className="px-1 text-[0.75rem] text-ink-500">
            الملف يحتوي {options.length} جهة اتصال — اختر التي تريد تسجيلها.
          </p>
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-[0.8125rem] text-ink-500">لا نتائج مطابقة</p>
          ) : (
            filtered.slice(0, 200).map((contact, index) => (
              <button
                key={`${contact.phone ?? contact.name ?? index}-${index}`}
                type="button"
                onClick={() => apply(contact)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white px-3 py-3 text-start transition active:scale-[0.99] dark:bg-ink-900"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{contact.name ?? 'بدون اسم'}</span>
                  {contact.phone ? (
                    <span className="block text-[0.75rem] text-ink-500" dir="ltr">
                      {contact.phone}
                    </span>
                  ) : (
                    <span className="block text-[0.75rem] text-ink-400">لا يوجد رقم</span>
                  )}
                </span>
                {contact.phone ? <span className="chip bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">اختيار</span> : null}
              </button>
            ))
          )}
        </div>
      </Sheet>
    </>
  )
}
