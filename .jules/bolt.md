## 2026-10-05 - Optimize Party Summaries with Single-Pass Loop
**Learning:** Combining multiple array iterations (`computeTotals`, `for..of` date/legacy check, `list.some`) into a single `for..of` pass in core domain calculation functions like `summarizeParties` prevents redundant array iterations on large list rendering.
**Action:** Always look for nested or repeated list traversals in core calculation functions powering hooks like `useFilteredParties`.
