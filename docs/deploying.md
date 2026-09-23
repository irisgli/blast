# Deploying

`blast` deploys to Vercel as one project: the Next.js surface in
[`apps/web`](../apps/web) and the agent runtime it mounts at `/eve/v1/*`.

## One project, two things

`apps/web/next.config.ts` wraps the Next config with `withEve`, pointing at the agent
at the repository root. Browser requests reach the page; the agent's HTTP routes are
served same-origin from the same deployment. Nothing needs to be deployed twice or kept
in sync.

## Deploy

```bash
npx vercel link            # root directory: apps/web
npx vercel --prod
```

Set the project's **Root Directory** to `apps/web`. Vercel installs from the pnpm
workspace root, so the packages build with it.

Alternatively, from the repository root:

```bash
pnpm exec eve link --project blast
pnpm exec eve deploy
```

## Model credentials

The page needs none. It runs the engine, and the engine is deterministic code over the
fixtures — verdict, ledger, and remediations render with no model call and no
credentials.

The agent needs a model. A string model ID routes through the
[Vercel AI Gateway](https://vercel.com/docs/ai-gateway), which authenticates through the
project's OIDC — no provider key to hold. For a direct provider, set `ANTHROPIC_API_KEY`
in the project environment and change `agent/agent.ts` to use `anthropic()` from
`eve/models/anthropic`.

## The GitHub App

[`agent/channels/github.ts`](../agent/channels/github.ts) reads credentials from the
environment, so it stays dormant until they exist:

```bash
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY=...    # PEM
GITHUB_WEBHOOK_SECRET=...
GITHUB_APP_SLUG=blast
```

Point the App's webhook at `https://<deployment>/eve/v1/github` and subscribe to
`issue_comment` and `pull_request_review_comment`. Mentioning `@blast` on a pull request
then starts a turn with the diff already in context.

`pnpm exec eve add channel/github` replaces all of that with Vercel Connect, which
creates and holds the App, forwards verified webhooks, and rotates the installation
token. It rewrites `agent/channels/github.ts` and removes the three variables above.

## The sandbox

just-bash, in production as well as locally: a pure-JavaScript shell and filesystem with
no container to provision. Every deterministic computation in this agent runs as a tool
in the app runtime, so the sandbox only ever holds skill files. Vercel Sandbox would be
the default on Vercel and would provision real compute to hold four markdown documents.

## What a deployment does not have

Live telemetry. Every adapter reads the checked-in storefront fixtures, so a deployed
page shows the sample pull request and nothing else. Pointing a dimension at a real
source is one file implementing `Adapter` plus a registry entry; see
[Adapters](./adapters.md).
