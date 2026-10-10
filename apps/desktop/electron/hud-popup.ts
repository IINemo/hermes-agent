interface HudPopupWindow {
  show(): void
  focus(): void
}

/** Hiding preserves the live chat, reading position, and native geometry. */
export function dismissHudPopup(
  win: { isDestroyed(): boolean; hide(): void } | null,
  {
    clearWindow,
    releaseShortcut,
    broadcast
  }: { clearWindow: () => void; releaseShortcut: () => void; broadcast: (open: boolean) => void }
): void {
  if (win && !win.isDestroyed()) {
    win.hide()
  } else {
    clearWindow()
  }

  releaseShortcut()
  broadcast(false)
}

/** Requested visibility includes first paint: a second press cancels a cold summon. */
export function createHudPopup({
  open,
  dismiss,
  canToggle
}: {
  open: () => void
  dismiss: () => void
  canToggle: () => boolean
}) {
  let requestedOpen = false

  return {
    changed(value: boolean) {
      requestedOpen = value
    },
    toggle() {
      if (!canToggle()) {
        return
      }

      if (requestedOpen) {
        dismiss()
      } else {
        open()
      }
    },
    reveal(win: HudPopupWindow) {
      if (requestedOpen) {
        win.show()
        win.focus()
      }
    }
  }
}
