## 2026-09-23 - Stable Callbacks with React.memo in List Items
**Learning:** `React.memo` on list row components (like `EntryRow`) is ineffective if parents pass inline arrow functions like `onOpen={() => setOpenEntryId(entry.id)}`. Updating the component prop to `onOpen?: (id: string) => void` allows parent components to pass a single stable `useCallback` reference across all list items.
**Action:** Always pair `React.memo` on list item components with `(id: string) => void` callback signatures and stable `useCallback` handlers in parent list screens.
