## 2025-05-18 - Avoid heavy composite hooks when simple query hooks suffice
**Learning:** `useFilteredParties` fetches 1000 entries and calculates financial summaries, payment ratios, and pending counts for all parties. Calling it in components that only need basic party attributes (like `party.id -> party.name` mapping in `EntriesScreen`) introduces unnecessary computation and query overhead.
**Action:** Use `useParties({ includeArchived: true, limit: 1000 })` directly when only basic party information is required.
