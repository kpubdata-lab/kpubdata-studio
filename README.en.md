<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/kpubdata-brand-assets/svg/horizontal_dark.svg">
    <img alt="KPubData Studio" src="assets/logo/kpubdata-brand-assets/svg/horizontal_light.svg" width="360">
  </picture>
</p>

# KPubData Studio

**KPubData Studio is a workspace for collecting Korean public data, keeping it as snapshots that carry their source and terms of use, and analysing it with tables and SQL.**
It is the web interface of the KPubData product family.

> **Names** — the execution engine is **KPubData Builder**; its repository and package are
> `kpubdata-builder`. Commands and environment variables here (`VITE_BUILDER_API_URL` and so
> on) use the same name ([BRAND.md](https://github.com/kpubdata-lab/kpubdata/blob/main/docs/brand/BRAND.md)).

The process of designing and normalizing datasets is often complex, with barriers including YAML editing errors, lack of visual feedback, and difficulty for non-developers. Studio removes these barriers, enabling anyone to intuitively configure and manage public data workflows without coding experience.

## When this project is NOT needed

- You want to write build configuration files directly via CLI or Python code → Use [kpubdata-builder](https://github.com/kpubdata-lab/kpubdata-builder)
- You only need to access Korean public data programmatically → Use [kpubdata](https://github.com/kpubdata-lab/kpubdata)

## Installation and Getting Started

### Requirements

**Node 22 or newer** is required. (Test tooling only works on Node 22+)

### Quick Start (Demo Mode)

```bash
git clone https://github.com/kpubdata-lab/kpubdata-studio.git
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
# CORS is default-deny, so allow Studio's origin; the Tables and SQL screens need a warehouse
mkdir -p build
KPUBDATA_BUILDER_DEV_MODE=true \
  KPUBDATA_BUILDER_ALLOWED_ORIGINS=http://localhost:5173 \
  uv run kpubdata-builder serve --output-dir build --warehouse build/warehouse

# Terminal 2: Studio
cd ../kpubdata-studio
cp .env.development.real .env.development.local
npm run dev
```

### Deploying the container image

`Dockerfile` builds the image (#411). The image is the
same for every deployment; the Builder URL and OIDC settings are passed as environment
variables **when the container starts**.

```bash
docker build -t kpubdata-studio .
docker run -p 8080:8080 \
  -e BUILDER_API_URL=https://api.example.org \
  -e OIDC_ISSUER=https://sso.example.org/realms/kpubdata \
  -e OIDC_CLIENT_ID=kpubdata-studio \
  kpubdata-studio
```

| Variable | Meaning |
|---|---|
| `BUILDER_API_URL` | The Builder URL the browser calls. Setting it turns real Builder mode on |
| `USE_REAL_BUILDER` | `false` keeps the demo data even when a URL is set |
| `OIDC_ISSUER` · `OIDC_CLIENT_ID` | Public SPA client settings — not secrets |

The browser calls Builder directly, so add this Studio's origin to Builder's
`KPUBDATA_BUILDER_ALLOWED_ORIGINS`. A value containing a quote, a space, `<` or similar
stops the container with the reason instead of starting it.

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
| **React Router** | Routing |
| **Zustand** | Shell UI and session state (each screen's hooks load server responses) |
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
| [kpubdata](https://github.com/kpubdata-lab/kpubdata) | Access + parsing + normalization SDK |
| [kpubdata-builder](https://github.com/kpubdata-lab/kpubdata-builder) | Dataset assembly + pipeline |
| **kpubdata-studio** | **Visual interface** |

---

**한국어:** [README.md](./README.md) 참고
