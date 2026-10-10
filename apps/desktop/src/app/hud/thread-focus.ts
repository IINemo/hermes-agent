import { type RefObject, useEffect } from 'react'

import { focusComposerInput } from '@/app/chat/composer/focus'
import { RICH_INPUT_SLOT } from '@/app/chat/composer/rich-editor'

const THREAD_INTERACTIVE = 'a[href], button, input, textarea, select, [contenteditable], [role="button"], [role="link"]'

/**
 * Reading and copying are engaged HUD interactions too. Keep the band up
 * during selection and while its controls have focus, without canceling the
 * browser's text-selection gesture or sending focus back to the composer.
 */
export function useHudThreadFocus(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current

    if (!root) {
      return
    }

    let selecting = false
    let windowFocused = true

    const apply = () => {
      const band = root.querySelector('[data-slot="composer-bounds"]')
      const selection = document.getSelection()

      const selected =
        selection &&
        !selection.isCollapsed &&
        ((selection.anchorNode && band?.contains(selection.anchorNode)) ||
          (selection.focusNode && band?.contains(selection.focusNode)))

      const focused = document.activeElement && band?.contains(document.activeElement)
      root.toggleAttribute('data-hud-reading', windowFocused && Boolean(selecting || selected || focused))
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return
      }

      const target = event.target

      if (!(target instanceof Element)) {
        return
      }

      if (!target.closest('[data-slot="composer-bounds"]')) {
        return
      }

      selecting = true
      apply()

      if (target.closest(THREAD_INTERACTIVE) || target.closest('[data-slot="aui_thread-viewport"]')) {
        return
      }

      event.preventDefault()

      focusComposerInput(root.querySelector<HTMLElement>(`[data-slot="${RICH_INPUT_SLOT}"]`))
    }

    const onPointerUp = () => {
      selecting = false
      apply()
    }

    const onBlur = () => {
      windowFocused = false
      selecting = false
      apply()
    }

    const onFocus = () => {
      windowFocused = true
      apply()
    }

    root.addEventListener('pointerdown', onPointerDown, true)
    root.addEventListener('focusin', apply)
    root.addEventListener('focusout', apply)
    document.addEventListener('selectionchange', apply)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)

    return () => {
      root.removeAttribute('data-hud-reading')
      root.removeEventListener('pointerdown', onPointerDown, true)
      root.removeEventListener('focusin', apply)
      root.removeEventListener('focusout', apply)
      document.removeEventListener('selectionchange', apply)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [rootRef])
}
