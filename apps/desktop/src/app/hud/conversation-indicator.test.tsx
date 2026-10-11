import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { isHudWindow } = vi.hoisted(() => ({ isHudWindow: vi.fn(() => true) }))
vi.mock('@/store/windows', async original => ({ ...(await original<object>()), isHudWindow }))

import { createPluginContext } from '@/contrib/plugin'
import { I18nProvider } from '@/i18n'
import { stopFaceClock } from '@/plugins/hermes-bots/avatar'
import { $botMeta, ROSTER_KEY } from '@/plugins/hermes-bots/data'
import { HudConversationIndicator } from '@/plugins/hermes-bots/hud-conversation'
import { BOTS_LOCALES } from '@/plugins/hermes-bots/i18n'
import type { RosterRow } from '@/plugins/hermes-bots/types'
import { host } from '@/sdk'
import { $selectedStoredSessionId } from '@/store/session'
import { $botChatScopes, setSessionTileWorkspaceScope } from '@/store/session-states'

const local: RosterRow = { name: 'writer', canonical_session: { id: 'local-chat' } }

const remote: RosterRow = {
  name: 'writer',
  remoteSource: true,
  connectionId: 'vps',
  connectionLabel: 'Work server',
  canonical_session: { id: 'remote-chat', resolved_id: 'remote-tip' }
}

const image = 'data:image/png;base64,iVBORw0KGgo='
let client: QueryClient
let dispose: () => void
const onSelect = vi.fn()

function roster(profiles: RosterRow[]) {
  client.setQueryData([...ROSTER_KEY, host.state.connectionId.get()], { profiles })
}

function mount() {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <QueryClientProvider client={client}>
        <HudConversationIndicator onSelect={onSelect} />
      </QueryClientProvider>
    </I18nProvider>
  )
}

beforeEach(() => {
  onSelect.mockReset()
  isHudWindow.mockReturnValue(true)
  client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })
  dispose = createPluginContext('hermes-bots').i18n.register(BOTS_LOCALES)
  $selectedStoredSessionId.set(null)
  $botChatScopes.set({})
  $botMeta.set({
    writer: { title: 'Local writer' },
    'vps::writer': { title: 'Research assistant', image, custom: true }
  })
})

afterEach(() => {
  cleanup()
  stopFaceClock()
  dispose()
  client.clear()
  $selectedStoredSessionId.set(null)
  $botChatScopes.set({})
  $botMeta.set({})
})

describe('HUD conversation identity', () => {
  it('offers every visible agent and regular chat from a compact keyboard-accessible button', async () => {
    const extra = Array.from({ length: 10 }, (_, i) => ({ name: `agent-${i}` }))
    $botMeta.set({ ...$botMeta.get(), hidden: { hidden: true } })
    roster([local, remote, ...extra, { name: 'hidden' }])
    mount()
    const trigger = screen.getByRole('button', { name: 'Switch agent: Regular chat' })
    expect(trigger.textContent).toBe('')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(13)
    expect(within(menu).queryByText('hidden')).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Research assistant · Work server' }))
    expect(onSelect).toHaveBeenLastCalledWith(remote)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Regular chat' }))
    expect(onSelect).toHaveBeenLastCalledWith(1)
  })

  it('reacts to roster hydration, bot renames, direct chat switches, and returning to a draft', async () => {
    $selectedStoredSessionId.set('remote-tip')
    mount()
    expect(screen.getByRole('status').textContent).toBe('Loading chat…')

    act(() => roster([local, remote]))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Research assistant · Work server'))
    expect(
      screen
        .getByRole('button', { name: 'Switch agent: Research assistant · Work server' })
        .querySelector('img')
        ?.getAttribute('src')
    ).toBe(image)

    act(() => $botMeta.set({ ...$botMeta.get(), 'vps::writer': { title: 'Renamed assistant' } }))
    expect(screen.getByRole('status').textContent).toBe('Renamed assistant · Work server')
    act(() => $selectedStoredSessionId.set('local-chat'))
    expect(screen.getByRole('status').textContent).toBe('Local writer')
    act(() => $selectedStoredSessionId.set('regular-chat'))
    expect(screen.getByRole('status').textContent).toBe('Regular chat')
    act(() => $selectedStoredSessionId.set(null))
    expect(screen.getByRole('status').textContent).toBe('Regular chat')
  })

  it('uses the displayed session owner for a new bot chat before the roster learns its id', () => {
    roster([local, { ...remote, canonical_session: undefined }])
    setSessionTileWorkspaceScope('just-created', { workspaceMode: 'bots', workspaceOwnerKey: 'bot:vps::writer' })
    $selectedStoredSessionId.set('just-created')
    mount()
    expect(screen.getByRole('status').textContent).toBe('Research assistant · Work server')

    act(() => $selectedStoredSessionId.set('regular-chat'))
    expect(screen.getByRole('status').textContent).toBe('Regular chat')
  })

  it('adds no indicator to the main window', () => {
    isHudWindow.mockReturnValue(false)
    roster([local, remote])
    mount()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
