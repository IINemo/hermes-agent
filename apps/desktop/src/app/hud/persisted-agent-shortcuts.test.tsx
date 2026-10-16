import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Saved user overrides exist before the settings store initializes.
const { savedBindings } = vi.hoisted(() => {
  // jsdom has no native navigator.platform; exercise the macOS renderer chords.
  Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'MacIntel' })

  const savedBindings = {
    'hermes-bots.hud.switch.1': ['mod+ctrl+1'],
    'hermes-bots.hud.switch.2': ['mod+ctrl+2'],
    'hermes-bots.hud.switch.3': ['mod+ctrl+3']
  }

  window.localStorage.setItem('hermes.desktop.keybinds', JSON.stringify(savedBindings))

  return { savedBindings }
})

vi.mock('@/store/windows', async original => ({ ...(await original<object>()), isHudWindow: () => true }))
vi.mock('@/themes/context', () => ({ useTheme: () => ({ resolvedMode: 'dark', setMode: vi.fn() }) }))
// Native backend startup and RPC transport are the only external boundaries.
// Roster loading, key dispatch, canonical lookup, and SDK navigation stay real.
vi.mock('@/store/gateway', async original => ({
  ...(await original<object>()),
  openGatewayForProfile: vi.fn(async () => undefined),
  openGatewayForAgent: vi.fn(async () => undefined)
}))

import { useKeybinds } from '@/app/hooks/use-keybinds'
import { sessionRoute } from '@/app/routes'
import { setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { createPluginContext } from '@/contrib/plugin'
import { queryClient } from '@/lib/query-client'
import { $botMeta, cachedUnionRoster } from '@/plugins/hermes-bots/data'
import { registerHudShortcuts } from '@/plugins/hermes-bots/hud-shortcuts'
import { BOTS_LOCALES } from '@/plugins/hermes-bots/i18n'
import { host } from '@/sdk'
import { $comboIndex, setBinding } from '@/store/keybinds'
import { $activeSessionId, $connection, $selectedStoredSessionId, $sessionResumeRequest } from '@/store/session'
import { $botChatScopes } from '@/store/session-states'

let dispose: (() => void)[] = []

beforeEach(() => {
  queryClient.clear()
  $connection.set(null)
  $botMeta.set({})
  $botChatScopes.set({})
  $selectedStoredSessionId.set('regular-chat')
  $activeSessionId.set('regular-runtime')
  $sessionResumeRequest.set(null)
  setWorkspaceScope('sessions')
  window.location.hash = `#${sessionRoute('regular-chat')}`

  vi.spyOn(host, 'profileRoutes').mockResolvedValue([])
  vi.spyOn(host, 'agents').mockResolvedValue({ agents: [], sources: [] } as never)
  vi.spyOn(host, 'request').mockImplementation(async <T,>(method: string, params?: Record<string, unknown>) => {
    if (method === 'profiles.list') {
      return { profiles: [{ name: 'alpha' }, { name: 'beta' }] } as T
    }

    if (method === 'session.list') {
      return { sessions: [{ id: `${params?.profile}-chat`, title: 'Bot Chat', message_count: 0 }] } as T
    }

    throw new Error(`Unexpected RPC: ${method}`)
  })
  // Stand in for transcript hydration after a real navigation/resume request.
  dispose.push(
    $sessionResumeRequest.listen(request => {
      if (request) {
        $selectedStoredSessionId.set(request.sessionId)
        $activeSessionId.set(`${request.sessionId}-runtime`)
      }
    })
  )
  const ctx = createPluginContext('hermes-bots', cleanup => dispose.push(cleanup))
  ctx.i18n.register(BOTS_LOCALES)
  registerHudShortcuts(ctx)
  dispose.push(
    renderHook(
      () =>
        useKeybinds({
          archiveSelectedSession: vi.fn(),
          openNewSessionTab: vi.fn(),
          requestGateway: host.request,
          startFreshSession: vi.fn(),
          toggleCommandCenter: vi.fn(),
          toggleSelectedPin: vi.fn()
        }),
      { wrapper: ({ children }: { children: ReactNode }) => createElement(MemoryRouter, null, children) }
    ).unmount
  )
})

afterEach(() => {
  dispose.reverse().forEach(cleanup => cleanup())
  dispose = []
  vi.restoreAllMocks()
  queryClient.clear()
  $selectedStoredSessionId.set(null)
  $activeSessionId.set(null)
  $sessionResumeRequest.set(null)
  $botChatScopes.set({})
  setWorkspaceScope('sessions')
  window.localStorage.clear()
})

it('preserves saved HUD hotkeys on unrelated settings writes and switches canonical chats while typing', async () => {
  // This used to persist [] for every late-registered HUD action. The current
  // renderer still worked, but the next renderer boot loaded cleared bindings.
  act(() => setBinding('session.new', ['mod+shift+n']))
  expect(JSON.parse(window.localStorage.getItem('hermes.desktop.keybinds') ?? '{}')).toMatchObject(savedBindings)
  expect(cachedUnionRoster()).toBeNull()
  expect($comboIndex.get().get('mod+ctrl+2')).toContain('hermes-bots.hud.switch.2')

  const composer = window.document.createElement('textarea')
  window.document.body.append(composer)
  composer.focus()
  dispose.push(() => composer.remove())

  for (const [slot, session] of [
    [2, 'alpha-chat'],
    [3, 'beta-chat'],
    [1, 'regular-chat']
  ] as const) {
    act(() => {
      const event = new KeyboardEvent('keydown', {
        code: `Digit${slot}`,
        key: String(slot),
        metaKey: true,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })

      composer.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    })
    await waitFor(() => expect($selectedStoredSessionId.get()).toBe(session))
    expect(window.location.hash).toBe(`#${sessionRoute(session)}`)
  }

  for (const profile of ['alpha', 'beta']) {
    expect(host.request).toHaveBeenCalledWith(
      'session.list',
      expect.objectContaining({ profile, title: 'Bot Chat', include_hidden: true })
    )
  }
})
