import { expect, it, vi } from 'vitest'

import { createHudPopup, dismissHudPopup } from './hud-popup'

it('toggles the popup alone and does not reveal a cold window dismissed before first paint', () => {
  const win = { show: vi.fn(), focus: vi.fn() }
  const dismiss = vi.fn(() => popup.changed(false))
  const open = vi.fn(() => popup.changed(true))
  const popup = createHudPopup({ open, dismiss, canToggle: () => true })
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
  const popup = createHudPopup({ open, dismiss, canToggle: () => false })
  popup.toggle()
  popup.changed(true)
  popup.toggle()
  expect(open).not.toHaveBeenCalled()
  expect(dismiss).not.toHaveBeenCalled()
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
