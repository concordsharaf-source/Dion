# Bolt's Journal - Critical Learnings

## 2026-10-18 - Pre-computing Normalized Search Strings for List Filtering
**Learning:** Arabic text normalization (`normalizeArabic`, `normalizePhone`) involves multiple regex replace operations (~25 per party). Executing regex normalization inside `.filter()` on every keypress creates severe UI thread jank as the list size grows. Pre-computing normalized search strings on domain summary objects during list construction (`summarizeParties`) avoids repeated regex execution on user typing.
**Action:** Always pre-compute normalized search fields on domain summary objects or memoized models, and reuse them during interactive filtering.
