import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import {
  assistantMessage,
  stubThreadEnvironment,
  stubThreadViewportSize,
  ThreadRuntime,
  userMessage
} from '@/components/assistant-ui/test-utils'
import { Thread } from '@/components/assistant-ui/thread'
import { rescopeConnectionScopedStores } from '@/lib/connection-scoped'
import { setActiveProfile } from '@/store/profile'
import { saveThreadScrollPosition } from '@/store/thread-scroll'

import { HudWindowVisibility } from './window-visibility'

stubThreadEnvironment()
stubThreadViewportSize()

const scrollHeight = 5000
const clientHeight = 600
Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight })
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientHeight })

type HudChanged = (state: { open: boolean; sessionId: string; retained: boolean }) => void
const initialDesktop = window.hermesDesktop
let emitHudChanged: HudChanged

beforeEach(() => {
  window.localStorage.clear()
  setActiveProfile('default')
  rescopeConnectionScopedStores(null)
  window.hermesDesktop = {
    hud: {
      onChanged: (listener: HudChanged) => {
        emitHudChanged = listener

        return () => undefined
      }
    }
  } as unknown as Window['hermesDesktop']
})

afterEach(() => {
  window.hermesDesktop = initialDesktop
})

async function settleScroll() {
  await act(async () => {
    for (let tick = 0; tick < 10; tick += 1) {
      await new Promise<void>(resolve => window.setTimeout(resolve, 0))
    }
  })
}

it.each([0, 800])(
  'retains the HUD transcript and restores its reading position on reveal (offset %i)',
  async offset => {
    if (offset) {
      saveThreadScrollPosition('hud-session', { kind: 'offset', fromBottom: offset })
    }

    const { container } = render(
      <HudWindowVisibility>
        <ThreadRuntime messages={[userMessage(), assistantMessage()]}>
          <Thread sessionKey="hud-session" />
        </ThreadRuntime>
      </HudWindowVisibility>
    )

    await settleScroll()
    const viewport = container.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')!
    const expectedTop = scrollHeight - clientHeight - offset
    expect(viewport.scrollTop).toBe(expectedTop)

    for (let cycle = 0; cycle < 2; cycle += 1) {
      act(() => emitHudChanged({ open: false, sessionId: 'hud-session', retained: true }))
      // Native hiding or a background transcript refresh can reset browser layout.
      act(() => {
        viewport.scrollTop = 0
        viewport.dispatchEvent(new Event('scroll'))
      })
      await settleScroll()
      act(() => emitHudChanged({ open: true, sessionId: 'hud-session', retained: true }))
      await settleScroll()
      expect(container.querySelector('[data-slot="aui_thread-viewport"]')).toBe(viewport)
      expect(viewport.scrollTop).toBe(expectedTop)
    }
  }
)
