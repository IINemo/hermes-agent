import { host, KEYBINDS_AREA } from '@hermes/plugin-sdk'
import type { KeybindContribution, PluginContext } from '@hermes/plugin-sdk'

import { isCanonicalChatOnScreen } from './canonical-chat'
import { $botMeta, botRosterKey, cachedUnionRoster, preferReachableSameNameRows, primeRoster } from './data'
import { isBotHidden } from './hidden-bots'
import { openRosterBot } from './roster-actions'
import { sortRosterBots } from './roster-pane-derivation'
import { bumpBotOpenGeneration } from './shared'
import type { RosterRow } from './types'

export type HudChatTarget = number | RosterRow

export function visibleHudBots(roster: RosterRow[], meta = $botMeta.get()): RosterRow[] {
  return preferReachableSameNameRows(sortRosterBots(roster, meta).roster.filter(bot => !isBotHidden(bot, meta)))
}

/** Rebindable HUD-only navigation, using the same canonical open as a bot row. */
export function registerHudShortcuts(ctx: PluginContext): ((target: HudChatTarget) => void) | undefined {
  if (!host.hud) {
    return
  }

  let generation = 0
  // Freeze positions as they are first used. Incoming messages can reorder the
  // roster, but must not silently change which bot a numbered shortcut opens.
  let slots: string[] = []

  const rememberRegularChat = (roster: RosterRow[]) => {
    const selected = host.hud.currentSessionId()

    if (!roster.some(bot => isCanonicalChatOnScreen(bot, selected))) {
      host.hud.rememberChat()
    }
  }

  const switchTo = async (target: HudChatTarget) => {
    if (!host.hud?.isActive()) {
      return
    }

    const request = ++generation
    bumpBotOpenGeneration()

    if (target === 1) {
      if (!cachedUnionRoster()) {
        await primeRoster()
      }

      if (request !== generation) {
        return
      }

      rememberRegularChat(cachedUnionRoster()?.profiles ?? [])
      host.hud.returnToChat()

      return
    }

    await primeRoster()

    if (request !== generation) {
      return
    }

    const roster = cachedUnionRoster()?.profiles

    if (!roster) {
      throw new Error(ctx.i18n.t('hud.rosterUnavailable'))
    }

    const visible = visibleHudBots(roster)

    const keys = visible.map(botRosterKey)
    slots = [...slots, ...keys.filter(key => !slots.includes(key))]
    const key = typeof target === 'number' ? slots[target - 2] : botRosterKey(target)
    const bot = visible.find(row => botRosterKey(row) === key)

    if (!bot) {
      return
    }

    rememberRegularChat(roster)
    await openRosterBot(bot)
  }

  // Both the picker and numbered keys share cancellation, draft preservation,
  // and canonical opening. A picker selection also cancels an older keypress.
  const selectChat = (target: HudChatTarget) => {
    void switchTo(target).catch(error => host.notifyError(error, ctx.i18n.t('hud.switchFailed')))
  }

  const registerLabels = () =>
    ctx.registerMany(
      Array.from({ length: 9 }, (_, index) => {
        const slot = index + 1

        return {
          id: `hud-switch-${slot}`,
          area: KEYBINDS_AREA,
          data: {
            id: `hermes-bots.hud.switch.${slot}`,
            category: 'view',
            defaults: [`mod+alt+${slot}`],
            hudOnly: true,
            label: slot === 1 ? ctx.i18n.t('hud.regularChat') : ctx.i18n.t('hud.botSlot', slot - 1),
            run: () => selectChat(slot)
          } satisfies KeybindContribution
        }
      })
    )

  let disposeLabels = registerLabels()
  ctx.i18n.onLocaleChange(() => {
    disposeLabels()
    disposeLabels = registerLabels()
  })
  ctx.onDispose(() => {
    generation += 1
  })

  return selectChat
}
