// Extension entry. Registers commands, manages status bar usage display, tools, diagnostics, and provides first-time setup prompt.

import * as vscode from 'vscode';
import { addModelCommand } from './commands/addProvider';
import { removeModelCommand } from './commands/removeProvider';
import { listModelsCommand } from './commands/listProviders';
import { configureMcpCommand } from './commands/addMcp';
import { removeMcpCommand } from './commands/removeMcp';
import { quickSetupCommand } from './commands/setup';
import { configureUsageKeyCommand } from './commands/configureUsageKey';
import { selectVisionModelCommand } from './commands/selectVisionModel';
import { runDiagnosticsCommand } from './commands/diagnostics';
import { UsageStatusBarManager } from './usage/statusBar';
import { resetConfigurationCommand } from './commands/resetConfiguration';
import { CopilotBridgeVisionTool, VISION_BACKENDS } from './tools/visionTool';
import { Logger } from './utils/logger';

export { PROVIDERS, type Provider, type ProviderId, type ProviderModel } from './providers';
export {
  modelToConfig,
  providerToConfig,
  readConfig,
  writeConfig,
  findGroupIndex,
  hasAnyBridgeGroup,
  userConfigPath,
  type ConfigModel,
  type ConfigGroup,
  type ConfigFile,
} from './config';
export {
  MCP_PRESETS,
  mergeMcpConfig,
  getMcpPresetsForProvider,
  type McpPreset,
  type McpConfigFile,
  type McpInputDefinition,
  type McpServerDefinition,
} from './mcpCatalog';
export { quickSetupCommand, validateProviderKey } from './commands/setup';
export { configureUsageKeyCommand } from './commands/configureUsageKey';
export { selectVisionModelCommand } from './commands/selectVisionModel';
export { runDiagnosticsCommand } from './commands/diagnostics';
export { UsageStatusBarManager } from './usage/statusBar';
export { resetConfigurationCommand, resetCopilotBridgeState } from './commands/resetConfiguration';
export { getPieGlyph, formatCountdown, type UsageReport } from './usage/types';
export { CopilotBridgeVisionTool, VISION_BACKENDS } from './tools/visionTool';
export { Logger } from './utils/logger';

export function activate(context: vscode.ExtensionContext): void {
  // Initialize Logger
  Logger.initialize(context);
  Logger.debug('Activating Copilot Bridge extension...');

  // Initialize status bar usage manager
  const statusBarManager = new UsageStatusBarManager(context);
  void statusBarManager.start();

  // Register built-in Vision Agent LanguageModelTool
  if (typeof vscode.lm?.registerTool === 'function') {
    const visionTool = new CopilotBridgeVisionTool(context);
    context.subscriptions.push(vscode.lm.registerTool(CopilotBridgeVisionTool.toolId, visionTool));
    Logger.debug(`Registered LanguageModelTool: ${CopilotBridgeVisionTool.toolId}`);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-bridge.quickSetup', () => quickSetupCommand(context)),
    vscode.commands.registerCommand('copilot-bridge.addModel', () => addModelCommand(context)),
    vscode.commands.registerCommand('copilot-bridge.removeModel', removeModelCommand),
    vscode.commands.registerCommand('copilot-bridge.listModels', listModelsCommand),
    vscode.commands.registerCommand('copilot-bridge.configureMcp', configureMcpCommand),
    vscode.commands.registerCommand('copilot-bridge.removeMcp', removeMcpCommand),
    vscode.commands.registerCommand('copilot-bridge.configureUsageKey', (providerId) =>
      configureUsageKeyCommand(context, providerId)
    ),
    vscode.commands.registerCommand('copilot-bridge.selectStatusBarProvider', () =>
      statusBarManager.selectProviderInteractive()
    ),
    vscode.commands.registerCommand('copilot-bridge.refreshUsage', () => statusBarManager.refresh()),
    vscode.commands.registerCommand('copilot-bridge.selectVisionModel', () => selectVisionModelCommand(context)),
    vscode.commands.registerCommand('copilot-bridge.runDiagnostics', () => runDiagnosticsCommand(context)),
    vscode.commands.registerCommand('copilot-bridge.showDebugLogs', () => Logger.showChannel()),
    vscode.commands.registerCommand('copilot-bridge.toggleDebugLogging', async () => {
      const enabled = await Logger.toggleDebugLogging();
      void vscode.window.showInformationMessage(
        `Copilot Bridge: Debug logging ${enabled ? 'ENABLED' : 'DISABLED'}.`
      );
    }),
    vscode.commands.registerCommand('copilot-bridge.resetConfiguration', () =>
      resetConfigurationCommand(context)
    ),
  );

  // Check if first-time setup prompt has already been shown, dismissed, or completed
  const hasPrompted = context.globalState.get<boolean>('copilotBridge.hasPromptedSetup');
  const hasRun = context.globalState.get<boolean>('copilotBridge.hasRunSetup');

  if (!hasPrompted && !hasRun) {
    // Mark as prompted immediately so dismissing or choosing 'Later' does not prompt on every restart
    void context.globalState.update('copilotBridge.hasPromptedSetup', true);
    void vscode.window
      .showInformationMessage(
        'Welcome to Copilot Bridge! Would you like to run the Quick Setup to configure your coding plan models and companion MCP tools?',
        'Run Quick Setup',
        'Later'
      )
      .then((choice) => {
        if (choice === 'Run Quick Setup') {
          void quickSetupCommand(context);
        }
      });
  }

  Logger.info('Copilot Bridge extension activated successfully.');
}

export function deactivate(): void {
  // No-op. VS Code disposes subscriptions on deactivate.
}
