import { execFile } from 'node:child_process'

interface HudPopupWindow extends HiddenAppWindow {
  show(): void
  focus(): void
}

interface HiddenAppWindow {
  isDestroyed(): boolean
  hide(): void
}

/** What a dismissal reads and drives on the HUD window. */
export interface HudDismissWindow extends HiddenAppWindow {
  isFocused(): boolean
  setOpacity(opacity: number): void
}

/** The activity a hand-back follows; Electron's `app` satisfies it. */
export interface HudAppActivity {
  on(event: 'did-become-active' | 'did-resign-active', listener: () => void): unknown
  removeListener(event: 'did-resign-active', listener: () => void): unknown
}

/** Starts activating the app under the HUD; `cancel` abandons the attempt. */
export type ActivateAppBelowHud = (done: (activated: boolean) => void) => { cancel(): void }

export interface HudHandBack {
  cancel(): void
  hide(win: HudDismissWindow, stayInHermes?: boolean): void
}

const HAND_BACK_TIMEOUT_MS = 1500
const RESIGN_GRACE_MS = 400

// JXA for `osascript`: activate the app that owns the topmost ordinary window
// on this Space, unless that window is Hermes's own. A bare desktop belongs to
// Finder. Reads window owners and bounds only, so it needs neither the Screen
// Recording nor the Automation permission.
const ACTIVATE_APP_BELOW_HUD = `
ObjC.import('AppKit')
ObjC.import('CoreGraphics')
function run(argv) {
  const hermes = Number(argv[0])
  const windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(
    $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)))
  const top = windows.find(w => w.kCGWindowLayer === 0 && w.kCGWindowAlpha > 0 &&
    w.kCGWindowBounds.Width > 150 && w.kCGWindowBounds.Height > 100)
  if (top && top.kCGWindowOwnerPID === hermes) return 'kept'
  const below = top
    ? $.NSRunningApplication.runningApplicationWithProcessIdentifier(top.kCGWindowOwnerPID)
    : $.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.apple.finder').firstObject
  return !below.isNil() && below.activateWithOptions(0) ? 'activated' : 'kept'
}`

const activateAppBelowHud: ActivateAppBelowHud = done => {
  const child = execFile(
    '/usr/bin/osascript',
    ['-l', 'JavaScript', '-e', ACTIVATE_APP_BELOW_HUD, String(process.pid)],
    { timeout: HAND_BACK_TIMEOUT_MS },
    (error, stdout) => done(!error && stdout.trim() === 'activated')
  )

  return { cancel: () => void child.kill() }
}

/**
 * The macOS popup is a non-activating panel. For an ordinary window Electron's
 * `show()` activates the whole app, which makes Hermes frontmost and raises
 * its main window over the app the popup was summoned from; for a panel
 * `show()`/`focus()` hand over the keyboard and leave the frontmost app alone.
 * Electron's panel is an NSWindow carrying the non-activating style mask, not
 * an NSPanel: it does not hide when Hermes deactivates, but it also lacks the
 * window-server flag of a real one, so a CLICK on it still activates Hermes
 * (see createHudHandBack).
 */
export function hudPopupWindowType(platform: string): 'panel' | undefined {
  return platform === 'darwin' ? 'panel' : undefined
}

/**
 * Hides the HUD without leaving Hermes in front of the app the user is in.
 *
 * Once a click has made Hermes the active app, ordering its key window out
 * makes AppKit promote the next Hermes window and raise it over that app. So
 * while Hermes is active and the HUD has the keyboard, the app directly under
 * the HUD is activated first and the HUD is ordered out only after Hermes has
 * resigned; until then it is merely transparent, so the dismissal still looks
 * instant. When the window underneath is Hermes's own, nothing is handed back.
 */
export function createHudHandBack({
  platform,
  app,
  activateAppBelow = activateAppBelowHud,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
}: {
  platform: string
  app: HudAppActivity
  activateAppBelow?: ActivateAppBelowHud
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}): HudHandBack {
  // Real activation only: a summon leaves the HUD key while another app stays
  // frontmost, and that state fires neither event.
  let hermesActive = false
  let abort: (() => void) | null = null

  app.on('did-become-active', () => {
    hermesActive = true
  })
  app.on('did-resign-active', () => {
    hermesActive = false
  })

  const cancel = () => abort?.()

  return {
    cancel,
    hide(win, stayInHermes = false) {
      cancel()

      if (platform !== 'darwin' || stayInHermes || !hermesActive || !win.isFocused()) {
        win.hide()

        return
      }

      let live = true
      let request: { cancel(): void } | null = null

      let stopWaiting = () => {}

      const settle = (hide: boolean) => {
        if (!live) {
          return
        }

        live = false
        abort = null
        stopWaiting()

        if (!win.isDestroyed()) {
          if (hide) {
            win.hide()
          }

          win.setOpacity(1)
        }
      }

      win.setOpacity(0)

      // A summon that arrives first keeps the HUD up and drops the request.
      abort = () => {
        request?.cancel()
        settle(false)
      }

      request = activateAppBelow(activated => {
        if (!live || !activated || !hermesActive) {
          settle(true)

          return
        }

        // AppKit still believes Hermes is active until it processes the
        // switch; ordering the key window out before then promotes the main
        // window and pulls Hermes straight back to the front.
        const resigned = () => settle(true)
        const timer = setTimer(resigned, RESIGN_GRACE_MS)

        stopWaiting = () => {
          clearTimer(timer)
          app.removeListener('did-resign-active', resigned)
        }

        app.on('did-resign-active', resigned)
      })
    }
  }
}

/** Hiding preserves the live chat, reading position, and native geometry. */
export function dismissHudPopup<T extends HiddenAppWindow>(
  win: null | T,
  {
    hide,
    clearWindow,
    releaseShortcut,
    broadcast
  }: { hide: (win: T) => void; clearWindow: () => void; releaseShortcut: () => void; broadcast: (open: boolean) => void }
): void {
  if (win && !win.isDestroyed()) {
    hide(win)
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
  getAppHiddenWindows,
  handBack
}: {
  open: () => void
  dismiss: () => void
  canToggle: () => boolean
  getAppHiddenWindows: () => readonly HiddenAppWindow[]
  handBack: HudHandBack
}) {
  let requestedOpen = false

  return {
    changed(value: boolean) {
      requestedOpen = value
    },
    /** `stayInHermes` is Exit HUD: the main window takes over, so nothing is handed back. */
    hide(win: HudDismissWindow, stayInHermes = false) {
      handBack.hide(win, stayInHermes)
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
        handBack.cancel()

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
