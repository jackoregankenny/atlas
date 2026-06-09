/**
 * Single source of truth for global keyboard shortcuts.
 *
 * `useKeyboardShortcuts` (src/state/useKeyboardShortcuts.ts) implements the
 * behavior; `ShortcutsOverlay` renders this data as the help sheet. Adding a
 * shortcut means adding it in both the hook and HELP_GROUPS — they live a
 * file apart on purpose, and the overlay test asserts the registry matches
 * what the hook handles.
 *
 * Reader-local shortcuts (page turns) live in Reader.tsx; they're listed
 * here for the help sheet only.
 */
export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";

export interface ShortcutHelp {
  keys: string;
  label: string;
}

export const HELP_GROUPS: { name: string; items: ShortcutHelp[] }[] = [
  {
    name: "Navigation",
    items: [
      { keys: `${MOD} K`, label: "Open command palette" },
      { keys: "/", label: "Focus filter" },
      { keys: `${MOD} F`, label: "Focus filter" },
      { keys: "g l", label: "Go to library" },
      { keys: "g s", label: "Go to settings" },
      { keys: "?", label: "Show shortcuts" },
      { keys: "Esc", label: "Close overlay / back" },
    ],
  },
  {
    name: "Library",
    items: [
      { keys: "v", label: "Cycle view (grid · compact · list)" },
      { keys: `${MOD} I`, label: "Import files" },
      { keys: `${MOD} ⇧ I`, label: "Import folder" },
      { keys: "t", label: "Cycle theme" },
    ],
  },
  {
    name: "Reader",
    items: [
      { keys: "← / →", label: "Previous / next page" },
      { keys: "Space", label: "Next page" },
      { keys: "j / k", label: "Next / previous page" },
      { keys: "Esc", label: "Close reader" },
    ],
  },
];
