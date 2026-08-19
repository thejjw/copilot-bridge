import * as vscode from 'vscode';
import {
  readMcpFile,
  userMcpConfigPath,
  workspaceMcpConfigPath,
  writeMcpFile,
} from './addMcp';

/** Command: Copilot Provider Bridge: Remove MCP Server */
export async function removeMcpCommand(): Promise<void> {
  const wsPath = workspaceMcpConfigPath();
  const targetOptions = [
    {
      label: '$(globe) User Profile (Global)',
      description: userMcpConfigPath(),
      path: userMcpConfigPath(),
    },
  ];

  if (wsPath) {
    targetOptions.push({
      label: '$(folder) Current Workspace Folder',
      description: wsPath,
      path: wsPath,
    });
  }

  const targetPick = await vscode.window.showQuickPick(targetOptions, {
    title: 'Copilot Provider Bridge - Remove MCP Server: Select Target',
    placeHolder: 'Select the mcp.json file to manage',
    ignoreFocusOut: true,
  });
  if (!targetPick) return;

  const config = await readMcpFile(targetPick.path);
  if (!config || Object.keys(config.servers).length === 0) {
    void vscode.window.showInformationMessage('No MCP servers found in the selected configuration file.');
    return;
  }

  const serverKeys = Object.keys(config.servers);
  const serverPicks = await vscode.window.showQuickPick(
    serverKeys.map((key) => {
      const s = config.servers[key];
      return {
        label: key,
        description: s.type === 'http' ? s.url : `${s.command} ${(s.args ?? []).join(' ')}`,
        serverKey: key,
      };
    }),
    {
      title: 'Copilot Provider Bridge - Choose MCP Server to Remove',
      placeHolder: 'Select the server to remove from configuration',
      ignoreFocusOut: true,
    }
  );
  if (!serverPicks) return;

  const keyToRemove = serverPicks.serverKey;
  delete config.servers[keyToRemove];

  await writeMcpFile(targetPick.path, config);
  void vscode.window.showInformationMessage(`Removed MCP server "${keyToRemove}" from mcp.json.`);
}
