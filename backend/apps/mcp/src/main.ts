#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: 'request_audit',
    description: 'Request a crypto tax audit for a wallet address',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Solana wallet address to audit',
        },
        jurisdiction: {
          type: 'string',
          enum: ['US', 'EU', 'BR'],
          description: 'Tax jurisdiction (US, EU, or BR)',
        },
        taxYear: {
          type: 'number',
          description: 'Tax year to audit (e.g., 2024)',
        },
        options: {
          type: 'object',
          properties: {
            costBasisMethod: {
              type: 'string',
              enum: ['FIFO', 'LIFO', 'HIFO'],
              description: 'Cost basis calculation method',
            },
            includeStaking: { type: 'boolean' },
            includeAirdrops: { type: 'boolean' },
            includeNFTs: { type: 'boolean' },
          },
        },
      },
      required: ['walletAddress', 'jurisdiction', 'taxYear'],
    },
  },
  {
    name: 'check_compliance',
    description: 'Quick compliance check for a wallet in a specific jurisdiction',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Solana wallet address to check',
        },
        jurisdiction: {
          type: 'string',
          enum: ['US', 'EU', 'BR'],
          description: 'Tax jurisdiction to check compliance for',
        },
      },
      required: ['walletAddress', 'jurisdiction'],
    },
  },
  {
    name: 'get_report',
    description: 'Get an audit report in a specific format',
    inputSchema: {
      type: 'object',
      properties: {
        auditId: {
          type: 'string',
          description: 'ID of the completed audit',
        },
        format: {
          type: 'string',
          enum: ['PDF', 'CSV', 'XLSX', 'JSON'],
          description: 'Report format',
        },
        reportType: {
          type: 'string',
          description: 'Type of report (e.g., Form8949, ScheduleD, IN1888)',
        },
      },
      required: ['auditId', 'format'],
    },
  },
  {
    name: 'verify_attestation',
    description: 'Verify an on-chain compliance attestation',
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Wallet address to verify',
        },
        jurisdiction: {
          type: 'string',
          enum: ['US', 'EU', 'BR'],
          description: 'Jurisdiction of the attestation',
        },
      },
      required: ['walletAddress', 'jurisdiction'],
    },
  },
  {
    name: 'list_jurisdictions',
    description: 'List all supported jurisdictions and their features',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// API configuration
const API_BASE_URL = process.env.AUDITSWARM_API_URL || 'http://localhost:3001/v1';
const API_KEY = process.env.AUDITSWARM_API_KEY;

// API client
async function callAPI(endpoint: string, method: string = 'GET', body?: object) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 402) {
    const paymentInfo = await response.json();
    return {
      error: 'payment_required',
      message: 'Payment required to complete this request',
      instructions: paymentInfo.instructions,
    };
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Tool handlers
async function handleRequestAudit(args: {
  walletAddress: string;
  jurisdiction: string;
  taxYear: number;
  options?: object;
}) {
  const result = await callAPI('/audits', 'POST', {
    walletAddress: args.walletAddress,
    jurisdiction: args.jurisdiction,
    taxYear: args.taxYear,
    type: 'FULL_TAX_YEAR',
    options: args.options || {
      costBasisMethod: 'FIFO',
      includeStaking: true,
      includeAirdrops: true,
      includeNFTs: true,
      includeDeFi: true,
    },
  });

  if (result.error === 'payment_required') {
    return {
      content: [
        {
          type: 'text',
          text: `Payment required to request audit.\n\nPayment Instructions:\n- Pay to: ${result.instructions.payTo}\n- Amount: ${result.instructions.amount} ${result.instructions.currency}\n- Network: ${result.instructions.network}`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Audit requested successfully!\n\nAudit ID: ${result.id}\nStatus: ${result.status}\nJurisdiction: ${args.jurisdiction}\nTax Year: ${args.taxYear}\n\nTrack progress at: ${API_BASE_URL}/audits/${result.id}/status`,
      },
    ],
  };
}

async function handleCheckCompliance(args: {
  walletAddress: string;
  jurisdiction: string;
}) {
  const result = await callAPI('/compliance/check', 'POST', {
    walletAddress: args.walletAddress,
    jurisdiction: args.jurisdiction,
  });

  if (result.error === 'payment_required') {
    return {
      content: [
        {
          type: 'text',
          text: `Payment required for compliance check.\n\nAmount: ${result.instructions.amount} ${result.instructions.currency}`,
        },
      ],
    };
  }

  const statusEmoji = result.status === 'COMPLIANT' ? '✅' : result.status === 'NEEDS_REVIEW' ? '⚠️' : '❌';

  return {
    content: [
      {
        type: 'text',
        text: `Compliance Check Results\n\n${statusEmoji} Status: ${result.status}\nScore: ${result.score}/100\n\nSummary: ${result.summary}\n\nHas Valid Attestation: ${result.hasAttestation ? 'Yes' : 'No'}${result.attestationExpiry ? `\nAttestation Expires: ${result.attestationExpiry}` : ''}${result.lastAuditDate ? `\nLast Audit: ${result.lastAuditDate}` : ''}\n\nRecommended Actions:\n${result.recommendedActions.map((a: string) => `- ${a}`).join('\n')}`,
      },
    ],
  };
}

async function handleGetReport(args: {
  auditId: string;
  format: string;
  reportType?: string;
}) {
  const result = await callAPI('/reports', 'POST', {
    auditId: args.auditId,
    type: args.format,
    format: args.reportType || 'Summary',
  });

  if (result.error === 'payment_required') {
    return {
      content: [
        {
          type: 'text',
          text: `Payment required for report generation.\n\nAmount: ${result.instructions.amount} ${result.instructions.currency}`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Report generation started!\n\nJob ID: ${result.jobId}\n${result.message}`,
      },
    ],
  };
}

async function handleVerifyAttestation(args: {
  walletAddress: string;
  jurisdiction: string;
}) {
  const result = await callAPI(`/attestations/verify?address=${args.walletAddress}&jurisdiction=${args.jurisdiction}`);

  const validEmoji = result.valid ? '✅' : '❌';

  let text = `Attestation Verification\n\n${validEmoji} Valid: ${result.valid}\nMessage: ${result.message}`;

  if (result.attestation) {
    text += `\n\nAttestation Details:\n- Type: ${result.attestation.type}\n- Status: ${result.attestation.status}\n- Tax Year: ${result.attestation.taxYear}\n- Issued: ${result.attestation.issuedAt}\n- Expires: ${result.attestation.expiresAt}`;

    if (result.attestation.onChainAccount) {
      text += `\n- On-chain Account: ${result.attestation.onChainAccount}`;
    }
  }

  return {
    content: [{ type: 'text', text }],
  };
}

async function handleListJurisdictions() {
  const result = await callAPI('/compliance/jurisdictions');

  const text = `Supported Jurisdictions\n\n${result.map((j: any) =>
    `${j.supported ? '✅' : '🔜'} ${j.code} - ${j.name}${j.supported ? '' : ' (Coming Soon)'}`
  ).join('\n')}\n\nFor details on a specific jurisdiction, use: /compliance/jurisdictions/{code}`;

  return {
    content: [{ type: 'text', text }],
  };
}

// Main server
async function main() {
  const server = new Server(
    {
      name: 'auditswarm-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'request_audit':
          return await handleRequestAudit(args as any);
        case 'check_compliance':
          return await handleCheckCompliance(args as any);
        case 'get_report':
          return await handleGetReport(args as any);
        case 'verify_attestation':
          return await handleVerifyAttestation(args as any);
        case 'list_jurisdictions':
          return await handleListJurisdictions();
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('AuditSwarm MCP server running on stdio');
}

main().catch(console.error);
