interface HudPopupWindow {
  show(): void
  focus(): void
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
