// Debug logging and diagnostics manager for Copilot Provider Bridge.
// Outputs to a dedicated VS Code Output Channel and optional local log file.
// All sensitive API keys are automatically masked in logs.

import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

export class Logger {
  private static _channel?: vscode.OutputChannel;
  private static _context?: vscode.ExtensionContext;
  private static _logFilePath?: string;

  static initialize(context: vscode.ExtensionContext): void {
    this._context = context;
    this._channel = vscode.window.createOutputChannel('Copilot Provider Bridge');
    this._logFilePath = path.join(homedir(), 'copilot-provider-bridge-debug.log');
    context.subscriptions.push(this._channel);
  }

  /** Check if debug logging is enabled in settings. */
  static isDebugEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('copilotProviderBridge');
    return config.get<boolean>('debugLogging', false);
  }

  /** Toggle debug logging on or off. */
  static async toggleDebugLogging(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('copilotProviderBridge');
    const current = config.get<boolean>('debugLogging', false);
    const updated = !current;
    await config.update('debugLogging', updated, vscode.ConfigurationTarget.Global);
    this.info(`Debug logging ${updated ? 'ENABLED' : 'DISABLED'}`);
    return updated;
  }

  /** Show and focus the Copilot Provider Bridge Output Channel. */
  static showChannel(): void {
    this._channel?.show(true);
  }

  /** Mask sensitive API key strings (shows first 4 and last 3 chars). */
  static maskSecret(str: string): string {
    if (!str || str.length <= 8) return '••••';
    return `${str.substring(0, 4)}...${str.substring(str.length - 3)}`;
  }

  /** Format log entry with timestamp and level. */
  private static formatEntry(level: string, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    let line = `[${timestamp}] [${level}] ${message}`;
    if (data !== undefined) {
      const serialized = typeof data === 'string' ? data : JSON.stringify(data, (key, value) => {
        if (typeof value === 'string' && (key.toLowerCase().includes('key') || key.toLowerCase().includes('token') || key.toLowerCase().includes('authorization'))) {
          return this.maskSecret(value);
        }
        return value;
      });
      line += ` ${serialized}`;
    }
    return line;
  }

  static debug(message: string, data?: unknown): void {
    if (!this.isDebugEnabled()) return;
    const entry = this.formatEntry('DEBUG', message, data);
    this._channel?.appendLine(entry);
    this.appendToFile(entry);
  }

  static info(message: string, data?: unknown): void {
    const entry = this.formatEntry('INFO', message, data);
    this._channel?.appendLine(entry);
    if (this.isDebugEnabled()) {
      this.appendToFile(entry);
    }
  }

  static warn(message: string, data?: unknown): void {
    const entry = this.formatEntry('WARN', message, data);
    this._channel?.appendLine(entry);
    this.appendToFile(entry);
  }

  static error(message: string, error?: unknown, data?: unknown): void {
    const errText = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error ?? '');
    const entry = this.formatEntry('ERROR', `${message} ${errText}`, data);
    this._channel?.appendLine(entry);
    this.appendToFile(entry);
  }

  private static appendToFile(entry: string): void {
    if (!this._logFilePath) return;
    void fs.appendFile(this._logFilePath, entry + '\n', 'utf8').catch(() => {});
  }
}
