import { css } from '@emotion/css';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Section from '../../components/Section';
import Switch from '../../components/Switch';
import { colors } from '../../styles';
import * as SystemIPC from '../../ipc/system';
import type {
  AgentMcpClientId,
  AgentMcpConnectResult,
} from '@shared-types/app';
import { settingsCenterColumnStyles } from './styles';

const infoBoxStyles = css`
  padding: 14px 16px;
  margin-bottom: 12px;
  border: 1px solid ${colors.border};
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  font-size: 0.9rem;
  line-height: 1.5;
  color: ${colors.text};
`;

const toggleRowStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 10px;
  border: 1px solid ${colors.border};
  border-radius: 8px;
  background: ${colors.grayLight};
`;

const toggleLabelStyles = css`
  font-weight: 600;
  color: ${colors.text};
`;

const directoryListStyles = css`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
`;

const directoryItemStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid ${colors.border};
  border-radius: 6px;
  background: ${colors.surface};
  font-size: 0.9rem;
`;

const directoryPathStyles = css`
  flex: 1;
  color: ${colors.text};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  font-size: 0.85rem;
`;

const removeButtonStyles = css`
  padding: 4px 10px;
  background: transparent;
  border: 1px solid ${colors.border};
  border-radius: 4px;
  color: ${colors.text};
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;

  &:hover {
    background: ${colors.grayLight};
    border-color: ${colors.gray};
  }
`;

const addButtonStyles = css`
  padding: 8px 14px;
  background: ${colors.primary};
  border: none;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
  transition: all 0.2s;
  margin-top: 8px;

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const labelStyles = css`
  display: block;
  margin-top: 16px;
  margin-bottom: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  color: ${colors.text};
`;

const launcherPathStyles = css`
  display: block;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid ${colors.border};
  border-radius: 6px;
  background: ${colors.surface};
  color: ${colors.text};
  font-family: monospace;
  font-size: 0.82rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
  user-select: text;
`;

const pitchStyles = css`
  margin: 0 0 8px;
  font-weight: 600;
  color: ${colors.text};
`;

const connectRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
`;

const secondaryButtonStyles = css`
  padding: 6px 12px;
  background: transparent;
  border: 1px solid ${colors.border};
  border-radius: 6px;
  color: ${colors.text};
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    background: ${colors.grayLight};
    border-color: ${colors.gray};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const connectMessageStyles = (tone: 'ok' | 'warn' | 'error') => css`
  margin: 10px 0 0;
  font-size: 0.88rem;
  color: ${tone === 'ok'
    ? '#22c55e'
    : tone === 'error'
      ? colors.danger
      : colors.text};
  overflow-wrap: anywhere;
`;

const permissionListStyles = css`
  padding-left: 20px;
  margin: 8px 0;

  li {
    margin-bottom: 6px;
    color: ${colors.text};
  }
`;

const statusIndicatorStyles = (active: boolean) => css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 600;
  background: ${active ? 'rgba(34, 197, 94, 0.1)' : 'rgba(107, 114, 128, 0.1)'};
  color: ${active ? '#22c55e' : colors.gray};
  border: 1px solid ${active ? '#22c55e' : colors.border};
`;

const statusDotStyles = (active: boolean) => css`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${active ? '#22c55e' : colors.gray};
`;

