/**
 * توليد كشف الحساب كملف PDF — داخل الجهاز بالكامل (بلا أي خادم).
 *
 * العربية في PDF: لا يشكّل الحروف ولا يرتّب الاتجاه. لذلك:
 *   · يُحوَّل النص إلى أشكاله السياقية ويُرتَّب بصريًا (`@/core/pdfText`)
 *   · يُقسَّم النص إلى مقاطع، كل مقطع يُرسم بخطه: خط عربي (Cairo Arabic)
 *     للمقاطع العربية وخط لاتيني (Cairo Latin) للأرقام والرموز واللاتينية.
 *     وهذا يمنع أي تداخل في جداول الحروف (cmap) ويضمن أرقامًا واضحة.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { baseOfCluster, clusterMarks, formatMinorForPdf, shapeArabic, splitBidiRuns } from '@/core/pdfText'
import { formatDateAr, formatTimeAr } from '@/core/datetime'
import type { StatementModel, StatementRow } from '@/core/statement'

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 40
const CONTENT_WIDTH = A4.width - MARGIN * 2

const COLORS = {
  brand: rgb(0.06, 0.48, 0.35),
  brandSoft: rgb(0.93, 0.97, 0.95),
  ink: rgb(0.11, 0.15, 0.2),
  muted: rgb(0.42, 0.47, 0.53),
  line: rgb(0.85, 0.88, 0.91),
  danger: rgb(0.72, 0.18, 0.18),
  gold: rgb(0.72, 0.53, 0.04),
  white: rgb(1, 1, 1),
  zebra: rgb(0.97, 0.98, 0.99),
}

type Color = ReturnType<typeof rgb>

export interface PdfFonts {
  ar: PDFFont
  arBold: PDFFont
  la: PDFFont
  laBold: PDFFont
}

/**
 * الخطوط المدمجة في كشف الحساب:
 *   · عربي: Noto Naskh Arabic (يشمل كل الأشكال السياقية واللام-ألف والترقيم العربي)
 *   · لاتيني: Cairo Latin (أرقام واضحة للمبالغ والتواريخ)
 */
const FONT_FILES = {
  ar: 'statement-ar-regular.ttf',
  arBold: 'statement-ar-bold.ttf',
  la: 'cairo-pdf-latin-regular.ttf',
  laBold: 'cairo-pdf-latin-bold.ttf',
} as const

/** يحمّل خطوط كشف الحساب (تُخدَم محليًا من ملفات التطبيق) */
export async function loadPdfFonts(doc: PDFDocument, baseUrl = '/'): Promise<PdfFonts> {
  doc.registerFontkit(fontkit)
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const [ar, arBold, la, laBold] = await Promise.all(
    (['ar', 'arBold', 'la', 'laBold'] as const).map(async (key) => {
      const response = await fetch(`${base}fonts/${FONT_FILES[key]}`)
      if (!response.ok) throw new Error(`تعذّر تحميل خط الكشف (${FONT_FILES[key]})`)
      // ملاحظتان مهمتان:
      //  · بلا اقتطاع (subset): الاقتطاع يفسد الأشكال السياقية العربية في بعض القارئات.
      //  · تعطيل ccmp: الخط يفكّ الحروف المنقوطة (ة/ب/ت/ي/ؤ…) إلى «نقطة + هيكل» والنقطة
      //    بلا عرض، و pdf-lib لا يطبّق مواضع العلامات ⇒ كانت النقاط تُرسم في مكان خاطئ.
      //    تعطيل ccmp يُبقي النقاط داخل الحرف. (التشكيل نتولاه نحن في core/pdfText)
      return doc.embedFont(await response.arrayBuffer(), {
        subset: false,
        features: { ccmp: false },
      })
    }),
  )
  return { ar, arBold, la, laBold }
}

/* ============================ تقسيم النص إلى مقاطع ============================ */

interface Segment {
  text: string
  kind: 'ar' | 'la'
}

