import { Codicon, host, OverflowTip, useValue } from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { isCanonicalChatOnScreen } from './canonical-chat'
import { $botMeta, useRoster } from './data'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botRosterMeta, botWorkspaceOwnerKey } from './routing'

/** A permanent recipient label inside the HUD's composer, independent of the faded transcript. */
export function HudConversationIndicator() {
  if (!host.hud?.isActive() || !host.hud.sessionId || !host.hud.sessionOwnerKey) {
    return null
  }

  return <HudConversationLabel />
}

function HudConversationLabel() {
  const sessionId = useValue(host.hud.sessionId)
  const ownerKey = useValue(host.hud.sessionOwnerKey)
  const metaByName = useValue($botMeta)
  // Share the roster cache and its refreshes without adding a background poll
  // to the HUD, which stays mounted while hidden.
  const { data, isPending } = useRoster({ poll: false })
  const b = useBots()

  // Session-owned scope also identifies a just-created bot chat before the
  // roster refresh learns its canonical id. Never read the last selected bot.
  const bot = data?.profiles?.find(row =>
    ownerKey ? botWorkspaceOwnerKey(row) === ownerKey : isCanonicalChatOnScreen(row, sessionId)
  )

  const meta = bot ? botRosterMeta(bot, metaByName) : null
  const appearance = bot ? botAppearance(bot.name, meta) : null
  const fallback = isPending ? b.hud.loadingChat : b.hud.unknownChat
  const regularChat = !sessionId || (data && !ownerKey)
  const name = bot ? displayName(bot, meta) : regularChat ? b.hud.chatLabel : fallback
  const source = bot?.connectionLabel || (bot?.remoteSource ? bot.connectionId : null)
  const label = source ? `${name} · ${source}` : name

  return (
    <span
      aria-atomic="true"
      className="inline-flex h-7 max-w-32 shrink-0 items-center gap-1.5 text-xs text-(--ui-text-secondary)"
      data-slot="hud-conversation"
      role="status"
    >
      <span aria-hidden className="shrink-0">
        {bot && appearance ? (
          <BotFace
            color={avatarColor(appearance.color, bot.name)}
            image={isBackfilledFacePng(appearance.image) ? null : appearance.image}
            name={bot.name}
            shape={appearance.shape}
            size={20}
          />
        ) : (
          <Codicon name="comment" size="1rem" />
        )}
      </span>
      <OverflowTip label={label} placement="control">
        <span className="truncate">{label}</span>
      </OverflowTip>
    </span>
  )
}
