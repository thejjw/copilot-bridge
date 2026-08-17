// Catalog of verified MCP server presets grouped by coding-plan provider.
// Supports both HTTP SSE servers (Z.ai Web Search, Web Reader, zread)
// and stdio servers (Z.ai MCP Server, MiniMax MCP).

import type { ProviderId } from './providers';

export interface McpInputDefinition {
  type: 'promptString';
  id: string;
  description: string;
  password: true;
}

export interface McpServerDefinition {
  type: 'http' | 'stdio' | 'sse';
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpPreset {
  id: string;
  name: string;
  description: string;
  providerId: ProviderId;
  serverKey: string;
  inputs: McpInputDefinition[];
  server: McpServerDefinition;
}

export const MCP_INPUT_ZAI: McpInputDefinition = {
  type: 'promptString',
  id: 'zai-api-key',
  description: 'Z.ai API Key for MCP tools',
  password: true,
};

export const MCP_INPUT_MINIMAX: McpInputDefinition = {
  type: 'promptString',
  id: 'minimax-api-key',
  description: 'MiniMax API Key for MCP tools',
  password: true,
};

/** All verified MCP server presets, explicitly associated with their provider. */
export const MCP_PRESETS: McpPreset[] = [
  // --- Z.ai Group ---
  {
    id: 'web-search-prime',
    name: 'Z.ai Web Search Prime',
    description: 'Real-time web search capability via Z.ai HTTP MCP.',
    providerId: 'zai',
    serverKey: 'webSearchPrime',
    inputs: [MCP_INPUT_ZAI],
    server: {
      type: 'http',
      url: 'https://api.z.ai/api/mcp/web_search_prime/mcp',
      headers: {
        Authorization: 'Bearer ${input:zai-api-key}',
      },
    },
  },
  {
    id: 'web-reader',
    name: 'Z.ai Web Reader',
    description: 'Convert web URLs into markdown/text via Z.ai HTTP MCP.',
    providerId: 'zai',
    serverKey: 'webReader',
    inputs: [MCP_INPUT_ZAI],
    server: {
      type: 'http',
      url: 'https://api.z.ai/api/mcp/web_reader/mcp',
      headers: {
        Authorization: 'Bearer ${input:zai-api-key}',
      },
    },
  },
  {
    id: 'zread',
    name: 'Z.ai zread (GitHub Doc/Repo Search)',
    description: 'Search documentation, issues, and code repositories via Z.ai HTTP MCP.',
    providerId: 'zai',
    serverKey: 'zread',
    inputs: [MCP_INPUT_ZAI],
    server: {
      type: 'http',
      url: 'https://api.z.ai/api/mcp/zread/mcp',
      headers: {
        Authorization: 'Bearer ${input:zai-api-key}',
      },
    },
  },
  {
    id: 'zai-mcp-server',
    name: 'Z.ai MCP Server (Vision & Image OCR)',
    description: 'Image analysis, diagram understanding, and text extraction via stdio npm package @z_ai/mcp-server.',
    providerId: 'zai',
    serverKey: 'zaiMcpServer',
    inputs: [MCP_INPUT_ZAI],
    server: {
      type: 'stdio',
      command: process.platform === 'win32' ? 'cmd.exe' : 'npx',
      args: process.platform === 'win32'
        ? ['/c', 'npx', '-y', '@z_ai/mcp-server']
        : ['-y', '@z_ai/mcp-server'],
      env: {
        Z_AI_API_KEY: '${input:zai-api-key}',
        Z_AI_MODE: 'ZAI',
      },
    },
  },

  // --- MiniMax Group ---
  {
    id: 'minimax-mcp',
    name: 'MiniMax Coding Plan MCP',
    description: 'MiniMax web search and image understanding via stdio uvx minimax-coding-plan-mcp.',
    providerId: 'minimax',
    serverKey: 'minimaxMcp',
    inputs: [MCP_INPUT_MINIMAX],
    server: {
      type: 'stdio',
      command: 'uvx',
      args: ['--with', 'mcp<2.0.0', 'minimax-coding-plan-mcp', '-y'],
      env: {
        MINIMAX_API_KEY: '${input:minimax-api-key}',
        MINIMAX_API_HOST: 'https://api.minimax.io',
      },
    },
  },
];

/** Get all companion MCP presets available for a given provider. */
export function getMcpPresetsForProvider(providerId: ProviderId): McpPreset[] {
  return MCP_PRESETS.filter((p) => p.providerId === providerId);
}

export interface McpConfigFile {
  inputs?: McpInputDefinition[];
  servers: Record<string, McpServerDefinition>;
  sandbox?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Merge presets into an existing or empty mcp.json file, strictly preserving all unrelated top-level properties. */
export function mergeMcpConfig(
  existing: McpConfigFile | null | undefined,
  presets: McpPreset[]
): McpConfigFile {
  const currentInputs: McpInputDefinition[] = existing?.inputs ? [...existing.inputs] : [];
  const currentServers: Record<string, McpServerDefinition> = existing?.servers ? { ...existing.servers } : {};

  for (const p of presets) {
    // Merge inputs without duplicate IDs
    for (const input of p.inputs) {
      const exists = currentInputs.some((item) => item.id === input.id);
      if (!exists) {
        currentInputs.push(input);
      }
    }
    // Merge server definition
    currentServers[p.serverKey] = p.server;
  }

  // Preserve all existing top-level properties (e.g. sandbox, custom fields)
  const result: McpConfigFile = {
    ...(existing ?? {}),
    servers: currentServers,
  };
  if (currentInputs.length > 0) {
    result.inputs = currentInputs;
  }
  return result;
}
