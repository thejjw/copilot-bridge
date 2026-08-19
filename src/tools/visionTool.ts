// Built-in LanguageModelTool that empowers text-only models (GLM-5.3, DeepSeek V4, etc.)
// to delegate visual analysis, screenshot inspection, and OCR to any configured multimodal backend.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ProviderId } from '../providers';

export interface VisionBackendOption {
  id: string;
  name: string;
  providerId: ProviderId;
  description: string;
  model: string;
  endpointUrl: string;
  apiType: 'openai' | 'anthropic';
}

export const VISION_BACKENDS: VisionBackendOption[] = [
  {
    id: 'glm-4.6v',
    name: 'GLM-4.6V (Z.ai Vision)',
    providerId: 'zai',
    description: 'Z.ai internal vision model for diagram understanding and OCR.',
    model: 'glm-4.6v',
    endpointUrl: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
    apiType: 'openai',
  },
  {
    id: 'glm-5v-turbo',
    name: 'GLM-5V-Turbo (Z.ai Multimodal)',
    providerId: 'zai',
    description: 'Z.ai frontier multimodal coding model.',
    model: 'glm-5v-turbo',
    endpointUrl: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
    apiType: 'openai',
  },
  /*
  // Google Gemini (Disabled for now)
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash (Google High-Speed Vision)',
    providerId: 'gemini',
    description: 'Google high-speed multimodal model with 1M context.',
    model: 'gemini-2.5-flash',
    endpointUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    apiType: 'openai',
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash (Google Multimodal)',
    providerId: 'gemini',
    description: 'Google latest flagship fast multimodal model.',
    model: 'gemini-3.7-flash',
    endpointUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    apiType: 'openai',
  },
  */
  {
    id: 'minimax-m3',
    name: 'MiniMax M3 (MiniMax Vision)',
    providerId: 'minimax',
    description: 'MiniMax M3 multimodal model with 1M context.',
    model: 'MiniMax-M3',
    endpointUrl: 'https://api.minimax.io/v1/chat/completions',
    apiType: 'openai',
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3 (Moonshot Vision)',
    providerId: 'kimi',
    description: 'Kimi K3 multimodal model with 1M context.',
    model: 'k3',
    endpointUrl: 'https://api.kimi.com/coding/v1/messages',
    apiType: 'anthropic',
  },
  {
    id: 'qwen3.8-max',
    name: 'Qwen 3.8 Max (Alibaba Vision)',
    providerId: 'qwen',
    description: 'Qwen 3.8 Max flagship multimodal model.',
    model: 'qwen3.8-max',
    endpointUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic/v1/messages',
    apiType: 'anthropic',
  },
  {
    id: 'meta/muse-glimmer-30b',
    name: 'Muse Glimmer 30B (NVIDIA NIM Vision)',
    providerId: 'nvidia',
    description: 'Meta Muse Glimmer 30B multimodal vision model on NVIDIA NIM.',
    model: 'meta/muse-glimmer-30b',
    endpointUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    apiType: 'openai',
  },
  {
    id: 'thinkingmachines/inkling',
    name: 'Inkling (NVIDIA NIM Vision & Reasoning)',
    providerId: 'nvidia',
    description: 'Thinking Machines Inkling multimodal model on NVIDIA NIM.',
    model: 'thinkingmachines/inkling',
    endpointUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    apiType: 'openai',
  },
];

export interface VisionToolInput {
  file_path?: string;
  image_url?: string;
  prompt?: string;
}