/** هل الحرف عربي (أو علامة ترقيم عربية)؟ */
export function isArabicCodePoint(code: number): boolean {
  return (
    (code >= 0x0600 && code <= 0x06ff) ||
    (code >= 0x0750 && code <= 0x077f) ||
    (code >= 0x08a0 && code <= 0x08ff) ||
    (code >= 0xfb50 && code <= 0xfdff) ||
    (code >= 0xfe70 && code <= 0xfeff)
  )
}

/**
 * يقسّم النص إلى مقاطع مرتّبة منطقيًا (كما تُكتب)، كل مقطع يُرسم بخطه:
 * عربي (Noto Naskh) أو لاتيني (Cairo Latin).
 *
 * مهم: **لا قلب ولا إعادة ترتيب هنا** — محرّك الخط داخل pdf-lib يتولى
 * ترتيب المقاطع العربية من اليمين إلى اليسار، والقلب اليدوي يخرج النص مقلوبًا.
 * المطلوب منّا فقط: تشكيل الحروف ثم تقسيمها بحسب الخط.
 */
export function visualSegments(input: string): Segment[] {
  const shaped = shapeArabic(input)

  const segments: Segment[] = []
  for (const run of splitBidiRuns(shaped)) {
    for (const cluster of clusterMarks(run.text)) {
      const base = baseOfCluster(cluster)
      const kind: Segment['kind'] = isArabicCodePoint(base.codePointAt(0) ?? 0) ? 'ar' : 'la'
      const last = segments[segments.length - 1]
      if (last && (last.kind === kind || base === ' ')) last.text += cluster
      else segments.push({ text: cluster, kind })
    }
  }

  return segments
}

/* ============================ أدوات الرسم ============================ */

interface Ctx {
  doc: PDFDocument
  page: PDFPage
  fonts: PdfFonts
  y: number
  pageNumber: number
}

function pickFont(fonts: PdfFonts, kind: Segment['kind'], bold: boolean): PDFFont {
  if (kind === 'ar') return bold ? fonts.arBold : fonts.ar
  return bold ? fonts.laBold : fonts.la
}

function segmentsWidth(segments: Segment[], fonts: PdfFonts, size: number, bold: boolean): number {
  return segments.reduce((total, segment) => {
    try {
      return total + pickFont(fonts, segment.kind, bold).widthOfTextAtSize(segment.text, size)
    } catch {
      return total + segment.text.length * size * 0.5
    }
  }, 0)
}

/** يرسم نصًا (عربي/لاتيني/مختلط) بمحاذاة يمنى أو يسرى أو وسطى */
function drawText(
  ctx: Ctx,
  text: string,
  options: {
    y?: number
    size?: number
    bold?: boolean
    color?: Color
    align?: 'right' | 'left' | 'center'
    /** الحافة التي تُحاذى إليها */
    edge?: number
    /** عرض منطقة المحاذاة عند استخدام align */
    width?: number
  } = {},
): number {
  const size = options.size ?? 10
  const bold = options.bold ?? false
  const color = options.color ?? COLORS.ink
  const segments = visualSegments(text)
  if (segments.length === 0) return 0

  const total = segmentsWidth(segments, ctx.fonts, size, bold)
  const region = options.width ?? CONTENT_WIDTH
  const edge = options.edge ?? A4.width - MARGIN

  let x = edge
  if (options.align === 'left') x = MARGIN + 8
  else if (options.align === 'center') x = MARGIN + (region - total) / 2
  else if (options.align === 'right') x = edge - total
  else x = edge - total

  for (const segment of segments) {
    const font = pickFont(ctx.fonts, segment.kind, bold)
    ctx.page.drawText(segment.text, { x, y: options.y ?? ctx.y, size, font, color })
    x += segmentsWidth([segment], ctx.fonts, size, bold)
  }

  return total
}

