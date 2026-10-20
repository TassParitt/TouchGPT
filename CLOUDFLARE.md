# Deploy TouchGPT from GitHub to Cloudflare

The original deployment failed because Wrangler was given a React source repository without a static-assets directory configuration. Vite generates the HTML/CSS/JS in **`dist`**; the original `main` branch also contained only LICENSE. Deploy the updated **`main`** branch.

This repository supports **Workers with Static Assets (recommended)** and **Pages with Functions**. Choose one deployment type. The Express server and local `node:sqlite` database are for Node hosting; Cloudflare uses `cloudflare/api.js` and **D1** instead.

## Workers — recommended

In **Workers & Pages → your Worker → Settings → Builds**, use:

| Setting           | Value                                                               |
| ----------------- | ------------------------------------------------------------------- |
| GitHub repository | `TassParitt/TouchGPT`                                               |
| Production branch | `main`                                                              |
| Root directory    | repository root (leave blank or `/`)                                |
| Build command     | `npm run build`                                                     |
| Deploy command    | `npx wrangler deploy`                                               |
| Node version      | `24` (`.node-version` is included; set `NODE_VERSION=24` if needed) |

Save the settings and retry the latest deployment, **not the old failed commit**. `wrangler.jsonc` declares the Worker entry point, `nodejs_compat`, and `assets.directory = "./dist"`. It also includes a custom build command, so invoking `npx wrangler deploy` by itself builds the assets. A Git integration that already ran the build may therefore build twice; this is safe.

The configured Worker name is `touchgpt`. If your existing Cloudflare Worker has a different name, change `name` in `wrangler.jsonc` to match it before deploying. Cloudflare supplies the final HTTPS `workers.dev` address after a successful deployment; no address is assumed by this repository.

For an authenticated local terminal:

```sh
npm ci
npx wrangler login
npm run deploy
```

For CI use a scoped Cloudflare API token and account ID through the CI secret store, never in Git. The Codex environment's AI secret is separate from Cloudflare credentials.

## Pages — alternative

In a **Pages** project connected to GitHub, configure:

| Setting                | Value                                           |
| ---------------------- | ----------------------------------------------- |
| Production branch      | `main`                                          |
| Root directory         | repository root                                 |
| Framework preset       | Vite (or None with the explicit settings below) |
| Build command          | `npm run build`                                 |
| Build output directory | `dist`                                          |
| Node version           | `24`                                            |

**Pages Git integration does not need a `wrangler deploy` command.** It publishes the build output automatically. If your screen requires a deploy command, you likely created a Workers Builds project: use the Workers instructions above, or create a Pages project.

In Pages **Settings → Functions / Runtime**, set the compatibility date to `2026-01-01` (or later), add **`nodejs_compat`**, and apply it to production and preview. Redeploy after changing runtime settings. Pages compiles `functions/api/[[path]].js` and routes `/api/*` to the same D1 API. `_routes.json` keeps static requests out of Functions; `_headers` supplies the app's response headers.

The root `wrangler.jsonc` intentionally describes Workers and omits `pages_build_output_dir`. Pages Git deployments use the Pages dashboard settings; a warning that the Worker file is not a Pages deployment configuration is expected. Do not add `pages_build_output_dir` to that Worker configuration or combine incompatible Worker/Pages fields. If you later choose a Pages-only configuration file, follow Cloudflare's Pages configuration guide and replace the Worker config intentionally.

For direct Pages upload after signing in and creating a Pages project:

```sh
npm run build
npx wrangler pages deploy dist --project-name YOUR_PAGES_PROJECT
```

Do not use `npx wrangler deploy` for a Pages upload. Do not use `public` or the repository root as the build output directory.

## Enable accounts and cloud storage with D1

The deployed app's microphone, calibration, photo capture, demo, local history, downloads, and offline shell work without a database binding. Registration, login, and cloud uploads require **D1**. Missing bindings/migrations produce an actionable JSON error rather than a broken app page.

1. In Cloudflare **Storage & databases → D1**, create a database named `touchgpt`. Alternatively, after authenticating:

   ```sh
   npx wrangler d1 create touchgpt
   ```

2. For **Workers**, add this property to `wrangler.jsonc`, using the actual database ID returned by Cloudflare. Database IDs are configuration identifiers, not API credentials.

   ```json
   "d1_databases": [
     {
       "binding": "DB",
       "database_name": "touchgpt",
       "database_id": "ACTUAL_DATABASE_ID_FROM_CLOUDFLARE",
       "migrations_dir": "migrations"
     }
   ]
   ```

   For **Pages**, add a D1 binding named **`DB`** in the Pages project's **Settings → Bindings** and select the database. Configure production and preview separately; use a separate preview database if preview data should be isolated.

3. Initialize the schema. For the Worker config with the binding added:

   ```sh
   npx wrangler d1 migrations apply DB --remote
   ```

   For a Pages dashboard binding, apply the same migration by database name:

   ```sh
   npx wrangler d1 execute touchgpt --remote --file=migrations/0001_initial.sql
   ```

   You can also execute the SQL in `migrations/0001_initial.sql` in the D1 dashboard console. It creates tables/indexes without dropping data. Do not apply only the first table; all statements are required.

4. Commit any Worker binding configuration and redeploy. On Pages, redeploy after binding/runtime changes.

5. Visit `/api/health` on the deployed HTTPS address. Ready storage reports `"storage":"d1"` and `"cloudReady":true`. `ok:true` alone confirms the API is responding, **not** that storage has been configured.

Passwords retain the Node version's salted scrypt hashing; cookies are HttpOnly/SameSite and Secure on HTTPS. Rate limits are stored in D1 across Worker instances. Cloud records remain user-scoped and read in bounded pages. Worker CPU budgets apply to password hashing; use a plan/budget adequate for scrypt rather than reducing password security if authentication hits CPU limits. These checks do not replace production load testing.

Existing `.data/touchgpt.sqlite` records and accounts are **not automatically copied to D1**. Keep that database backed up if migrating existing users/data.

## Optional AI photo identification

Set a **secret** named `TOUCHGPT_AI_KEY` in the deployed Worker's or Pages project's settings. For Workers, an authenticated terminal can use:

```sh
npx wrangler secret put TOUCHGPT_AI_KEY
```

Enter the key only in the secure secret prompt or Cloudflare settings, never in source control or chat. `OPENAI_MODEL` is an optional ordinary variable, defaulting to `gpt-4.1-mini`. D1-backed login must also work before AI identification is available. Photo identification is not tested against the live provider without a key.

## Validate before deploying

```sh
npm ci
npm test
npm run test:cloudflare  # builds/bundles and tests the actual Workers runtime with local D1
npm run check:pages     # compiles Pages Functions with nodejs_compat
npm run test:e2e        # browser workflows against the Node server
```

`npm run check:cloudflare` is a deploy **dry-run**, not a publication. It must report the files read from `dist` and the `ASSETS` binding. `npm run dev:cloudflare` starts the Worker and assets locally on port 8787; `npx wrangler pages dev dist --compatibility-date 2026-01-01 --compatibility-flags nodejs_compat` tests Pages locally. Local state lives under ignored `.wrangler/`.

After publication, check the home page, manifest/icons, demo → result → local history, and `/api/health`. With D1 configured, test registration, upload, reload, and cloud retrieval. Real phone microphone/motion/vibration tests require the published HTTPS origin; desktop synthetic-microphone tests do not validate physical material sensing.