export class CopilotProviderBridgeVisionTool implements vscode.LanguageModelTool<VisionToolInput> {
  static readonly toolId = 'copilot_provider_bridge_analyze_visual';

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Resolve user's preferred vision backend or pick the first one with an active key. */
  async resolveBackend(): Promise<{ backend: VisionBackendOption; apiKey: string } | undefined> {
    const preferredId = this.context.globalState.get<string>('copilotProviderBridge.preferredVisionModel');

    // Helper to retrieve API key for a provider
    const getKey = async (provId: ProviderId): Promise<string | undefined> => {
      return (
        (await this.context.secrets.get(`copilot-provider-bridge.${provId}.apiKey`)) ??
        process.env[`${provId.toUpperCase()}_API_KEY`]
      );
    };

    // If preferred backend exists and has key, use it
    if (preferredId) {
      const match = VISION_BACKENDS.find((b) => b.id === preferredId);
      if (match) {
        const key = await getKey(match.providerId);
        if (key) return { backend: match, apiKey: key };
      }
    }

    // Otherwise, find first backend with an available key
    for (const b of VISION_BACKENDS) {
      const key = await getKey(b.providerId);
      if (key) return { backend: b, apiKey: key };
    }

    return undefined;
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<VisionToolInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { file_path, image_url, prompt } = options.input;
    const resolvedPrompt = prompt ?? 'Analyze this image in detail, describing visual structure, layout, UI elements, and all visible text/code.';

    const resolved = await this.resolveBackend();
    if (!resolved) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          'Error: No API key found for any vision backend (Z.ai, Gemini, MiniMax, Kimi, Qwen, or NVIDIA). ' +
            'Please run command "Copilot Provider Bridge: Configure Usage API Key" or "Copilot Provider Bridge: Select Vision Agent Model" to set an API key.'
        ),
      ]);
    }

    const { backend, apiKey } = resolved;

    // Resolve image into a valid base64 data URL (data:image/...;base64,...)
    let dataUrl: string | undefined;

    if (image_url) {
      if (image_url.startsWith('data:')) {
        dataUrl = image_url;
      } else if (image_url.startsWith('http://') || image_url.startsWith('https://')) {
        try {
          const imgRes = await fetch(image_url);
          if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const cType = imgRes.headers.get('content-type') ?? 'image/png';
          dataUrl = `data:${cType};base64,${buf.toString('base64')}`;
        } catch (err) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error fetching image from URL "${image_url}": ${(err as Error).message}`),
          ]);
        }
      } else {
        dataUrl = image_url;
      }
    } else if (file_path) {
      try {
        let absPath = file_path;
        if (!path.isAbsolute(absPath)) {
          const wsFolders = vscode.workspace.workspaceFolders;
          if (wsFolders && wsFolders.length > 0) {
            absPath = path.join(wsFolders[0].uri.fsPath, file_path);
          }
        }
        const fileBytes = await fs.readFile(absPath);
        const ext = path.extname(absPath).toLowerCase().replace('.', '');
        const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
        dataUrl = `data:${mime};base64,${fileBytes.toString('base64')}`;
      } catch (err) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Error reading image file at "${file_path}": ${(err as Error).message}`),
        ]);
      }
    }

    if (!dataUrl) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart('Error: Please provide either a "file_path" or "image_url" parameter.'),
      ]);
    }

    // Dispatch request to the vision model backend
    try {
      let analysisText: string;

      if (backend.apiType === 'openai') {
        const response = await fetch(backend.endpointUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: backend.model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: resolvedPrompt },
                  { type: 'image_url', image_url: { url: dataUrl } },
                ],
              },
            ],
            max_tokens: 4096,
          }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Vision backend ${backend.name} returned HTTP ${response.status}: ${errBody}`);
        }

        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        analysisText = json.choices?.[0]?.message?.content ?? 'No visual analysis generated.';
      } else {
        // Anthropic format requires source: { type: "base64", media_type: "image/...", data: "<pure_base64_string>" }
        let mediaType = 'image/png';
        let b64Payload = dataUrl;

        if (dataUrl.startsWith('data:')) {
          const commaIdx = dataUrl.indexOf(',');
          if (commaIdx !== -1) {
            const header = dataUrl.substring(0, commaIdx);
            const match = header.match(/data:(.*?);base64/);
            if (match) mediaType = match[1];
            b64Payload = dataUrl.substring(commaIdx + 1);
          }
        }

        const response = await fetch(backend.endpointUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: backend.model,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: mediaType,
                      data: b64Payload,
                    },
                  },
                  { type: 'text', text: resolvedPrompt },
                ],
              },
            ],
            max_tokens: 4096,
          }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Vision backend ${backend.name} returned HTTP ${response.status}: ${errBody}`);
        }

        const json = (await response.json()) as {
          content?: Array<{ type?: string; text?: string }>;
        };
        analysisText =
          json.content?.find((c) => c.type === 'text')?.text ??
          json.content?.[0]?.text ??
          'No visual analysis generated.';
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`[Visual Analysis from ${backend.name}]:\n\n${analysisText}`),
      ]);
    } catch (err) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Vision analysis error: ${(err as Error).message}`),
      ]);
    }
  }

  prepareInvocation?(
    options: vscode.LanguageModelToolInvocationPrepareOptions<VisionToolInput>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    const target = options.input.file_path ?? options.input.image_url ?? 'image';
    return {
      invocationMessage: `Analyzing visual asset (${target}) with Vision Agent...`,
    };
  }
}
