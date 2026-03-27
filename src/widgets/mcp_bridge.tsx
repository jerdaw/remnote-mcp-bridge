/**
 * Automation Bridge Widget
 *
 * Sidebar widget that displays connection status, stats, and logs.
 * Uses renderWidget() as required by RemNote plugin SDK.
 */

import { renderWidget, StorageEvents, usePlugin } from '@remnote/plugin-sdk';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ConnectionStatus, RetryPhase } from '../bridge/websocket-client';
import { type BridgeRuntimeSnapshot, type HistoryEntry } from '../bridge/runtime';
import { useCompatibleTracker as useTracker } from './tracker-compat';
import {
  SETTING_ACCEPT_WRITE_OPERATIONS,
  SETTING_ACCEPT_REPLACE_OPERATION,
  SETTING_AUTO_TAG_ENABLED,
  SETTING_AUTO_TAG,
  SETTING_JOURNAL_PREFIX,
  SETTING_JOURNAL_TIMESTAMP,
  SETTING_WS_URL,
  SETTING_DEFAULT_PARENT,
  DEFAULT_WS_URL,
  AutomationBridgeSettings,
} from '../settings';
import {
  BRIDGE_UI_COMMAND_STORAGE_KEY,
  BRIDGE_UI_SNAPSHOT_STORAGE_KEY,
  type BridgeUiCommand,
  deserializeBridgeRuntimeSnapshot,
  isSerializedBridgeRuntimeSnapshot,
} from './runtime-ui-bridge';
import { buildConnectionUiState } from './connection-ui';
import { withScopedLogPrefix } from '../logging';

