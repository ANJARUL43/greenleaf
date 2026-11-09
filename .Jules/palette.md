## 2025-05-18 - Plant Deletion Confirmation & Screen Reader Context
**Learning:** Destructive actions on garden cards in GreenLeaf had generic "Remove" labels without identifying which plant was being removed for screen readers, and had no confirmation prompt against accidental clicks.
**Action:** Always provide an explicit, contextual `aria-label` identifying the specific target item (e.g., `Remove [plant name] from garden`) and guard destructive state-loss actions with a confirmation dialog.
