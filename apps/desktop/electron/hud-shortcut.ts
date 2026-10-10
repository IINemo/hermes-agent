import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'

import { DEFAULT_HUD_SHORTCUT, type HudShortcutStatus } from './hud-shortcut-types'
import { createQuickEntryShortcut } from './quick-entry'

/** OS registration and device persistence belong to Electron, including at cold boot. */
export function installHudShortcut({ rendererUrl, toggle }: { rendererUrl: string; toggle: () => void }): () => void {
  const configPath = path.join(app.getPath('userData'), 'hud-shortcut.json')
  const expectedUrl = new URL(rendererUrl)
  const shortcut = createQuickEntryShortcut(globalShortcut, toggle)
  const captures = new Set<WebContents>()
  const watched = new WeakSet<WebContents>()
  let disposed = false
  let combo: string | null = DEFAULT_HUD_SHORTCUT
  let migrated = false

  try {
    const saved = JSON.parse(readFileSync(configPath, 'utf8'))

    if (saved.combo === null || typeof saved.combo === 'string') {
      combo = saved.combo
      migrated = true
    }
  } catch {
    // A missing or corrupt device preference uses the shipped shortcut.
  }

  const persist = (next: string | null) => {
    mkdirSync(path.dirname(configPath), { recursive: true })
    writeFileSync(`${configPath}.tmp`, JSON.stringify({ combo: next }), { mode: 0o600 })
    renameSync(`${configPath}.tmp`, configPath)
    combo = next
    migrated = true
  }

  const status = (): HudShortcutStatus => {
    const { registered, error } = shortcut.current()

    return { combo, registered, error }
  }

  const apply = () => {
    shortcut.apply({
      enabled: combo !== null && captures.size === 0,
      shortcut: (combo ?? DEFAULT_HUD_SHORTCUT).replace(/\bmod\b/g, 'CommandOrControl')
    })

    const current = status()

    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('hermes:hud-shortcut:status', current)
      }
    }

    return current
  }

  const trusted = (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    if (!win || win.isDestroyed() || event.senderFrame !== event.sender.mainFrame) {
      return false
    }

    const url = new URL(event.senderFrame.url)

    return (
      url.protocol === expectedUrl.protocol && url.host === expectedUrl.host && url.pathname === expectedUrl.pathname
    )
  }

  const handlers = {
    get: (_event: IpcMainInvokeEvent, legacyCombo?: unknown) => {
      if (!migrated && (legacyCombo === null || typeof legacyCombo === 'string')) {
        persist(typeof legacyCombo === 'string' ? legacyCombo : null)

        return apply()
      }

      return status()
    },
    set: (_event: IpcMainInvokeEvent, next: unknown) => {
      if (next !== null && typeof next !== 'string') {
        throw new Error('HUD shortcut must be a combo or null')
      }

      persist(typeof next === 'string' ? next : null)

      return apply()
    },
    capture: (event: IpcMainInvokeEvent, capturing: unknown) => {
      if (capturing === true && !captures.has(event.sender)) {
        captures.add(event.sender)

        if (!watched.has(event.sender)) {
          watched.add(event.sender)
          event.sender.once('destroyed', () => {
            if (!disposed && captures.delete(event.sender)) {
              apply()
            }
          })
        }
      } else if (capturing === false) {
        captures.delete(event.sender)
      }

      apply()
    }
  }

  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`hermes:hud-shortcut:${name}`, (event, value) => {
      if (!trusted(event)) {
        throw new Error('HUD shortcut request from an untrusted frame')
      }

      return handler(event, value)
    })
  }

  apply()

  const dispose = () => {
    disposed = true
    captures.clear()
    shortcut.dispose()

    for (const name of Object.keys(handlers)) {
      ipcMain.removeHandler(`hermes:hud-shortcut:${name}`)
    }
  }

  app.once('will-quit', dispose)

  return dispose
}