function fillRect(ctx: Ctx, options: { x: number; y: number; width: number; height: number; color: Color }): void {
  ctx.page.drawRectangle({ x: options.x, y: options.y, width: options.width, height: options.height, color: options.color })
}

function strokeLine(ctx: Ctx, y: number, color: Color = COLORS.line): void {
  ctx.page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y }, thickness: 0.6, color })
}

/** تذييل الصفحة */
function drawFooter(ctx: Ctx, model: StatementModel): void {
  const y = 34
  ctx.page.drawLine({
    start: { x: MARGIN, y: y + 14 },
    end: { x: A4.width - MARGIN, y: y + 14 },
    thickness: 0.6,
    color: COLORS.line,
  })
  drawText(ctx, `${model.ownerName} — دفتر الديون`, { y, size: 8, color: COLORS.muted, align: 'right' })
  drawText(ctx, `صفحة ${ctx.pageNumber}`, { y, size: 8, color: COLORS.muted, align: 'left' })
}

/* ============================ بناء الكشف ============================ */

const ROW_HEIGHT = 22
const TABLE_HEADER_HEIGHT = 24
const MAX_Y_BEFORE_BREAK = 92
const RIGHT = A4.width - MARGIN

/** حدود الأعمدة من اليمين إلى اليسار: التاريخ · البيان · النوع · المبلغ · الحالة */
const EDGE = {
  date: RIGHT - 4,
  details: RIGHT - 92,
  type: RIGHT - 300,
  amount: RIGHT - 378,
  status: MARGIN + 8,
}

