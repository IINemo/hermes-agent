import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { isHudWindow, primeRoster, cachedUnionRoster, openRosterBot } = vi.hoisted(() => ({
  isHudWindow: vi.fn(() => true),
  primeRoster: vi.fn(async (): Promise<void> => undefined),
  cachedUnionRoster: vi.fn(),
  openRosterBot: vi.fn()
}))

vi.mock('@/store/windows', async original => ({ ...(await original<object>()), isHudWindow }))
vi.mock('@/themes/context', () => ({ useTheme: () => ({ resolvedMode: 'dark', setMode: vi.fn() }) }))
vi.mock('@/plugins/hermes-bots/data', async original => ({
  ...(await original<object>()),
  primeRoster,
  cachedUnionRoster
}))
vi.mock('@/plugins/hermes-bots/roster-actions', () => ({ openRosterBot }))

import { sessionRoute } from '@/app/routes'
import { $workspaceMode, setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { createPluginContext } from '@/contrib/plugin'
import { isMacPlatform } from '@/lib/platform'
import { $botMeta } from '@/plugins/hermes-bots/data'
import { registerHudShortcuts } from '@/plugins/hermes-bots/hud-shortcuts'
import { BOTS_LOCALES } from '@/plugins/hermes-bots/i18n'
import { getBotOpenGeneration } from '@/plugins/hermes-bots/shared'
import type { RosterRow } from '@/plugins/hermes-bots/types'
import { $freshDraftKey, onComposerDraftSyncRequest } from '@/store/composer'
import { resetBinding, setBinding } from '@/store/keybinds'
import { $newChatProfile } from '@/store/profile'
import { $selectedStoredSessionId, $sessionResumeRequest } from '@/store/session'
import { deferred } from '@/test/deferred'

import { useKeybinds } from './use-keybinds'

const wrapper = ({ children }: { children: ReactNode }) => createElement(MemoryRouter, null, children)

const alpha: RosterRow = {
  name: 'alpha',
  canonical_session: { id: 'alpha-chat' },
  ui_meta: { 'hermes-bots': { created: 20 } }
}

const beta: RosterRow = {
  name: 'beta',
  connectionId: 'remote',
  canonical_session: { id: 'beta-chat' },
  ui_meta: { 'hermes-bots': { created: 10 } }
}

let cleanup: (() => void)[] = []
let input: HTMLTextAreaElement

function select(id: string | null) {
  $selectedStoredSessionId.set(id)
}

function press(slot: number, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: `Digit${slot}`,
    key: ')!@#$%^&*('[slot],
    ctrlKey: !isMacPlatform(),
    metaKey: isMacPlatform(),
    shiftKey: true,
    ...options
  })

  act(() => {
    input.dispatchEvent(event)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  isHudWindow.mockReturnValue(true)
  primeRoster.mockResolvedValue(undefined)
  cachedUnionRoster.mockReturnValue({ profiles: [alpha, beta] })
  $botMeta.set({})
  setWorkspaceScope('sessions')
  select('regular-chat')
  $sessionResumeRequest.set(null)
  window.location.hash = `#${sessionRoute('regular-chat')}`
  openRosterBot.mockImplementation(async (bot: RosterRow) => {
    setWorkspaceScope('bots', `bot:${bot.name}`)
    select(`${bot.name}-chat`)
    window.location.hash = `#${sessionRoute(`${bot.name}-chat`)}`

    return true
  })
  const ctx = createPluginContext('hermes-bots', dispose => cleanup.push(dispose))
  ctx.i18n.register(BOTS_LOCALES)
  registerHudShortcuts(ctx)
  cleanup.push(
    renderHook(
      () =>
        useKeybinds({
          archiveSelectedSession: vi.fn(),
          openNewSessionTab: vi.fn(),
          requestGateway: async <T,>() => undefined as T,
          startFreshSession: vi.fn(),
          toggleCommandCenter: vi.fn(),
          toggleSelectedPin: vi.fn()
        }),
      { wrapper }
    ).unmount
  )
  input = window.document.createElement('textarea')
  window.document.body.append(input)
  input.focus()
})