function createBridgeUiCommand(
  kind: BridgeUiCommand['kind'],
  extra: Omit<BridgeUiCommand, 'source' | 'id' | 'timestamp' | 'kind'>
): BridgeUiCommand {
  return {
    source: 'widget',
    id: `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    kind,
    ...extra,
  } as BridgeUiCommand;
}

function AutomationBridgeWidget() {
  const plugin = usePlugin();
  const lastSnapshotSignatureRef = useRef<string | null>(null);
  const lastSettingsSignatureRef = useRef<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [snapshot, setSnapshot] = useState<BridgeRuntimeSnapshot>({
    status: 'disconnected',
    retryPhase: 'idle',
    wsUrl: DEFAULT_WS_URL,
    logs: [],
    stats: {
      created: 0,
      updated: 0,
      journal: 0,
      searches: 0,
    },
    history: [],
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
  });

  // Read settings from RemNote
  const acceptWriteOperations = useTracker(
    () => plugin.settings.getSetting<boolean>(SETTING_ACCEPT_WRITE_OPERATIONS),
    []
  );
  const acceptReplaceOperation = useTracker(
    () => plugin.settings.getSetting<boolean>(SETTING_ACCEPT_REPLACE_OPERATION),
    []
  );
  const autoTagEnabled = useTracker(
    () => plugin.settings.getSetting<boolean>(SETTING_AUTO_TAG_ENABLED),
    []
  );
  const autoTag = useTracker(() => plugin.settings.getSetting<string>(SETTING_AUTO_TAG), []);
  const journalPrefix = useTracker(
    () => plugin.settings.getSetting<string>(SETTING_JOURNAL_PREFIX),
    []
  );
  const journalTimestamp = useTracker(
    () => plugin.settings.getSetting<boolean>(SETTING_JOURNAL_TIMESTAMP),
    []
  );
  const wsUrl = useTracker(() => plugin.settings.getSetting<string>(SETTING_WS_URL), []);
  const defaultParentId = useTracker(
    () => plugin.settings.getSetting<string>(SETTING_DEFAULT_PARENT),
    []
  );

  const applySnapshot = useCallback((storedSnapshot: unknown) => {
    if (!isSerializedBridgeRuntimeSnapshot(storedSnapshot)) {
      return;
    }

    const signature = `${storedSnapshot.status}:${storedSnapshot.retryPhase}`;
    if (lastSnapshotSignatureRef.current !== signature) {
      console.log(
        withScopedLogPrefix(
          'widget',
          `Storage snapshot read: status=${storedSnapshot.status} retryPhase=${storedSnapshot.retryPhase} logs=${storedSnapshot.logs.length}`
        )
      );
      lastSnapshotSignatureRef.current = signature;
    }

    setSnapshot(deserializeBridgeRuntimeSnapshot(storedSnapshot));
  }, []);

  useEffect(() => {
    console.log(withScopedLogPrefix('widget', 'Widget mounted'));

    const storageListener = (value: unknown): void => {
      applySnapshot(value);
    };

    plugin.event.addListener(
      StorageEvents.StorageSessionChange,
      BRIDGE_UI_SNAPSHOT_STORAGE_KEY,
      storageListener
    );

    void plugin.storage
      .getSession(BRIDGE_UI_SNAPSHOT_STORAGE_KEY)
      .then((storedSnapshot) => {
        applySnapshot(storedSnapshot);
      })
      .catch((error) => {
        console.warn(withScopedLogPrefix('widget', `Failed to read stored snapshot: ${error}`));
      });

    const command = createBridgeUiCommand('request_snapshot', {});

    console.log(withScopedLogPrefix('widget', 'Storage command out: request_snapshot'));
    void plugin.storage.setSession(BRIDGE_UI_COMMAND_STORAGE_KEY, command);

    const nudgeCommand = createBridgeUiCommand('nudge_reconnect', {
      reason: 'bridge panel opened',
    });
    console.log(withScopedLogPrefix('widget', 'Storage command out: nudge_reconnect'));
    void plugin.storage.setSession(BRIDGE_UI_COMMAND_STORAGE_KEY, nudgeCommand);

    return () => {
      plugin.event.removeListener(
        StorageEvents.StorageSessionChange,
        BRIDGE_UI_SNAPSHOT_STORAGE_KEY,
        storageListener
      );
      console.log(withScopedLogPrefix('widget', 'Widget unmounted'));
    };
  }, [applySnapshot, plugin]);

  useEffect(() => {
    if (
      acceptWriteOperations === undefined ||
      acceptReplaceOperation === undefined ||
      autoTagEnabled === undefined ||
      autoTag === undefined ||
      journalPrefix === undefined ||
      journalTimestamp === undefined ||
      wsUrl === undefined ||
      defaultParentId === undefined
    ) {
      return;
    }

    const settings: AutomationBridgeSettings = {
      acceptWriteOperations,
      acceptReplaceOperation,
      autoTagEnabled,
      autoTag,
      journalPrefix,
      journalTimestamp,
      wsUrl,
      defaultParentId,
    };

    const signature = JSON.stringify(settings);
    if (lastSettingsSignatureRef.current === signature) {
      return;
    }
    lastSettingsSignatureRef.current = signature;

    const command = createBridgeUiCommand('update_settings', { settings });
    console.log(
      withScopedLogPrefix(
        'widget',
        `Storage command out: update_settings keys=${Object.keys(settings).join(', ')}`
      )
    );
    void plugin.storage.setSession(BRIDGE_UI_COMMAND_STORAGE_KEY, command);
  }, [
    plugin,
    acceptWriteOperations,
    acceptReplaceOperation,
    autoTagEnabled,
    autoTag,
    journalPrefix,
    journalTimestamp,
    wsUrl,
    defaultParentId,
  ]);

  useEffect(() => {
    setNow(Date.now());

    if (!snapshot.nextRetryAt || snapshot.status === 'connected') {
      return;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [snapshot.nextRetryAt, snapshot.status]);

  // Handle reconnect button
  const handleReconnect = useCallback(() => {
    const command = createBridgeUiCommand('reconnect', {
      reason: 'sidebar button',
    });
    console.log(withScopedLogPrefix('widget', 'Storage command out: reconnect'));
    void plugin.storage.setSession(BRIDGE_UI_COMMAND_STORAGE_KEY, command);
  }, [plugin]);

  const status = snapshot.status as ConnectionStatus;
  const retryPhase = snapshot.retryPhase as RetryPhase;
  const logs = snapshot.logs;
  const stats = snapshot.stats;
  const history = snapshot.history;
  const connectionUi = buildConnectionUiState(snapshot, now);

  // Action icons for history
  const actionIcons: Record<HistoryEntry['action'], string> = {
    create: '+',
    update: '~',
    journal: '#',
    search: '?',
    read: '>',
  };

  const handleOpenRem = useCallback(
    async (e: React.MouseEvent, remId: string) => {
      e.stopPropagation();
      const targetRem = await plugin.rem.findOne(remId);
      if (targetRem) {
        await targetRem.openRemInContext();
      } else {
        await plugin.app.toast('Could not find that Rem!');
      }
    },
    [plugin]
  );

  const handleCopyReference = useCallback(
    async (e: React.MouseEvent, remId: string) => {
      e.stopPropagation();
      const targetRem = await plugin.rem.findOne(remId);
      if (targetRem) {
        try {
          await targetRem.copyReferenceToClipboard();
        } catch (err) {
          console.error('Failed to copy reference:', err);
        }
      } else {
        await plugin.app.toast('Could not find that Rem!');
      }
    },
    [plugin]
  );

  const renderActionRow = (
    isChild: boolean,
    title: string,
    remId: string | undefined,
    action: HistoryEntry['action'],
    timestamp: Date,
    showExpandIcon: boolean,
    itemCount: number,
    onClickRow?: () => void
  ) => {
    return (
      <div
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.02)';
          const actions = e.currentTarget.querySelector('.row-actions') as HTMLElement | null;
          if (actions) {
            actions.style.opacity = '0.85';
            actions.style.maxWidth = '50px';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
          const actions = e.currentTarget.querySelector('.row-actions') as HTMLElement | null;
          if (actions) {
            actions.style.opacity = '0';
            actions.style.maxWidth = '0px';
          }
        }}
        onClick={onClickRow}
        style={{
          padding: isChild ? '6px 10px 6px 36px' : '6px 10px',
          fontSize: '11px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: onClickRow ? 'pointer' : 'default',
          transition: 'background-color 0.2s',
          position: 'relative',
        }}
      >
        <span
          style={{
            color:
              action === 'create'
                ? '#22c55e'
                : action === 'update'
                  ? '#3b82f6'
                  : action === 'journal'
                    ? '#8b5cf6'
                    : action === 'search'
                      ? '#f59e0b'
                      : '#6b7280',
            fontWeight: 600,
            width: isChild ? '24px' : '28px',
            minWidth: isChild ? '24px' : '28px',
            whiteSpace: 'nowrap',
            display: 'flex',
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: isChild ? 'center' : 'flex-start',
            gap: '2px',
          }}
        >
          {actionIcons[action]}
          {showExpandIcon && <span style={{ fontSize: '10px' }}>{itemCount}</span>}
        </span>
        <span style={{ color: '#6b7280', flexShrink: 0 }}>
          {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span
          onClick={(e) => {
            if (remId) handleOpenRem(e, remId);
          }}
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#374151',
            textDecoration: 'none',
            cursor: remId ? 'pointer' : 'inherit',
          }}
        >
          {title}
        </span>

        {/* Actions panel */}
        <div
          className="row-actions"
          style={{
            display: 'flex',
            gap: '4px',
            opacity: 0,
            maxWidth: '0px',
            overflow: 'hidden',
            transition: 'all 0.2s',
            alignItems: 'center',
          }}
        >
          {remId && (
            <span
              onClick={(e) => handleCopyReference(e, remId)}
              title="Copy Reference"
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <span
                data-icon="copy-v2"
                className="inline-block"
                style={{
                  width: '16px',
                  minWidth: '16px',
                  height: '16px',
                  minHeight: '16px',
                  backgroundColor: 'currentColor',
                  maskImage:
                    'url(https://www.remnote.com/offline_assets/svg_icons/uncolored/copy-v2.svg)',
                  maskRepeat: 'no-repeat',
                  maskPosition: 'center center',
                  maskSize: 'contain',
                  WebkitMaskImage:
                    'url(https://www.remnote.com/offline_assets/svg_icons/uncolored/copy-v2.svg)',
                  WebkitMaskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center center',
                  WebkitMaskSize: 'contain',
                }}
              ></span>
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '12px', fontFamily: 'system-ui, sans-serif', fontSize: '13px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '12px',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
          Automation Bridge (OpenClaw, CLI, MCP...)
        </h3>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            borderRadius: '12px',
            backgroundColor: connectionUi.badge.bg,
            color: connectionUi.badge.color,
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          <span>{connectionUi.badge.icon}</span>
          <span>{connectionUi.badge.text}</span>
        </div>
      </div>

      <div
        style={{
          marginBottom: '12px',
          padding: '10px',
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          backgroundColor: '#f9fafb',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#111827', marginBottom: '6px' }}>
          {connectionUi.summary}
        </div>
        {connectionUi.phaseLabel && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 8px',
              borderRadius: '999px',
              backgroundColor: '#eef2ff',
              color: '#4338ca',
              fontSize: '11px',
              fontWeight: 600,
              marginBottom: '8px',
            }}
          >
            {connectionUi.phaseLabel}
          </div>
        )}
        <div style={{ display: 'grid', gap: '4px', fontSize: '11px', color: '#4b5563' }}>
          <div>
            {connectionUi.directionLabel}: {snapshot.wsUrl}
          </div>
          <div>
            The bridge plugin initiates this connection outward from RemNote to the local companion
            app.
          </div>
          {connectionUi.nextRetryLabel && <div>{connectionUi.nextRetryLabel}</div>}
          {connectionUi.lastConnectedLabel && <div>{connectionUi.lastConnectedLabel}</div>}
          {connectionUi.lastDisconnectLabel && <div>{connectionUi.lastDisconnectLabel}</div>}
          <div>
            RemNote plugins do not have a hosted backend API, so the bridge connects outward
            instead.
          </div>
          {connectionUi.hint && <div>{connectionUi.hint}</div>}
        </div>
      </div>

      {/* Reconnect button */}
      {status !== 'connected' && (
        <div style={{ marginBottom: '12px' }}>
          <button
            onClick={handleReconnect}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              backgroundColor: '#ffffff',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            Reconnect Now
          </button>
          <div style={{ marginTop: '6px', fontSize: '11px', color: '#6b7280' }}>
            Forces an immediate retry instead of waiting for the next scheduled one.
          </div>
        </div>
      )}

      {/* Stats Section */}
      <div
        style={{
          marginBottom: '12px',
          padding: '10px',
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          backgroundColor: '#f9fafb',
          color: '#374151',
        }}
      >
        <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '8px', color: '#6b7280' }}>
          SESSION STATS
        </div>
        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px' }}>
          {retryPhase === 'burst'
            ? `Burst window: ${Math.min(snapshot.reconnectAttempts, snapshot.maxReconnectAttempts)}/${snapshot.maxReconnectAttempts} retries used`
            : retryPhase === 'standby'
              ? 'Standby retry mode active'
              : status === 'connected'
                ? 'Live session active'
                : 'Idle'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#22c55e' }}>+</span>
            <span>Created: {stats.created}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#3b82f6' }}>~</span>
            <span>Updated: {stats.updated}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#8b5cf6' }}>#</span>
            <span>Journal: {stats.journal}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#f59e0b' }}>?</span>
            <span>Searches: {stats.searches}</span>
          </div>
        </div>
      </div>

      {/* History Section */}
      {history.length > 0 && (
        <div
          style={{
            marginBottom: '12px',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            backgroundColor: '#f9fafb',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '8px 10px',
              borderBottom: '1px solid #e5e7eb',
              color: '#6b7280',
            }}
          >
            RECENT ACTIONS
          </div>
          <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
            {history.map((entry, index) => {
              const showExpand = entry.titles.length > 1;
              const isExpanded = !!expandedRows[index];
              //const isLast = index === history.length - 1;

              const toggleExpand = () => {
                if (showExpand) {
                  setExpandedRows((prev) => ({ ...prev, [index]: !prev[index] }));
                }
              };

              return (
                <div
                  key={index}
                  style={{
                    borderBottom: index < history.length - 1 ? 'none' : '1px solid #e5e7eb',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Main Row */}
                  {renderActionRow(
                    false,
                    entry.titles[0],
                    entry.remIds?.[0],
                    entry.action,
                    entry.timestamp,
                    showExpand && !isExpanded,
                    entry.titles.length,
                    showExpand ? toggleExpand : undefined
                  )}

                  {/* Expanded rows */}
                  <div
                    style={{
                      maxHeight: isExpanded && showExpand ? '500px' : '0px',
                      opacity: isExpanded && showExpand ? 1 : 0,
                      overflowY: 'auto',
                      transition: 'all 0.3s ease-in-out',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {showExpand &&
                        entry.titles.slice(1).map((title, idx) => {
                          const actualIdx = idx + 1;
                          const remId = entry.remIds?.[actualIdx];
                          return (
                            <React.Fragment key={actualIdx}>
                              {renderActionRow(
                                true,
                                title,
                                remId,
                                entry.action,
                                entry.timestamp,
                                false,
                                0,
                                undefined
                              )}
                            </React.Fragment>
                          );
                        })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Logs Section */}
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          backgroundColor: '#f9fafb',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '8px 10px',
            borderBottom: '1px solid #e5e7eb',
            color: '#6b7280',
          }}
        >
          LOGS
        </div>
        <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
          {logs.length === 0 ? (
            <div style={{ padding: '12px', color: '#9ca3af', textAlign: 'center' }}>
              No logs yet
            </div>
          ) : (
            logs
              .slice()
              .reverse()
              .map((log, index) => (
                <div
                  key={index}
                  style={{
                    padding: '6px 10px',
                    borderBottom: index < logs.length - 1 ? '1px solid #e5e7eb' : 'none',
                    fontSize: '11px',
                  }}
                >
                  <span style={{ color: '#9ca3af' }}>
                    {log.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span
                    style={{
                      marginLeft: '8px',
                      color:
                        log.level === 'error'
                          ? '#ef4444'
                          : log.level === 'success'
                            ? '#22c55e'
                            : log.level === 'warn'
                              ? '#f59e0b'
                              : '#374151',
                    }}
                  >
                    {log.message}
                  </span>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

renderWidget(AutomationBridgeWidget);
