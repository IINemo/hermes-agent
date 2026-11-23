import type { BrowserWindow } from 'electron'
import { beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ handle: vi.fn(), on: vi.fn() }))
const app = vi.hoisted(() => ({ focus: vi.fn() }))
vi.mock('electron', () => ({ app, ipcMain: host, screen: {} }))

import { type HudIpcDeps, registerHudIpc } from './hud-ipc'

beforeEach(() => {
  host.handle.mockClear()
  app.focus.mockClear()
})

function register(overrides: Partial<HudIpcDeps> = {}) {
  return registerHudIpc({
    isMac: true,
    getTranslucencyState: vi.fn(),
    getHudWindow: () => null,
    openHudWindow: vi.fn(),
    closeHudWindow: vi.fn(),
    returnToMain: vi.fn(),
    resetHudLayout: () => true,
    setHudSessionId: vi.fn(),
    ...overrides
  })
}

const closeHandler = () => host.handle.mock.calls.find(([channel]) => channel === 'hermes:hud:close')![1]
const asHudWindow = (fake: { isDestroyed(): boolean; isFocused(): boolean }) => fake as unknown as BrowserWindow
const hudWindow = (focused: boolean) => asHudWindow({ isDestroyed: () => false, isFocused: () => focused })

it('only returns to the main window for an explicit exit request', async () => {
  const calls: string[] = []
  register({
    closeHudWindow: stayInHermes => calls.push(stayInHermes ? 'dismiss, staying in Hermes' : 'dismiss'),
    returnToMain: () => calls.push('main')
  })
  const close = closeHandler()

  expect(await close({})).toEqual({ ok: true })
  expect(calls).toEqual(['dismiss'])
  calls.length = 0

  expect(await close({}, { returnToMain: true })).toEqual({ ok: true })
  // Exit HUD goes to the main window, so the keyboard is not handed back to another app.
  expect(calls).toEqual(['dismiss, staying in Hermes', 'main'])
})

it('activates the app before an explicit exit hands over to the main window on macOS', async () => {
  const calls: string[] = []
  app.focus.mockImplementation(() => calls.push('activate'))
  register({ returnToMain: () => calls.push('main') })
  const close = closeHandler()

  // A plain dismiss must leave the frontmost app alone.
  await close({})
  expect(calls).toEqual([])

  await close({}, { returnToMain: true })
  expect(calls).toEqual(['activate', 'main'])
  expect(app.focus).toHaveBeenCalledWith({ steal: true })
})

it('leaves activation to the window manager on Windows and Linux', async () => {
  register({ isMac: false })

  await closeHandler()({}, { returnToMain: true })
  expect(app.focus).not.toHaveBeenCalled()
})

it('shows a dialog standalone and activates the app while the macOS HUD has the keyboard', () => {
  const main = { name: 'main' }

  expect(register({ getHudWindow: () => hudWindow(true) }).dialogParent(main)).toBeNull()
  expect(app.focus).toHaveBeenCalledExactlyOnceWith({ steal: true })
})

it('keeps a dialog on the main window when the HUD does not have the keyboard', () => {
  const main = { name: 'main' }

  const destroyed = asHudWindow({
    isDestroyed: () => true,
    isFocused: () => {
      throw new Error('Object has been destroyed')
    }
  })

  for (const overrides of [
    { getHudWindow: () => null },
    { getHudWindow: () => hudWindow(false) },
    { getHudWindow: () => destroyed },
    { getHudWindow: () => hudWindow(true), isMac: false }
  ]) {
    expect(register(overrides).dialogParent(main)).toBe(main)
  }

  expect(app.focus).not.toHaveBeenCalled()
})
