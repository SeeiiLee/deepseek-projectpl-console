import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Compile-time mirror of the single root slot owned and declared by Personal Shell.
 * This package only occupies the slot; it does not own the Shell contract.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'project.control': { kind: 'single'; scope: 'root'; owner: ProjectControlOwnerProps }
  }
}

/** Gate 2C reads bounded Host DTOs over HTTP; the Shell owner still supplies no domain data. */
export interface ProjectControlOwnerProps {}

/** Standard runtime props supplied by the Shell-owned project.control slot. */
export type ProjectControlPlaceholderProps = PropsRuntime<'project.control'>
