export type HudMessages = {
  regularChat: string
  botSlot: (slot: number) => string
  switchFailed: string
  chatLabel: string
  loadingChat: string
  unknownChat: string
  switchAgent: string
  noAgents: string
  retryAgents: string
  rosterUnavailable: string
}

export const HUD_MESSAGES: Record<'en' | 'ja' | 'zh' | 'zhHant', HudMessages> = {
  en: {
    regularChat: 'HUD: Return to regular chat',
    botSlot: slot => `HUD: Switch to bot ${slot}`,
    switchFailed: 'Could not switch HUD chat',
    chatLabel: 'Regular chat',
    loadingChat: 'Loading chat…',
    unknownChat: 'Chat',
    switchAgent: 'Switch agent',
    noAgents: 'No agents available',
    retryAgents: 'Retry loading agents',
    rosterUnavailable: 'Agents could not be loaded. Open the HUD agent picker to retry.'
  },
  ja: {
    regularChat: 'HUD：通常のチャットに戻る',
    botSlot: slot => `HUD：ボット${slot}に切り替え`,
    switchFailed: 'HUDのチャットを切り替えられませんでした',
    chatLabel: '通常のチャット',
    loadingChat: 'チャットを読み込み中…',
    unknownChat: 'チャット',
    switchAgent: 'エージェントを切り替え',
    noAgents: '利用可能なエージェントがありません',
    retryAgents: 'エージェントを再読み込み',
    rosterUnavailable: 'エージェントを読み込めませんでした。HUDのエージェント選択から再試行してください。'
  },
  zh: {
    regularChat: 'HUD：返回普通聊天',
    botSlot: slot => `HUD：切换到机器人 ${slot}`,
    switchFailed: '无法切换 HUD 聊天',
    chatLabel: '普通聊天',
    loadingChat: '正在加载聊天…',
    unknownChat: '聊天',
    switchAgent: '切换智能体',
    noAgents: '没有可用的智能体',
    retryAgents: '重新加载智能体',
    rosterUnavailable: '无法加载智能体。请打开 HUD 智能体选择器重试。'
  },
  zhHant: {
    regularChat: 'HUD：返回一般聊天',
    botSlot: slot => `HUD：切換至機器人 ${slot}`,
    switchFailed: '無法切換 HUD 聊天',
    chatLabel: '一般聊天',
    loadingChat: '正在載入聊天…',
    unknownChat: '聊天',
    switchAgent: '切換代理',
    noAgents: '沒有可用的代理',
    retryAgents: '重新載入代理',
    rosterUnavailable: '無法載入代理。請開啟 HUD 代理選擇器重試。'
  }
}
