import { afterEach, expect, it, vi } from 'vitest'

import type { HudShortcutApi, HudShortcutStatus } from '../../electron/hud-shortcut-types'

import {
  $bindings,
  $capture,
  $comboIndex,
  $hudShortcutError,
  beginCapture,
  clearBinding,
  endCapture,
  initHudShortcut,
  setBinding
} from './keybinds'

const desktopWindow = window as unknown as { hermesDesktop?: Window['hermesDesktop'] }
const original = desktopWindow.hermesDesktop
const bindings = $bindings.get()
afterEach(() => {
  desktopWindow.hermesDesktop = original
  $bindings.set(bindings)
  $capture.set(null)
  $hudShortcutError.set(null)
})

it('adopts the global binding, pauses capture, rebinds and clears through Electron without duplicate local dispatch', async () => {
  let status: HudShortcutStatus = { combo: 'alt+j', registered: true, error: null }

  const api: HudShortcutApi = {
    getSettings: vi.fn(async () => status),
    setShortcut: vi.fn(async combo => (status = { combo, registered: combo !== null, error: null })),
    setCapturing: vi.fn(async () => {}),
    onStatus: vi.fn(() => () => {})
  }

  desktopWindow.hermesDesktop = { hudShortcut: api } as Window['hermesDesktop']
  const off = initHudShortcut()
  await vi.waitFor(() => expect($bindings.get()['view.toggleHud']).toEqual(['alt+j']))
  expect($comboIndex.get().get('alt+j') ?? []).not.toContain('view.toggleHud')
  beginCapture('view.toggleHud')
  await vi.waitFor(() => expect($capture.get()).toBe('view.toggleHud'))
  expect(api.setCapturing).toHaveBeenCalledWith(true)
  setBinding('view.toggleHud', ['mod+alt+space'])
  endCapture()
  await vi.waitFor(() => expect($bindings.get()['view.toggleHud']).toEqual(['mod+alt+space']))
  expect(api.setCapturing).toHaveBeenLastCalledWith(false)
  clearBinding('view.toggleHud')
  await vi.waitFor(() => expect($bindings.get()['view.toggleHud']).toEqual([]))
  expect(api.setShortcut).toHaveBeenLastCalledWith(null)
  off()
})

it('keeps the saved binding and reports a failed preference write', async () => {
  desktopWindow.hermesDesktop = {
    hudShortcut: { setShortcut: vi.fn().mockRejectedValue(new Error('disk full')) }
  } as unknown as Window['hermesDesktop']
  const before = $bindings.get()['view.toggleHud']
  setBinding('view.toggleHud', ['mod+alt+k'])
  await vi.waitFor(() => expect($hudShortcutError.get()).toBe('save'))
  expect($bindings.get()['view.toggleHud']).toEqual(before)
})
