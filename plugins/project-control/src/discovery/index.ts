import {
  DiscoveryPathError,
  SCANNER_VERSION as runtimeScannerVersion,
  scanProjectDirectory as runtimeScanProjectDirectory,
  scanSourceDirectory as runtimeScanSourceDirectory,
} from './runtime.js'

export { DiscoveryPathError }

export type DiscoveryRole =
  | 'readme'
  | 'prd'
  | 'devlog'
  | 'progress'
  | 'next'
  | 'current_architecture'
  | 'decision'
  | 'other'

export interface DiscoveryOptions {
  maxDepth?: number
  sourceDepth?: number
  maxEntries?: number
  maxDocuments?: number
  maxBytes?: number
  maxFileBytes?: number
  maxCandidates?: number
  previewChars?: number
}

export interface DiscoveryPathRecord {
  displayPath: string
  realPath: string
  normalizedPath: string
}

export interface DiscoveryIssue {
  code: string
  severity: 'info' | 'warning' | 'error' | 'blocking'
  message: string
  details: Record<string, unknown>
}

export interface DiscoveryDocument {
  relativePath: string
  displayPath: string
  realPath: string
  normalizedPath: string
  suggestedRole: DiscoveryRole | null
  roleCandidates: ReadonlyArray<{
    role: DiscoveryRole
    score: number
    confidence: 'low' | 'medium' | 'high'
    evidence: ReadonlyArray<{ kind: string; detail: string }>
  }>
  title: string | null
  preview: string | null
  sha256: `sha256:${string}`
  byteSize: number
  mtime: string
  observedAt: string
  evidence: Readonly<{ signals: ReadonlyArray<Record<string, unknown>> }>
}

export interface DiscoveryCandidate extends DiscoveryPathRecord {
  root: DiscoveryPathRecord
  isCandidate: boolean
  detectedMode: 'unknown' | 'linked_legacy' | 'managed'
  status: 'discovered' | 'conflict'
  manifestStatus: 'absent' | 'valid' | 'invalid' | 'unsupported' | 'unreadable' | 'validating_bindings'
  manifestProjectId: string | null
  manifestHash: `sha256:${string}` | null
  manifestName: string | null
  manifestOrigin: Record<string, unknown> | null
  manifestDocumentBindings: ReadonlyArray<{
    role: DiscoveryRole
    relativePath: string
    contentHash: `sha256:${string}` | null
    required: boolean
  }>
  manifest: Readonly<Record<string, unknown>> | null
  suggestedName: string
  nameCandidates: ReadonlyArray<Record<string, unknown>>
  suggestedSummary: string | null
  summarySource: string | null
  summary: Readonly<{ value: string | null; source: Readonly<Record<string, unknown>> | null }>
  confidence: Readonly<{
    level: 'low' | 'medium' | 'high'
    score: number
    evidence: ReadonlyArray<Record<string, unknown>>
    nameSource: Readonly<{ relativePath: string | null; label: string }>
    manifest: Readonly<Record<string, unknown>> | null
  }>
  markers: ReadonlyArray<Record<string, unknown>>
  documents: ReadonlyArray<DiscoveryDocument>
  issues: ReadonlyArray<DiscoveryIssue>
  scanStats: Readonly<Record<string, unknown>>
}

export interface DiscoveryScanEnvelope {
  mode: 'source_root' | 'single_project'
  scannerVersion: string
  rootPath: DiscoveryPathRecord
  sourceRoot: DiscoveryPathRecord & {
    scanPreferences: Readonly<Record<string, unknown>>
    isEnabled: true
  }
  scanPreferences: Readonly<Record<string, unknown>>
  status: 'completed'
  summary: Readonly<Record<string, unknown>>
  candidates: ReadonlyArray<DiscoveryCandidate>
  issues: ReadonlyArray<DiscoveryIssue>
}

export const SCANNER_VERSION = runtimeScannerVersion as 'gate2c-readonly/1'
export const scanProjectDirectory = runtimeScanProjectDirectory as (
  rootPath: string,
  options?: DiscoveryOptions,
) => Promise<DiscoveryScanEnvelope>
export const scanSourceDirectory = runtimeScanSourceDirectory as (
  rootPath: string,
  options?: DiscoveryOptions,
) => Promise<DiscoveryScanEnvelope>
