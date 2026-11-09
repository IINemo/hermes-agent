import { atom, computed } from 'nanostores'

import { $registryVersion } from '@/contrib/registry'
import { allKeybindActions, defaultBindings, keybindAction, type KeybindBindings } from '@/lib/keybinds/actions'
import { followBrowserWindowKind } from '@/lib/keybinds/app-window'
import { canonicalizeCombo } from '@/lib/keybinds/combo'
import { persistStore } from '@/lib/persist-store'
import { arraysEqual, persistString, storedString, type WriteOptions } from '@/lib/storage'

import type { HudShortcutStatus } from '../../electron/hud-shortcut-types'

const STORAGE_KEY = 'hermes.desktop.keybinds'

// The user's raw stored overrides. Kept verbatim so an action CONTRIBUTED
// after module init (plugins register late) still resolves its saved rebind —
// `bindingsFor` consults this before falling back to shipped defaults.
function readStoredOverrides(): Record<string, string[]> {
  const raw = storedString(STORAGE_KEY)

  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string[]> = {}

    for (const [id, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        out[id] = value.filter((combo): combo is string => typeof combo === 'string')
      }
    }

    return out
  } catch {
    // Corrupt storage falls back to defaults.
    return {}
  }
}

const storedOverrides = readStoredOverrides()

// Actions the user set themselves. A display-mode change moves shipped
// defaults (Ctrl+W in an app window, Alt+W in a tab) and must never move
// these, even when the user's combo equals the other mode's default. Every
// stored entry is one: older builds stored exactly the rebinds.
const explicitIds = new Set(Object.keys(storedOverrides))

// Defaults overlaid with the user's stored overrides. Unknown / stale action
// ids are dropped; actions added in a later release pick up their shipped
// default; late-registered contributed actions resolve via `bindingsFor`.
function loadBindings(): KeybindBindings {
  const base = defaultBindings()

  for (const id of Object.keys(base)) {
    // Empty combos are a cleared binding, not a missing one. Object.hasOwn
    // keeps a stored [] (sidebar unbound) from falling back to the shipped default.
    if (Object.hasOwn(storedOverrides, id)) {
      base[id] = storedOverrides[id]
    }
  }

  return base
}

// Persist the user's own bindings and nothing that still follows a shipped
// default, so changing a default never gets shadowed by a stored snapshot. A
// user binding is kept even while it equals the current default: it is the
// other window kind's default too, and storing a diff would drop it.
function persistBindings(bindings: KeybindBindings, options: WriteOptions): void {
  const defaults = defaultBindings()
  const diff: KeybindBindings = {}

  for (const action of allKeybindActions()) {
    // Plugins register after loadBindings(), so absence in the atom does not
    // mean cleared: resolve their saved override or default just as dispatch does.
    const current = bindingsFor(action.id, bindings)

    if (explicitIds.has(action.id) || !arraysEqual(current, defaults[action.id] ?? [])) {
      diff[action.id] = current
    }
  }

  // Actions contributed after boot (plugins register late) are missing
  // from the registry when the boot-time subscribe fires. Carry their
  // stored overrides forward so the persist does not wipe them. Re-read
  // storage rather than the module-init snapshot: an override written after
  // boot (plugin registered → rebound → unloaded) is otherwise invisible here
  // and the next persist of any other action drops it.
  for (const [id, combos] of Object.entries(readStoredOverrides())) {
    if (!(id in defaults)) {
      diff[id] = combos
    }
  }

  persistString(STORAGE_KEY, JSON.stringify(diff), options)
}

export const $bindings = atom<KeybindBindings>(loadBindings())

persistStore($bindings, persistBindings, defaultBindings())

