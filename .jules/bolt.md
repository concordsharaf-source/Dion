## 2026-10-17 - Pre-compute normalized search strings on domain summaries

**Learning:** `normalizeArabic` and `normalizePhone` perform multiple regex replacement operations per string. Executing them inside `filterAndSortParties` on every search query keystroke caused thousands of regex replacements per user input.
**Action:** Pre-compute `searchHaystack` and `normalizedPhone` on `PartySummary` during summary creation so array filtering runs simple string `.includes()` checks with zero regex overhead on keystrokes.
