import { BUILD_FLAVOR } from './build-flavor.js'

export const STABLE_APP_FLAVOR = Object.freeze({
  flavor: 'stable',
  name: 'DeepSeek Harness Personal',
  appId: 'com.cyrus.deepseek-harness-personal',
  shortcutName: 'DeepSeek Harness Personal.lnk',
  shortcutDescription: 'DeepSeek Harness Personal managed shortcut',
  artifactPrefix: 'DeepSeek-Harness-Personal',
})

export const DEV_APP_FLAVOR = Object.freeze({
  flavor: 'dev',
  name: 'DeepSeek Harness Personal Dev',
  appId: 'com.cyrus.deepseek-harness-personal-dev',
  shortcutName: 'DeepSeek Harness Personal Dev.lnk',
  shortcutDescription: 'DeepSeek Harness Personal Dev managed shortcut',
  artifactPrefix: 'DeepSeek-Harness-Personal-Dev',
})

/** Resolve the single build identity used by the desktop shell. */
export function loadAppFlavor(value = BUILD_FLAVOR) {
  return value === 'dev' ? DEV_APP_FLAVOR : STABLE_APP_FLAVOR
}

/**
 * Cyrus-approved data home for the INSTALLED stable package. The directory-run
 * development copy keeps its historic location during the transition.
 */
export const STABLE_PACKAGED_USER_DATA_PATH = 'F:\\documents\\Cyrus Deepseek Harness Data'

/**
 * Decide whether the desktop shell must override the Electron userData path.
 * Only the packaged stable build gets the fixed F: data home; explicit
 * DSH_DESKTOP_USER_DATA (launchers/smoke) always wins, and the dev flavor plus
 * the unpackaged stable copy keep their default locations.
 * @param {{flavor?: {flavor?: string}|string, isPackaged?: boolean, env?: NodeJS.ProcessEnv}} options
 * @returns {string|null} Absolute override path, or null to keep the default.
 */
export function resolveUserDataOverride(options = {}) {
  const flavor = typeof options.flavor === 'string'
    ? loadAppFlavor(options.flavor)
    : loadAppFlavor(options.flavor?.flavor)
  if (options.env?.DSH_DESKTOP_USER_DATA) return null
  if (flavor.flavor !== 'stable' || options.isPackaged !== true) return null
  return STABLE_PACKAGED_USER_DATA_PATH
}

/**
 * Cyrus-approved Harness home (sessions/profiles) for the INSTALLED stable
 * package. The directory-run copy and the dev flavor keep the default
 * %USERPROFILE%\.dsh / launcher-provided homes.
 */
export const STABLE_PACKAGED_HARNESS_HOME = 'F:\\documents\\Cyrus Deepseek Harness Data\\harness-home'

/**
 * Decide whether the desktop shell must point DSH_HOME at the F: harness home.
 * Mirrors resolveUserDataOverride: packaged stable only, explicit env wins.
 * @param {{flavor?: {flavor?: string}|string, isPackaged?: boolean, env?: NodeJS.ProcessEnv}} options
 * @returns {string|null} Absolute harness home override, or null to keep the default.
 */
export function resolveHarnessHomeOverride(options = {}) {
  const flavor = typeof options.flavor === 'string'
    ? loadAppFlavor(options.flavor)
    : loadAppFlavor(options.flavor?.flavor)
  if (options.env?.DSH_HOME) return null
  if (flavor.flavor !== 'stable' || options.isPackaged !== true) return null
  return STABLE_PACKAGED_HARNESS_HOME
}
