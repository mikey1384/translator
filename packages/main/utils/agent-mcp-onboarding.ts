import path from 'node:path';

export type AgentMcpOnboarding = {
  serverName: 'translator';
  transport: 'stdio';
  launcherPath: string | null;
  restartRequired: true;
};

export function getAgentMcpOnboarding({
  isPackaged,
  resourcesPath,
  platform,
}: {
  isPackaged: boolean;
  resourcesPath: string;
  platform: NodeJS.Platform;
}): AgentMcpOnboarding {
  return {
    serverName: 'translator',
    transport: 'stdio',
    launcherPath: isPackaged
      ? (platform === 'win32' ? path.win32 : path).join(
          resourcesPath,
          platform === 'win32' ? 'translator-mcp.cmd' : 'translator-mcp'
        )
      : null,
    restartRequired: true,
  };
}
