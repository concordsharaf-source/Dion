## 2026-10-21 - Pre-computing normalized search strings on domain summaries
**Learning:** Normalizing Arabic text (`normalizeArabic`) and phone numbers (`normalizePhone`) involves multiple regular expression operations per item. Executing these inside search filter loops on every keystroke causes significant CPU overhead for long lists.
**Action:** Always pre-compute normalized search strings on summary/view model objects during initial summarization/creation so search filtering uses simple string inclusion (`includes()`).
