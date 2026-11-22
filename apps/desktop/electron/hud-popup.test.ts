import { expect, it, vi } from 'vitest'

import { createHudPopup, dismissHudPopup, hudPopupWindowType } from './hud-popup'

it('makes only the macOS popup a non-activating panel, so a summon leaves the frontmost app alone', () => {
  expect(hudPopupWindowType('darwin')).toBe('panel')
  expect(hudPopupWindowType('win32')).toBeUndefined()
  expect(hudPopupWindowType('linux')).toBeUndefined()
})

it('toggles the popup alone and does not reveal a cold window dismissed before first paint', () => {
  const win = { show: vi.fn(), focus: vi.fn(), hide: vi.fn(), isDestroyed: () => false }
  const dismiss = vi.fn(() => popup.changed(false))
  const open = vi.fn(() => popup.changed(true))
  const popup = createHudPopup({ open, dismiss, canToggle: () => true, getAppHiddenWindows: () => [] })
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
  const popup = createHudPopup({ open, dismiss, canToggle: () => false, getAppHiddenWindows: () => [] })
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
    getAppHiddenWindows: () => (appHidden ? [...windows, destroyed, win] : [])
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
  const deps = { clearWindow: vi.fn(), releaseShortcut: vi.fn(), broadcast: vi.fn() }
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