afterEach(() => {
  cleanup.reverse().forEach(dispose => dispose())
  cleanup = []
  input.remove()
  resetBinding('hermes-bots.hud.switch.2')
  setWorkspaceScope('sessions')
  select(null)
})

describe('HUD chat shortcuts through the shared keyboard dispatcher', () => {
  it('opens stable bot slots while typing and returns to the original chat', async () => {
    const flush = vi.fn()
    cleanup.push(onComposerDraftSyncRequest(flush))
    const hidden = { name: 'hidden', ui_meta: { 'hermes-bots': { hidden: true, created: 100 } } }
    $botMeta.set({ hidden: { hidden: true } })
    cachedUnionRoster.mockReturnValue({ profiles: [hidden, alpha, beta] })
    press(2)
    await waitFor(() => expect(openRosterBot).toHaveBeenLastCalledWith(alpha))
    press(3)
    await waitFor(() => expect(openRosterBot).toHaveBeenLastCalledWith(beta))
    cachedUnionRoster.mockReturnValue({ profiles: [{ ...beta, ui_meta: { 'hermes-bots': { created: 200 } } }, alpha] })
    press(2)
    await waitFor(() => expect(openRosterBot).toHaveBeenLastCalledWith(alpha))
    press(9)
    await act(async () => {})
    expect(openRosterBot).toHaveBeenCalledTimes(3)
    press(1)
    expect(window.location.hash).toBe(`#${sessionRoute('regular-chat')}`)
    expect($sessionResumeRequest.get()?.sessionId).toBe('regular-chat')
    expect($workspaceMode.get()).toBe('sessions')
    expect(flush).toHaveBeenCalledWith({ mode: 'flush', target: 'main' })
  })

  it('restores the unsent draft scope and owner, and honors rebinding and HUD scope', async () => {
    select(null)
    $freshDraftKey.set('regular-draft')
    $newChatProfile.set('writer')
    isHudWindow.mockReturnValue(false)
    press(2)
    expect(primeRoster).not.toHaveBeenCalled()
    isHudWindow.mockReturnValue(true)
    press(2, { isComposing: true })
    press(2, { shiftKey: false })
    expect(primeRoster).not.toHaveBeenCalled()
    setBinding('hermes-bots.hud.switch.2', ['mod+alt+shift+9'])
    press(2)
    expect(primeRoster).not.toHaveBeenCalled()
    press(9, { altKey: true })
    await waitFor(() => expect(openRosterBot).toHaveBeenCalledWith(alpha))
    $freshDraftKey.set('other-draft')
    $newChatProfile.set('alpha')
    press(1)
    expect($freshDraftKey.get()).toBe('regular-draft')
    expect($newChatProfile.get()).toBe('writer')
    expect(window.location.hash).toBe('#/')
  })

  it('a newer shortcut cancels a slow roster lookup and in-flight bot navigation', async () => {
    const pending = deferred()
    primeRoster.mockReturnValue(pending.promise)
    const before = getBotOpenGeneration()
    press(2)
    press(1)
    expect(getBotOpenGeneration()).toBeGreaterThan(before)
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(openRosterBot).not.toHaveBeenCalled()
    expect(window.location.hash).toBe(`#${sessionRoute('regular-chat')}`)
  })

  it('a HUD retargeted directly to a Bot Chat never remembers it as the regular chat', async () => {
    press(1)
    select('alpha-chat')
    window.location.hash = `#${sessionRoute('alpha-chat')}`
    cachedUnionRoster.mockReturnValue(null)
    primeRoster.mockImplementation(async () => {
      cachedUnionRoster.mockReturnValue({ profiles: [alpha, beta] })
    })

    press(1)

    await waitFor(() => expect(window.location.hash).toBe(`#${sessionRoute('regular-chat')}`))
    expect($sessionResumeRequest.get()?.sessionId).toBe('regular-chat')
    expect(openRosterBot).not.toHaveBeenCalled()
  })
})