// A default move that would land on a chord the user gave another action is
// skipped, so the user's binding is not silently shadowed; the action keeps
// its combo as a saved one, or a reload would bring the collision back.
function keepOffUserChords(id: string, combos: string[]): boolean {
  if (explicitIds.has(id)) {
    return true
  }

  const bindings = $bindings.get()
  const taken = combos.some(combo => conflictsFor(id, combo, bindings).some(other => explicitIds.has(other)))

  if (taken) {
    explicitIds.add(id)
  }

  return taken
}

// "Open in Chrome" turns an app window into a tab without a reload.
followBrowserWindowKind($bindings, defaultBindings, keepOffUserChords)

export const $hudShortcutError = atom<'invalid' | 'taken' | 'load' | 'save' | null>(null)
let hudShortcutRevision = 0
let hudShortcutWrite = 0

const hudShortcutApi = () => (typeof window === 'undefined' ? undefined : window.hermesDesktop?.hudShortcut)

/** Main owns this device-wide binding; each renderer caches its live reply. */
export function initHudShortcut(): () => void {
  const api = hudShortcutApi()

  if (!api) {
    return () => {}
  }

  let disposed = false

  const adopt = (status: HudShortcutStatus) => {
    hudShortcutRevision += 1
    $hudShortcutError.set(status.error)
    $bindings.set({ ...$bindings.get(), 'view.toggleHud': status.combo ? [status.combo] : [] })
  }

  const off = api.onStatus(adopt)
  const current = hudShortcutRevision
  // Adopt a pre-existing renderer rebind once, then Electron's saved setting wins.
  void api
    .getSettings(bindingsFor('view.toggleHud')[0] ?? null)
    .then(status => {
      if (!disposed && hudShortcutRevision === current) {
        adopt(status)
      }
    })
    .catch(() => $hudShortcutError.set('load'))

  return () => {
    disposed = true
    off()
  }
}

function applyBindings(next: KeybindBindings): void {
  const api = hudShortcutApi()

  if (!api || arraysEqual(next['view.toggleHud'] ?? [], $bindings.get()['view.toggleHud'] ?? [])) {
    $bindings.set(next)

    return
  }

  $bindings.set({ ...next, 'view.toggleHud': $bindings.get()['view.toggleHud'] ?? [] })
  const version = hudShortcutRevision
  const request = ++hudShortcutWrite
  void api
    .setShortcut(next['view.toggleHud']?.[0] ?? null)
    .then(status => {
      if (request !== hudShortcutWrite || version !== hudShortcutRevision) {
        return
      }

      $hudShortcutError.set(status.error)
      $bindings.set({ ...$bindings.get(), 'view.toggleHud': status.combo ? [status.combo] : [] })
    })
    .catch(() => {
      if (request === hudShortcutWrite) {
        $hudShortcutError.set('save')
      }
    })
}

/** Live combos for an action: explicit binding → stored override → default. */
export function bindingsFor(id: string, bindings: KeybindBindings = $bindings.get()): string[] {
  return bindings[id] ?? storedOverrides[id] ?? [...(keybindAction(id)?.defaults ?? [])]
}

// Reverse lookup combo → action ids for dispatch, in KEYBIND_ACTIONS order.
// The first action runs; a `passthrough` action that declines hands the chord
// to the next one. Keys go through `canonicalizeCombo` so a `ctrl+…` binding
// resolves everywhere. Recomputes on registry mutations so contributed
// actions dispatch live.
export const $comboIndex = computed([$bindings, $registryVersion], bindings => {
  const index = new Map<string, string[]>()

  for (const action of allKeybindActions()) {
    // Electron owns this chord even when another macOS app has focus. Do not
    // dispatch a second toggle if Chromium also receives the same keypress.
    if (action.id === 'view.toggleHud' && hudShortcutApi()) {
      continue
    }

    for (const combo of bindingsFor(action.id, bindings)) {
      const key = canonicalizeCombo(combo)
      const ids = index.get(key)

      if (ids) {
        ids.push(action.id)
      } else {
        index.set(key, [action.id])
      }
    }
  }

  return index
})

