import { expect, it, vi } from 'vitest'

import { createHudHandBack, createHudPopup, dismissHudPopup, hudPopupWindowType } from './hud-popup'

const noHandBack = () => ({ cancel: vi.fn(), hide: vi.fn() })

function fakeApp() {
  const listeners = new Map<string, Set<() => void>>()

  return {
    on(event: string, listener: () => void) {
      listeners.set(event, (listeners.get(event) ?? new Set()).add(listener))
    },
    removeListener(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener)
    },
    emit(event: 'did-become-active' | 'did-resign-active') {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener()
      }
    }
  }
}

function fakeHud({ focused = true } = {}) {
  const calls: string[] = []

  return {
    calls,
    isDestroyed: () => false,
    isFocused: () => focused,
    hide: () => void calls.push('hide'),
    setOpacity: (opacity: number) => void calls.push(`opacity:${opacity}`)
  }
}

/** A hand-back whose activation and grace timer the test completes by hand. */
function handBackUnderTest({ platform = 'darwin' } = {}) {
  const app = fakeApp()
  const abandoned = vi.fn()
  const timers: (() => void)[] = []

  let done: (activated: boolean) => void = () => {}

  const activateAppBelow = vi.fn((finished: (activated: boolean) => void) => {
    done = finished

    return { cancel: abandoned }
  })

  const handBack = createHudHandBack({
    platform,
    app,
    activateAppBelow,
    setTimer: fn => timers.push(fn),
    clearTimer: () => {}
  })

  return { app, handBack, activateAppBelow, abandoned, timers, activationEnds: (activated: boolean) => done(activated) }
}

it('makes only the macOS popup a non-activating panel, so a summon leaves the frontmost app alone', () => {
  expect(hudPopupWindowType('darwin')).toBe('panel')
  expect(hudPopupWindowType('win32')).toBeUndefined()
  expect(hudPopupWindowType('linux')).toBeUndefined()
})

it('toggles the popup alone and does not reveal a cold window dismissed before first paint', () => {
  const win = { show: vi.fn(), focus: vi.fn(), hide: vi.fn(), isDestroyed: () => false }
  const dismiss = vi.fn(() => popup.changed(false))
  const open = vi.fn(() => popup.changed(true))
  const popup = createHudPopup({ open, dismiss, canToggle: () => true, getAppHiddenWindows: () => [], handBack: noHandBack() })
  popup.toggle()
  popup.toggle()
  popup.reveal(win)
  expect(open).toHaveBeenCalledOnce()
  expect(dismiss).toHaveBeenCalledOnce()
  expect(win.show).not.toHaveBeenCalled()
  popup.toggle()
  popup.reveal(win)
  expect(win.show).toHaveBeenCalledOnce()
  expect(win.focus).toHaveBeenCalledOnce()
  popup.toggle()
  expect(dismiss).toHaveBeenCalledTimes(2)
})

it('cannot summon a window during shutdown', () => {
  const open = vi.fn()
  const dismiss = vi.fn()
  const popup = createHudPopup({ open, dismiss, canToggle: () => false, getAppHiddenWindows: () => [], handBack: noHandBack() })
  popup.toggle()
  popup.changed(true)
  popup.toggle()
  expect(open).not.toHaveBeenCalled()
  expect(dismiss).not.toHaveBeenCalled()
})

it('keeps other windows hidden when a cold or retained HUD unhides the macOS app', () => {
  const main = { visible: false, hide: vi.fn(), isDestroyed: () => false }
  const secondary = { visible: false, hide: vi.fn(), isDestroyed: () => false }
  const destroyed = { hide: vi.fn(), isDestroyed: () => true }
  const win = { show: vi.fn(), focus: vi.fn(), hide: vi.fn(), isDestroyed: () => false }
  const windows = [main, secondary]
  let appHidden = true

  const popup = createHudPopup({
    open: () => popup.changed(true),
    dismiss: () => popup.changed(false),
    canToggle: () => true,
    getAppHiddenWindows: () => (appHidden ? [...windows, destroyed, win] : []),
    handBack: noHandBack()
  })

  // AppKit restores app-hidden windows on show unless individually ordered out first.
  win.show.mockImplementation(() => {
    for (const window of windows) {
      window.visible = window.hide.mock.calls.length === 0
    }
  })

  for (const _opening of ['cold', 'retained']) {
    for (const window of windows) {
      window.hide.mockClear()
    }

    popup.toggle()
    popup.reveal(win)
    expect(windows.map(window => window.visible)).toEqual([false, false])
    expect(win.hide).not.toHaveBeenCalled()
    expect(destroyed.hide).not.toHaveBeenCalled()
    popup.toggle()
  }

  expect(win.focus).toHaveBeenCalledTimes(2)

  // Once unhidden, visible peers must not be hidden by subsequent summons.
  appHidden = false

  for (const window of windows) {
    window.hide.mockClear()
  }

  popup.toggle()
  popup.reveal(win)

  for (const window of windows) {
    expect(window.hide).not.toHaveBeenCalled()
  }
})

