// Status bar manager for Copilot Bridge.
// Displays a minimal single-provider badge (dynamic pie glyph + percent, or balance number)
// for the user's explicitly pinned provider, or automatically selects the most relevant active provider.

import * as vscode from 'vscode';
import type { ProviderId } from '../providers';
import {
  fetchDeepseekUsage,
  fetchKimiUsage,
  fetchMinimaxUsage,
  fetchOpenrouterUsage,
  fetchZaiUsage,
} from './fetchers';
import { getDatatypeIcon, getPieGlyph, type UsageReport, type UsageStatus } from './types';
import { readConfig } from '../config';
import { Logger } from '../utils/logger';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Render a crisp SVG progress bar as a data URI for Markdown tooltips. */
export function renderSvgProgressBar(
  percent: number,
  status: UsageStatus,
  width = 100,
  height = 8
): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const fillWidth = Math.round((clamped / 100) * width);
  const color =
    status === 'critical' || clamped <= 15
      ? '#f43f5e' // Rose red
      : status === 'low' || clamped <= 35
      ? '#f59e0b' // Amber
      : '#10b981'; // Emerald green
  const bg = '#3f3f46'; // Zinc-700 track

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="${height / 2}" fill="${bg}"/><rect width="${fillWidth}" height="${height}" rx="${height / 2}" fill="${color}"/></svg>`;
  const base64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

export class UsageStatusBarManager {
  private readonly _statusBarItem: vscode.StatusBarItem;
  private readonly _reports = new Map<ProviderId, UsageReport>();
  private _pollTimer?: NodeJS.Timeout;
  private _pinnedProviderId?: ProviderId;

  constructor(private readonly context: vscode.ExtensionContext) {
    this._statusBarItem = vscode.window.createStatusBarItem(
      'copilot-bridge.usage',
      vscode.StatusBarAlignment.Right,
      99
    );
    this._statusBarItem.name = 'Copilot Bridge: Plan Usage';
    this._statusBarItem.command = 'copilot-bridge.selectStatusBarProvider';

    // Restore previously pinned provider from globalState, if any
    const savedPin = this.context.globalState.get<ProviderId>('copilotBridge.pinnedProvider');
    if (savedPin) {
      this._pinnedProviderId = savedPin;
    }
  }

  /** Initialize status bar, load keys, and start background polling. */
  async start(): Promise<void> {
    this._statusBarItem.show();
    this.render();

    // Initial background query
    await this.refresh();

    // Periodic polling
    this._pollTimer = setInterval(() => {
      void this.refresh();
    }, POLL_INTERVAL_MS);

    this.context.subscriptions.push({
      dispose: () => {
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._statusBarItem.dispose();
      },
    });
  }

  /** Explicitly pin which provider badge appears on the status bar (pass undefined to unpin and restore auto-select). */
  async setPinnedProvider(providerId?: ProviderId): Promise<void> {
    this._pinnedProviderId = providerId;
    await this.context.globalState.update('copilotBridge.pinnedProvider', providerId);
    this.render();
  }

  /** Interactive QuickPick to let user switch the pinned provider, unpin to restore auto-select, or manage keys. */
  async selectProviderInteractive(): Promise<void> {
    const items: Array<vscode.QuickPickItem & { providerId?: ProviderId; action?: string }> = [];

    const activeId = this.getActiveProviderId();
    const isAutoMode = this._pinnedProviderId === undefined;

    // Option 1: Auto-select / Unpin option
    items.push({
      label: '$(sparkle) Auto-Select Provider (Default)',
      description: isAutoMode ? '(Currently Active)' : 'Unpin specific provider and automatically track active quota',
      detail: 'Automatically selects the primary configured provider with active usage quota.',
      action: 'unpin',
    });

    if (this._reports.size > 0) {
      items.push({ label: 'Configured Providers', kind: vscode.QuickPickItemKind.Separator });
    }

    for (const report of this._reports.values()) {
      const isPinned = this._pinnedProviderId === report.providerId;
      const isCurrentlyShown = report.providerId === activeId;
      const metric =
        report.percentageRemaining !== undefined
          ? `${getPieGlyph(report.percentageRemaining)} ${report.percentageRemaining}% remaining`
          : report.balanceDisplay
          ? `Balance: ${report.balanceDisplay}`
          : 'Active';

      const reset = report.resetCountdown ? ` · Reset ${report.resetCountdown}` : '';
      const statusIcon =
        report.status === 'ok' ? '🟢' : report.status === 'low' ? '🟡' : report.status === 'critical' ? '🔴' : '⚠️';

      const tag = isPinned
        ? '📌 (Pinned in Status Bar)'
        : isCurrentlyShown && isAutoMode
        ? '✨ (Showing via Auto-Select)'
        : undefined;

      items.push({
        label: `${statusIcon} ${report.providerName}`,
        description: tag,
        detail: `${metric}${reset}`,
        providerId: report.providerId,
      });
    }

    items.push({ label: 'Actions', kind: vscode.QuickPickItemKind.Separator });

    items.push({
      label: '$(refresh) Refresh All Quotas Now',
      description: 'Query live API usage endpoints immediately',
      action: 'refresh',
    });

    items.push({
      label: '$(key) Configure Usage API Keys',
      description: 'Add or update API keys used for live quota polling',
      action: 'configureKeys',
    });

    items.push({
      label: '$(pulse) Run Connectivity Diagnostics',
      description: 'Test all endpoints, headers, and secret keys',
      action: 'diagnostics',
    });

    const choice = await vscode.window.showQuickPick(items, {
      title: 'Copilot Bridge: Status Bar Badge Provider',
      placeHolder: 'Select a provider to pin, choose Auto-Select to unpin, or manage keys',
    });

    if (!choice) return;

    if (choice.action === 'unpin') {
      await this.setPinnedProvider(undefined);
      void vscode.window.showInformationMessage('Restored status bar to Auto-Select provider mode.');
      return;
    }

    if (choice.action === 'refresh') {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Refreshing Copilot Bridge plan quotas & balances...',
          cancellable: false,
        },
        () => this.refresh()
      );
      void vscode.window.showInformationMessage('Copilot Bridge: Plan quotas refreshed.');
      return;
    }

    if (choice.action === 'configureKeys') {
      await vscode.commands.executeCommand('copilot-bridge.configureUsageKey');
      return;
    }

    if (choice.action === 'diagnostics') {
      await vscode.commands.executeCommand('copilot-bridge.runDiagnostics');
      return;
    }

    if (choice.providerId) {
      await this.setPinnedProvider(choice.providerId);
      void vscode.window.showInformationMessage(`Pinned ${choice.label} to status bar.`);
    }
  }

  /** Get active provider ID (explicitly pinned, or auto-selected from available reports). */
  getActiveProviderId(): ProviderId {
    if (this._pinnedProviderId) {
      return this._pinnedProviderId;
    }
    // Auto-select: prioritize providers with percentage quotas (e.g. zai, kimi), then balances, or first available
    for (const [id, r] of this._reports) {
      if (r.percentageRemaining !== undefined && r.status !== 'error') {
        return id;
      }
    }
    for (const [id, r] of this._reports) {
      if (r.balanceDisplay && r.status !== 'error') {
        return id;
      }
    }
    const firstReport = this._reports.keys().next().value;
    return firstReport ?? 'zai';
  }

  /** Query all configured provider usage endpoints in parallel. */
  async refresh(): Promise<void> {
    try {
      const config = await readConfig();

      const zaiGroup = config.find((g) => g.apiKey.includes('zai.apiKey') || g.name.includes('Z.ai'));
      const dsGroup = config.find((g) => g.apiKey.includes('deepseek.apiKey') || g.name.includes('DeepSeek'));
      const mmGroup = config.find((g) => g.apiKey.includes('minimax.apiKey') || g.name.includes('MiniMax'));
      const kimiGroup = config.find((g) => g.apiKey.includes('kimi.apiKey') || g.name.includes('Kimi'));
      const orGroup = config.find((g) => g.apiKey.includes('openrouter.apiKey') || g.name.includes('OpenRouter'));

      const zaiKey =
        (await this.context.secrets.get('copilot-bridge.zai.apiKey')) ??
        process.env.ZAI_API_KEY ??
        (zaiGroup && !zaiGroup.apiKey.startsWith('${input:') ? zaiGroup.apiKey : undefined);

      const dsKey =
        (await this.context.secrets.get('copilot-bridge.deepseek.apiKey')) ??
        process.env.DEEPSEEK_API_KEY ??
        (dsGroup && !dsGroup.apiKey.startsWith('${input:') ? dsGroup.apiKey : undefined);

      const mmKey =
        (await this.context.secrets.get('copilot-bridge.minimax.apiKey')) ??
        process.env.MINIMAX_API_KEY ??
        (mmGroup && !mmGroup.apiKey.startsWith('${input:') ? mmGroup.apiKey : undefined);

      const kimiKey =
        (await this.context.secrets.get('copilot-bridge.kimi.apiKey')) ??
        process.env.KIMI_API_KEY ??
        (kimiGroup && !kimiGroup.apiKey.startsWith('${input:') ? kimiGroup.apiKey : undefined);

      const orKey =
        (await this.context.secrets.get('copilot-bridge.openrouter.apiKey')) ??
        process.env.OPENROUTER_API_KEY ??
        (orGroup && !orGroup.apiKey.startsWith('${input:') ? orGroup.apiKey : undefined);

      const fetchers: Array<Promise<UsageReport | null>> = [];

      if (zaiKey || zaiGroup) {
        fetchers.push(
          zaiKey
            ? fetchZaiUsage(zaiKey)
            : Promise.resolve({
                providerId: 'zai',
                providerName: 'Z.ai GLM Coding Plan',
                details: ['API Key not yet configured for live balance query.'],
                status: 'error',
                lastUpdated: new Date(),
              })
        );
      }

      if (dsKey || dsGroup) {
        fetchers.push(
          dsKey
            ? fetchDeepseekUsage(dsKey)
            : Promise.resolve({
                providerId: 'deepseek',
                providerName: 'DeepSeek',
                details: ['API Key not yet configured for live balance query.'],
                status: 'error',
                lastUpdated: new Date(),
              })
        );
      }

      if (mmKey || mmGroup) {
        fetchers.push(
          mmKey
            ? fetchMinimaxUsage(mmKey)
            : Promise.resolve({
                providerId: 'minimax',
                providerName: 'MiniMax',
                details: ['API Key not yet configured for live balance query.'],
                status: 'error',
                lastUpdated: new Date(),
              })
        );
      }

      if (kimiKey || kimiGroup) {
        fetchers.push(
          kimiKey
            ? fetchKimiUsage(kimiKey)
            : Promise.resolve({
                providerId: 'kimi',
                providerName: 'Kimi Code Plan',
                details: ['API Key not yet configured for live balance query.'],
                status: 'error',
                lastUpdated: new Date(),
              })
        );
      }

      if (orKey || orGroup) {
        fetchers.push(
          orKey
            ? fetchOpenrouterUsage(orKey)
            : Promise.resolve({
                providerId: 'openrouter',
                providerName: 'OpenRouter',
                details: ['API Key not yet configured for live balance query.'],
                status: 'error',
                lastUpdated: new Date(),
              })
        );
      }

      const results = await Promise.allSettled(fetchers);

      for (const res of results) {
        if (res.status === 'fulfilled' && res.value) {
          this._reports.set(res.value.providerId, res.value);
        }
      }
    } catch (err) {
      Logger.error(`Error refreshing usage reports: ${(err as Error).message}`);
    }

    this.render();
  }

  /** Render the minimal status bar text and rich Markdown tooltip. */
  render(): void {
    if (this._reports.size === 0) {
      this._statusBarItem.text = 'Copilot-Bridge';
      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      md.supportHtml = true;
      md.appendMarkdown(`### ⚡ Copilot Bridge — Plan Quotas & Balances\n\n`);
      md.appendMarkdown(`*No usage API keys configured yet.*\n\n`);
      md.appendMarkdown(
        `[🔑 Configure Usage Keys](command:copilot-bridge.configureUsageKey) · [🚀 Quick Setup](command:copilot-bridge.quickSetup)`
      );
      this._statusBarItem.tooltip = md;
      this._statusBarItem.color = undefined;
      return;
    }

    const activeId = this.getActiveProviderId();
    const active = this._reports.get(activeId) ?? this._reports.values().next().value;
    if (!active) {
      this._statusBarItem.text = 'Copilot-Bridge';
      return;
    }

    // Status bar badge: bundled Datatype icon + percent (e.g. "$(copilot-bridge-p99) 99%") or balance string (e.g. "¥299.79")
    if (active.percentageRemaining !== undefined) {
      const icon = getDatatypeIcon(active.percentageRemaining);
      this._statusBarItem.text = `${icon} ${active.percentageRemaining}%`;
    } else if (active.balanceDisplay) {
      this._statusBarItem.text = active.balanceDisplay;
    } else {
      this._statusBarItem.text = 'Copilot-Bridge';
    }

    // Set warning/error colors for critical states
    if (active.status === 'critical') {
      this._statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
    } else if (active.status === 'low') {
      this._statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    } else {
      this._statusBarItem.color = undefined;
    }

    // Build Polished Markdown Tooltip covering ALL active providers
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    const isPinned = this._pinnedProviderId !== undefined;
    const modeLabel = isPinned ? 'Pinned Mode' : 'Auto-Select Mode';

    md.appendMarkdown(`### ⚡ Copilot Bridge — Quotas & Balances *(${modeLabel})*\n\n`);
    md.appendMarkdown(
      `[🔄 Refresh](command:copilot-bridge.refreshUsage) | [📌 ${isPinned ? 'Change / Unpin' : 'Pin Provider'}](command:copilot-bridge.selectStatusBarProvider) | [🔑 Keys](command:copilot-bridge.configureUsageKey) | [🩺 Diagnostics](command:copilot-bridge.runDiagnostics)\n\n`
    );

    md.appendMarkdown(`| Provider | Remaining / Balance | Meter | Reset | Status |\n`);
    md.appendMarkdown(`| :--- | :--- | :---: | :--- | :---: |\n`);

    for (const report of this._reports.values()) {
      const isReportPinned = this._pinnedProviderId === report.providerId;
      const isReportActive = report.providerId === activeId;
      const name = isReportPinned
        ? `**📌 ${report.providerName}**`
        : isReportActive && !isPinned
        ? `**✨ ${report.providerName}**`
        : `**${report.providerName}**`;

      const value =
        report.percentageRemaining !== undefined
          ? `**${report.percentageRemaining}%**`
          : `**${report.balanceDisplay ?? 'Active'}**`;

      const meter =
        report.percentageRemaining !== undefined
          ? `![${report.percentageRemaining}%](${renderSvgProgressBar(report.percentageRemaining, report.status, 90, 8)})`
          : '`Balance`';

      let reset = '—';
      if (report.resets && report.resets.length > 1) {
        reset = report.resets
          .map((r) => `${r.label.replace(' Window', '').replace(' Limit', '').replace(' Reset', '')}: ${r.countdown}`)
          .join(' · ');
      } else if (report.resetCountdown) {
        reset = `🔄 ${report.resetCountdown}`;
      }

      const statusIcon =
        report.status === 'ok'
          ? '🟢 Normal'
          : report.status === 'low'
          ? '🟡 Low'
          : report.status === 'critical'
          ? '🔴 Critical'
          : '⚪ Error';

      md.appendMarkdown(`| ${name} | ${value} | ${meter} | ${reset} | ${statusIcon} |\n`);
    }

    // Detailed per-provider breakdowns
    md.appendMarkdown(`\n---\n`);
    for (const report of this._reports.values()) {
      const isReportPinned = this._pinnedProviderId === report.providerId;
      const isReportActive = report.providerId === activeId;
      const header = isReportPinned
        ? `#### 📌 ${report.providerName} *(Pinned in Status Bar)*\n`
        : isReportActive && !isPinned
        ? `#### ✨ ${report.providerName} *(Active in Status Bar via Auto-Select)*\n`
        : `#### ${report.providerName}\n`;
      md.appendMarkdown(header);

      if (report.errorMessage) {
        md.appendMarkdown(`- ⚠️ Error: \`${report.errorMessage}\`\n`);
      }

      for (const detail of report.details) {
        md.appendMarkdown(`- ${detail}\n`);
      }
      if (report.resets && report.resets.length > 0) {
        for (const r of report.resets) {
          const label = r.label.endsWith('Reset') ? r.label : `${r.label} Reset`;
          md.appendMarkdown(`- ⏳ **${label}**: **${r.countdown}**\n`);
        }
      } else if (report.resetCountdown) {
        md.appendMarkdown(`- ⏳ **Next Reset**: **${report.resetCountdown}**\n`);
      }
      md.appendMarkdown(`\n`);
    }

    const lastTime = active.lastUpdated.toLocaleTimeString();
    md.appendMarkdown(`---\n*Auto-refreshes every 5m · Click status bar to switch or unpin badge · Updated ${lastTime}*`);

    this._statusBarItem.tooltip = md;
  }

  /** Get all cached reports. */
  getReports(): Map<ProviderId, UsageReport> {
    return new Map(this._reports);
  }
}
