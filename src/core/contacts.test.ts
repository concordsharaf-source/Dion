import { describe, expect, it } from 'vitest'
import {
  cleanPhone,
  dedupeContacts,
  hasContactsPicker,
  parseContactsCsv,
  parseContactsFile,
  parseCsvRows,
  parseVCards,
  pickBestPhone,
  scorePhoneType,
} from './contacts'

describe('جهات الاتصال — vCard', () => {
  it('يقرأ ملف تصدير أندرويد (vCard 3.0) بالاسم والجوال', () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:محمد;أحمد;;;',
      'FN:أحمد محمد',
      'TEL;TYPE=CELL:+967771234567',
      'END:VCARD',
    ].join('\r\n')

    expect(parseVCards(vcf)).toEqual([{ name: 'أحمد محمد', phone: '771234567' }])
  })

  it('يبني الاسم من N حين لا يوجد FN (vCard 4.0)', () => {
    const vcf = ['BEGIN:VCARD', 'VERSION:4.0', 'N:الشامي;سامي;;;', 'TEL:+967733222111', 'END:VCARD'].join('\n')
    expect(parseVCards(vcf)).toEqual([{ name: 'سامي الشامي', phone: '733222111' }])
  })

  it('يفضّل الجوال على العمل ويتجاهل الفاكس', () => {
    const vcf = [
      'BEGIN:VCARD',
      'FN:بقالة النور',
      'TEL;TYPE=WORK:012345678',
      'TEL;TYPE=FAX:+967111111111',
      'TEL;TYPE=CELL:+967733222111',
      'END:VCARD',
    ].join('\n')

    expect(parseVCards(vcf)[0]!.phone).toBe('733222111')
  })

  it('يتعامل مع بادئة المجموعة في تصدير آبل: item1.TEL', () => {
    const vcf = [
      'BEGIN:VCARD',
      'FN:خالد',
      'item1.TEL;type=CELL:+967711111111',
      'item1.X-ABLabel:_$!<Mobile>!$_',
      'END:VCARD',
    ].join('\n')

    expect(parseVCards(vcf)[0]).toEqual({ name: 'خالد', phone: '711111111' })
  })

  it('يفتح الأسطر المطويّة داخل القيمة', () => {
    const vcf = ['BEGIN:VCARD', 'FN:بقالة النو', ' ر', 'TEL:771234567', 'END:VCARD'].join('\n')
    const [contact] = parseVCards(vcf)
    expect(contact!.name).toBe('بقالة النور')
  })

  it('يفكّ الرموز المُهرَّبة في الاسم', () => {
    const vcf = ['BEGIN:VCARD', 'FN:أحمد\\, للتجارة العامة\\; فرع صنعاء', 'END:VCARD'].join('\n')
    expect(parseVCards(vcf)[0]!.name).toBe('أحمد, للتجارة العامة; فرع صنعاء')
  })

  it('يقرأ عدة جهات اتصال من ملف واحد ويبقي غير الفارغة', () => {
    const vcf = [
      'BEGIN:VCARD',
      'FN:أحمد',
      'TEL;TYPE=CELL:771111111',
      'END:VCARD',
      'BEGIN:VCARD',
      'FN:سعيد',
      'END:VCARD',
      'BEGIN:VCARD',
      'FN:نورا',
      'TEL:733333333',
      'END:VCARD',
    ].join('\n')

    expect(parseVCards(vcf)).toEqual([
      { name: 'أحمد', phone: '771111111' },
      { name: 'سعيد', phone: null },
      { name: 'نورا', phone: '733333333' },
    ])
  })

  it('يقرأ اسم الشركة حين لا يوجد اسم شخص', () => {
    const vcf = ['BEGIN:VCARD', 'ORG:مؤسسة الرشيد;فرع تعز', 'TEL:777777777', 'END:VCARD'].join('\n')
    expect(parseVCards(vcf)[0]!.name).toBe('مؤسسة الرشيد;فرع تعز')
  })
})

