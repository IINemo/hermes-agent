import { host, KEYBINDS_AREA } from '@hermes/plugin-sdk'
import type { KeybindContribution, PluginContext } from '@hermes/plugin-sdk'

import { isCanonicalChatOnScreen } from './canonical-chat'
import { $botMeta, botRosterKey, cachedUnionRoster, preferReachableSameNameRows, primeRoster } from './data'
import { isBotHidden } from './hidden-bots'
import { openRosterBot } from './roster-actions'
import { sortRosterBots } from './roster-pane-derivation'
import { bumpBotOpenGeneration } from './shared'
import type { RosterRow } from './types'

/** Rebindable HUD-only navigation, using the same canonical open as a bot row. */
export function registerHudShortcuts(ctx: PluginContext): void {
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

  const switchTo = async (slot: number) => {
    if (!host.hud?.isActive()) {
      return
    }

    const request = ++generation
    bumpBotOpenGeneration()

    if (slot === 1) {
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

    const roster = cachedUnionRoster()?.profiles ?? []
    const meta = $botMeta.get()

    const visible = preferReachableSameNameRows(
      sortRosterBots(roster, meta).roster.filter(bot => !isBotHidden(bot, meta))
    )

    const keys = visible.map(botRosterKey)
    slots = [...slots, ...keys.filter(key => !slots.includes(key))]
    const bot = visible.find(row => botRosterKey(row) === slots[slot - 2])

    if (!bot) {
      return
    }

    rememberRegularChat(roster)
    await openRosterBot(bot)
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
            defaults: [`mod+shift+${slot}`],
            label: slot === 1 ? ctx.i18n.t('hud.regularChat') : ctx.i18n.t('hud.botSlot', slot - 1),
            run: () => {
              void switchTo(slot).catch(error => host.notifyError(error, ctx.i18n.t('hud.switchFailed')))
            }
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
}
