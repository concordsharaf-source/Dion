/**
 * عدّاد النوافذ المفتوحة (Sheet / نافذة تأكيد).
 * يُستخدم لمعرفة إن كان زر الرجوع يجب أن يُغلق النافذة أولًا (سلوك أندرويد)
 * بدل اعتباره خروجًا من التطبيق.
 */

let openOverlays = 0

/** تُنادى عند فتح نافذة */
export function beginOverlay(): void {
  openOverlays += 1
}

/** تُنادى عند إغلاق نافذة */
export function endOverlay(): void {
  openOverlays = Math.max(0, openOverlays - 1)
}

/** هل هناك نافذة مفتوحة الآن؟ */
export function hasOpenOverlay(): boolean {
  return openOverlays > 0
}

/** للاختبارات: تصفير العدّاد */
export function resetOverlays(): void {
  openOverlays = 0
}
