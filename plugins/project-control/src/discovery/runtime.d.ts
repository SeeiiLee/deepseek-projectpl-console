export declare const SCANNER_VERSION: 'gate2c-readonly/1'

export declare class DiscoveryPathError extends Error {
  readonly code: string
  readonly details: Record<string, unknown>
}

export declare function scanProjectDirectory(
  rootPath: string,
  options?: Record<string, unknown>,
): Promise<unknown>

export declare function scanSourceDirectory(
  rootPath: string,
  options?: Record<string, unknown>,
): Promise<unknown>

export declare function parseYamlSubset(text: string): Record<string, unknown>

export declare function decodeText(bytes: Uint8Array): string

export declare function isIgnoredDirectoryName(lowerName: string): boolean