export function setBinding(actionId: string, combos: string[]): void {
  const action = keybindAction(actionId)

  if (!action) {
    return
  }

  // Picking the current default again is a reset, not a pin.
  if (arraysEqual(combos, [...action.defaults])) {
    explicitIds.delete(actionId)
  } else {
    explicitIds.add(actionId)
  }

  applyBindings({ ...$bindings.get(), [actionId]: [...combos] })
}

/** Drop every combo. Empty is persisted, so a shipped default stays unbound. */
export function clearBinding(actionId: string): void {
  setBinding(actionId, [])
}

export function resetBinding(actionId: string): void {
  const action = keybindAction(actionId)

  if (!action) {
    return
  }

  explicitIds.delete(actionId)
  applyBindings({ ...$bindings.get(), [actionId]: [...action.defaults] })
}

export function resetAllBindings(): void {
  explicitIds.clear()
  applyBindings(defaultBindings())
}

// Other actions that already use `combo` (excluding `actionId` itself). A
// `passthrough` action layered over a later one shares the chord by design,
// so that pair is not reported from either side. Combos compare the way
// dispatch keys them, so `mod+tab` meets an app window's `ctrl+tab`.
// HUD-only actions take precedence in the HUD while app-wide actions keep other windows.
export function conflictsFor(actionId: string, combo: string, bindings = $bindings.get()): string[] {
  const actions = allKeybindActions()
  const self = actions.findIndex(action => action.id === actionId)
  const key = canonicalizeCombo(combo)
  // Two shipped defaults spelled differently (`ctrl+1` vs `mod+1`) overlap by
  // design off macOS; the alias only conflicts once a user binding (or a combo
  // being proposed for this action) is involved.
  const proposed = explicitIds.has(actionId) || !bindingsFor(actionId, bindings).includes(combo)

  return actions
    .filter((action, index) => {
      const userSide = proposed || explicitIds.has(action.id)

      const clashes = bindingsFor(action.id, bindings).some(
        other => other === combo || (userSide && canonicalizeCombo(other) === key)
      )

      if (index === self || !clashes) {
        return false
      }

      if (Boolean(action.hudOnly) !== Boolean(actions[self]?.hudOnly)) {
        return false
      }

      const earlier = index < self ? action : actions[self]

      return !earlier?.passthrough
    })
    .map(action => action.id)
}

// ── Capture ─────────────────────────────────────────────────────────────────
// `$capture` is the action currently listening for its next keypress (a panel
// row armed for rebinding). Session-only — never persisted.

export const $capture = atom<string | null>(null)

export function beginCapture(actionId: string): void {
  const api = hudShortcutApi()

  if (!api) {
    $capture.set(actionId)

    return
  }

  const request = ++captureRequest
  // Release the global chord before recording keys, including its current chord.
  void api
    .setCapturing(true)
    .then(() => {
      if (request === captureRequest) {
        $capture.set(actionId)
      }
    })
    .catch(() => $hudShortcutError.set('save'))
}

let captureRequest = 0

export function endCapture(): void {
  captureRequest += 1
  $capture.set(null)
  void hudShortcutApi()
    ?.setCapturing(false)
    .catch(() => $hudShortcutError.set('save'))
}

export type CaptureStep = { type: 'cancel' } | { type: 'set'; combos: string[] } | { type: 'wait' }

// Capture-mode keydown. Backspace/Delete record an empty combo so a shipped
// chord (sidebar mod+b) can be unbound. Escape cancels. A modifier-only press
// (`combo == null`) keeps waiting for a real key.
export function captureStep(key: string, combo: string | null): CaptureStep {
  if (key === 'Escape') {
    return { type: 'cancel' }
  }

  if (key === 'Backspace' || key === 'Delete') {
    return { type: 'set', combos: [] }
  }

  if (!combo) {
    return { type: 'wait' }
  }

  return { type: 'set', combos: [combo] }
}
