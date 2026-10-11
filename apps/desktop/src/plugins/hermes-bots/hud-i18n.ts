export type HudMessages = {
  regularChat: string
  botSlot: (slot: number) => string
  switchFailed: string
  chatLabel: string
  loadingChat: string
  unknownChat: string
}

export const HUD_MESSAGES: Record<'en' | 'ja' | 'zh' | 'zhHant', HudMessages> = {
  en: {
    regularChat: 'HUD: Return to regular chat',
    botSlot: slot => `HUD: Switch to bot ${slot}`,
    switchFailed: 'Could not switch HUD chat',
    chatLabel: 'Regular chat',
    loadingChat: 'Loading chat…',
    unknownChat: 'Chat'
  },
  ja: {
    regularChat: 'HUD：通常のチャットに戻る',
    botSlot: slot => `HUD：ボット${slot}に切り替え`,
    switchFailed: 'HUDのチャットを切り替えられませんでした',
    chatLabel: '通常のチャット',
    loadingChat: 'チャットを読み込み中…',
    unknownChat: 'チャット'
  },
  zh: {
    regularChat: 'HUD：返回普通聊天',
    botSlot: slot => `HUD：切换到机器人 ${slot}`,
    switchFailed: '无法切换 HUD 聊天',
    chatLabel: '普通聊天',
    loadingChat: '正在加载聊天…',
    unknownChat: '聊天'
  },
  zhHant: {
    regularChat: 'HUD：返回一般聊天',
    botSlot: slot => `HUD：切換至機器人 ${slot}`,
    switchFailed: '無法切換 HUD 聊天',
    chatLabel: '一般聊天',
    loadingChat: '正在載入聊天…',
    unknownChat: '聊天'
  }
}
