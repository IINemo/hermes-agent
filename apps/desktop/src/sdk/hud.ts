import { computed, type ReadableAtom } from 'nanostores'

import { requestComposerFocus } from '@/app/chat/composer/focus'
import { NEW_CHAT_ROUTE, sessionRoute } from '@/app/routes'
import { $workspaceMode, setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { $freshDraftKey, requestComposerDraftSync } from '@/store/composer'
import { $newChatConnectionId, $newChatProfile, $newChatRoute } from '@/store/profile'
import { $selectedStoredSessionId, requestSessionResume } from '@/store/session'
import { $botChatScopes, focusWorkspaceOwnerSessionTile } from '@/store/session-states'
import { isHudWindow } from '@/store/windows'

function currentChat() {
  return {
    storedId: $selectedStoredSessionId.get(),
    draftKey: $freshDraftKey.get(),
    profile: $newChatProfile.get(),
    route: $newChatRoute.get(),
    connectionId: $newChatConnectionId.get()
  }
}

// Window-local return address, never a canonical bot-session identity.
let regularChat: ReturnType<typeof currentChat> | null = null

/** A retained tile is not visible in the HUD's single routed chat surface. */
export function focusVisibleWorkspaceSession(...args: Parameters<typeof focusWorkspaceOwnerSessionTile>) {
  return isHudWindow() ? null : focusWorkspaceOwnerSessionTile(...args)
}

export const hudHost = {
  isActive: isHudWindow,
  /** The HUD's routed chat; retained main-window tiles do not own this readout. */
  sessionId: $selectedStoredSessionId as ReadableAtom<null | string>,
  sessionOwnerKey: computed([$selectedStoredSessionId, $botChatScopes], (id, scopes) =>
    id ? (scopes[id]?.workspaceOwnerKey ?? null) : null
  ),
  currentSessionId: (): null | string => $selectedStoredSessionId.get(),
  rememberChat(): void {
    if (!isHudWindow() || $workspaceMode.get() !== 'sessions') {
      return
    }

    requestComposerDraftSync('flush')
    regularChat = currentChat()
  },
  returnToChat(): void {
    if (!isHudWindow()) {
      return
    }

    requestComposerDraftSync('flush')
    setWorkspaceScope('sessions')

    const storedId = regularChat?.storedId

    if (storedId) {
      requestSessionResume(storedId)
    } else if (regularChat) {
      // Route-resume restores this draft without rotating its scope. Keep its
      // owner too: opening a bot must not redirect an unsent regular draft.
      $freshDraftKey.set(regularChat.draftKey)
      $newChatProfile.set(regularChat.profile)
      $newChatRoute.set(regularChat.route)
      $newChatConnectionId.set(regularChat.connectionId)
    }

    window.location.hash = `#${storedId ? sessionRoute(storedId) : NEW_CHAT_ROUTE}`
    requestComposerFocus('main')
  }
}
