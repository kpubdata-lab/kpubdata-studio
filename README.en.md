# KPubData Studio

**KPubData Studio is the visual web interface for the KPubData product family.**
A web application where you can plan, preview, run, and inspect Korean public data builds from your browser.

The process of designing and normalizing datasets is often complex, with barriers including YAML editing errors, lack of visual feedback, and difficulty for non-developers. Studio removes these barriers, enabling anyone to intuitively configure and manage public data workflows without coding experience.

## When this project is NOT needed

- You want to write build configuration files directly via CLI or Python code → Use [kpubdata-builder](https://github.com/yeongseon/kpubdata-builder)
- You only need to access Korean public data programmatically → Use [kpubdata](https://github.com/yeongseon/kpubdata)

## Installation and Getting Started

### Requirements

**Node 22 or newer** is required. (Test tooling only works on Node 22+)

### Quick Start (Demo Mode)

```bash
git clone https://github.com/yeongseon/kpubdata-studio.git
cd kpubdata-studio
npm install
npm run dev
```

Running `npm run dev` starts a Vite development server in **demo mode** (using mock data). Open [http://localhost:5173](http://localhost:5173) in your browser.

### Running with Builder (Real Data)

To integrate with the Builder API and use real data:

```bash
# Method 1: Use script
./scripts/dev-with-builder.sh --real

# Method 2: Manual setup
# Terminal 1: Builder
cd ../kpubdata-builder
KPUBDATA_BUILDER_DEV_MODE=true uv run kpubdata-builder serve

# Terminal 2: Studio
cd ../kpubdata-studio
cp .env.development.real .env.development.local
npm run dev
```

## Key Features

- **Build Planning**: Configure dataset build rules using UI buttons and inputs.
- **Real-Time Preview**: See immediately how data will be organized based on your configuration.
- **Build Execution & Monitoring**: Integrate with Builder to track actual data collection in real time.
- **Result Inspection**: Visually verify the structure and contents of generated data files.

## Technology Stack

| Technology | Description |
|---|---|
| **Vite** | Fast frontend build tool |
| **React** | UI library |
| **TypeScript** | Type safety |
| **TanStack Query** | Server state management and data fetching |
| **Zustand** | Local UI state management |
| **Tailwind CSS** | Styling |

## Development Commands

```bash
npm run dev        # Start dev server
npm run lint       # Run ESLint
npm test           # Run Vitest
npm run build      # Production build
npm run preview    # Preview build results
```

## Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture |
| [STATE_MODEL.md](./STATE_MODEL.md) | State management model |
| [UI_SPEC.md](./UI_SPEC.md) | UI specification |
| [AGENTS.md](./AGENTS.md) | AI agent collaboration guide |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contribution guide |
| [PRD.md](./PRD.md) | Product requirements |

For more details, see the [docs/](./docs/) directory. For Keycloak authentication setup and troubleshooting, see [docs/troubleshooting.md](./docs/troubleshooting.md).

## Product Family

| Package | Role |
|---|---|
| [kpubdata](https://github.com/yeongseon/kpubdata) | Access + parsing + normalization SDK |
| [kpubdata-builder](https://github.com/yeongseon/kpubdata-builder) | Dataset assembly + pipeline |
| **kpubdata-studio** | **Visual interface** |

---

**한국어:** [README.md](./README.md) 참고
