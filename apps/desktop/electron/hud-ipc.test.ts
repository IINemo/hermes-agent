import { expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ handle: vi.fn(), on: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: host, screen: {} }))

import { registerHudIpc } from './hud-ipc'

it('only returns to the main window for an explicit exit request', async () => {
  const calls: string[] = []
  registerHudIpc({
    isMac: true,
    getTranslucencyState: vi.fn(),
    getHudWindow: () => null,
    openHudWindow: vi.fn(),
    closeHudWindow: () => calls.push('dismiss'),
    returnToMain: () => calls.push('main'),
    resetHudLayout: () => true,
    setHudSessionId: vi.fn()
  })
  const close = host.handle.mock.calls.find(([channel]) => channel === 'hermes:hud:close')![1]

  expect(await close({})).toEqual({ ok: true })
  expect(calls).toEqual(['dismiss'])
  calls.length = 0

  expect(await close({}, { returnToMain: true })).toEqual({ ok: true })
  expect(calls).toEqual(['dismiss', 'main'])
})