it('retains the native popup on dismiss and clears a destroyed handle', () => {
  const win = { hide: vi.fn(), isDestroyed: vi.fn(() => false) }

  const deps = {
    hide: (hud: typeof win) => hud.hide(),
    clearWindow: vi.fn(),
    releaseShortcut: vi.fn(),
    broadcast: vi.fn()
  }

  dismissHudPopup(win, deps)
  expect(win.hide).toHaveBeenCalledOnce()
  expect(deps.clearWindow).not.toHaveBeenCalled()
  expect(deps.broadcast).toHaveBeenLastCalledWith(false)
  expect(deps.releaseShortcut).toHaveBeenCalledOnce()

  win.isDestroyed.mockReturnValue(true)
  dismissHudPopup(win, deps)
  expect(win.hide).toHaveBeenCalledOnce()
  expect(deps.clearWindow).toHaveBeenCalledOnce()
  expect(deps.releaseShortcut).toHaveBeenCalledTimes(2)
})

it('hides at once while Hermes is not the active app, so a keyboard-only dismissal starts nothing', () => {
  const { handBack, activateAppBelow } = handBackUnderTest()
  const hud = fakeHud()

  // Summoned over another app: the HUD is key, but Hermes never became active.
  handBack.hide(hud)

  expect(hud.calls).toEqual(['hide'])
  expect(activateAppBelow).not.toHaveBeenCalled()
})

it('hands the keyboard to the app under the HUD before ordering it out once a click made Hermes active', () => {
  const { app, handBack, activationEnds } = handBackUnderTest()
  const hud = fakeHud()

  app.emit('did-become-active')
  handBack.hide(hud)
  // Gone to the eye immediately, but still the key window.
  expect(hud.calls).toEqual(['opacity:0'])

  // Ordering it out while AppKit still believes Hermes is active raises the main window.
  activationEnds(true)
  expect(hud.calls).toEqual(['opacity:0'])

  app.emit('did-resign-active')
  expect(hud.calls).toEqual(['opacity:0', 'hide', 'opacity:1'])

  // The wait is over: a later deactivation must not hide a HUD summoned since.
  app.emit('did-become-active')
  app.emit('did-resign-active')
  expect(hud.calls).toEqual(['opacity:0', 'hide', 'opacity:1'])
})

it('orders the HUD out after the grace period when Hermes never reports resigning', () => {
  const { app, handBack, activationEnds, timers } = handBackUnderTest()
  const hud = fakeHud()

  app.emit('did-become-active')
  handBack.hide(hud)
  activationEnds(true)
  timers[0]()

  expect(hud.calls).toEqual(['opacity:0', 'hide', 'opacity:1'])
})

it('keeps the keyboard in Hermes when nothing could be handed back', () => {
  const { app, handBack, activationEnds } = handBackUnderTest()
  const hud = fakeHud()

  app.emit('did-become-active')
  handBack.hide(hud)
  // Hermes's own window is underneath, or the activation failed.
  activationEnds(false)

  expect(hud.calls).toEqual(['opacity:0', 'hide', 'opacity:1'])
})

it('keeps the HUD up when a summon arrives during the hand-back', () => {
  const { app, handBack, abandoned, activationEnds } = handBackUnderTest()
  const hud = fakeHud()

  app.emit('did-become-active')
  handBack.hide(hud)
  handBack.cancel()
  expect(hud.calls).toEqual(['opacity:0', 'opacity:1'])
  expect(abandoned).toHaveBeenCalledOnce()

  // The abandoned attempt finishing late must not order the re-summoned HUD out.
  activationEnds(true)
  app.emit('did-resign-active')
  expect(hud.calls).toEqual(['opacity:0', 'opacity:1'])
})

it('hides directly for Exit HUD, a HUD without the keyboard, and other platforms', () => {
  for (const { platform = 'darwin', focused = true, stayInHermes = false } of [
    { stayInHermes: true },
    { focused: false },
    { platform: 'win32' },
    { platform: 'linux' }
  ]) {
    const { app, handBack, activateAppBelow } = handBackUnderTest({ platform })
    const hud = fakeHud({ focused })

    app.emit('did-become-active')
    handBack.hide(hud, stayInHermes)

    expect(hud.calls).toEqual(['hide'])
    expect(activateAppBelow).not.toHaveBeenCalled()
  }
})

it('lets a summon cancel a dismissal still in flight, and passes Exit HUD through', () => {
  const handBack = noHandBack()
  const win = { show: vi.fn(), focus: vi.fn(), hide: vi.fn(), isDestroyed: () => false }
  const hud = fakeHud()

  const popup = createHudPopup({
    open: () => popup.changed(true),
    dismiss: () => popup.changed(false),
    canToggle: () => true,
    getAppHiddenWindows: () => [],
    handBack
  })

  popup.hide(hud, true)
  expect(handBack.hide).toHaveBeenCalledWith(hud, true)

  popup.toggle()
  popup.reveal(win)
  expect(handBack.cancel).toHaveBeenCalledBefore(win.show)
})