export async function buildStatementPdf(model: StatementModel, baseUrl = '/'): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${model.title} — ${model.partyName}`)
  doc.setAuthor(model.ownerName)
  doc.setSubject('كشف حساب من تطبيق دفتر الديون')
  doc.setCreator('دفتر الديون')

  const fonts = await loadPdfFonts(doc, baseUrl)
  const page = doc.addPage([A4.width, A4.height])
  const ctx: Ctx = { doc, page, fonts, y: A4.height - MARGIN, pageNumber: 1 }

  /* ---------- الترويسة ---------- */
  fillRect(ctx, { x: 0, y: A4.height - 96, width: A4.width, height: 96, color: COLORS.brand })
  drawText(ctx, 'دفتر الديون', { y: A4.height - 48, size: 19, bold: true, color: COLORS.white })
  drawText(ctx, model.title, { y: A4.height - 72, size: 11, color: COLORS.white })
  drawText(ctx, model.ownerName, { y: A4.height - 48, size: 11, color: COLORS.white, align: 'left' })
  drawText(ctx, `صدر بتاريخ ${formatDateAr(model.generatedAt)} · ${formatTimeAr(model.generatedAt)}`, {
    y: A4.height - 72,
    size: 9,
    color: COLORS.white,
    align: 'left',
  })

  ctx.y = A4.height - 120

  /* ---------- بيانات الطرف ---------- */
  fillRect(ctx, { x: MARGIN, y: ctx.y - 66, width: CONTENT_WIDTH, height: 62, color: COLORS.brandSoft })
  drawText(ctx, `${model.partyKindLabel}: ${model.partyName}`, {
    y: ctx.y - 24,
    size: 13,
    bold: true,
    color: COLORS.brand,
  })
  if (model.partyPhone) {
    drawText(ctx, model.partyPhone, { y: ctx.y - 46, size: 9, color: COLORS.muted, align: 'left' })
  }
  drawText(ctx, model.linkLabel, { y: ctx.y - 46, size: 9, color: COLORS.muted })
  drawText(ctx, `الفترة: ${model.periodLabel}`, { y: ctx.y - 24, size: 9, color: COLORS.muted, align: 'left' })

  ctx.y -= 84

  /* ---------- الملخّص ---------- */
  const cards: { label: string; value: number; color: Color }[] = [
    { label: 'إجمالي الدين المؤكد', value: model.totals.debtMinor, color: COLORS.ink },
    { label: 'إجمالي السداد المؤكد', value: model.totals.paidMinor, color: COLORS.brand },
    {
      label: 'المتبقي',
      value: model.totals.remainingMinor,
      color: model.totals.remainingMinor > 0 ? COLORS.danger : COLORS.brand,
    },
  ]
  const cardGap = 8
  const cardWidth = (CONTENT_WIDTH - cardGap * 2) / 3
  cards.forEach((card, index) => {
    const right = RIGHT - index * (cardWidth + cardGap)
    const left = right - cardWidth
    fillRect(ctx, { x: left, y: ctx.y - 54, width: cardWidth, height: 54, color: COLORS.zebra })
    drawText(ctx, card.label, { y: ctx.y - 18, size: 8, color: COLORS.muted, edge: right - 8 })
    drawText(ctx, formatMinorForPdf(card.value), {
      y: ctx.y - 42,
      size: 15,
      bold: true,
      color: card.color,
      edge: right - 8,
    })
  })
  ctx.y -= 72

  drawText(
    ctx,
    `المعروض: ${model.rows.length} عملية · مؤكدة ${model.counts.confirmed} · معلّقة ${model.counts.pending}`,
    { y: ctx.y, size: 9, color: COLORS.muted },
  )
  if (model.totals.pendingDebtMinor > 0 || model.totals.pendingPaidMinor > 0) {
    ctx.y -= 14
    drawText(
      ctx,
      `معلّق بانتظار التأكيد: دين ${formatMinorForPdf(model.totals.pendingDebtMinor)} · سداد ${formatMinorForPdf(
        model.totals.pendingPaidMinor,
      )} (لا يدخل الرصيد)`,
      { y: ctx.y, size: 9, color: COLORS.gold },
    )
  }

  ctx.y -= 20

  /* ---------- جدول العمليات ---------- */
  const drawTableHeader = () => {
    fillRect(ctx, {
      x: MARGIN,
      y: ctx.y - TABLE_HEADER_HEIGHT,
      width: CONTENT_WIDTH,
      height: TABLE_HEADER_HEIGHT,
      color: COLORS.brand,
    })
    const y = ctx.y - 16
    const header = { y, size: 9, bold: true, color: COLORS.white }
    drawText(ctx, 'التاريخ', { ...header, edge: EDGE.date })
    drawText(ctx, 'البيان', { ...header, edge: EDGE.details })
    drawText(ctx, 'النوع', { ...header, edge: EDGE.type })
    drawText(ctx, 'المبلغ', { ...header, edge: EDGE.amount })
    drawText(ctx, 'الحالة', { ...header, align: 'left' })
    ctx.y -= TABLE_HEADER_HEIGHT
  }

  const newPage = () => {
    drawFooter(ctx, model)
    ctx.page = ctx.doc.addPage([A4.width, A4.height])
    ctx.pageNumber += 1
    ctx.y = A4.height - MARGIN
    drawText(ctx, `${model.title} — ${model.partyName}`, { y: ctx.y - 4, size: 10, bold: true, color: COLORS.brand })
    ctx.y -= 26
    drawTableHeader()
  }

  drawTableHeader()

  const statusColor = (row: StatementRow): Color => {
    switch (row.statusTone) {
      case 'confirmed':
        return COLORS.brand
      case 'pending':
        return COLORS.gold
      case 'rejected':
        return COLORS.danger
      default:
        return COLORS.muted
    }
  }

  model.rows.forEach((row, index) => {
    if (ctx.y - ROW_HEIGHT < MAX_Y_BEFORE_BREAK) newPage()

    if (index % 2 === 1) {
      fillRect(ctx, { x: MARGIN, y: ctx.y - ROW_HEIGHT, width: CONTENT_WIDTH, height: ROW_HEIGHT, color: COLORS.zebra })
    }
    const y = ctx.y - 15

    const stamp = `${row.date.slice(0, 10)} ${row.date.slice(11, 16)}`
    drawText(ctx, stamp, { y, size: 8, color: COLORS.muted, edge: EDGE.date })
    const details = row.details ? `${row.label} — ${row.details}` : row.label
    drawText(ctx, details, { y, size: 9, edge: EDGE.details })
    drawText(ctx, row.label, { y, size: 9, color: COLORS.muted, edge: EDGE.type })

    const amountText = row.label.includes('سداد') ? `-${row.amountText}` : row.amountText
    drawText(ctx, amountText, {
      y,
      size: 9,
      bold: true,
      color: row.statusTone === 'confirmed' ? COLORS.ink : statusColor(row),
      edge: EDGE.amount,
    })
    drawText(ctx, row.statusLabel, { y, size: 8, color: statusColor(row), align: 'left' })

    ctx.y -= ROW_HEIGHT
    strokeLine(ctx, ctx.y)
  })

  if (model.rows.length === 0) {
    drawText(ctx, 'لا توجد عمليات في هذه الفترة.', {
      y: ctx.y - 20,
      size: 10,
      color: COLORS.muted,
      align: 'center',
      width: CONTENT_WIDTH,
    })
    ctx.y -= 40
  }

  /* ---------- الخلاصة ---------- */
  if (ctx.y - 90 < MAX_Y_BEFORE_BREAK) newPage()
  ctx.y -= 12
  fillRect(ctx, { x: MARGIN, y: ctx.y - 72, width: CONTENT_WIDTH, height: 72, color: COLORS.brandSoft })
  drawText(ctx, 'الرصيد المتبقي (المؤكد فقط)', { y: ctx.y - 22, size: 10, bold: true, color: COLORS.brand, edge: RIGHT - 8 })
  drawText(ctx, formatMinorForPdf(model.totals.remainingMinor), {
    y: ctx.y - 46,
    size: 20,
    bold: true,
    color: model.totals.remainingMinor > 0 ? COLORS.danger : COLORS.brand,
    edge: RIGHT - 8,
  })
  drawText(
    ctx,
    `${model.rows.length} عملية · ${model.currency === 'YER' ? 'ريال يمني' : model.currency}`,
    { y: ctx.y - 30, size: 9, color: COLORS.muted, align: 'left' },
  )
  drawText(ctx, model.footerNote, { y: ctx.y - 62, size: 8, color: COLORS.muted })

  drawFooter(ctx, model)

  return doc.save()
}

/* ============================ المشاركة والتنزيل ============================ */

export function pdfFileName(model: StatementModel): string {
  const day = model.generatedAt.toISOString().slice(0, 10)
  const safeParty = model.partyName.replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '-')
  return `كشف-${safeParty}-${day}.pdf`
}

/** هل يستطيع هذا الجهاز مشاركة ملفات (أندرويد/آيفون)؟ */
export function canShareFiles(candidate?: { canShare?: (data: unknown) => boolean } | null): boolean {
  const nav = candidate ?? (typeof navigator === 'undefined' ? null : navigator)
  return typeof nav?.canShare === 'function'
}

/** ينزّل ملف PDF على جهاز المستخدم مباشرة */
export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * يشارك الملف عبر تطبيقات الجهاز (واتساب، تيليجرام، البريد…) إن أمكن،
 * وإلا ينزّله كملف على الجهاز. تعيد: 'shared' أو 'downloaded'.
 */
export async function shareOrDownloadPdf(bytes: Uint8Array, fileName: string): Promise<'shared' | 'downloaded'> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
  const file = typeof File !== 'undefined' ? new File([blob], fileName, { type: 'application/pdf' }) : null

  if (file && canShareFiles() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'كشف حساب', text: 'كشف حساب من دفتر الديون' })
      return 'shared'
    } catch (error) {
      // إلغاء المستخدم لم يعد خطأً — نكمل إلى التنزيل
      if (error instanceof DOMException && error.name === 'AbortError') return 'shared'
    }
  }

  downloadPdf(bytes, fileName)
  return 'downloaded'
}
