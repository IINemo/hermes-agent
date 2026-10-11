import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

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
import { $activeSessionId, $connection, $selectedStoredSessionId, $sessionResumeRequest } from '@/store/session'
import { $botChatScopes } from '@/store/session-states'

let dispose: (() => void)[] = []
let selectChat: ReturnType<typeof registerHudShortcuts>

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
  selectChat = registerHudShortcuts(ctx)
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
})

it('opens two agents from a cold local HUD using real roster and navigation, then returns to chat', async () => {
  // The HUD has no Bots pane; nothing has populated the query cache yet.
  expect(cachedUnionRoster()).toBeNull()

  for (const [slot, glyph, name] of [
    [2, '™', 'alpha'],
    [3, '£', 'beta']
  ] as const) {
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          code: `Digit${slot}`,
          key: glyph,
          metaKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true
        })
      )
    )
    await waitFor(() => expect(window.location.hash).toBe(`#${sessionRoute(`${name}-chat`)}`))
    expect($selectedStoredSessionId.get()).toBe(`${name}-chat`)
    expect(host.request).toHaveBeenCalledWith(
      'session.list',
      expect.objectContaining({
        profile: name,
        title: 'Bot Chat',
        include_hidden: true
      })
    )
  }

  act(() => selectChat?.(1))
  expect(window.location.hash).toBe(`#${sessionRoute('regular-chat')}`)
  // The click path opens the same canonical chat; it never invents a new session.
  act(() => selectChat?.(cachedUnionRoster()!.profiles!.find(row => row.name === 'alpha')!))
  await waitFor(() => expect(window.location.hash).toBe(`#${sessionRoute('alpha-chat')}`))
})