export default function AgentControlSection() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [allowedDirectories, setAllowedDirectories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [clientsConnected, setClientsConnected] = useState(0);
  const [launcherPath, setLauncherPath] = useState<string | null>(null);
  const authoritativeRevisionRef = useRef(0);
  const [pathCopied, setPathCopied] = useState(false);
  const [connecting, setConnecting] = useState<AgentMcpClientId | null>(null);
  const [connectOutcome, setConnectOutcome] = useState<{
    result: AgentMcpConnectResult;
    commandCopied: boolean;
  } | null>(null);

  const appNameFor = (client: AgentMcpClientId) =>
    client === 'claude-code'
      ? 'Claude Code'
      : client === 'codex'
        ? 'Codex'
        : 'Claude Desktop';

  const copyText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const handleCopyLauncherPath = async () => {
    if (!launcherPath) return;
    if (await copyText(launcherPath)) {
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 2000);
    }
  };

  const handleConnect = async (client: AgentMcpClientId) => {
    if (connecting) return;
    setConnecting(client);
    setConnectOutcome(null);
    try {
      const result = await SystemIPC.connectAgentMcpClient(client);
      const commandCopied =
        result.status === 'cli-not-found' && result.command
          ? await copyText(result.command)
          : false;
      setConnectOutcome({ result, commandCopied });
    } catch (error: any) {
      setConnectOutcome({
        result: {
          status: 'failed',
          client,
          message: String(error?.message || error),
        },
        commandCopied: false,
      });
    } finally {
      setConnecting(null);
    }
  };

  const renderConnectOutcome = () => {
    if (!connectOutcome) return null;
    const { result, commandCopied } = connectOutcome;
    const app = appNameFor(result.client);
    if (
      result.status === 'connected' ||
      result.status === 'already-connected'
    ) {
      const text =
        result.client === 'claude-desktop'
          ? result.status === 'connected'
            ? t(
                'settings.agentControl.connection.desktopConnected',
                'Added Translator to Claude Desktop. Quit and reopen Claude to load it.'
              )
            : t(
                'settings.agentControl.connection.alreadyConnected',
                '{{app}} already has the Translator server. Restart it if the tools do not appear.',
                { app }
              )
          : result.status === 'connected'
            ? t(
                'settings.agentControl.connection.connected',
                '{{app}} is connected. Start a new session to load the Translator tools.',
                { app }
              )
            : t(
                'settings.agentControl.connection.alreadyConnected',
                '{{app}} already has the Translator server. Restart it if the tools do not appear.',
                { app }
              );
      return <p className={connectMessageStyles('ok')}>{text}</p>;
    }
    if (result.status === 'cli-not-found') {
      return (
        <div className={connectMessageStyles('warn')}>
          <p style={{ margin: 0 }}>
            {commandCopied
              ? t(
                  'settings.agentControl.connection.cliNotFoundCopied',
                  'Could not find the {{app}} command on this computer. The setup command was copied; paste it into a terminal:',
                  { app }
                )
              : t(
                  'settings.agentControl.connection.cliNotFound',
                  'Could not find the {{app}} command on this computer. Run this in a terminal:',
                  { app }
                )}
          </p>
          <code className={launcherPathStyles} dir="ltr">
            {result.command}
          </code>
        </div>
      );
    }
    return (
      <div className={connectMessageStyles('error')}>
        <p style={{ margin: 0 }}>
          {t(
            'settings.agentControl.connection.failed',
            'Could not connect {{app}}: {{message}}',
            { app, message: result.message || '' }
          )}
        </p>
        {result.command && (
          <code className={launcherPathStyles} dir="ltr">
            {result.command}
          </code>
        )}
      </div>
    );
  };

  // Load authoritative settings and follow fail-closed or cross-tab changes.
  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      const loadRevision = authoritativeRevisionRef.current;
      try {
        const [enabledValue, dirs] = await Promise.all([
          SystemIPC.getAgentControlEnabled(),
          SystemIPC.getAgentAllowedDirectories(),
        ]);

        if (mounted) {
          if (authoritativeRevisionRef.current === loadRevision) {
            setEnabled(enabledValue);
          }
          setAllowedDirectories(dirs);
          setLoading(false);
        }
      } catch (error) {
        console.error('Failed to load agent control settings:', error);
        if (mounted) {
          setLoading(false);
        }
      }
    };

    const unsubscribe = SystemIPC.onAgentControlChanged(payload => {
      authoritativeRevisionRef.current += 1;
      if (mounted) setEnabled(payload.enabled === true);
    });

    void loadSettings();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // Poll connection status only while the packaged socket is meant to run.
  useEffect(() => {
    let mounted = true;
    let statusInterval: NodeJS.Timeout | null = null;

    const updateConnectionStatus = async () => {
      if (!enabled || !window.env.isPackaged) return;

      try {
        const status = await SystemIPC.getAgentSocketStatus();
        if (mounted && status) {
          setClientsConnected(status.connectedClients || 0);
          setLauncherPath(status.launcherPath || null);
        }
      } catch {
        // Silently fail - socket server may not be running
      }
    };

    if (enabled && window.env.isPackaged) {
      void updateConnectionStatus();
      statusInterval = setInterval(updateConnectionStatus, 2000);
    } else {
      setClientsConnected(0);
      setLauncherPath(null);
    }

    return () => {
      mounted = false;
      if (statusInterval) {
        clearInterval(statusInterval);
      }
    };
  }, [enabled]);

  const handleToggleEnabled = async (newValue: boolean) => {
    if (updating) return;
    setUpdating(true);
    const requestRevision = authoritativeRevisionRef.current;
    try {
      const result = await SystemIPC.setAgentControlEnabled(newValue);
      if (authoritativeRevisionRef.current === requestRevision) {
        setEnabled(result.enabled);
      }
      if (result.success) {
        return;
      } else {
        console.error('Failed to update agent control:', result.error);
        alert(
          t(
            'settings.agentControl.errors.update',
            'Failed to update agent control setting.'
          )
        );
      }
    } catch (error) {
      console.error('Failed to toggle agent control:', error);
      alert(
        t(
          'settings.agentControl.errors.update',
          'Failed to update agent control setting.'
        )
      );
      try {
        const enabledValue = await SystemIPC.getAgentControlEnabled();
        if (authoritativeRevisionRef.current === requestRevision) {
          setEnabled(enabledValue);
        }
      } catch {
        // A broadcast or the next settings load will reconcile the UI.
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleAddDirectory = async () => {
    try {
      const result = await SystemIPC.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: t(
          'settings.agentControl.selectDirectory',
          'Select directory to allow agent file writes'
        ),
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const dirPath = result.filePaths[0];
        const addResult = await SystemIPC.addAgentAllowedDirectory(dirPath);

        if (addResult.success) {
          const updatedDirs = await SystemIPC.getAgentAllowedDirectories();
          setAllowedDirectories(updatedDirs);
        } else {
          console.error('Failed to add directory:', addResult.error);
          alert(
            t(
              'settings.agentControl.errors.addDirectory',
              'Failed to add directory.'
            )
          );
        }
      }
    } catch (error) {
      console.error('Failed to add directory:', error);
      alert(
        t(
          'settings.agentControl.errors.addDirectory',
          'Failed to add directory.'
        )
      );
    }
  };

  const handleRemoveDirectory = async (dirPath: string) => {
    try {
      const result = await SystemIPC.removeAgentAllowedDirectory(dirPath);
      if (result.success) {
        const updatedDirs = await SystemIPC.getAgentAllowedDirectories();
        setAllowedDirectories(updatedDirs);
      } else {
        console.error('Failed to remove directory:', result.error);
        alert(
          t(
            'settings.agentControl.errors.removeDirectory',
            'Failed to remove directory.'
          )
        );
      }
    } catch (error) {
      console.error('Failed to remove directory:', error);
      alert(
        t(
          'settings.agentControl.errors.removeDirectory',
          'Failed to remove directory.'
        )
      );
    }
  };

  if (loading) {
    return null;
  }

  // Only show in packaged mode or dev mode with TRANSLATOR_AGENT_DEV=1
  if (!window.env.isPackaged && !window.env.agentMode) {
    return null;
  }

  return (
    <Section
      destination="settings-agent-control"
      title={t('settings.agentControl.title', 'Agent Control')}
      className={settingsCenterColumnStyles}
      headerRight={
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className={statusIndicatorStyles(enabled)}>
            <span className={statusDotStyles(enabled)} />
            {enabled
              ? t('settings.agentControl.status.enabled', 'Enabled')
              : t('settings.agentControl.status.disabled', 'Disabled')}
          </div>
          {enabled && clientsConnected > 0 && (
            <div className={statusIndicatorStyles(true)}>
              <span className={statusDotStyles(true)} />
              {t(
                'settings.agentControl.status.connected',
                '{{count}} client(s) connected',
                { count: clientsConnected }
              )}
            </div>
          )}
        </div>
      }
    >
      <div className={infoBoxStyles}>
        <p className={pitchStyles}>
          {t(
            'settings.agentControl.pitch',
            'Translate for free with the Claude or Codex subscription you already have.'
          )}
        </p>
        <p style={{ margin: 0 }}>
          {t(
            'settings.agentControl.description',
            'Let Claude Code, Claude Desktop, Codex, or another MCP agent control Translator on this computer. When enabled, agents can download videos, manage your library, edit and translate subtitles, and export files to allowed directories.'
          )}
        </p>
      </div>

      <div className={toggleRowStyles}>
        <div className={toggleLabelStyles}>
          {t(
            'settings.agentControl.enableLabel',
            'Allow agent control of this app'
          )}
        </div>
        <Switch
          checked={enabled}
          onChange={handleToggleEnabled}
          disabled={updating}
          ariaLabel={t(
            'settings.agentControl.enableAria',
            'Enable agent control'
          )}
        />
      </div>

      {enabled && (
        <>
          {window.env.isPackaged && launcherPath && (
            <div className={infoBoxStyles}>
              <strong>
                {t(
                  'settings.agentControl.connection.title',
                  'Connect Claude Code, Claude Desktop, or Codex'
                )}
              </strong>
              <p style={{ margin: '6px 0 0', color: colors.gray }}>
                {t(
                  'settings.agentControl.connection.instructions',
                  'Click a button to register the “translator” MCP server. For other agents, add an STDIO MCP server named “translator” with this launcher path, then restart the agent so the new tools appear.'
                )}
              </p>
              <div className={connectRowStyles}>
                {(['claude-code', 'codex', 'claude-desktop'] as const).map(
                  client => (
                    <button
                      key={client}
                      type="button"
                      className={addButtonStyles}
                      style={{ marginTop: 0 }}
                      disabled={connecting !== null}
                      onClick={() => void handleConnect(client)}
                    >
                      {connecting === client
                        ? t(
                            'settings.agentControl.connection.connecting',
                            'Connecting…'
                          )
                        : client === 'claude-code'
                          ? t(
                              'settings.agentControl.connection.connectClaudeCode',
                              'Connect Claude Code'
                            )
                          : client === 'codex'
                            ? t(
                                'settings.agentControl.connection.connectCodex',
                                'Connect Codex'
                              )
                            : t(
                                'settings.agentControl.connection.connectClaudeDesktop',
                                'Connect Claude Desktop'
                              )}
                    </button>
                  )
                )}
              </div>
              {renderConnectOutcome()}
              <code className={launcherPathStyles} dir="ltr">
                {launcherPath}
              </code>
              <button
                type="button"
                className={secondaryButtonStyles}
                style={{ marginTop: 8 }}
                onClick={() => void handleCopyLauncherPath()}
              >
                {pathCopied
                  ? t('settings.agentControl.connection.copied', 'Copied')
                  : t('settings.agentControl.connection.copyPath', 'Copy path')}
              </button>
            </div>
          )}

          <div className={labelStyles}>
            {t('settings.agentControl.permissions', 'What agents can do:')}
          </div>
          <ul className={permissionListStyles}>
            <li>
              {t(
                'settings.agentControl.permission.download',
                'Download and manage videos'
              )}
            </li>
            <li>
              {t(
                'settings.agentControl.permission.subtitles',
                'Create, edit, and translate subtitles'
              )}
            </li>
            <li>
              {t(
                'settings.agentControl.permission.export',
                'Export files to allowed directories'
              )}
            </li>
            <li>
              {t(
                'settings.agentControl.permission.settings',
                'Read and modify app settings'
              )}
            </li>
          </ul>

          <div className={labelStyles}>
            {t('settings.agentControl.restrictions', 'What agents cannot do:')}
          </div>
          <ul className={permissionListStyles}>
            <li>
              {t(
                'settings.agentControl.restriction.payment',
                'Make purchases or access payment information'
              )}
            </li>
            <li>
              {t(
                'settings.agentControl.restriction.secrets',
                'Read stored API keys or authentication tokens'
              )}
            </li>
            <li>
              {t(
                'settings.agentControl.restriction.admin',
                'Perform admin operations or factory resets'
              )}
            </li>
          </ul>

          <div className={labelStyles}>
            {t(
              'settings.agentControl.allowedDirectories.title',
              'Allowed directories for file writes:'
            )}
          </div>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: '0.9rem',
              color: colors.gray,
            }}
          >
            {t(
              'settings.agentControl.allowedDirectories.description',
              'Agents can only write files (exports, merged videos) to these directories. Configure at least one directory to enable file exports.'
            )}
          </p>

          <div className={directoryListStyles}>
            {allowedDirectories.length === 0 ? (
              <div
                style={{
                  padding: '12px',
                  textAlign: 'center',
                  color: colors.gray,
                  fontSize: '0.9rem',
                }}
              >
                {t(
                  'settings.agentControl.allowedDirectories.empty',
                  'No allowed directories configured. Add at least one to enable file exports.'
                )}
              </div>
            ) : (
              allowedDirectories.map(dir => (
                <div key={dir} className={directoryItemStyles}>
                  <span className={directoryPathStyles} title={dir}>
                    {dir}
                  </span>
                  <button
                    className={removeButtonStyles}
                    onClick={() => void handleRemoveDirectory(dir)}
                  >
                    {t('settings.agentControl.removeDirectory', 'Remove')}
                  </button>
                </div>
              ))
            )}
          </div>

          <button
            className={addButtonStyles}
            onClick={handleAddDirectory}
            disabled={!enabled}
          >
            {t('settings.agentControl.addDirectory', '+ Add Directory')}
          </button>
        </>
      )}
    </Section>
  );
}
