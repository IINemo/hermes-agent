export const DEFAULT_HUD_SHORTCUT = 'mod+shift+h'

export interface HudShortcutStatus {
  combo: string | null
  registered: boolean
  error: 'invalid' | 'taken' | null
}

export interface HudShortcutApi {
  getSettings: (legacyCombo?: string | null) => Promise<HudShortcutStatus>
  setShortcut: (combo: string | null) => Promise<HudShortcutStatus>
  setCapturing: (capturing: boolean) => Promise<void>
  onStatus: (callback: (status: HudShortcutStatus) => void) => () => void
}
