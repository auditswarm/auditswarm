# AuditSwarm

**AI-powered crypto tax compliance with jurisdiction-specific agents and on-chain attestations.**

[![Built for Colosseum](https://img.shields.io/badge/Built%20for-Colosseum%20Agent%20Hackathon-purple)](https://www.colosseum.org/)
[![Solana](https://img.shields.io/badge/Solana-black?logo=solana)](https://solana.com)
[![Claude](https://img.shields.io/badge/Powered%20by-Claude-orange)](https://anthropic.com)

---

## The Problem

**Crypto tax compliance is broken.**

- **Fragmented Regulations**: Each jurisdiction has unique rules. The US uses Form 8949, Brazil requires IN 1888 monthly reports, the EU is implementing MiCA and DAC8. One-size-fits-all tools fail.

- **No Proof of Compliance**: After spending hours on tax software, you get a PDF. There's no verifiable, tamper-proof record that you actually completed compliance. If questioned, you start from scratch.

- **Cost Prohibitive**: Professional crypto tax services charge $500-5000+ per year. For most users, this exceeds their actual tax liability.

- **AI Agents Can't Help**: Despite the rise of AI assistants, they have no standardized way to access compliance tools on your behalf.

## The Solution

**AuditSwarm** is a swarm of specialized AI agents ("bees") that handle crypto tax compliance for specific jurisdictions, with permanent on-chain proof.

```
┌─────────────────────────────────────────────────────────────────┐
│                         AuditSwarm                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   👛 Connect Wallet  →  🐝 AI Bees Analyze  →  📋 Generate Forms │
│                                                                  │
│                              ↓                                   │
│                                                                  │
│                    ⛓️ On-Chain Attestation                       │
│                    (Permanent Proof of Compliance)               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Innovations

| Feature                  | Traditional Tools | AuditSwarm                             |
| ------------------------ | ----------------- | -------------------------------------- |
| **Jurisdiction Support** | Generic rules     | Specialized AI agents per jurisdiction |
| **Proof of Compliance**  | PDF file          | Immutable on-chain attestation         |
| **Pricing**              | $500-5000/year    | Pay-per-audit via x402 micropayments   |
| **AI Integration**       | None              | MCP server for any AI agent            |
| **Verification**         | Manual review     | Instant on-chain verification          |

---

## Monorepo Structure

This is a **pnpm monorepo** containing all AuditSwarm components:

```
auditswarm/
├── backend/                    # NestJS Backend Monorepo
│   ├── apps/
│   │   ├── api/               # REST API (auth, wallets, audits, reports)
│   │   ├── indexer/           # Solana transaction indexer (Helius)
│   │   ├── workflows/         # LangGraph audit workflows + Bees
│   │   └── mcp/               # Model Context Protocol server
│   ├── libs/
│   │   ├── common/            # Shared types, utils, constants
│   │   ├── database/          # Prisma ORM + repositories
│   │   ├── queue/             # BullMQ job definitions
│   │   └── x402/              # Payment protocol integration
│   ├── docker-compose.yml     # Local infrastructure
│   └── package.json
│
├── frontend/
│   ├── website/               # Astro landing page (coming soon)
│   └── dapp/                  # NextJS web application
│
├── onchain/
│   ├── programs/
│   │   └── attestation/       # Anchor program for on-chain attestations
│   ├── sdk/                   # TypeScript SDK for the program
│   ├── tests/                 # Program tests
│   └── Anchor.toml
│
├── packages/                   # Public NPM packages (@auditswarm.xyz/*)
│   ├── client/                # API client SDK
│   ├── solana/                # Solana utilities
│   ├── react/                 # React hooks
│   └── mcp/                   # MCP client wrapper
```

---

## Jurisdiction Bees

Each "bee" is a specialized AI agent trained on specific tax regulations:

### 🇺🇸 US Bee

- **Form 8949**: Sales and Other Dispositions of Capital Assets
- **Schedule D**: Capital Gains and Losses Summary
- **FBAR Check**: Foreign account reporting ($10,000+ threshold)
- **Cost Basis**: FIFO, LIFO, HIFO, Specific ID methods
- **Wash Sale**: Detection (when enforced for crypto)

### 🇪🇺 EU Bee

- **MiCA Classification**: EMT, ART, and other crypto-asset categories
- **DAC8 Reporting**: EU-wide transaction reporting standard
- **Travel Rule**: Compliance for transfers >€1,000
- **Country Variants**: Adapts to member state specifics

### 🇧🇷 BR Bee

- **IN 1888**: Monthly crypto transaction reporting
- **GCAP**: Capital gains calculation program format
- **DIRPF**: Annual tax declaration crypto section
- **Exemption Analysis**: R$35,000/month sales threshold

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose
- Rust & Anchor CLI (for Solana development)

### 1. Clone & Install

```bash
git clone https://github.com/auditswarm/auditswarm.git
cd auditswarm
pnpm install
```

### 2. Start Infrastructure

```bash
cd backend
docker-compose up -d  # PostgreSQL, Redis, Qdrant
```

### 3. Setup Database

```bash
pnpm db:generate
pnpm db:push
```

### 4. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys (Helius, Anthropic, etc.)
```

### 5. Start Development Servers

```bash
# Terminal 1: API
pnpm dev:api

# Terminal 2: Workflows
pnpm dev:workflows

# Terminal 3: Frontend
cd ../frontend/dapp && pnpm dev
```

### 6. Deploy Solana Program (Optional)

```bash
cd onchain
anchor build
anchor test
anchor deploy --provider.cluster devnet
```

---

## API Reference

### Authentication

```http
POST /v1/auth/siws/nonce
POST /v1/auth/siws
```

Sign-In With Solana (SIWS) for wallet-based authentication.

### Wallets

```http
GET    /v1/wallets
POST   /v1/wallets
GET    /v1/wallets/:id
PATCH  /v1/wallets/:id
DELETE /v1/wallets/:id
GET    /v1/wallets/:id/transactions
```

### Audits

```http
POST   /v1/audits              # Request new audit (💰 paid)
GET    /v1/audits
GET    /v1/audits/:id
GET    /v1/audits/:id/status
GET    /v1/audits/:id/result
DELETE /v1/audits/:id          # Cancel pending audit
```

### Reports

```http
POST   /v1/reports             # Generate report (💰 paid)
GET    /v1/reports/audit/:id
GET    /v1/reports/:id
GET    /v1/reports/:id/download
```

### Attestations

```http
POST   /v1/attestations        # Create on-chain (💰 paid)
GET    /v1/attestations/wallet/:id
GET    /v1/attestations/verify # Public verification
GET    /v1/attestations/:id
DELETE /v1/attestations/:id    # Revoke
```

### Compliance

```http
POST   /v1/compliance/check    # Quick check (💰 paid)
GET    /v1/compliance/jurisdictions
GET    /v1/compliance/jurisdictions/:code
```

---

## MCP Server

AuditSwarm exposes an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server, allowing any AI agent to perform compliance checks.

### Available Tools

| Tool                 | Description                           |
| -------------------- | ------------------------------------- |
| `request_audit`      | Request a full tax audit for a wallet |
| `check_compliance`   | Quick compliance status check         |
| `get_report`         | Generate or retrieve tax reports      |
| `verify_attestation` | Verify on-chain attestation           |
| `list_jurisdictions` | List supported jurisdictions          |

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "auditswarm": {
      "command": "npx",
      "args": ["@auditswarm.xyz/mcp"],
      "env": {
        "AUDITSWARM_API_URL": "https://api.auditswarm.xyz",
        "AUDITSWARM_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Example Interaction

```
User: Check if wallet DYw8jC... is tax compliant in the US

Claude: [Calls check_compliance tool]

AuditSwarm:
✅ Status: COMPLIANT
Score: 100/100
Has valid US tax attestation for 2024
Attestation expires: 2025-12-31
On-chain proof: https://solscan.io/account/...
```

---

## SDK Usage

### TypeScript Client

```typescript
import { AuditSwarmClient } from "@auditswarm.xyz/client";

const client = new AuditSwarmClient({
  apiUrl: "https://api.auditswarm.xyz",
  apiKey: process.env.AUDITSWARM_API_KEY,
});

// Request an audit
const audit = await client.createAudit({
  walletIds: ["wallet-uuid"],
  jurisdiction: "US",
  taxYear: 2024,
  type: "FULL_TAX_YEAR",
  options: {
    costBasisMethod: "HIFO", // Tax-optimized
    includeStaking: true,
    includeAirdrops: true,
  },
});

// Poll for completion
const result = await client.getAuditResult(audit.id);
console.log(`Net gain/loss: $${result.summary.netGainLoss}`);
console.log(`Estimated tax: $${result.summary.estimatedTax}`);
```

### React Hooks

```tsx
import {
  AuditSwarmProvider,
  useAudit,
  useCompliance,
  useAttestation,
} from "@auditswarm.xyz/react";

function App() {
  return (
    <AuditSwarmProvider config={{ apiUrl: "https://api.auditswarm.xyz" }}>
      <ComplianceDashboard />
    </AuditSwarmProvider>
  );
}

function ComplianceDashboard() {
  const { checkCompliance, check, loading } = useCompliance();
  const { verify, verification } = useAttestation();

  const handleCheck = async () => {
    await checkCompliance(walletAddress, "US", 2024);
  };

  return (
    <div>
      {check?.status === "COMPLIANT" && (
        <Badge color="green">Tax Compliant ✓</Badge>
      )}
    </div>
  );
}
```

### Solana SDK

```typescript
import {
  AuditSwarmSolana,
  Jurisdiction,
  AttestationType,
} from "@auditswarm.xyz/solana";
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com");
const sdk = new AuditSwarmSolana(connection);

// Check if wallet is compliant on-chain
const { compliant, attestation } = await sdk.isCompliant(
  new PublicKey("DYw8jC..."),
  Jurisdiction.US,
  2024,
);

if (compliant) {
  console.log("Attestation hash:", attestation.auditHash);
  console.log("Expires:", new Date(Number(attestation.expiresAt) * 1000));
}
```

---

## On-Chain Attestations

Attestations are stored as PDAs on Solana, providing permanent, verifiable proof of compliance.

### Account Structure

```rust
pub struct Attestation {
    pub wallet: Pubkey,           // Wallet being attested
    pub jurisdiction: Jurisdiction, // US, EU, BR, etc.
    pub attestation_type: AttestationType,
    pub status: AttestationStatus,  // Active, Expired, Revoked
    pub tax_year: u16,
    pub audit_hash: [u8; 32],     // SHA-256 of audit result
    pub issued_at: i64,
    pub expires_at: i64,
}
```

### PDA Derivation

```
seeds = ["attestation", wallet, jurisdiction, type, tax_year]
```

### Verification Flow

```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│   DeFi App   │────▶│  AuditSwarm   │────▶│   Solana     │
│              │     │   Verifier    │     │   On-Chain   │
└──────────────┘     └───────────────┘     └──────────────┘
       │                    │                     │
       │  "Is user         │  Check PDA          │
       │   compliant?"     │  attestation        │
       │                    │                     │
       ◀────────────────────┼─────────────────────┘
              ✅ Valid / ❌ Not Found
```

---

## x402 Micropayments

AuditSwarm uses the [x402 protocol](https://www.x402.org/) for pay-per-use pricing:

| Service                     | Price |
| --------------------------- | ----- |
| Basic Audit                 | $0.10 |
| Standard Audit              | $0.50 |
| Premium Audit + Attestation | $1.00 |
| Compliance Check            | $0.05 |
| Report Generation           | $0.02 |
| On-Chain Attestation        | $0.25 |

When a paid endpoint is called without payment:

```json
{
  "error": "payment_required",
  "code": 402,
  "instructions": {
    "payTo": "AuditSwarm...",
    "amount": "0.10",
    "currency": "USDC",
    "network": "solana:mainnet"
  }
}
```

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/auditswarm

# Redis (BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379

# Qdrant (RAG/Embeddings)
QDRANT_URL=http://localhost:6333

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
HELIUS_API_KEY=your-helius-key

# AI
ANTHROPIC_API_KEY=your-claude-key

# Auth
JWT_SECRET=your-jwt-secret

# x402 Payments
X402_ENABLED=true
X402_PAY_TO_ADDRESS=your-usdc-address
X402_NETWORK=solana:devnet
```

---

## Roadmap

- [x] Core API & Database
- [x] US, EU, BR Jurisdiction Bees
- [x] On-Chain Attestation Program
- [x] MCP Server Integration
- [x] React Hooks SDK
- [ ] RAG with Regulatory Documents
- [ ] UK, JP, AU Jurisdiction Bees
- [ ] Mobile App
- [ ] Institutional Dashboard
- [ ] DAO Governance

---

## Contributing

We welcome contributions! Fork the repo, create a feature branch, and submit a PR.

```bash
# Run tests
pnpm test

# Run linting
pnpm lint

# Build all packages
pnpm build
```

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

## Acknowledgments

Built with ❤️ for the [Colosseum Agent Hackathon](https://www.colosseum.org/)

**Powered by:**

- [Solana](https://solana.com) - High-performance blockchain
- [Anthropic Claude](https://anthropic.com) - AI backbone
- [LangGraph](https://langchain-ai.github.io/langgraph/) - Agent orchestration
- [Helius](https://helius.dev) - Solana RPC & indexing
- [x402 Protocol](https://www.x402.org/) - Web3 micropayments

---

<p align="center">
  <strong> The Swarm is Compliant </strong>
</p>
