export const AUTOMATION_BRIDGE_LOG_PREFIX = '[automation-bridge] ';

export function withLogPrefix(message: string): string {
  return `${AUTOMATION_BRIDGE_LOG_PREFIX}${message}`;
}

export function withScopedLogPrefix(scope: string, message: string): string {
  return `[automation-bridge:${scope}] ${message}`;
}
