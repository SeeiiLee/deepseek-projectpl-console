export type AnchorJumpResult = 'exact' | 'approximate' | 'unavailable'

function anchorElement(key: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
    .find(element => element.dataset.chatAnchorKey === key)
}

function reveal(element: HTMLElement): void {
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  element.animate?.([
    { outline: '2px solid transparent', outlineOffset: '2px' },
    { outline: '2px solid currentColor', outlineOffset: '4px' },
    { outline: '2px solid transparent', outlineOffset: '6px' },
  ], { duration: 900, easing: 'ease-out' })
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => { resolve() }))
}

/** Use the stable upstream chat anchor; if Chat is unmounted, switch its first view tab and retry. */
export async function jumpToChatAnchor(
  key: string | undefined,
  index: number,
  total: number,
): Promise<AnchorJumpResult> {
  if (key !== undefined) {
    const direct = anchorElement(key)
    if (direct !== undefined) {
      reveal(direct)
      return 'exact'
    }
  }

  const tabList = [...document.querySelectorAll<HTMLElement>('[role="tablist"]')]
    .find(list => list.querySelectorAll('button[role="tab"]').length > 1)
  const chatTab = tabList?.querySelector<HTMLButtonElement>('button[role="tab"]')
  if (chatTab !== null && chatTab !== undefined && chatTab.getAttribute('aria-selected') !== 'true') {
    chatTab.click()
    await nextFrame()
    await nextFrame()
  }
  if (key !== undefined) {
    const afterSwitch = anchorElement(key)
    if (afterSwitch !== undefined) {
      reveal(afterSwitch)
      return 'exact'
    }
  }

  const scroll = document.querySelector<HTMLElement>('[data-conversation-scroll]')
  if (scroll === null || total <= 0) return 'unavailable'
  const ratio = total <= 1 ? 1 : index / (total - 1)
  scroll.scrollTo({ top: Math.max(0, (scroll.scrollHeight - scroll.clientHeight) * ratio), behavior: 'smooth' })
  return 'approximate'
}
