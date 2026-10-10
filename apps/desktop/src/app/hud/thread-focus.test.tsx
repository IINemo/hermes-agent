import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { CopyButton } from '@/components/ui/copy-button'

import { useHudGlass } from './glass'
import { useHudThreadFocus } from './thread-focus'

const response = 'A response you can select and copy.'

function Harness() {
  const ref = useRef<HTMLDivElement>(null)
  useHudThreadFocus(ref)
  useHudGlass(ref, true)

  return (
    <div data-hud-shell ref={ref}>
      <input aria-label="Message" data-slot="composer-rich-input" />
      <div data-slot="composer-bounds">
        <div data-slot="aui_thread-viewport">
          <p>{response}</p>
          <CopyButton haptic={false} text={response} />
        </div>
      </div>
    </div>
  )
}

afterEach(() => {
  document.getSelection()?.removeAllRanges()
})

it('allows transcript selection and holds the band after mouse-up until the selection clears', () => {
  const { container } = render(<Harness />)
  const root = container.querySelector('[data-hud-shell]')!
  const message = screen.getByText(response)
  act(() => screen.getByLabelText('Message').focus())

  const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
  fireEvent(message, down)
  expect(down.defaultPrevented).toBe(false)
  expect(root.hasAttribute('data-hud-reading')).toBe(true)

  act(() => {
    screen.getByLabelText('Message').blur()
    const range = document.createRange()
    range.selectNodeContents(message)
    document.getSelection()?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  fireEvent.pointerUp(window)
  expect(document.getSelection()?.toString()).toBe(response)
  expect(root.hasAttribute('data-hud-reading')).toBe(true)

  act(() => {
    document.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
  })
  expect(root.hasAttribute('data-hud-reading')).toBe(false)
})

it('keeps the transcript engaged when its Copy button takes focus and copies through the desktop bridge', async () => {
  const originalDesktop = window.hermesDesktop
  const writeClipboard = vi.fn().mockResolvedValue(undefined)
  const setFrost = vi.fn()
  window.hermesDesktop = { hud: { setFrost }, writeClipboard } as unknown as Window['hermesDesktop']

  try {
    const { container } = render(<Harness />)
    const root = container.querySelector('[data-hud-shell]')!
    act(() => screen.getByLabelText('Message').focus())
    const copy = screen.getByRole('button', { name: 'Copy' })
    act(() => copy.focus())
    expect(root.hasAttribute('data-hud-reading')).toBe(true)
    expect(setFrost).toHaveBeenLastCalledWith(true)
    fireEvent.click(copy)
    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith(response))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    act(() => window.dispatchEvent(new Event('blur')))
    expect(root.hasAttribute('data-hud-reading')).toBe(false)
    await waitFor(() => expect(setFrost).toHaveBeenLastCalledWith(false))
  } finally {
    window.hermesDesktop = originalDesktop
  }
})
