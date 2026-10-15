# API Documentation Engine (GOSI)

A working prototype that turns an Apigee API proxy into reviewed, approved OpenAPI (Swagger) documentation in six guided steps. An AI writes the documentation from real traffic, a developer discusses and corrects it with the AI, and the approved file is stored in a registry.

The data sources (Apigee and Splunk) are **simulated** from two JSON files. Everything else behaves like the real product: the step-by-step flow, the AI generation and discussion, validation, versioning, approval and download.

---

## Contents

1. [The six steps](#the-six-steps)
2. [Quick start](#quick-start)
3. [Connect the AI (cloud)](#connect-the-ai-cloud)
4. [Running a client demo](#running-a-client-demo)
5. [Configuration](#configuration)
6. [Project structure](#project-structure)
7. [How it works](#how-it-works)
8. [REST API](#rest-api)
9. [Troubleshooting](#troubleshooting)
10. [From prototype to production](#from-prototype-to-production)

---

## The six steps

Each step unlocks only after the previous one is done. Progress is saved, so a user can leave and come back.

| # | Step | What the user does | What happens |
| --- | --- | --- | --- |
| 1 | **Select API** | Picks a proxy and clicks *Start documentation* | The API is registered in the workflow |
| 2 | **Apigee metadata** | Clicks *Fetch proxy metadata* | Reads the proxy revision (management API call shown) and turns each conditional flow into an OpenAPI operation |
| 3 | **Splunk samples** | Chooses masking, clicks *Pull samples from Splunk* | Runs the shown search, matches events to operations, and shows masked sample requests and responses |
| 4 | **AI** | Clicks *Generate Swagger* | Sends the base spec and samples to the AI with prompt v0.6; the AI returns the finished Swagger file |
| 5 | **Review** | Reads the docs, discusses with the AI, accepts or rejects its proposed changes | Every change is versioned and re-validated against the prompt's Rule 7 checks |
| 6 | **Submit** | Enters reviewer name and an optional note, clicks *Approve and submit* | The spec is approved and stored with the reviewer's name; it can be downloaded or reopened |

Submission is blocked until every validation check passes and no AI proposal is waiting for a decision.

---

## Quick start

**Requirements:** Node.js 20 or newer (`node -v`).

```bash
npm run setup
npm run build
npm start
```

Run these in the project root folder. `npm run setup` installs the backend and frontend, `npm run build` builds both, and `npm start` starts the app.

Open **http://localhost:3000**. The terminal prints a banner showing the app URL and whether the AI is connected.

Without an API key the app runs in **offline mode**: every step works, but step 4 produces a basic local draft and the discussion in step 5 is disabled. To connect the real AI, follow the next section.

### Developer mode (live reload)

Use two terminals:

```bash
# terminal 1
cd backend
npm run start:dev

# terminal 2
cd frontend
npm start
```

Open http://localhost:4200. The Angular dev server forwards `/api` to the backend on port 3000.

---

## Connect the AI (cloud)

The app supports Claude and several free providers (see [Free AI providers](#free-ai-providers)). With Claude, the backend calls the Claude API at `api.anthropic.com` over HTTPS, so you need an API key with credit and internet access from the machine running the backend.

### 1. Get an API key

1. Go to **https://console.anthropic.com** and sign in.
2. Open **API Keys** and select **Create Key**. Copy the key (it starts with `sk-ant-`). It is shown only once.
3. In **Plans & Billing**, make sure the account has credit. API usage is billed separately from a claude.ai subscription.

### 2. Put the key in `backend/.env`

Create the file from the template if you have not already:

```bash
cd backend
copy .env.example .env      # Windows
cp .env.example .env        # macOS / Linux
```

Edit `backend/.env`:

```env
ANTHROPIC_API_KEY=sk-ant-api03-...your key...
BRAIN_MODE=claude
```

No quotes and no spaces around the key. The `.env` file is in `.gitignore`; never commit it.

### 3. Check the connection

```bash
cd backend
npm run ai:check
```

This sends one tiny request and tells you exactly what is wrong if it fails:

```
AI connection check

  [OK]   .env found at ...\backend\.env
  [OK]   BRAIN_MODE=claude
  [OK]   API key set (sk-ant-...a1B2)
  [OK]   Model claude-sonnet-5-5
         No proxy configured (set AI_PROXY in .env if your network needs one)
  [OK]   Reached the AI service in 840 ms. Reply: "ready"

All good. Restart the backend (npm start) and the header badge will show the model name.
```

### 4. Restart and confirm

Restart the backend (Ctrl+C, then `npm start`). The startup banner says `AI: connected (claude-sonnet-5-5)` and the header badge in the app changes from **AI · OFFLINE MOCK** to the model name. If a Swagger file was generated offline, go to step 4 and click **Regenerate** to get the AI version.

### Free AI providers

Any of these can replace Claude. Generation and the step 5 discussion both work. Pick one with `AI_PROVIDER` in `backend/.env`, then run `npm run ai:check`.

| Provider | Cost | Setup | Data |
| --- | --- | --- | --- |
| **Groq** (recommended) | Free tier (daily limits) | Key from https://console.groq.com/keys | Cloud; may be logged for up to 30 days |
| **Google Gemini** | Free tier on Flash models | Key from https://aistudio.google.com/apikey | Cloud; free-tier content may be used by Google |
| **OpenRouter** | Free models, low daily limit | Key from https://openrouter.ai/keys | Cloud |
| **Ollama** | Free, runs on your PC | Install from https://ollama.com, then `ollama pull gpt-oss:20b` | Stays on your PC |

**Groq** (fastest to set up):

```env
AI_PROVIDER=groq
AI_API_KEY=gsk_...your key...
```

**Gemini:**

```env
AI_PROVIDER=gemini
AI_API_KEY=AIza...your key...
```

**Ollama** (needs a strong PC, 16 GB RAM or more):

```env
AI_PROVIDER=ollama
```

**Any other OpenAI-compatible service:**

```env
AI_PROVIDER=openai
AI_BASE_URL=https://host/v1
AI_API_KEY=...
AI_MODEL=...
```

Each provider has a default model. Set `AI_MODEL` to change it. If the model name is wrong, `npm run ai:check` lists the models your key can use. Free models are smaller than Claude, so review the generated Swagger carefully in step 5.

Use free cloud tiers with the simulated data only. Before sending real traffic samples, even masked, get approval from your security team, or use Ollama so the data never leaves your PC.

To go back to Claude, set `AI_PROVIDER=claude` and `ANTHROPIC_API_KEY`.

### No API credit? Generate for free

Step 4 has a **No AI credit? Generate for free** panel with two options:

- **Option A, claude.ai:** free with a Claude subscription.
  1. Click **Copy full prompt**.
  2. Paste it into a new chat at claude.ai and send.
  3. Copy Claude's whole reply, paste it into the box and click **Use this Swagger**.

  The result is real Claude output and goes through the same validation and review. In the registry it is marked as *claude.ai (pasted)*.
- **Option B, offline draft:** one click. A simple draft built locally, so a demo never gets stuck.

The discussion in step 5 needs the API (a key with credit). Everything else works with these options.

### Corporate network or proxy

If `ai:check` says *Could not connect to the AI service*:

- **Behind a proxy:** set it in `backend/.env`:
  ```env
  AI_PROXY=http://proxy-host:8080
  ```
  The app also reads `HTTPS_PROXY` / `HTTP_PROXY` if `AI_PROXY` is empty. Proxy credentials can go in the URL: `http://user:pass@proxy-host:8080`.
- **Certificate errors (SSL inspection):** point Node.js at your company root CA before starting:
  ```powershell
  $env:NODE_EXTRA_CA_CERTS="C:\certs\company-root-ca.pem"
  npm start
  ```
- **Blocked domain:** ask the network team to allow HTTPS to `api.anthropic.com`.
- **Company AI gateway:** if your organization routes Claude through its own gateway, set `ANTHROPIC_BASE_URL` to the gateway URL.

### Data protection

With **Mask personal data** on (the default in step 3), national IDs, names, mobile numbers and birth dates in the samples are pseudonymized before anything leaves your machine. Before using real Splunk data, confirm with your security team that sending masked samples to an external AI service is approved under your PDPL and data-classification policies.

---

## Running a client demo

1. Start fresh: stop the app, delete `backend/data/registry.sqlite`, start again.
2. Walk through `contributor-inquiry`: two operations, real-looking traffic, a 404 sample and nullable fields. It shows the full flow well.
3. In step 3, open a sample to show masking (Arabic and English names replaced, IDs pseudonymized).
4. In step 5, try the discussion. Good prompts:
   - *Which fields came from the samples?*
   - *Make the summaries shorter*
   - *Add a 500 response* (the AI refuses, because no sample shows one: this demonstrates the no-invention rule)
5. Accept one proposal and reject another, then show the validation tab and **Undo last change**.
6. Submit with a reviewer name, then use **Document next API** to show `establishment-registry` (no Splunk logs, so the AI documents structure only).

---

## Configuration

All settings are in `backend/.env` (template: `backend/.env.example`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port for the app and API |
| `AI_PROVIDER` | `claude` | `claude`, `groq`, `gemini`, `openrouter`, `ollama` or `openai` |
| `AI_API_KEY` | empty | Key for the free provider (not needed for Ollama) |
| `AI_MODEL` | provider default | Model for the free provider |
| `AI_BASE_URL` | provider default | Endpoint; required for `AI_PROVIDER=openai` |
| `AI_MAX_TOKENS` | `8192` | Output limit for generation with a free provider |
| `ANTHROPIC_API_KEY` | empty | Claude API key, used when `AI_PROVIDER=claude` |
| `BRAIN_MODE` | empty | `mock` forces offline mode |
| `BRAIN_MODEL` | `claude-sonnet-5-5` | Claude model |
| `AI_PROXY` | empty | HTTP(S) proxy for cloud AI calls; falls back to `HTTPS_PROXY` |
| `ANTHROPIC_BASE_URL` | empty | Optional company gateway for Claude |
| `BRAIN_MAX_TOKENS` | `32000` | Output limit for Swagger generation with Claude |
| `BRAIN_CHAT_MAX_TOKENS` | `4096` | Output limit per discussion reply |
| `SIMULATION_DIR` | `./simulation` | Folder with `apigee.json` and `splunk.json` |
| `SIMULATED_LATENCY_MS` | `900` | Delay for the simulated Apigee and Splunk calls, so steps 2 and 3 feel real. `0` disables it |
| `SAMPLES_PER_OPERATION` | `5` | Maximum Splunk samples sent per operation |
| `PROMPT_FILE` | `./prompts/prompt-v0.6.md` | Generation prompt; must contain `{{INPUT_SPEC}}` |
| `DB_FILE` | `./data/registry.sqlite` | Where the registry is saved. `:memory:` keeps nothing after a restart |
| `FRONTEND_DIST` | `../frontend/dist/frontend/browser` | Built frontend served by the backend |

### Using your own sample data

Replace `backend/simulation/apigee.json` and `splunk.json`, or use the **Replace** buttons at the top of the app. The formats are defined in `backend/src/sources/source.types.ts`. Each Apigee flow needs a condition with `MatchesPath` and `request.verb`, as in a real proxy bundle.

### Changing the prompt

Edit `backend/prompts/prompt-v0.6.md` and restart. No code change is needed. Keep the `{{INPUT_SPEC}}` placeholder at the end.

### GOSI logo

Place the official logo from the GOSI brand kit at `frontend/public/gosi-logo.svg` (or `.png`) and run `npm run build`. It appears in the header on a white plate, as the brand guidelines require.

---

## Project structure

```
gosi-api-doc-engine/
├── package.json                  one-command scripts (setup, build, start, ai:check, test)
├── backend/                      NestJS 11 + TypeScript
│   ├── .env.example
│   ├── prompts/prompt-v0.6.md    AI generation rules
│   ├── simulation/               apigee.json, splunk.json
│   ├── scripts/ai-check.ts       AI connection diagnostic
│   ├── data/                     registry.sqlite (created on first run)
│   ├── src/
│   │   ├── brain/                AI: Claude client, offline mock, discussion guide
│   │   ├── sources/              Apigee and Splunk data
│   │   ├── spec/                 spec builder, masking, validator, JSON Patch
│   │   ├── registry/             workflow, database entities, REST controller
│   │   └── common/               error handling
│   └── test/                     unit and workflow tests
└── frontend/                     Angular 19 (standalone components, signals)
    └── src/app/
        ├── components/           header, stepper, API list, step screens, review tabs
        ├── store.service.ts      app state and workflow actions
        └── api.service.ts        REST client
```

---

## How it works

**Step 2: Apigee to OpenAPI.** Each flow condition such as `(proxy.pathsuffix MatchesPath "/contributors/*/engagements") and (request.verb = "GET")` becomes `GET /contributors/{contributorId}/engagements`. Wildcards are named after the preceding path segment, and the flow name becomes the `operationId`.

**Step 3: Splunk samples.** Each event is matched to an operation by method and path, with literal paths preferred over wildcards. Up to 5 samples per operation are injected as hint fields: `path_examples_for_ai`, `query_parameters_examples_for_ai`, `headers_parameters_examples_for_ai` and `body_examples_for_ai`. Masking replaces personal data consistently, so the same ID always maps to the same pseudonym.

**Step 4: AI generation.** The enriched spec replaces `{{INPUT_SPEC}}` in prompt v0.6 and is sent to Claude. The response is parsed, saved as version 1 and validated against the prompt's Rule 7:

- hints removed
- paths and methods unchanged
- metadata kept
- descriptions present
- unique operationIds
- every `$ref` resolves

**Step 5: Discussion.** The AI sees the current spec, the source samples and the generation rules. When a change is needed, it calls a `propose_changes` tool with JSON Patch operations. The backend dry-runs and validates each proposal before showing it. Accepting creates a new version, and undo removes the latest version.

**Step 6: Approval.** This is guarded on the server: all checks must pass, no proposals may be pending, and a reviewer name is required. Approved specs are locked until they are reopened.

**Storage.** SQLite in a single file (`backend/data/registry.sqlite`, via `sql.js`, so nothing needs compiling). It has five tables:

| Table | Holds |
| --- | --- |
| `api_registry` | One row per API: status, step progress, approval |
| `api_specs` | Every spec version with its source and the input it was validated against |
| `validation_logs` | Check results per version |
| `discussion_messages` | The review conversation |
| `proposals` | AI-proposed changes and decisions |

---

## REST API

All endpoints are under `/api`. Errors return `{ "code", "message" }` with minimal detail.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | App status and AI mode |
| GET | `/sources` | Loaded Apigee and Splunk data, and AI mode |
| POST | `/sources/apigee`, `/sources/splunk` | Replace simulation data |
| GET | `/proxies` | APIs with status and step progress |
| GET | `/proxies/:name` | Full detail for one API, including step results |
| POST | `/proxies/:name/start` | Step 1 |
| POST | `/proxies/:name/steps/apigee` | Step 2 |
| POST | `/proxies/:name/steps/splunk` | Step 3, body `{ "mask": true }` |
| GET | `/proxies/:name/input?mask=true` | The exact input sent to the AI |
| POST | `/proxies/:name/generate` | Step 4 |
| PUT | `/proxies/:name/spec` | Save a manual JSON edit, body `{ "spec": {...} }` |
| GET / POST / DELETE | `/proxies/:name/discussion` | Read, send `{ "message": "..." }`, or clear the discussion |
| POST | `/proxies/:name/proposals/:id/accept` or `/reject` | Decide an AI proposal |
| POST | `/proxies/:name/undo` | Remove the latest version |
| POST | `/proxies/:name/approve` | Step 6, body `{ "reviewer": "...", "note": "..." }` |
| POST | `/proxies/:name/reopen` | Back to review |
| POST | `/proxies/:name/restart` | Start the API's workflow over |
| GET | `/proxies/:name/spec/download` | Download the current spec |

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Browser shows *The backend is not reachable* | The backend is not running. Run `npm start` (root folder) or `npm run start:dev` (backend folder) |
| Terminal shows `ECONNREFUSED` on `/api/...` | Same as above: the frontend dev server cannot find the backend on port 3000 |
| Badge says **AI · OFFLINE** | No AI is connected. Set up a [free provider](#free-ai-providers) or Claude, then run `npm run ai:check` |
| *free limit reached* | The free tier's rate limit was hit. Wait a minute, or lower `SAMPLES_PER_OPERATION` |
| *The request is too large for this free model* | Lower `SAMPLES_PER_OPERATION` (for example `2`) or `AI_MAX_TOKENS` |
| *The AI service rejected the API key* | Wrong or revoked key. Copy it again from the Console |
| *Cannot reach the AI service* | Network or proxy. Set `AI_PROXY`, and `NODE_EXTRA_CA_CERTS` for SSL inspection |
| *The AI account has no available credit* | Add billing in the Console under Plans & Billing |
| *The AI stopped before finishing the file* | Very large API. Raise `BRAIN_MAX_TOKENS` or lower `SAMPLES_PER_OPERATION` |
| Port 3000 already in use | Set `PORT=3001` in `backend/.env` (and update `frontend/proxy.conf.json` for dev mode) |
| `npm install` fails behind a proxy | `npm config set proxy http://host:port` and `npm config set https-proxy http://host:port`, or point npm at your internal registry mirror |
| Want a clean demo | Stop the app, delete `backend/data/registry.sqlite`, start again |

Run the tests with `npm test` in the root folder.

---

## From prototype to production

What would change for a real deployment:

- **Live sources:** replace `SourcesService` with an Apigee Edge management API client (deployed revisions and proxy endpoints) and a Splunk REST search client, keeping the same data shapes.
- **Database:** move from the SQLite file to Oracle or PostgreSQL by changing the TypeORM options in `backend/src/app.module.ts`, with migrations instead of `synchronize`.
- **Identity:** put the app behind GOSI single sign-on and take the reviewer name from the signed-in user.
- **Hosting:** container image built from the internal registry mirror, deployed on OpenShift with the API key in a Secret.
- **Governance:** formal approval for sending masked samples to the AI service, and publishing approved specs to the developer portal.
