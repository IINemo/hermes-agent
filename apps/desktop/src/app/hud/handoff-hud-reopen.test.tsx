import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type * as Windows from '@/store/windows'

vi.mock('@/store/windows', async importOriginal => ({
  ...(await importOriginal<typeof Windows>()),
  isHudWindow: () => true
}))
vi.mock('@/store/hud', () => ({ reportHudSession: vi.fn(), watchHudState: vi.fn() }))
vi.mock('@/store/composer', () => ({ reloadPersistedDrafts: vi.fn(), requestComposerDraftSync: vi.fn() }))
vi.mock('../chat/composer/focus', () => ({ getActiveComposer: () => 'main', requestComposerFocus: vi.fn() }))
vi.mock('@/store/session-states', () => ({ focusOpenSession: vi.fn(), sessionTileDelegate: vi.fn() }))
vi.mock('../open-session', () => ({ openSession: vi.fn() }))

import { requestComposerDraftSync } from '@/store/composer'
import { $selectedStoredSessionId } from '@/store/session'

import { useHudHandoff } from './handoff'

it('flushes the hidden popup draft and reclaims its stream once when the same window is shown again', () => {
  const desktopWindow = window as unknown as { hermesDesktop?: Window['hermesDesktop'] }
  const original = desktopWindow.hermesDesktop
  const selected = $selectedStoredSessionId.get()
  $selectedStoredSessionId.set('popup-session')

  let changed: (state: { open: boolean }) => void = () => {}
  desktopWindow.hermesDesktop = {
    hud: {
      onChanged: (listener: typeof changed) => {
        changed = listener

        return () => {}
      }
    }
  } as unknown as Window['hermesDesktop']
  const resumeSession = vi.fn()
  const { unmount } = renderHook(() => useHudHandoff({ navigate: vi.fn(), resumeSession }))

  try {
    changed({ open: true })
    expect(resumeSession).not.toHaveBeenCalled()
    changed({ open: false })
    expect(requestComposerDraftSync).toHaveBeenCalledWith('flush')
    changed({ open: true })
    changed({ open: true })
    expect(resumeSession).toHaveBeenCalledExactlyOnceWith('popup-session')
  } finally {
    unmount()
    desktopWindow.hermesDesktop = original
    $selectedStoredSessionId.set(selected)
  }
})
