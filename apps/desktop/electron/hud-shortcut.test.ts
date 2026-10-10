import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  directory: '',
  windows: [] as any[],
  handlers: new Map<string, any>(),
  held: new Map<string, () => void>(),
  taken: new Set<string>()
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')

  return {
    app: Object.assign(new EventEmitter(), { getPath: () => state.directory }),
    BrowserWindow: {
      getAllWindows: () => state.windows,
      fromWebContents: (wc: unknown) => state.windows.find(win => win.webContents === wc)
    },
    ipcMain: {
      handle: (name: string, handler: unknown) => state.handlers.set(name, handler),
      removeHandler: (name: string) => state.handlers.delete(name)
    },
    globalShortcut: {
      isRegistered: (chord: string) => state.held.has(chord),
      register: (chord: string, callback: () => void) => {
        if (state.taken.has(chord)) {
          return false
        }

        state.held.set(chord, callback)

        return true
      },
      unregister: (chord: string) => state.held.delete(chord)
    }
  }
})

import { app } from 'electron'

import { installHudShortcut } from './hud-shortcut'

const cleanups: (() => void)[] = []
afterEach(async () => {
  cleanups.splice(0).forEach(dispose => dispose())
  app.removeAllListeners('will-quit')
  await rm(state.directory, { recursive: true, force: true })
  state.windows = []
  state.held.clear()
  state.taken.clear()
  state.handlers.clear()
})

async function setup() {
  state.directory = await mkdtemp(path.join(os.tmpdir(), 'hud-shortcut-'))
  const frame = { url: 'http://127.0.0.1:5174/' }
  const wc = Object.assign(new EventEmitter(), { mainFrame: frame, send: vi.fn() })
  state.windows.push({ webContents: wc, isDestroyed: () => false })
  const event = { sender: wc, senderFrame: frame }
  const toggle = vi.fn()

  const install = () => {
    const dispose = installHudShortcut({ rendererUrl: frame.url, toggle })
    cleanups.push(dispose)

    return dispose
  }

  const call = (name: string, value?: unknown, sender = event) =>
    state.handlers.get(`hermes:hud-shortcut:${name}`)(sender, value)

  return { install, call, event, wc, toggle }
}

it('registers at boot, migrates a rebind, replaces the chord and restores it across launches', async () => {
  const { install, call, toggle } = await setup()
  const dispose = install()
  state.held.get('CommandOrControl+Shift+H')!()
  expect(toggle).toHaveBeenCalledOnce()
  expect(call('get', 'alt+j')).toEqual({ combo: 'alt+j', registered: true, error: null })
  expect(state.held.has('CommandOrControl+Shift+H')).toBe(false)
  call('set', 'mod+alt+space')
  expect(JSON.parse(await readFile(path.join(state.directory, 'hud-shortcut.json'), 'utf8'))).toEqual({
    combo: 'mod+alt+space'
  })
  expect(state.held.has('Alt+J')).toBe(false)
  dispose()
  install()
  expect(call('get', 'mod+shift+h').combo).toBe('mod+alt+space')
  expect(state.held.has('CommandOrControl+Alt+Space')).toBe(true)
  call('set', null)
  dispose()
  install()
  expect(call('get')).toEqual({ combo: null, registered: false, error: null })
  expect(state.held.size).toBe(0)
})

it('reports OS conflicts and invalid chords, and releases the binding while capturing keys', async () => {
  const { install, call, wc } = await setup()
  install()
  state.taken.add('Alt+J')
  expect(call('set', 'alt+j').error).toBe('taken')
  expect(call('set', 'j').error).toBe('invalid')
  call('set', 'mod+shift+h')
  call('capture', true)
  expect(state.held.size).toBe(0)
  call('set', 'mod+alt+space')
  expect(state.held.size).toBe(0)
  call('capture', false)
  expect(state.held.has('CommandOrControl+Alt+Space')).toBe(true)
  call('capture', true)
  wc.emit('destroyed')
  expect(state.held.has('CommandOrControl+Alt+Space')).toBe(true)
  app.emit('will-quit')
  expect(state.held.size).toBe(0)
})

it('rejects a guest frame before it can mutate the device preference', async () => {
  const { install, call, event } = await setup()
  install()
  expect(() => call('set', 'alt+j', { ...event, senderFrame: { url: 'https://example.com' } })).toThrow('untrusted')
  expect(call('get').combo).toBe('mod+shift+h')
})
