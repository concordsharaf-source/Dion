## 2026-09-23 - Pre-computing Search Normalized Strings

**Learning:** Re-running Arabic text normalization (`normalizeArabic`) and phone normalization (`normalizePhone`) inside list filtering functions on every search input keystroke executes up to 28 regex replacements per item. For large party lists, this blocks the main thread during typing.
**Action:** Always pre-compute search haystack strings on summary domain objects when created or memoized, so search filtering uses simple `.includes()` without regex execution per item on keystrokes.
