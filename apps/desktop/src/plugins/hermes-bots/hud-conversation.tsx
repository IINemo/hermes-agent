import {
  Button,
  Codicon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  host,
  Loader,
  OverflowTip,
  useValue
} from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { isCanonicalChatOnScreen } from './canonical-chat'
import { $botMeta, botRosterKey, useRoster } from './data'
import { type HudChatTarget, visibleHudBots } from './hud-shortcuts'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botRosterMeta, botWorkspaceOwnerKey } from './routing'
import type { BotMeta, RosterRow } from './types'

interface HudConversationProps {
  onSelect?: (target: HudChatTarget) => void
}

/** Current recipient and the HUD's direct door to every visible agent. */
export function HudConversationIndicator({ onSelect }: HudConversationProps) {
  if (!host.hud?.isActive() || !host.hud.sessionId || !host.hud.sessionOwnerKey || !onSelect) {
    return null
  }

  return <HudConversationPicker onSelect={onSelect} />
}

function HudConversationPicker({ onSelect }: Required<HudConversationProps>) {
  const sessionId = useValue(host.hud.sessionId)
  const ownerKey = useValue(host.hud.sessionOwnerKey)
  const metaByName = useValue($botMeta)
  // Share the roster cache and its refreshes without adding a background poll
  // to the HUD, which stays mounted while hidden.
  const { data, isPending, isError, refetch } = useRoster({ poll: false })
  const b = useBots()

  // Session-owned scope also identifies a just-created bot chat before the
  // roster refresh learns its canonical id. Never read the last selected bot.
  const bot = data?.profiles?.find(row =>
    ownerKey ? botWorkspaceOwnerKey(row) === ownerKey : isCanonicalChatOnScreen(row, sessionId)
  )

  const meta = bot ? botRosterMeta(bot, metaByName) : null
  const fallback = isPending ? b.hud.loadingChat : b.hud.unknownChat
  const regularChat = !sessionId || (data && !ownerKey)
  const name = bot ? displayName(bot, meta) : regularChat ? b.hud.chatLabel : fallback
  const label = bot ? botLabel(bot, meta) : name
  const visible = visibleHudBots(data?.profiles ?? [], metaByName)

  return (
    <span className="inline-flex shrink-0" data-slot="hud-conversation">
      <span aria-atomic="true" className="sr-only" role="status">
        {label}
      </span>
      <DropdownMenu onOpenChange={open => open && void refetch()}>
        <DropdownMenuTrigger asChild>
          <Button aria-label={`${b.hud.switchAgent}: ${label}`} size={bot ? 'sm' : 'icon-sm'} variant="ghost">
            <HudBotIcon bot={bot} meta={meta} />
            {bot && (
              <OverflowTip label={label} placement="control">
                <span className="max-w-20 truncate">{name}</span>
              </OverflowTip>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64" side="top">
          <DropdownMenuItem onSelect={() => onSelect(1)}>
            <HudBotIcon />
            <span className="flex-1">{b.hud.chatLabel}</span>
            {!bot && regularChat && <Codicon aria-hidden name="check" />}
          </DropdownMenuItem>
          {visible.map(row => {
            const rowMeta = botRosterMeta(row, metaByName)
            const rowLabel = botLabel(row, rowMeta)

            return (
              <DropdownMenuItem key={botRosterKey(row)} onSelect={() => onSelect(row)} textValue={rowLabel}>
                <HudBotIcon bot={row} meta={rowMeta} />
                <OverflowTip label={rowLabel} placement="row">
                  <span className="min-w-0 flex-1 truncate">{rowLabel}</span>
                </OverflowTip>
                {bot && botRosterKey(bot) === botRosterKey(row) && <Codicon aria-hidden name="check" />}
              </DropdownMenuItem>
            )
          })}
          {isError ? (
            <DropdownMenuItem
              onSelect={event => {
                event.preventDefault()
                void refetch()
              }}
            >
              <Codicon name="refresh" />
              {b.hud.retryAgents}
            </DropdownMenuItem>
          ) : visible.length === 0 ? (
            <DropdownMenuItem disabled>
              {isPending ? <Loader className="size-4" label={b.hud.loadingChat} /> : b.hud.noAgents}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

function botLabel(bot: RosterRow, meta: BotMeta | null): string {
  const name = displayName(bot, meta)
  const source = bot.connectionLabel || (bot.remoteSource ? bot.connectionId : null)

  return source ? `${name} · ${source}` : name
}

function HudBotIcon({ bot, meta = null }: { bot?: RosterRow; meta?: BotMeta | null }) {
  const appearance = bot ? botAppearance(bot.name, meta) : null

  return (
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
        <Codicon name="comment" />
      )}
    </span>
  )
}
