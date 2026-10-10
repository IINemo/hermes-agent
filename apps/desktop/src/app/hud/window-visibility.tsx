import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { type ReactNode, useEffect } from 'react'

import { PaneVisibleContext } from '@/components/pane-shell/pane-visibility'

// A native hide keeps the chat mounted, just like switching away from a tab.
// Let the thread save its reading position before hidden layout can change it.
const $hudWindowVisible = atom(true)

interface HudWindowVisibilityProps {
  children: ReactNode
}

export function HudWindowVisibility({ children }: HudWindowVisibilityProps) {
  const visible = useStore($hudWindowVisible)

  useEffect(() => {
    const off = window.hermesDesktop?.hud?.onChanged?.(({ open }) => $hudWindowVisible.set(open))

    return () => {
      off?.()
      $hudWindowVisible.set(true)
    }
  }, [])

  return <PaneVisibleContext value={visible}>{children}</PaneVisibleContext>
}
