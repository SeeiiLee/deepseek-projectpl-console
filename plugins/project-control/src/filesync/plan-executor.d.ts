export declare class FileSyncPlanError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>
  constructor(code: string, message: string, details?: Record<string, unknown>)
}

export declare type FileSyncOperation =
  | { kind: 'create_directory'; relativePath: string; expectedState: 'absent'; contentHash?: null }
  | { kind: 'create_file'; relativePath: string; expectedState: 'absent'; contentHash: string }

export declare function validateWritePlanDomain(
  plan: Record<string, any>,
): ReadonlyArray<Readonly<FileSyncOperation>>

export declare function computePlanHash(plan: Record<string, any>): string

export declare function verifyWritePlanHashes(plan: Record<string, any>): boolean

export declare function stagingRootForPlan(
  plan: { syncPolicy: string; planId: string },
  targetRoot: string,
): string

export declare function pathIsWithin(rootPath: string, candidatePath: string): boolean

export declare function isStagingDirectoryName(name: string): boolean

export declare function stagePlan(options: Record<string, any>): Promise<Record<string, unknown>>

export declare function commitPlan(options: Record<string, any>): Promise<Record<string, unknown>>

export declare function verifyCommittedPlan(options: Record<string, any>): Promise<{
  ok: boolean
  mismatches: ReadonlyArray<Record<string, unknown>>
}>

export declare function rollbackCreated(options: Record<string, any>): Promise<{
  complete: boolean
  failures: ReadonlyArray<Record<string, unknown>>
}>

export declare function recoverPlan(options: Record<string, any>): Promise<{
  outcome: 'rolled_back' | 'resumable' | 'quarantined'
  mismatches?: ReadonlyArray<Record<string, unknown>>
}>

export declare function executeFileSyncPlan(options: Record<string, any>): Promise<{
  createdPaths: ReadonlyArray<string>
  rootPreexistedEmpty: boolean
}>