describe('جهات الاتصال — CSV', () => {
  it('يقرأ تصدير Google Contacts مع التنصيص والفواصل داخل الحقل', () => {
    const csv = [
      'Name,Given Name,Phone 1 - Value,Organization',
      '"أحمد محمد, الشامي",أحمد,+967 771 234 567,"شركة, صنعاء"',
      'سعيد علي,سعيد,733222111,',
    ].join('\n')

    expect(parseContactsCsv(csv)).toEqual([
      { name: 'أحمد محمد, الشامي', phone: '771234567' },
      { name: 'سعيد علي', phone: '733222111' },
    ])
  })

  it('يقرأ ملفًا بعناوين عربية وفاصل منقوطة', () => {
    const csv = ['الاسم;رقم الهاتف', 'بقالة النور;771-234-567', 'سوق الأمانة;733222111'].join('\n')
    expect(parseContactsCsv(csv)).toEqual([
      { name: 'بقالة النور', phone: '771234567' },
      { name: 'سوق الأمانة', phone: '733222111' },
    ])
  })

  it('يستنتج الأعمدة حين لا توجد عناوين', () => {
    const csv = ['بقالة النور,771234567', 'سوق الأمانة,733222111'].join('\n')
    expect(parseContactsCsv(csv)).toEqual([
      { name: 'بقالة النور', phone: '771234567' },
      { name: 'سوق الأمانة', phone: '733222111' },
    ])
  })

  it('يتعامل مع الفاصلة المنقوطة داخل حقل مُنصَّص', () => {
    const rows = parseCsvRows('"أ","ب;ج"\n"د","هـ"', ',')
    expect(rows).toEqual([
      ['أ', 'ب;ج'],
      ['د', 'هـ'],
    ])
  })

  it('يتجاهل النص غير المفهوم', () => {
    expect(parseContactsCsv('مرحبا بالعالم')).toEqual([])
  })
})

describe('جهات الاتصال — أدوات', () => {
  it('ينظّف الأرقام بكل صيغها', () => {
    // بلا مفتاح دولة: يُزال المفتاح والصفر، ويبقى الرقم المحلي
    expect(cleanPhone('+967 771-234-567')).toBe('771234567')
    expect(cleanPhone('tel:+967711111111')).toBe('711111111')
    expect(cleanPhone('00967711222333')).toBe('711222333')
    expect(cleanPhone('٠٧٧١٢٣٤٥٦٧')).toBe('771234567')
    expect(cleanPhone('777123456')).toBe('777123456')
    expect(cleanPhone('abc')).toBeNull()
    expect(cleanPhone('')).toBeNull()
  })

  it('يرتّب أولوية نوع الرقم', () => {
    expect(scorePhoneType('TYPE=CELL')).toBeGreaterThan(scorePhoneType('TYPE=WORK'))
    expect(scorePhoneType('TYPE=WORK')).toBeGreaterThan(scorePhoneType('TYPE=FAX'))
    expect(
      pickBestPhone([
        { value: '999', score: scorePhoneType('TYPE=FAX') },
        { value: '771234567', score: scorePhoneType('TYPE=CELL') },
      ]),
    ).toBe('771234567')
  })

  it('يزيل التكرار بالرقم أو بالاسم', () => {
    const list = dedupeContacts([
      { name: 'أحمد', phone: '771111111' },
      { name: 'أحمد م.', phone: '771111111' },
      { name: 'سعيد', phone: null },
      { name: 'سعيد', phone: null },
      { name: null, phone: null },
    ])
    expect(list).toEqual([
      { name: 'أحمد', phone: '771111111' },
      { name: 'سعيد', phone: null },
    ])
  })

  it('يكتشف ملف vCard أو CSV تلقائيًا', () => {
    expect(parseContactsFile('BEGIN:VCARD\nFN:أحمد\nTEL:771234567\nEND:VCARD')).toEqual([
      { name: 'أحمد', phone: '771234567' },
    ])
    expect(parseContactsFile('الاسم,الهاتف\nسعيد,733222111')).toEqual([{ name: 'سعيد', phone: '733222111' }])
    expect(parseContactsFile('')).toEqual([])
  })

  it('يكتشف توفّر منتقي جهات الاتصال في النظام', () => {
    expect(hasContactsPicker({})).toBe(false)
    expect(hasContactsPicker(undefined)).toBe(false)
    expect(hasContactsPicker({ contacts: { select: async () => [] } })).toBe(true)
  })
})
