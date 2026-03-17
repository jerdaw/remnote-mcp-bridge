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

  // Status colors and icons
  const statusConfig = {
    connected: { color: '#22c55e', bg: '#dcfce7', icon: '●', text: 'Connected' },
    connecting: { color: '#f59e0b', bg: '#fef3c7', icon: '◐', text: 'Connecting...' },
    disconnected: {
      color: retryPhase === 'standby' ? '#2563eb' : '#ef4444',
      bg: retryPhase === 'standby' ? '#dbeafe' : '#fee2e2',
      icon: retryPhase === 'standby' ? '◌' : '○',
      text: retryPhase === 'standby' ? 'Waiting for server...' : 'Disconnected',
    },
    error: { color: '#ef4444', bg: '#fee2e2', icon: '✕', text: 'Error' },
  };

  const currentStatus = statusConfig[status];

  // Action icons for history
  const actionIcons: Record<HistoryEntry['action'], string> = {
    create: '+',
    update: '~',
    journal: '#',
    search: '?',
    read: '>',
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
            backgroundColor: currentStatus.bg,
            color: currentStatus.color,
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          <span>{currentStatus.icon}</span>
          <span>{currentStatus.text}</span>
        </div>
      </div>

      {/* Reconnect button */}
      {status !== 'connected' && (
        <button
          onClick={handleReconnect}
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '12px',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            backgroundColor: '#f9fafb',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Reconnect
        </button>
      )}

      {/* Stats Section */}
      <div
        style={{
          marginBottom: '12px',
          padding: '10px',
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          backgroundColor: '#f9fafb',
        }}
      >
        <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '8px', color: '#6b7280' }}>
          SESSION STATS
        </div>
        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px' }}>
          Server: {snapshot.wsUrl}
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
            {history.map((entry, index) => (
              <div
                key={index}
                style={{
                  padding: '6px 10px',
                  borderBottom: index < history.length - 1 ? '1px solid #e5e7eb' : 'none',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span
                  style={{
                    color:
                      entry.action === 'create'
                        ? '#22c55e'
                        : entry.action === 'update'
                          ? '#3b82f6'
                          : entry.action === 'journal'
                            ? '#8b5cf6'
                            : entry.action === 'search'
                              ? '#f59e0b'
                              : '#6b7280',
                    fontWeight: 600,
                    minWidth: '24px',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    overflow: 'hidden',
                  }}
                >
                  {actionIcons[entry.action]}
                  {entry.remIds && entry.remIds.length > 1 && <span>{entry.remIds.length}</span>}
                </span>
                <span style={{ color: '#9ca3af', flexShrink: 0 }}>
                  {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: '#374151',
                  }}
                >
                  {entry.titles[0]}
                </span>
              </div>
            ))}
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
