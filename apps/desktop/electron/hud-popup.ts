interface HudPopupWindow extends HiddenAppWindow {
  show(): void
  focus(): void
}

interface HiddenAppWindow {
  isDestroyed(): boolean
  hide(): void
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
  canToggle,
  getAppHiddenWindows
}: {
  open: () => void
  dismiss: () => void
  canToggle: () => boolean
  getAppHiddenWindows: () => readonly HiddenAppWindow[]
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
        // macOS restores every app-hidden window when show/focus unhides the app.
        // Order peers out first so summoning the HUD does not restore them too.
        for (const hidden of getAppHiddenWindows()) {
          if (hidden !== win && !hidden.isDestroyed()) {
            hidden.hide()
          }
        }

        win.show()
        win.focus()
      }
    }
  }
}
