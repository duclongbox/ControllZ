/* Wire vocabulary, hand-mirrored from shared/schemas/.
 *
 * TEMPORARY. When M1 wires up codegen (json-schema-to-typescript →
 * src/generated/messages.ts, per shared/README.md) this file goes away and the
 * generated union replaces it. Until then, nothing enforces that these match
 * the schemas except review — so if you touch shared/schemas/, touch this too.
 *
 * `erasableSyntaxOnly` is on in tsconfig.app.json, so these are `as const`
 * objects plus derived unions, never TypeScript enums. */

/** shared/schemas/deviceType.schema.json */
export const DEVICE_TYPES = ['desktop', 'phone'] as const
export type DeviceType = (typeof DEVICE_TYPES)[number]

/**
 * shared/schemas/connectRejected.schema.json
 *
 * A well-formed request that is legitimately refused — distinct from `error`,
 * which is a protocol fault. `notPaired` deliberately covers unknown,
 * never-paired and revoked alike: distinguishing them would let a caller
 * enumerate which deviceIds exist. The UI must not try to infer the difference.
 */
export const REJECT_REASONS = ['notPaired', 'desktopOffline', 'alreadyInSession'] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

/** shared/schemas/errorCode.schema.json — protocol faults only. */
export const ERROR_CODES = [
  'malformedMessage',
  'unsupportedMessage',
  'notAuthenticated',
  'alreadyAuthenticated',
  'invalidCredential',
  'wrongDeviceType',
  'invalidPairCode',
  'notPaired',
  'desktopOffline',
  'alreadyInSession',
  'unknownSession',
  'selfPairing',
  'rateLimited',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

/** Which side offers. `sessionStarted` carries this; the desktop is the offerer. */
export const SESSION_ROLES = ['offerer', 'answerer'] as const
export type SessionRole = (typeof SESSION_ROLES)[number]

/** Copy for the two refusals the phone can actually receive. */
export function rejectReasonTitle(reason: RejectReason): string {
  switch (reason) {
    case 'notPaired':
      return 'Not paired with this computer'
    case 'desktopOffline':
      return 'That computer is asleep'
    case 'alreadyInSession':
      return 'Already in a session'
  }
}

export function rejectReasonBody(reason: RejectReason): string {
  switch (reason) {
    case 'notPaired':
      return 'The pairing was removed, or it never completed. Pair again with a fresh code from the desktop app.'
    case 'desktopOffline':
      return 'RemoteHost is not running there right now. Launch it and this screen will move on by itself.'
    case 'alreadyInSession':
      return 'Another device is controlling this computer. A second connection never silently displaces a working one — end the other session first.'
  }
}
