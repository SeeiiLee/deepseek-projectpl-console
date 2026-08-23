import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SkillLibrarySection, type SkillLibrarySectionInjected } from './SkillLibrarySection.tsx'
import { createSkillLibraryApi } from './skillApi.ts'
import { requirePersonalApi } from './personalApi.ts'

/** Runtime services used by the settings contribution. */
export const inject = ['slots', 'personalApi']

/** Register the personal Skill library as an independent Settings section. */
export function apply(ctx: ClientContext): void {
  const service = requirePersonalApi(ctx.get('personalApi'))
  const api = createSkillLibraryApi(service)
  const injected = (): SkillLibrarySectionInjected => ({ api })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personal-skill-library',
    order: 40,
    label: 'Skill 资料库',
    inject: injected,
  }, SkillLibrarySection))
}

export type { SkillItem, SkillLibraryApi, NewSkillInput } from './skillApi.ts'
export type { SkillLibrarySectionInjected, SkillLibrarySectionProps } from './SkillLibrarySection.tsx'
