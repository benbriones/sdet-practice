# Learning Plan

Nine milestones that take this repo from "app with tests" to "every PR gets a tested preview environment on EC2". You write the infrastructure. From Milestone 2 on, each milestone is a list of small numbered steps. Each step says what to write and why, then gives a check that proves it works. The steps name each instruction and field, but you still type every file yourself.

## How to use this plan

- Do one milestone at a time, in order. Each one depends on the contracts of the one before.
- Inside a milestone, don't start a step until the previous step's check passes.
- Don't move on until every "Done when" box is true. A half-working layer turns every later failure into a guessing game.
- Commit at the end of each milestone, for example `feat: dockerfile with standalone output`.
- When you're stuck, run the milestone's debugging commands before searching. Most failures here show up clearly in `describe`, `events` or `logs`.
- Ask for a review by pasting your file, or say "review milestone N".

## Conventions used in every milestone

Pick these once and reuse them everywhere. Most "it deployed but I can't reach it" bugs are a name that differs between two files.

| Thing                              | Value                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| Image                              | `ghcr.io/<owner-lowercase>/sdet-cicd-lab:<40-char PR head SHA>`                           |
| Preview Application and namespace  | `preview-pr-<N>`                                                                          |
| Preview hostname                   | `pr-<N>.<domain>`, with domain `127.0.0.1.nip.io` on kind and `<public-ip>.nip.io` on EC2 |
| PR label that opts in to a preview | `preview`                                                                                 |
| App env vars                       | `APP_COMMIT_SHA`, `APP_ENVIRONMENT`                                                       |
| Test env vars                      | `BASE_URL`, `EXPECTED_COMMIT_SHA`                                                         |
| Health endpoint                    | `GET /api/health` → `{ status, commitSha, shortSha, environment }`                        |

## Tools by milestone

| Milestone | Install                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 2         | A Docker runtime: Docker Desktop or OrbStack. Give it at least 4 CPUs and 8 GB of memory, since kind and Argo CD come later. |
| 3         | `gh` (already installed), optionally `actionlint`                                                                            |
| 4         | `kind`, `kubectl`, `helm` (`brew install kind kubectl helm`), optionally `k9s`                                               |
| 5         | `argocd` CLI (`brew install argocd`)                                                                                         |
| 8         | AWS CLI v2 (`brew install awscli`), optionally the Session Manager plugin                                                    |

---

## Milestone 1: Local app and Playwright

### What you're learning

How this app exposes its identity (`/api/health`, the build badge) and how the Playwright suite switches between a local server and any remote URL. You'll also see why reproducible installs matter (`npm ci`, the lockfile, `.nvmrc`).

### Why it matters for an SDET

Every later stage leans on three contracts that already exist. Probes and CI read `/api/health`. `BASE_URL` points the same suite at any environment. `EXPECTED_COMMIT_SHA` proves you're testing the build you think you are. Testing the wrong build is the most expensive kind of false green.

### Files you'll create

None in the app. You'll create the GitHub repository.

### What to implement yourself

1. Read `src/lib/build-info.ts`, `src/app/api/health/route.ts`, `playwright.config.ts` and `e2e/build-info.spec.ts`. Be able to explain why the env vars aren't `NEXT_PUBLIC_*`.
2. Initialize git if needed (`git init -b main`), make the first commit, create a public GitHub repo and push.
   - Public is recommended. Standard Actions runners are free, a public GHCR package can be pulled without credentials, and arm64 runners are available.
   - The trade-off: never attach a self-hosted runner to a public repo without the Milestone 9 precautions, and never commit secrets.
3. Warm-up: add one test of your own, such as "ignores a blank task title". Use the same Arrange/Act/Assert shape.

### How to verify

```bash
npm ci
npm run lint && npm run typecheck && npm run build
npm run test:e2e

# Prove runtime env injection works without rebuilding
APP_COMMIT_SHA=abc1234def APP_ENVIRONMENT=pr-99 npm run start
curl -s localhost:3000/api/health          # in another terminal
```

Done when:

- [ ] All checks pass and the suite is green on the first try.
- [ ] `/api/health` reports `abc1234def` and the badge shows `pr-99 · abc1234`, with no rebuild.
- [ ] The repo is on GitHub with `main` pushed.

### Common mistakes and debugging

- **Port 3000 already in use.** Playwright then reuses whatever is running there, which may be a stale dev server. Check with `lsof -i :3000`.
- **"Executable doesn't exist" from Playwright.** The browser build doesn't match the installed Playwright version. Run `npx playwright install chromium`.
- **Moving the build info to `NEXT_PUBLIC_*`.** It looks fine locally, then every container reports the SHA from build time.

---

## Milestone 2: Docker

### What you're learning

- Multi-stage builds and how layer caching works.
- Next.js `output: "standalone"`.
- The difference between build args (`ARG`) and runtime env (`ENV`).
- Running as a non-root user.
- `.dockerignore`.
- Tagging images by commit.
- CPU architecture (your Mac is `arm64`; GitHub's default runners and t3 instances are `amd64`).

### Why it matters for an SDET

The image is the artifact under test. If you can read a Dockerfile, you can tell "the code is broken" from "the artifact differs from what I tested locally". That's a common source of works-on-my-machine bugs.

### Files you'll create

- `Dockerfile`
- `.dockerignore`
- An edit to `next.config.ts` to add `output: "standalone"`

### Steps

#### 2.1 Turn on standalone output

Add `output: "standalone"` to `next.config.ts` and run `npm run build`.

Look inside `.next/standalone/`. You'll find `server.js`, a `package.json`, a trimmed `node_modules` with only what the server imports, and a `.next` folder with the compiled server code. Two folders are missing on purpose, because Next.js assumes a CDN will serve them:

- `.next/static`: the JS and CSS chunks the browser downloads.
- `public/`: files served as-is, like `robots.txt`.

Your runner stage will have to copy both in.

**Check:** copy them in by hand and start the server the way the container will:

```bash
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/
PORT=3001 node .next/standalone/server.js
```

Open `localhost:3001` and add a task. `curl -s localhost:3001/api/health` from another terminal should return JSON. Stop the server with Ctrl+C.

#### 2.2 Install Docker

Install Docker Desktop (pick the Apple silicon build):
https://www.docker.com/products/docker-desktop/

Open it once to finish setup. Then go to Settings → Resources and set 4 CPUs and 8 GB of memory.

**Check:** `docker run --rm hello-world` prints "Hello from Docker!"

#### 2.3 Create `.dockerignore`

Docker sends the whole project folder, called the build context, to the builder before it runs a single step. `.dockerignore` decides what stays behind. Add one entry per line:

- `node_modules` and `.next`: your Mac's builds.
- `.git` and `.env*`: history isn't needed, and secrets never go in an image.
- `test-results`, `playwright-report` and `blob-report`: test output.
- `e2e` and `playwright.config.ts`: the tests run against the image, not inside it.
- `*.md`: the docs.
- `tsconfig.tsbuildinfo` and `next-env.d.ts`: generated files the build recreates.
- `.github`, `deploy` and `scripts`: folders you'll add in later milestones. Leaving them out means a workflow or chart edit doesn't rebuild the app.

This matters a lot here, because you have a local `node_modules` and `.next`. Without the ignore file, they'd overwrite the Linux versions inside the image. Packages like Tailwind's oxide and lightningcss ship a different native binary per platform, and yours are built for macOS on arm64.

**Check:** build a throwaway image that copies the context and lists it. The Dockerfile comes from stdin, so Docker uses your real context and ignore file:

```bash
docker build -q -t context-check -f- . <<'EOF'
FROM busybox
COPY . /ctx
CMD ["ls", "-A", "/ctx"]
EOF
docker run --rm context-check
docker rmi context-check
```

You should see `src`, `public`, the package files and the config files. None of the ignored entries should appear.

#### 2.4 Dockerfile, stage 1: deps

This stage installs dependencies in a way that stays cached. Write these four instructions:

1. `FROM` the `node:24-alpine` image, naming the stage `deps` with `AS deps`. Node 24 matches `.nvmrc`.
2. `WORKDIR /app`. Later paths are relative to it.
3. `COPY` only `package.json` and `package-lock.json` into `./`.
4. `RUN npm ci`.

The order matters. Docker caches each step, so step 4 only re-runs when the files from step 3 change. If you copied all the source first, every code edit would reinstall dependencies.

**Check:** `--target` builds only up to this stage:

```bash
docker build --target deps -t sdet-cicd-lab:deps .
docker run --rm sdet-cicd-lab:deps ls /app
```

You should see only `node_modules`, `package.json` and `package-lock.json`.

#### 2.5 Stage 2: builder

1. `FROM node:24-alpine AS builder`
2. `WORKDIR /app`
3. `COPY --from=deps` the `/app/node_modules` folder into `./node_modules`.
4. `COPY . .` to bring in everything else. `.dockerignore` decides what "everything" means.
5. `RUN npm run build`

Each stage starts from a clean image, so step 3 is how the installed packages cross over. Optional: `ENV NEXT_TELEMETRY_DISABLED=1` before the build stops Next.js from sending usage data.

**Check:**

```bash
docker build --target builder -t sdet-cicd-lab:builder .
docker run --rm sdet-cicd-lab:builder ls -A .next/standalone
```

You should see `.next`, `node_modules`, `package.json` and `server.js`, the same as in 2.1.

#### 2.6 Stage 3: runner

This is the only stage that ships. It holds the standalone server and nothing else: no source, no dev dependencies, no compiler.

1. `FROM node:24-alpine AS runner`
2. `WORKDIR /app`
3. `ENV` three values: `NODE_ENV=production`, `PORT=3000` and `HOSTNAME=0.0.0.0`. Docker and Kubernetes set `HOSTNAME` to the container name, and `server.js` binds to whatever `HOSTNAME` says. Overwrite it so the server listens on every interface.
4. `COPY --from=builder --chown=node:node` three times:
   - `/app/.next/standalone` into `./`
   - `/app/.next/static` into `./.next/static`
   - `/app/public` into `./public`
5. `USER node`. The Node image already includes this non-root user, with uid 1000. The `--chown` in step 4 lets it write the server's cache folder.
6. `EXPOSE 3000`. This only documents the port; `docker run -p` still does the publishing.
7. `CMD ["node", "server.js"]`. Use this JSON form, not `CMD node server.js`. It makes `node` process 1, so it receives the stop signal and `docker stop` or Ctrl+C ends it at once.

**Check:** build the whole image and run the suite against it. No commit is baked in yet, so the app reports `dev`, which is also the test's default:

```bash
docker build -t sdet-cicd-lab:dev .
docker run --rm -p 3000:3000 sdet-cicd-lab:dev

# another terminal
curl -s localhost:3000/api/health
BASE_URL=http://localhost:3000 npm run test:e2e
```

All 5 tests should pass. Ctrl+C in the first terminal should stop the container within a second.

#### 2.7 Bake in the commit

Add three instructions to the runner stage, after the `COPY` lines:

1. `ARG COMMIT_SHA=unknown`. An `ARG` only exists in the stage that declares it, so it goes here, not at the top of the file.
2. `ENV APP_COMMIT_SHA=$COMMIT_SHA`. This turns the build-time value into a runtime default that `docker run -e` can still override.
3. `LABEL org.opencontainers.image.revision=$COMMIT_SHA`. Registries and scanners read this label.

Put them late on purpose. A changed `ARG` value invalidates every step after it. Near the end, a new SHA only rebuilds these tiny metadata layers.

**Check:**

```bash
docker build --build-arg COMMIT_SHA=test123 -t sdet-cicd-lab:dev .
docker run --rm sdet-cicd-lab:dev env | grep APP_
docker image inspect sdet-cicd-lab:dev --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

Both should print `test123`.

#### 2.8 Commit, then build and tag by SHA

An image built from uncommitted changes carries a SHA that doesn't describe its contents. Commit first, and confirm the tree is clean:

```bash
git add Dockerfile .dockerignore next.config.ts
git commit -m "feat: dockerfile with standalone output"
git status --short                     # must print nothing
SHA=$(git rev-parse HEAD)
docker build --build-arg COMMIT_SHA=$SHA -t sdet-cicd-lab:$SHA .
```

Never tag with only `latest`. It can point at any build, so a test result for `latest` doesn't say which code it tested.

**Check:** `docker image ls sdet-cicd-lab` lists a tag equal to `git rev-parse HEAD`.

#### 2.9 Run the suite against the container

```bash
docker run --rm -p 3000:3000 -e APP_ENVIRONMENT=docker sdet-cicd-lab:$SHA

# another terminal; a new shell doesn't have SHA set
SHA=$(git rev-parse HEAD)
curl -s localhost:3000/api/health
BASE_URL=http://localhost:3000 EXPECTED_COMMIT_SHA=$SHA npm run test:e2e
```

**Check:** the health JSON shows your SHA and `"environment":"docker"`, and all 5 tests pass, including `serves the expected commit`.

#### 2.10 Prove the SHA is read at runtime

Stop the container and start it again with an override:

```bash
docker run --rm -p 3000:3000 -e APP_COMMIT_SHA=override sdet-cicd-lab:$SHA
curl -s localhost:3000/api/health      # another terminal
```

**Check:** `commitSha` is `override`. It's the same image with a different value and no rebuild. That's what lets one image move through every environment.

#### 2.11 Check the user, architecture and size

```bash
docker run --rm --entrypoint id sdet-cicd-lab:$SHA
docker image inspect sdet-cicd-lab:$SHA --format '{{.Architecture}}'
docker image ls sdet-cicd-lab
```

**Check:**

- `id` prints `uid=1000(node)`, not `uid=0(root)`.
- The architecture is `arm64`, your Mac's. GitHub's default runners and t3 instances are `amd64`; Milestone 3 builds both.
- The image is about 250 MB or less.

#### 2.12 Prove the cache works

Add a comment to any file under `src/`, then rebuild with the full log:

```bash
docker build --progress=plain --build-arg COMMIT_SHA=$SHA -t sdet-cicd-lab:cache-test .
```

**Check:** the `RUN npm ci` step shows `CACHED`, and `npm run build` runs again. Next, revert that edit and change a file under `e2e/` instead, then rebuild. This time every step should show `CACHED`, because `e2e` isn't in the context. Revert both edits afterward.

### Done when

- [ ] All 5 tests pass against the container, including `serves the expected commit`.
- [ ] The container runs as a non-root user.
- [ ] Rebuilding after a source-only change reuses the cached `npm ci` layer.
- [ ] `docker run -e APP_COMMIT_SHA=override …` changes the reported SHA. That proves the value is read at runtime.
- [ ] The image is roughly 250 MB or less. Check `docker image ls`.

### Common mistakes and debugging

- **The page renders but buttons do nothing, and tests time out on the disabled input.** The JS chunks returned 404 because `.next/static` wasn't copied into the runner, so React never hydrated. Open DevTools → Network, or `curl -I` a `/_next/static/...` URL.
- **`ARG` declared in one stage and used in another.** An `ARG` is scoped to the stage that declares it. Declare it again where you use it.
- **The server listens on the wrong address.** Docker and Kubernetes set `HOSTNAME` to the container or pod name, and `server.js` binds to it. Then `localhost` inside the container fails, and in Milestone 4 `kubectl port-forward` fails too. Set `HOSTNAME=0.0.0.0` yourself.
- **Copying your Mac's `node_modules` into the image.** Native binaries (Tailwind's oxide, lightningcss) are platform-specific. A `Cannot find module '...-linux-arm64-musl'` error usually means this. That's what `.dockerignore` prevents.
- **`npm install` instead of `npm ci`.** The build stops being reproducible.
- **`port is already allocated`.** A dev server, `npm run start` or an old container holds port 3000. Check `lsof -i :3000` and `docker ps`.

Debugging commands:

```bash
docker build --progress=plain --no-cache .          # full build log
docker run --rm -it --entrypoint sh sdet-cicd-lab:$SHA   # poke around inside
docker history sdet-cicd-lab:$SHA                   # what each layer added
docker inspect sdet-cicd-lab:$SHA --format '{{json .Config.Env}}'
docker logs <container-id>
```

---

## Milestone 3: GitHub Actions

### What you're learning

- Workflow triggers, jobs and `needs`.
- Least-privilege `permissions` for `GITHUB_TOKEN`.
- `concurrency` groups.
- Dependency and Docker layer caching.
- Artifacts.
- Buildx multi-platform builds.
- Pushing to GHCR.
- The difference between a PR's head commit and its merge commit.

### Why it matters for an SDET

CI turns tests into a merge gate. Owning that gate means owning its speed (caching), its trustworthiness (no retries hiding flakes, artifacts for every failure) and its correctness (testing the right commit).

### Files you'll create

- `.github/workflows/pr.yml`: one workflow, so later jobs can depend on earlier ones through `needs`.
- An edit to `playwright.config.ts`: add the `github` reporter when `CI` is set.

### Steps

#### 3.1 Get the CLI tools ready

```bash
gh auth status          # want "Logged in to github.com"
brew install actionlint
```

If `gh` says you're not logged in, run `gh auth login` and pick GitHub.com, HTTPS and the browser login.

Pin every action to a major version. These were the current majors when this plan was written. Check each action's releases page for a newer one.

| Action                       | Version |
| ---------------------------- | ------- |
| `actions/checkout`           | `v7`    |
| `actions/setup-node`         | `v7`    |
| `actions/upload-artifact`    | `v7`    |
| `docker/login-action`        | `v4`    |
| `docker/setup-qemu-action`   | `v4`    |
| `docker/setup-buildx-action` | `v4`    |
| `docker/build-push-action`   | `v7`    |

**Check:** `gh repo view --json nameWithOwner` prints your repo.

#### 3.2 Add the GitHub reporter

In `playwright.config.ts`, make `reporter` depend on `process.env.CI`:

- In CI: `["github"]` and `["html", { open: "never" }]`. The `github` reporter turns each failure into an annotation on the PR's changed lines.
- Locally: keep `["list"]` and the `html` reporter.

**Check:** `npm run typecheck` passes. The real proof comes in 3.9, when a failing test shows up on the PR.

#### 3.3 Workflow skeleton

Create `.github/workflows/pr.yml` with these top-level keys:

1. `name: pr`
2. `on:`
   - `pull_request` with `types: [opened, synchronize, reopened, labeled]`. `synchronize` is a new push to the PR. `labeled` makes adding the `preview` label start a run.
   - `push` with `branches: [main]`.
3. `concurrency:`
   - `group: pr-${{ github.event.pull_request.number || github.ref }}`. A push to main has no PR number, so it falls back to the branch.
   - `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. A new push to a PR cancels the stale run, and runs on main always finish.
4. `permissions:` with `contents: read`. Every job gets only this unless it asks for more.
5. `jobs:`, filled in next.

Adding any label also starts a run and cancels the current one. That's expected.

#### 3.4 The checks job

One expression decides which commit every job tests. Getting it wrong breaks Milestone 6:

```yaml
${{ github.event.pull_request.head.sha }}   # the commit you pushed, which Argo CD calls head_sha
${{ github.sha }}                           # on pull_request: a temporary merge commit, so don't tag with it
```

Add a job called `checks`:

1. `runs-on: ubuntu-24.04` and `timeout-minutes: 15`. Without a timeout, a hung step can run for 6 hours.
2. Steps, in order:
   1. `actions/checkout` with `ref: ${{ github.event.pull_request.head.sha || github.sha }}`. On a PR that's the commit you pushed. On a push to main it's the pushed commit.
   2. `actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`. The cache holds npm's downloads, keyed on the lockfile.
   3. `run: npm ci`
   4. Three separate steps: `npm run lint`, `npm run typecheck` and `npm run build`. Separate steps make the failing one obvious in the run view.
   5. `run: npx playwright install --with-deps chromium`. `--with-deps` also installs the Linux libraries Chromium needs.
   6. `run: npm run test:e2e`. `BASE_URL` is unset, so Playwright's `webServer` builds and starts the app itself. That's a second build, which is fine for now.
   7. `actions/upload-artifact` with:
      - `if: ${{ !cancelled() }}`. It runs after a failure too, but not after a cancel. `always()` would also upload half-finished runs.
      - `name: playwright-report`
      - `path:` both `playwright-report/` and `test-results/`, one per line.
      - `retention-days: 7`

**Check:** lint the file, then push a branch and open a PR:

```bash
actionlint
git switch -c ci/pr-workflow
git add .github playwright.config.ts
git commit -m "feat: pr workflow with checks job"
git push -u origin ci/pr-workflow
gh pr create --fill
gh pr checks --watch
```

`checks` should go green. Keep this PR open for the next steps.

#### 3.5 The image job

Add a second job called `image`:

1. `needs: checks`, `runs-on: ubuntu-24.04` and `timeout-minutes: 30`.
2. `permissions:` with `contents: read` and `packages: write`. A job-level block replaces the workflow default, so list both.
3. Job-level `env:` with `SHA: ${{ github.event.pull_request.head.sha || github.sha }}`. Every step uses this one value.
4. Steps:
   1. `actions/checkout` with `ref: ${{ env.SHA }}`.
   2. A `run` step that sets the image name in lowercase: `echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"`. Later steps read it as `$IMAGE` or `${{ env.IMAGE }}`.
   3. `docker/login-action` with `registry: ghcr.io`, `username: ${{ github.actor }}` and `password: ${{ secrets.GITHUB_TOKEN }}`.
   4. `docker/setup-qemu-action`, then `docker/setup-buildx-action`. QEMU lets the amd64 runner build the arm64 image.
   5. `docker/build-push-action` with:
      - `context: .`. Without it, the action fetches the repo itself at the PR's merge commit and ignores your checkout.
      - `platforms: linux/amd64,linux/arm64`
      - `push: true`
      - `tags: ${{ env.IMAGE }}:${{ env.SHA }}`. One tag, nothing else.
      - `build-args: COMMIT_SHA=${{ env.SHA }}`
      - `labels: org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}`. This links the package to the repo.
      - `cache-from: type=gha` and `cache-to: type=gha,mode=max`. `mode=max` also caches the `deps` and `builder` stages, not only the final one.

**Check:**

```bash
actionlint
git add .github && git commit -m "feat: build and push image to ghcr" && git push
gh pr checks --watch
```

`image` goes green after `checks`. The first arm64 build is slow; later ones hit the cache. The package now shows under your GitHub profile → Packages.

#### 3.6 Make the package public

New packages start private. Open your profile → Packages → `sdet-cicd-lab` → Package settings:

1. Under "Danger Zone", choose Change visibility → Public.
2. Check that the package page shows your repo. If it doesn't, use "Connect repository" there.

**Check:** pull the image with no credentials, then test what you pulled:

```bash
SHA=$(git rev-parse HEAD)
docker logout ghcr.io
docker buildx imagetools inspect ghcr.io/<owner>/sdet-cicd-lab:$SHA   # lists linux/amd64 and linux/arm64
docker pull ghcr.io/<owner>/sdet-cicd-lab:$SHA
docker run --rm -p 3000:3000 ghcr.io/<owner>/sdet-cicd-lab:$SHA

# another terminal
BASE_URL=http://localhost:3000 EXPECTED_COMMIT_SHA=$(git rev-parse HEAD) npm run test:e2e
```

The tag must equal `git rev-parse HEAD` on your branch, and all 5 tests pass.

#### 3.7 Immutability guard

A published tag should never change, so a re-run must not overwrite it.

1. Add a step right after the login, with `id: exists`. It runs `docker buildx imagetools inspect "$IMAGE:$SHA"`, which exits non-zero when the tag doesn't exist.
   - If it succeeds, write `found=true` to `$GITHUB_OUTPUT` and print `::notice::$IMAGE:$SHA already exists, skipping build`.
   - If it fails, write `found=false`.
2. Add `if: steps.exists.outputs.found != 'true'` to the QEMU, Buildx and build steps.

Wrap the inspect in `if ...; then ...; else ...; fi`. Actions runs bash with `-e`, so a bare failing command would fail the step.

**Check:** re-run the last workflow:

```bash
gh run list --workflow pr.yml --limit 1
gh run rerun <run-id>
gh run watch <run-id>
```

The `image` job passes, its build steps show as skipped, and the notice appears on the run's summary page.

#### 3.8 Protect main

Settings → Rules → Rulesets → New ruleset → New branch ruleset:

1. Name it `main` and set Enforcement status to Active.
2. Under Target branches, choose Add target → Include default branch.
3. Turn on "Require a pull request before merging". Set required approvals to 0, since you're working alone.
4. Turn on "Require status checks to pass" → Add checks → type `checks` and pick it. It only shows up after it has run once.
5. Keep "Block force pushes" on. Leave the bypass list empty.

**Check:** `gh api repos/<owner>/sdet-cicd-lab/rules/branches/main` lists a `pull_request` rule and a `required_status_checks` rule.

#### 3.9 Prove the pipeline behaves

1. **Cancel.** Push twice quickly:

   ```bash
   git commit --allow-empty -m "wip: cancel test 1" && git push
   git commit --allow-empty -m "wip: cancel test 2" && git push
   gh run list --workflow pr.yml --limit 3
   ```

   The older run shows as cancelled.

2. **Failure.** Change an expected value in `e2e/tasks.spec.ts` so a test fails, then push. The run goes red, and the PR's Files changed tab shows the failure on that line. Open the report:

   ```bash
   gh run download <run-id> -n playwright-report -D /tmp/pr-report
   npx playwright show-report /tmp/pr-report/playwright-report
   ```

   Revert the change and push again.

3. **Merge.** Once the PR is green, run `gh pr merge --squash --delete-branch`. The push to main builds an image tagged with main's new SHA. Milestone 5 deploys it.

### Done when

- [ ] On a PR, `checks` and `image` both pass.
- [ ] The GHCR tag equals the PR head SHA, lists amd64 and arm64, and pulls without logging in.
- [ ] The pulled image passes the suite with `EXPECTED_COMMIT_SHA`.
- [ ] A second quick push cancels the first run.
- [ ] A re-run skips the build because the tag already exists.
- [ ] A broken test turns the run red, is annotated on the PR, and leaves a report you can open.
- [ ] `main` only accepts changes through a PR with `checks` passing.

### Common mistakes and debugging

- **`denied: permission_denied: write_package`.** The image job is missing `packages: write`.
- **`repository name must be lowercase`.** The owner name has capitals.
- **Image tag doesn't match your commit.** You used `github.sha` or checked out the merge ref.
- **The tag is right but the image runs other code.** `build-push-action` has no `context: .`, so it built the merge commit.
- **Artifacts missing on failure.** The upload step only ran on success.
- **Missing shared libraries when browsers launch on Ubuntu.** You installed browsers without `--with-deps`.
- **arm64 build takes 10+ minutes.** QEMU emulation is slow. Use the GHA cache, or later split the build across native `ubuntu-24.04-arm` and amd64 runners.
- **Actions pinned to `@main`.** Pin to a major version, or to a full SHA for third-party actions.

Debugging commands:

```bash
gh run list --workflow pr.yml
gh run watch
gh run view <run-id> --log-failed
gh run rerun <run-id> --failed
gh run download <run-id> -n playwright-report
gh pr checks
actionlint                                   # lints workflow files locally
gh auth refresh -s read:packages && gh api /user/packages/container/sdet-cicd-lab/versions
```

To get verbose step logs, set the repo secret `ACTIONS_STEP_DEBUG=true` and re-run.

---

## Milestone 4: Local Kubernetes with kind

### What you're learning

- Clusters, nodes, pods and namespaces.
- Deployments and ReplicaSets.
- Services, labels and selectors.
- Ingress and ingress controllers.
- Readiness and liveness probes.
- Resource requests and limits.
- Image pull behavior.
- Helm templating.
- kind's port mapping from your Mac into the cluster.

### Why it matters for an SDET

A preview environment is just Kubernetes objects. When an E2E run fails on a preview, you need to tell an app bug from an infrastructure one in minutes. The usual infrastructure suspects are a pod that never became Ready, a crash loop, the wrong image, or an ingress returning a 404 or 503.

### Files you'll create

- `deploy/kind/cluster.yaml`: a single node with `extraPortMappings` that sends host port 80 into the cluster.
- `deploy/kind/traefik-values.yaml`: Traefik as a NodePort service on the mapped port.
- `deploy/chart/`, a Helm chart:
  - `Chart.yaml`, `values.yaml`
  - `templates/deployment.yaml`, `templates/service.yaml`, `templates/ingress.yaml`

Older tutorials use ingress-nginx, which the Kubernetes project has retired. Use Traefik: k3s ships it by default, so your kind and EC2 setups will match.

### Steps

#### 4.1 Install the tools

```bash
brew install kind kubectl helm
brew install k9s        # optional terminal UI for watching the cluster
```

**Check:** `kind version`, `kubectl version --client` and `helm version` each print a version.

#### 4.2 Cluster config

Write `deploy/kind/cluster.yaml`:

1. `kind: Cluster` and `apiVersion: kind.x-k8s.io/v1alpha4`.
2. `nodes:` with a single entry, `role: control-plane`.
3. On that node, `extraPortMappings` with one entry:
   - `containerPort: 30080`
   - `hostPort: 80`
   - `listenAddress: "127.0.0.1"`, so the cluster isn't reachable from your Wi-Fi network.
   - `protocol: TCP`

Why: the kind "node" is a Docker container. This mapping sends your Mac's port 80 into it on port 30080. Kubernetes allows NodePorts from 30000 to 32767, and Traefik will listen on 30080 in 4.3.

Create the cluster:

```bash
kind create cluster --name sdet-lab --config deploy/kind/cluster.yaml
```

**Check:**

```bash
kubectl config current-context                # kind-sdet-lab
kubectl get nodes                             # one node, STATUS Ready
docker ps --format '{{.Names}}  {{.Ports}}'   # 127.0.0.1:80->30080/tcp
```

#### 4.3 Install Traefik

Add the chart repo and find the keys you need:

```bash
helm repo add traefik https://traefik.github.io/charts
helm repo update
helm search repo traefik/traefik                  # note the CHART VERSION
helm show values traefik/traefik | grep -n -i -A2 'nodePort\|^service:'
```

In chart v42 the two keys are `service.spec.type` and `ports.web.nodePort`. Older tutorials use `service.type`, which this chart's schema rejects.

Write `deploy/kind/traefik-values.yaml` with:

1. `service.spec.type: NodePort`
2. `ports.web.nodePort: 30080`

Install it, pinning the chart version you noted:

```bash
helm install traefik traefik/traefik -n traefik --create-namespace \
  --version <chart-version> -f deploy/kind/traefik-values.yaml
```

**Check:**

```bash
kubectl get pods -n traefik         # 1/1 Running
kubectl get svc -n traefik          # TYPE NodePort, PORT(S) include 80:30080/TCP
kubectl get ingressclass            # traefik
curl -i http://127.0.0.1/           # 404 page not found
```

The 404 is the good result: Traefik answered and has no routes yet. `Failed to connect` means the port mapping or the NodePort is wrong.

#### 4.4 Chart skeleton

Skip `helm create`; it generates a lot of files that hide the parts you need. Make these by hand.

`deploy/chart/Chart.yaml`: `apiVersion: v2`, `name: sdet-cicd-lab`, `type: application` and `version: 0.1.0`.

`deploy/chart/values.yaml`:

```yaml
image:
  repository: ghcr.io/<owner>/sdet-cicd-lab
  tag: "" # required; always a commit SHA
environment: local-k8s
replicaCount: 1
ingress:
  host: "" # required
```

Two rules for every template:

- Name every resource `{{ .Release.Name }}`.
- Give every resource, and the pod template, the same two labels: `app.kubernetes.io/name: sdet-cicd-lab` and `app.kubernetes.io/instance: {{ .Release.Name }}`. The second label stops two releases in one cluster from selecting each other's pods.

#### 4.5 Deployment template

Write `templates/deployment.yaml`:

1. `apiVersion: apps/v1` and `kind: Deployment`, with `metadata.name` and the two labels.
2. `spec.replicas: {{ .Values.replicaCount }}`.
3. `spec.strategy`: `type: RollingUpdate`, with `rollingUpdate.maxUnavailable: 0` and `maxSurge: 1`. A new pod must be Ready before an old one stops.
4. `spec.selector.matchLabels` and `spec.template.metadata.labels`: the two labels. They must match exactly.
5. One container named `app`:
   - `image: "{{ .Values.image.repository }}:{{ required "image.tag is required" .Values.image.tag }}"`
   - `imagePullPolicy: IfNotPresent`. Tags are immutable SHAs, so a cached copy is always the right one.
   - `ports`: `containerPort: 3000` with `name: http`.
   - `env`: `APP_ENVIRONMENT` set to `{{ .Values.environment | quote }}`. Don't set `APP_COMMIT_SHA`. The image already carries the true value, and a chart value could lie.
   - `readinessProbe`: `httpGet` with `path: /api/health` and `port: http`, plus `periodSeconds: 5` and `failureThreshold: 3`.
   - `livenessProbe`: the same `httpGet`, with `periodSeconds: 10` and `failureThreshold: 3`. A failed liveness probe restarts the container, so make it slower to fire than readiness.
   - `resources`: requests of `cpu: 50m` and `memory: 128Mi`, and a limit of `memory: 256Mi`. A CPU limit throttles the app under load, so most teams set only the memory limit.
   - `securityContext`: `runAsNonRoot: true`, `runAsUser: 1000` and `allowPrivilegeEscalation: false`. You need `runAsUser` because the image says `USER node`, a name, and Kubernetes can only check a numeric user.

**Check:**

```bash
helm lint deploy/chart
helm template local deploy/chart --set image.tag=abc --set ingress.host=x | less
helm template local deploy/chart          # must fail with "image.tag is required"
```

#### 4.6 Service and Ingress templates

`templates/service.yaml`:

1. `apiVersion: v1`, `kind: Service`, the name and the two labels.
2. `type: ClusterIP`.
3. `selector`: the two labels.
4. One port: `port: 80` with `targetPort: http`. Naming the target port means it follows the container if the number changes.

`templates/ingress.yaml`:

1. `apiVersion: networking.k8s.io/v1`, `kind: Ingress`, the name and the two labels.
2. `spec.ingressClassName: traefik`.
3. One rule with `host: {{ required "ingress.host is required" .Values.ingress.host }}`.
4. Under it, one path: `path: /` and `pathType: Prefix`, with the backend `service.name: {{ .Release.Name }}` and `service.port.number: 80`.

**Check:**

```bash
helm lint deploy/chart
helm template local deploy/chart --set image.tag=abc \
  --set ingress.host=local.127.0.0.1.nip.io | grep '^kind:'
```

You should see `Service`, `Deployment` and `Ingress`.

#### 4.7 Deploy your local image

kind can't see the images in your Mac's Docker, so load one into the node. Build it for your current commit first, as in 2.8:

```bash
SHA=$(git rev-parse HEAD)
docker build --build-arg COMMIT_SHA=$SHA -t sdet-cicd-lab:$SHA .
kind load docker-image sdet-cicd-lab:$SHA --name sdet-lab

helm upgrade --install local deploy/chart -n preview-local --create-namespace \
  --set image.repository=sdet-cicd-lab --set image.tag=$SHA \
  --set environment=local-k8s --set ingress.host=local.127.0.0.1.nip.io
kubectl rollout status deploy/local -n preview-local --timeout=120s
```

**Check:**

```bash
kubectl get pods -n preview-local                   # 1/1 Running
curl -s http://local.127.0.0.1.nip.io/api/health
BASE_URL=http://local.127.0.0.1.nip.io EXPECTED_COMMIT_SHA=$SHA npm run test:e2e
```

#### 4.8 Deploy the GHCR image

Switch the same release to the image CI built for main in 3.9. The node is arm64 and the image is multi-arch, so it pulls the arm64 variant.

```bash
git fetch && GHCR_SHA=$(git rev-parse origin/main)
helm upgrade --install local deploy/chart -n preview-local \
  --set image.repository=ghcr.io/<owner>/sdet-cicd-lab --set image.tag=$GHCR_SHA \
  --set environment=local-k8s --set ingress.host=local.127.0.0.1.nip.io
kubectl rollout status deploy/local -n preview-local --timeout=180s
```

**Check:** `/api/health` reports `$GHCR_SHA`, `kubectl get rs -n preview-local` shows a new ReplicaSet with the old one scaled to 0, and the suite passes with `EXPECTED_COMMIT_SHA=$GHCR_SHA`.

#### 4.9 Delete a pod with no dropped requests

Scale to two pods, then send a request every 0.2 seconds while you delete one:

```bash
helm upgrade local deploy/chart -n preview-local --reuse-values --set replicaCount=2
kubectl rollout status deploy/local -n preview-local

# terminal 1: one status code per request
while true; do curl -s -o /dev/null -w '%{http_code}\n' http://local.127.0.0.1.nip.io/api/health; sleep 0.2; done

# terminal 2
kubectl get pods -n preview-local
kubectl delete pod -n preview-local <one-pod-name>
```

**Check:** terminal 1 prints only `200`. If a few `502`s appear, the pod quit before Traefik stopped sending it traffic. Add a `lifecycle.preStop` with `sleep: { seconds: 5 }` to the container, upgrade, and try again.

#### 4.10 Break readiness on purpose

Keep the curl loop running. Point the readiness probe at a path that returns 404:

```bash
kubectl patch deploy/local -n preview-local --type=json \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/nope"}]'
kubectl get pods -n preview-local -w
```

**Check:**

- A new pod shows `0/1 Running` and never turns Ready.
- The old pods stay `1/1`, and the curl loop keeps printing `200`.
- `kubectl describe pod -n preview-local <new-pod>` shows `Readiness probe failed` with status code 404 under Events.

Undo it with `kubectl rollout undo deploy/local -n preview-local`.

### Done when

- [ ] The suite passes against the nip.io URL.
- [ ] `kubectl delete pod` on a running pod causes no failed requests while a replacement starts, with `replicaCount=2`.
- [ ] Changing `image.tag` to a new SHA rolls out, and `/api/health` reports it.
- [ ] Pointing the readiness probe at a bad path keeps the new pod un-Ready while the old one keeps serving. Undo it afterward.

### Common mistakes and debugging

- **Ingress returns 503 or `no available server`.** The Service selector doesn't match the pod labels, so there are no endpoints. Check `kubectl get endpointslices -n <ns>`.
- **Ingress returns 404.** The Host doesn't match, or `ingressClassName` is missing.
- **`ErrImagePull` or `ImagePullBackOff`:**
  - The GHCR package is private.
  - The tag doesn't exist.
  - It's a single-arch amd64 image on an arm64 kind node: `no match for platform in manifest`.
  - A locally loaded image with `imagePullPolicy: Always`, or tagged `latest`, which makes Kubernetes pull every time.
- **`CreateContainerConfigError` about a non-numeric user.** `runAsNonRoot` is set without `runAsUser: 1000`.
- **Pod is `Running` but never `Ready`.** Wrong probe path or port, or the server isn't bound to `0.0.0.0`.
- **`kubectl port-forward` fails while the Service works.** The app bound to the pod hostname, not `0.0.0.0`.
- **nip.io doesn't resolve.** Some routers and DNS filters drop answers that point at private IPs. Test with `dig local.127.0.0.1.nip.io`.
- **Port 80 is taken on your Mac.** Map host port 8080 instead and add `:8080` to the URLs.

Debugging commands:

```bash
kubectl get all -n preview-local
kubectl describe pod -n preview-local <pod>          # read Events at the bottom first
kubectl get events -n preview-local --sort-by=.lastTimestamp
kubectl logs -n preview-local deploy/<name> --previous   # logs from the crashed container
kubectl port-forward -n preview-local svc/<name> 3000:80  # skip the ingress
kubectl run curl -n preview-local --rm -it --image=curlimages/curl -- sh   # test from inside
kubectl logs -n traefik deploy/traefik
kubectl explain deployment.spec.template.spec.containers.readinessProbe
```

---

## Milestone 5: Argo CD and GitOps

### What you're learning

- The GitOps model: Git holds the desired state and a controller reconciles the cluster to it.
- Argo CD's parts: the API server, repo server, application controller and ApplicationSet controller.
- The `Application` resource: source, destination, sync policy, prune and self-heal.
- Sync status versus health status.
- How Argo CD renders Helm: it runs `helm template`, so `helm list` shows nothing.

### Why it matters for an SDET

In a GitOps shop, a deploy is a Git change plus reconciliation. "Is the environment ready to test?" becomes "is the Application Synced and Healthy at the revision I expect?" Reading drift, sync errors and health is how you stop blaming tests for deploys that never landed.

### Files you'll create

- `deploy/argocd/staging.yaml`: an `Application` that deploys `deploy/chart` from `main` into a `staging` namespace at `staging.127.0.0.1.nip.io`.
- `deploy/envs/staging/values.yaml`: the image tag and settings for staging.

### Steps

#### 5.1 Pick a version and install the CLI

```bash
brew install argocd
gh release view --repo argoproj/argo-cd --json tagName -q .tagName    # for example v3.6.1
```

Write that version down. You'll install the same one on EC2 in Milestone 8.

**Check:** `argocd version --client` prints a version.

#### 5.2 Install Argo CD into kind

Pin the release tag; don't use `stable`, which changes under you. Use server-side apply, because the CRDs are too large for client-side apply's annotation:

```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/<version>/manifests/install.yaml
```

**Check:** `kubectl get pods -n argocd -w` until every pod is `Running` and Ready. You should see the application controller, the ApplicationSet controller, dex, notifications, redis, the repo server and the server.

#### 5.3 Log in

Reach the UI and API through a port-forward. Never expose them through the ingress.

```bash
# terminal 1, leave it running
kubectl port-forward svc/argocd-server -n argocd 8080:443

# terminal 2
argocd admin initial-password -n argocd
argocd login localhost:8080 --username admin --insecure
argocd account update-password
kubectl delete secret argocd-initial-admin-secret -n argocd
```

Open `https://localhost:8080`, accept the self-signed certificate warning, and log in as `admin`.

**Check:** `argocd app list` prints an empty table, not an error.

#### 5.4 Staging values

Find a SHA that CI has already pushed, such as the main build from 3.9:

```bash
git fetch && git rev-parse origin/main
docker buildx imagetools inspect ghcr.io/<owner>/sdet-cicd-lab:<sha>    # must exist
```

Write `deploy/envs/staging/values.yaml` with only what differs from the chart defaults:

1. `image.tag`: that SHA.
2. `environment: staging`
3. `ingress.host: staging.127.0.0.1.nip.io`

#### 5.5 The staging Application

Write `deploy/argocd/staging.yaml`:

1. `apiVersion: argoproj.io/v1alpha1` and `kind: Application`.
2. `metadata`: `name: staging`, `namespace: argocd`, and `finalizers` with `resources-finalizer.argocd.argoproj.io`. The finalizer makes deleting the Application also delete what it deployed.
3. `spec.project: default`.
4. `spec.source`:
   - `repoURL: https://github.com/<owner>/sdet-cicd-lab.git`
   - `targetRevision: main`
   - `path: deploy/chart`
   - `helm.valueFiles` with one entry, `../envs/staging/values.yaml`. The path is relative to `path`.
5. `spec.destination`: `server: https://kubernetes.default.svc`, the cluster Argo CD runs in, and `namespace: staging`.
6. `spec.syncPolicy`:
   - `automated` with `prune: true` and `selfHeal: true`.
   - `syncOptions` with `CreateNamespace=true`.

Argo CD reads Git, not your disk. Commit the chart, the values file and the Application, and merge them to main through a PR (the ruleset requires one). Then apply the Application once by hand:

```bash
kubectl apply -f deploy/argocd/staging.yaml
argocd app get staging
```

**Check:**

- `argocd app get staging` shows Sync Status `Synced` and Health Status `Healthy`.
- `curl -s http://staging.127.0.0.1.nip.io/api/health` shows `"environment":"staging"` and the SHA from 5.4.
- `kubectl get deploy -n staging` shows a Deployment called `staging`. Argo CD uses the Application name as the Helm release name.

#### 5.6 Deploy by Git commit

1. Pick a newer main SHA that has an image. Merging any small PR gives you one.
2. Change `image.tag` in `deploy/envs/staging/values.yaml` through a PR, and merge it.
3. Ask Argo CD to look now instead of waiting for its 3-minute poll:

   ```bash
   argocd app get staging --refresh
   kubectl get rs -n staging -w      # new ReplicaSet scales up, old one scales to 0
   ```

**Check:** `/api/health` reports the new SHA, the suite passes against staging with `EXPECTED_COMMIT_SHA` set to it, and `argocd app history staging` lists both revisions.

#### 5.7 Drift and self-heal

Change the live cluster behind Argo CD's back, three ways:

```bash
kubectl scale deploy/staging -n staging --replicas=3
kubectl set env deploy/staging -n staging APP_ENVIRONMENT=hacked
kubectl delete deploy staging -n staging
```

Run one at a time, and watch `kubectl get pods -n staging -w` after each.

**Check:** each change is reverted within seconds. Argo CD scales back to 1, rolls back to `environment: staging`, and recreates the Deployment. The UI's app events show each automatic sync.

#### 5.8 Stretch: promote through Git from CI

On push to `main`, after `image` succeeds, have CI commit the new SHA into `deploy/envs/staging/values.yaml`. That's image promotion through Git.

- Pushes made with `GITHUB_TOKEN` don't start new workflow runs, so the commit can't loop. A personal access token would.
- The ruleset blocks direct pushes to main, so the job has to open a PR, or you add a narrow bypass.

### Done when

- [ ] Changing the tag in Git, and nothing else, updates staging.
- [ ] Manual drift is reverted without you touching it.
- [ ] You can explain the difference between `OutOfSync`/`Synced` and `Progressing`/`Healthy`/`Degraded`.
- [ ] `argocd app history staging` shows each revision you deployed.

### Common mistakes and debugging

- **"I pushed and nothing happened."** Argo CD polls Git about every 3 minutes. Run `argocd app get staging --refresh`, or add a webhook later.
- **`Synced` but `Degraded`.** The manifests applied fine; the pods are unhealthy. Go back to the Milestone 4 debugging steps.
- **`ComparisonError`.** Usually a wrong `path`, a missing values file, or a Helm template error. Run `helm template` locally with the same values.
- **`repository not found` or an authentication error.** The repo is private, so Argo CD needs repo credentials.
- **CRD `metadata.annotations: Too long`.** You installed with client-side apply.
- **Fixing things with `kubectl edit`.** Self-heal reverts it. Fix it in Git.

Debugging commands:

```bash
kubectl get applications -n argocd
argocd app get <app> --show-operation
argocd app diff <app>
argocd app manifests <app> | less
argocd app sync <app>
kubectl logs -n argocd deploy/argocd-repo-server          # rendering errors
kubectl logs -n argocd statefulset/argocd-application-controller
kubectl describe application <app> -n argocd
```

---

## Milestone 6: Per-PR preview environments

### What you're learning

- The ApplicationSet controller and its Pull Request generator.
- Template parameters: `number`, `branch`, `branch_slug`, `head_sha`, `head_short_sha`, `labels`.
- Go templates.
- Polling (`requeueAfterSeconds`) versus webhooks.
- GitHub API tokens and rate limits.
- Scoping with an `AppProject`.
- How finalizers and namespace cleanup work.
- The race between Argo CD seeing a new SHA and CI finishing the image.

### Why it matters for an SDET

This is the QA Wolf workflow. Knowing it end to end means you can answer the three questions that come up most:

- Why didn't my preview update?
- Did the tests run against the old build?
- Why are there 40 leftover environments?

### Files you'll create

- `deploy/argocd/previews-project.yaml`: an `AppProject` that allows only this repo as a source and only `preview-pr-*` namespaces as destinations.
- `deploy/argocd/previews-appset.yaml`: the `ApplicationSet`.
- `deploy/chart/templates/namespace.yaml`, in step 6.7.
- A GitHub token Secret, created with `kubectl create secret`. Never commit it.

### Steps

#### 6.1 Create the label

```bash
gh label create preview --description "Deploy a preview environment" --color 0E8A16
```

**Check:** `gh label list | grep preview` shows it.

#### 6.2 Token and Secret

Create a fine-grained token on GitHub: your profile → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.

1. Name: `argocd-previews`. Expiration: 90 days.
2. Repository access: Only select repositories → `sdet-cicd-lab`.
3. Permissions → Repository permissions → Pull requests: Read-only. Metadata: Read-only is added automatically.

Copy the token, then store it as a Secret without leaving it in your shell history:

```bash
read -rs GH_TOKEN        # paste the token, then press Enter
kubectl create secret generic github-token -n argocd --from-literal=token="$GH_TOKEN"
unset GH_TOKEN
```

Put the expiry date in your calendar.

**Check:** `kubectl describe secret github-token -n argocd` shows one data key, `token`, with a non-zero byte count.

#### 6.3 AppProject

Write `deploy/argocd/previews-project.yaml`:

1. `apiVersion: argoproj.io/v1alpha1`, `kind: AppProject`, `metadata.name: previews` and `metadata.namespace: argocd`.
2. `spec.sourceRepos`: only `https://github.com/<owner>/sdet-cicd-lab.git`.
3. `spec.destinations`: one entry with `server: https://kubernetes.default.svc` and `namespace: preview-pr-*`.
4. `spec.clusterResourceWhitelist`: one entry, `group: ""` and `kind: Namespace`. That's the only cluster-wide kind a preview may touch, and 6.7 needs it.

A preview can't deploy anywhere else or from any other repo, even if someone edits the template.

**Check:** `kubectl apply -f deploy/argocd/previews-project.yaml`, then `argocd proj get previews` shows the repo, the destination and the Namespace kind.

#### 6.4 ApplicationSet: the generator

Start `deploy/argocd/previews-appset.yaml`:

1. `apiVersion: argoproj.io/v1alpha1`, `kind: ApplicationSet`, `metadata.name: previews` and `metadata.namespace: argocd`.
2. `spec.goTemplate: true` and `spec.goTemplateOptions: ["missingkey=error"]`. A typo in a variable then fails loudly instead of rendering an empty string.
3. `spec.generators` with one `pullRequest` generator:
   - `github.owner: <owner>` and `github.repo: sdet-cicd-lab`
   - `github.tokenRef` with `secretName: github-token` and `key: token`
   - `github.labels` with one entry, `preview`
   - `requeueAfterSeconds: 60`. The default is 30 minutes, and GitHub can't send webhooks to your laptop.

#### 6.5 ApplicationSet: the template

`spec.template` is an Application with placeholders. Quote every value that starts with `{{`, because YAML reads a bare `{` as the start of a map.

1. `metadata.name: 'preview-pr-{{.number}}'`
2. `metadata.finalizers` with `resources-finalizer.argocd.argoproj.io`.
3. `spec.project: previews`
4. `spec.source`:
   - The same `repoURL` and `path` as staging.
   - `targetRevision: '{{.head_sha}}'`. The chart comes from the same commit as the image, so chart changes in the PR are previewed too.
   - `helm.parameters`, three `name`/`value` pairs:
     - `image.tag` = `'{{.head_sha}}'`
     - `environment` = `'pr-{{.number}}'`
     - `ingress.host` = `'pr-{{.number}}.127.0.0.1.nip.io'`
5. `spec.destination`: `server: https://kubernetes.default.svc` and `namespace: 'preview-pr-{{.number}}'`.
6. `spec.syncPolicy`: `automated` with `prune: true` and `selfHeal: true`, and `syncOptions` with `CreateNamespace=true`.

**Check:**

```bash
kubectl apply -f deploy/argocd/previews-appset.yaml
kubectl get applicationset previews -n argocd -o jsonpath='{.status.conditions}'
```

Look for `ErrorOccurred` with status `False`. No PR has the label yet, so no Applications exist.

#### 6.6 Lifecycle test

After each step, record what exists:

```bash
kubectl get applications -n argocd
kubectl get ns | grep preview
```

1. Open a PR from a branch cut after the chart reached main. Make a visible change, such as the page heading. No label yet, so nothing new should appear.
2. `gh pr edit <N> --add-label preview`. Within about a minute, `preview-pr-<N>` and its namespace appear. Once the `image` job finishes, `curl -s http://pr-<N>.127.0.0.1.nip.io/api/health` reports `gh pr view <N> --json headRefOid -q .headRefOid`.
3. Push another commit. The same Application and namespace stay; `kubectl get rs -n preview-pr-<N>` shows a new ReplicaSet.
4. Open a second PR and label it. Both previews run side by side with different SHAs.
5. `gh pr close <N>` for both. Their Applications disappear within about a minute. Note what's left in `kubectl get ns`.
6. `gh pr reopen <N>`. The environment comes back.

#### 6.7 Make cleanup complete

In step 5 of 6.6, the namespaces stayed behind. `CreateNamespace=true` makes the namespace outside the Application's resources, so nothing deletes it. Make the chart own it instead:

1. Add `deploy/chart/templates/namespace.yaml`: a `Namespace` named `{{ .Release.Namespace }}`, wrapped in `{{- if .Values.namespace.create }}` and `{{- end }}`.
2. Add `namespace.create: false` to `values.yaml`. With `helm --create-namespace` in 4.7, the release would otherwise clash with the namespace Helm made.
3. In the ApplicationSet, add a fourth Helm parameter: `namespace.create` = `"true"`.
4. The AppProject already allows the `Namespace` kind from 6.3.

Merge the chart change to main, re-apply the ApplicationSet, and rebase any open preview PRs so their head commit has the new template.

**Check:**

```bash
kubectl get application preview-pr-<N> -n argocd -o jsonpath='{.metadata.finalizers}'
argocd app resources preview-pr-<N>         # the Namespace is listed now
gh pr close <N>
kubectl get ns -w                           # preview-pr-<N> goes Terminating, then disappears
```

#### 6.8 Watch the race

1. On a labeled PR, push a commit and note the time.
2. Watch the pods: `kubectl get pods -n preview-pr-<N> -w`.
3. Within about a minute, Argo CD sees the new SHA and starts a pod for it. That pod sits in `ErrImagePull`, then `ImagePullBackOff`, because CI is still building the image. Meanwhile `curl` still reports the old SHA from the old pod.
4. Note when the `image` job finishes, and when `/api/health` reports the new SHA.

The kubelet's retry delay doubles up to 5 minutes, so the preview can lag the image by several minutes. `kubectl delete pod` on the stuck pod retries at once.

That's why "the preview is healthy" isn't the same as "the preview runs my commit". Milestone 7's wait script checks the SHA. One small win: start the image build in parallel with `checks` by removing `needs: checks`. The trade-off is that you'll publish images for commits that fail checks.

### Done when

- [ ] Labeling a PR creates `preview-pr-N` within about a minute, and `http://pr-N.127.0.0.1.nip.io/api/health` reports the PR head SHA.
- [ ] A new push updates the same Application and namespace. There's a new ReplicaSet, not a new environment.
- [ ] Two open PRs run side by side with different SHAs.
- [ ] Closing a PR removes its Application and namespace, with nothing left over.
- [ ] Reopening the PR recreates the environment.
- [ ] Running Playwright locally against `pr-N.127.0.0.1.nip.io` with `EXPECTED_COMMIT_SHA` passes.

### Common mistakes and debugging

- **Nothing is generated.**
  - The PR doesn't have the `preview` label.
  - The token Secret is missing, in the wrong namespace, or under the wrong key.
  - The repo name is misspelled.
- **`map has no entry for key`.** A typo in a template variable. That's what `missingkey=error` is for.
- **Mixing template syntaxes.** `{{.number}}` is Go template syntax; `{{number}}` is the older fasttemplate syntax. Pick one.
- **`app path does not exist`.** The PR branch was cut before the chart reached main. Rebase it.
- **`ImagePullBackOff` that never clears.** The image was tagged with a different SHA, usually the merge commit.
- **`resource :Namespace is not permitted in project previews`.** The AppProject doesn't allow that cluster-scoped kind.
- **Names over 63 characters or with invalid characters.** Use the PR number, not the branch name, in resource names.

Debugging commands:

```bash
kubectl get applicationset previews -n argocd -o yaml        # read status.conditions
kubectl logs -n argocd deploy/argocd-applicationset-controller | grep -i -E 'pull|error'
kubectl get applications -n argocd
kubectl get application preview-pr-<N> -n argocd -o jsonpath='{.metadata.finalizers}'
kubectl get ns | grep preview
kubectl get events -n preview-pr-<N> --sort-by=.lastTimestamp
```

---

## Milestone 7: E2E tests against preview URLs

### What you're learning

- Deployment gating: waiting until the right version is ready.
- Bounded timeouts and clear failure messages.
- Running Playwright against a remote `BASE_URL`.
- Reporting back to the PR: job summary, deployment URL, artifacts.
- Network reachability from the runner to the preview.

### Why it matters for an SDET

This is the job: testing a deployed artifact, not a dev server. A suite that starts before the rollout finishes passes or fails against the previous commit. A wait without a timeout hangs CI for hours. Both erode trust in the tests.

### Files you'll create

- `scripts/wait-for-preview.mts`. Node 24 runs TypeScript files directly.
- A `preview-e2e` job in `.github/workflows/pr.yml`.
- Edits to `playwright.config.ts`, `package.json` and `.gitignore`.

### Steps

#### 7.1 Wait script: inputs

Create `scripts/wait-for-preview.mts`. The `.mts` extension makes Node treat it as an ES module, so top-level `await` works and Node prints no module-type warning. Node runs it by stripping the types, so use plain type annotations only: no `enum` and no `namespace`.

1. Read four env vars:
   - `BASE_URL`, required.
   - `EXPECTED_COMMIT_SHA`, required.
   - `TIMEOUT_SECONDS`, default `600`.
   - `INTERVAL_SECONDS`, default `5`.
2. If a required one is missing, print a one-line usage message and exit with code 2.
3. Add an npm script to `package.json`: `"wait:preview": "node scripts/wait-for-preview.mts"`.

**Check:** `npm run wait:preview` with nothing set prints the usage line and exits non-zero. `npm run typecheck` still passes; `tsconfig.json` already includes `**/*.mts`.

#### 7.2 Wait script: the poll loop

1. Work out a deadline: now plus the timeout.
2. Until the deadline:
   1. `fetch` `${BASE_URL}/api/health` with `signal: AbortSignal.timeout(5000)`. The per-request timeout stops one hung request from eating the whole budget.
   2. If `fetch` throws, remember `unreachable` plus the reason. Node puts the useful part, such as `ECONNREFUSED`, in `err.cause.code`.
   3. If the status isn't 200, remember `HTTP <status>`.
   4. Parse the JSON. If `commitSha` isn't the expected SHA, remember `healthy but serving <commitSha>`.
   5. If it matches, print how long it took and exit 0.
   6. Log one line per attempt, then sleep for the interval. `setTimeout` from `node:timers/promises` can be awaited.
3. After the deadline, print the last failure reason and exit 1.

The last reason tells you which layer to look at. `unreachable` points at DNS, the network or the ingress controller. A 404 or 5xx points at the ingress rule or the pods. A wrong SHA points at the rollout or the image race from 6.8.

#### 7.3 Validate it against your kind preview

With a labeled PR from Milestone 6 running:

```bash
N=<pr-number>
SHA=$(gh pr view $N --json headRefOid -q .headRefOid)
BASE_URL=http://pr-$N.127.0.0.1.nip.io EXPECTED_COMMIT_SHA=$SHA npm run wait:preview
```

Then make it fail three ways, with short timeouts:

```bash
# wrong SHA: ends with "healthy but serving <sha>"
BASE_URL=http://pr-$N.127.0.0.1.nip.io EXPECTED_COMMIT_SHA=deadbeef TIMEOUT_SECONDS=20 npm run wait:preview

# no such preview: Traefik answers 404
BASE_URL=http://pr-9999.127.0.0.1.nip.io EXPECTED_COMMIT_SHA=$SHA TIMEOUT_SECONDS=20 npm run wait:preview

# nothing listening: unreachable
BASE_URL=http://127.0.0.1:9 EXPECTED_COMMIT_SHA=$SHA TIMEOUT_SECONDS=20 npm run wait:preview
```

Finally, push a commit to the PR, and start the script right away with the new SHA. It should log the old SHA for a while, then return the moment the new one is live. Run the suite after it:

```bash
BASE_URL=http://pr-$N.127.0.0.1.nip.io EXPECTED_COMMIT_SHA=$SHA npm run test:e2e
```

**Check:** each failure ends within about 20 seconds with a different reason, and the rollout case returns on its own.

#### 7.4 Add a JSON reporter for the summary

1. In `playwright.config.ts`, add `["json", { outputFile: "results.json" }]` to the CI reporters.
2. Add `results.json` to `.gitignore` and `.dockerignore`.

**Check:** `CI=1 npm run test:e2e`, then `jq .stats results.json` shows `expected`, `unexpected`, `flaky` and `skipped` counts.

#### 7.5 The preview-e2e job

Add a third job to `pr.yml`:

1. `needs: image`.
2. An `if:` that requires all three:
   - `github.event_name == 'pull_request'`
   - `contains(github.event.pull_request.labels.*.name, 'preview')`
   - `vars.PREVIEW_DOMAIN != ''`
3. `runs-on: ubuntu-24.04` and `timeout-minutes: 20`.
4. Job-level `env:`
   - `BASE_URL: http://pr-${{ github.event.pull_request.number }}.${{ vars.PREVIEW_DOMAIN }}`
   - `EXPECTED_COMMIT_SHA: ${{ github.event.pull_request.head.sha }}`
5. `environment:` with `name: preview` and `url:` set to the same URL as `BASE_URL`. This gives the PR a "View deployment" button.
6. Steps:
   1. `actions/checkout` at the PR head SHA.
   2. `actions/setup-node` with `.nvmrc` and npm caching, then `npm ci`.
   3. `npx playwright install --with-deps chromium`. Do this before waiting; the rollout keeps going while the browser downloads.
   4. `npm run wait:preview`.
   5. `npm run test:e2e`.
   6. `actions/upload-artifact` with `if: ${{ !cancelled() }}`, `name: preview-playwright-report`, and the same two paths as `checks`. Artifact names must be unique within a run, so this one can't reuse `playwright-report`.
   7. A summary step with `if: ${{ !cancelled() }}`. Append a few Markdown lines to `$GITHUB_STEP_SUMMARY`: the URL, the SHA, and the passed, failed and flaky counts from `jq` on `results.json`. Skip the counts if the file doesn't exist, which happens when the wait step failed.

**Reachability:** GitHub-hosted runners can't reach `pr-N.127.0.0.1.nip.io` on your laptop. While you're on kind, leave `PREVIEW_DOMAIN` unset so the job is skipped. The job goes live in Milestone 8, when you set `PREVIEW_DOMAIN` to the EC2 domain.

Don't use a quick tunnel that exposes your laptop, and don't register a self-hosted runner on your Mac for a public repo.

**Check:** `actionlint` passes. Push to a labeled PR: `gh pr checks <N>` shows `preview-e2e` as skipped, and the run is still green.

### Done when

- [ ] Locally, the wait script blocks during a rollout and returns the moment the new SHA is live.
- [ ] Locally, the wait script fails clearly within its deadline when you point it at a wrong SHA or a dead host.
- [ ] Without `PREVIEW_DOMAIN`, the job shows as skipped, not failed.
- [ ] After Milestone 8: a labeled PR runs `checks` → `image` → `preview-e2e` green. The PR shows the deployment link, and a deliberately broken test leaves a trace you can open with `npx playwright show-trace`.

### Common mistakes and debugging

- **Waiting on HTTP 200 alone.** The old pod returns 200 for the whole rollout.
- **No deadline.** A job default of 6 hours burns minutes and hides the real failure.
- **The `playwright.config.ts` webServer still starts.** It only starts when `BASE_URL` is unset, so check the variable actually reaches the step.
- **Uploading artifacts only on success.**
- **`an artifact with this name already exists`.** Two jobs in the same run used one artifact name.
- **Mixing `http` and `https`.** The previews are plain HTTP until you add TLS.

Debugging commands:

```bash
curl -sS http://pr-<N>.<domain>/api/health
gh run view <run-id> --log-failed
gh run download <run-id>
npx playwright show-trace test-results/<test>/trace.zip
argocd app get preview-pr-<N>
kubectl rollout status deploy -n preview-pr-<N>
```

---

## Milestone 8: AWS EC2 deployment

### What you're learning

- EC2 basics: AMIs, instance types, EBS, security groups, key pairs, Session Manager, IMDSv2, public and Elastic IPs.
- Running a single-node k3s cluster.
- Exposing ingress publicly.
- Reaching the Kubernetes API safely.
- Controlling cost and tearing everything down.

### Why it matters for an SDET

Real preview infrastructure has network rules, credentials and a bill. "The preview is unreachable from CI" is usually a security group or DNS problem. You'll recognize it on sight after building one.

### Files you'll create

- `deploy/ec2/bootstrap.sh`: your own script to install k3s and Argo CD on a fresh instance.
- `deploy/ec2/NOTES.md`: instance settings, security group rules and the teardown checklist.
- `deploy/argocd/previews-appset.ec2.yaml`: the same ApplicationSet with the EC2 domain.

### Steps

#### 8.1 Lock down the AWS account

Do this before launching anything.

1. **Root MFA.** Sign in as root → account menu, top right → Security credentials → Assign MFA device. Use an authenticator app or a passkey.
2. **Admin identity.** Open IAM Identity Center → Enable.
   1. Users → Add user: you.
   2. Permission sets → Create permission set → Predefined → `AdministratorAccess`.
   3. AWS accounts → select your account → Assign users or groups → you, with `AdministratorAccess`.
   4. Accept the email invite and set a password and MFA.
3. **CLI login.** `brew install awscli`, then `aws configure sso`. Paste the AWS access portal URL from the Identity Center dashboard, pick a region such as `us-east-1`, and name the profile `lab`. Then `export AWS_PROFILE=lab`, and add that line to `~/.zshrc`.
4. **Budget.** Billing and Cost Management → Budgets → Create budget → Customize → Cost budget, monthly, $25. Add three alerts that email you: 40% actual (about $10), 100% actual, and 100% forecasted.

**Check:**

```bash
aws sso login
aws sts get-caller-identity    # Arn has AWSReservedSSO_AdministratorAccess, not :root
aws budgets describe-budgets --account-id $(aws sts get-caller-identity --query Account --output text) \
  --query 'Budgets[].BudgetName'
```

Sign out of root. From now on, use the access portal.

#### 8.2 Key pair

Import your existing public key, so no private key is ever downloaded:

```bash
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519
aws ec2 import-key-pair --key-name sdet-lab --public-key-material fileb://~/.ssh/id_ed25519.pub
```

If you'd rather use Session Manager with no SSH at all, skip this, attach `AmazonSSMManagedInstanceCore` as the instance role in 8.4, and use `aws ssm start-session` wherever this plan says `ssh`.

**Check:** `aws ec2 describe-key-pairs --key-names sdet-lab` returns it.

#### 8.3 Security group

```bash
MY_IP=$(curl -s https://checkip.amazonaws.com)
VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 create-security-group --group-name sdet-lab --description "sdet-lab previews" \
  --vpc-id $VPC --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 22 --cidr $MY_IP/32
aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 443 --cidr 0.0.0.0/0
```

Ports 80 and 443 are open to the world because GitHub-hosted runners come from a huge, changing IP range. Milestone 9 closes them. Never open 6443 (the Kubernetes API) or the Argo CD UI.

**Check:** exactly three rules, and no 6443:

```bash
aws ec2 describe-security-groups --group-ids $SG \
  --query 'SecurityGroups[0].IpPermissions[].[FromPort,IpRanges[0].CidrIp]' --output table
```

Write the group ID into `deploy/ec2/NOTES.md`.

#### 8.4 Launch the instance

EC2 → Launch instance:

1. Name: `sdet-lab`.
2. AMI: Ubuntu Server 24.04 LTS, 64-bit (x86).
3. Instance type: `t3.medium` (2 vCPU, 4 GiB). 2 GiB is too tight for k3s plus Argo CD plus previews.
4. Key pair: `sdet-lab`.
5. Network settings → Edit: the default VPC, a public subnet, Auto-assign public IP enabled, and Select existing security group → `sdet-lab`.
6. Storage: 30 GiB gp3. Open Advanced and set Encrypted to Yes.
7. Advanced details:
   - Shutdown behavior: Stop.
   - Metadata version: V2 only (token required).
   - Credit specification: Standard. Unlimited lets sustained CPU use add charges.
   - IAM instance profile: none, unless you chose Session Manager in 8.2.

**Check:**

```bash
aws ec2 describe-instances --filters Name=tag:Name,Values=sdet-lab \
  --query 'Reservations[].Instances[].[InstanceId,State.Name,PublicIpAddress,InstanceType]' --output table
ssh ubuntu@<public-ip> 'uname -m && free -h'      # x86_64, about 3.8Gi total
```

Write the instance ID and IP into `NOTES.md`.

#### 8.5 Bootstrap script

Write `deploy/ec2/bootstrap.sh`. It runs as root on the instance and must be safe to run twice.

1. `#!/usr/bin/env bash` and `set -euo pipefail`.
2. Two pinned versions as variables at the top:
   - `K3S_VERSION`: the current stable release, from `curl -sL -o /dev/null -w '%{url_effective}\n' https://update.k3s.io/v1-release/channels/stable`. The version is the last part of the URL.
   - `ARGOCD_VERSION`: the same one you installed in 5.1.
3. Install k3s: `curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="$K3S_VERSION" sh -`. It includes Traefik on ports 80 and 443, so don't install a second ingress controller. The installer is safe to re-run.
4. Wait for the node: `kubectl wait --for=condition=Ready node --all --timeout=180s`. k3s installs `kubectl` for you.
5. Create the `argocd` namespace only if it's missing: `kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -`.
6. Install Argo CD with the same server-side apply as 5.2, using `$ARGOCD_VERSION`.
7. Wait for it: `kubectl rollout status` on `deploy/argocd-server` and `deploy/argocd-applicationset-controller` in `argocd`.
8. Leave secrets out. You'll create the token Secret by hand in 8.7.

Run it from your Mac:

```bash
ssh ubuntu@<public-ip> 'sudo bash -s' < deploy/ec2/bootstrap.sh
```

**Check:** run it a second time; it should finish without errors. Then:

```bash
ssh ubuntu@<public-ip> 'sudo kubectl get pods -A'      # everything Running
ssh ubuntu@<public-ip> 'systemctl is-enabled unattended-upgrades'   # enabled
curl -i http://<public-ip>/                              # 404 page not found, from Traefik
```

#### 8.6 kubectl from your Mac

The Kubernetes API stays closed to the internet. You reach it through an SSH tunnel.

1. Copy the kubeconfig and rename its context:

   ```bash
   ssh ubuntu@<public-ip> 'sudo cat /etc/rancher/k3s/k3s.yaml' > ~/.kube/sdet-ec2.yaml
   chmod 600 ~/.kube/sdet-ec2.yaml
   kubectl --kubeconfig ~/.kube/sdet-ec2.yaml config rename-context default ec2
   ```

   Keep its server address as `https://127.0.0.1:6443`. The tunnel makes that address reach the instance.

2. Open the tunnel in its own terminal and leave it running: `ssh -N -L 6443:127.0.0.1:6443 ubuntu@<public-ip>`.
3. Make both clusters visible: `export KUBECONFIG=~/.kube/config:~/.kube/sdet-ec2.yaml`, and add that line to `~/.zshrc`.

**Check:** `kubectl config get-contexts` lists `kind-sdet-lab` and `ec2`, and `kubectl --context ec2 get nodes` shows one Ready node. Stop the tunnel and run it again: it now fails. That's the "kubectl hangs" symptom from the mistakes list.

#### 8.7 Previews on EC2

1. Create a second fine-grained token, the same as 6.2. One token per cluster means you can revoke one without breaking the other. Store it with `kubectl --context ec2 create secret ...`.
2. `kubectl --context ec2 apply -f deploy/argocd/previews-project.yaml`.
3. Copy `previews-appset.yaml` to `deploy/argocd/previews-appset.ec2.yaml`, and change only the `ingress.host` parameter to `'pr-{{.number}}.<public-ip>.nip.io'`. Apply it with `--context ec2`.
4. To use the Argo CD UI or CLI on EC2, port-forward on a different local port so it doesn't clash with kind: `kubectl --context ec2 port-forward svc/argocd-server -n argocd 8081:443`.

Both clusters now deploy the same labeled PRs. That's fine. When you want your Mac's memory back, delete the kind ApplicationSet: `kubectl --context kind-sdet-lab delete applicationset previews -n argocd`.

**Check:** push to a labeled PR. `kubectl --context ec2 get applications -n argocd` shows `preview-pr-<N>`, and from your Mac:

```bash
curl -s http://pr-<N>.<public-ip>.nip.io/api/health
BASE_URL=http://pr-<N>.<public-ip>.nip.io EXPECTED_COMMIT_SHA=<head-sha> npm run test:e2e
```

#### 8.8 Turn on preview-e2e

```bash
gh variable set PREVIEW_DOMAIN --body "<public-ip>.nip.io"
```

Push a commit to a labeled PR.

**Check:** `gh pr checks <N> --watch` shows `checks`, `image` and `preview-e2e` passing. The PR shows a "View deployment" button, and the run's summary page shows the URL, SHA and counts. Then break a test on purpose, download `preview-playwright-report`, and open its trace with `npx playwright show-trace`.

#### 8.9 Decide on the IP

Stop and start the instance once to see the problem:

```bash
aws ec2 stop-instances --instance-ids <id> && aws ec2 wait instance-stopped --instance-ids <id>
aws ec2 start-instances --instance-ids <id> && aws ec2 wait instance-running --instance-ids <id>
aws ec2 describe-instances --instance-ids <id> \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
```

The IP changed, so every preview URL broke. Pick one fix and write it in `NOTES.md`:

- **No Elastic IP.** After every start, update `PREVIEW_DOMAIN`, the EC2 ApplicationSet's host and your SSH commands. Costs nothing while stopped.
- **Elastic IP.** `aws ec2 allocate-address`, then `aws ec2 associate-address --instance-id <id> --allocation-id <alloc-id>`. The domain stays stable, but you pay for the address even while the instance is stopped.

#### 8.10 Auto-stop at night

Add this line to `bootstrap.sh`, so a rebuilt instance keeps it, then run the script again as in 8.5:

```bash
echo '0 6 * * * root /usr/sbin/shutdown -h now' > /etc/cron.d/auto-stop
```

Cron runs in UTC on this image. Pick an hour after you're usually done; `date -u` shows the current UTC time. The shutdown only stops the instance because you set the shutdown behavior to Stop in 8.4. With Terminate, it would delete it.

**Check:**

```bash
aws ec2 describe-instance-attribute --instance-id <id> --attribute instanceInitiatedShutdownBehavior   # "stop"
ssh ubuntu@<public-ip> cat /etc/cron.d/auto-stop
```

The next morning, the instance should show as `stopped`.

#### 8.11 Write the teardown checklist

Put it in `NOTES.md` now, before you need it. Use the list under Cost below and the teardown audit commands under How to verify.

### Cost

These are approximate us-east-1 on-demand prices. Check the pricing pages for your region.

| Item                                           | Approx. cost                        | Notes                                              |
| ---------------------------------------------- | ----------------------------------- | -------------------------------------------------- |
| t3.medium                                      | ~$0.04/hr, ~$30/mo if never stopped | No charge while stopped                            |
| Public IPv4 or Elastic IP                      | ~$0.005/hr, ~$3.60/mo               | Charged while allocated, even when idle            |
| 30 GiB gp3                                     | ~$2.40/mo                           | Charged while the volume exists, even when stopped |
| GHCR public packages, Actions on a public repo | $0                                  |                                                    |
| Avoid: EKS control plane                       | ~$73/mo                             | Why this lab uses k3s                              |
| Avoid: NAT Gateway                             | ~$33/mo plus data                   | Why the instance sits in a public subnet           |
| Avoid: Application Load Balancer               | ~$16/mo plus usage                  | Why Traefik binds the instance's ports directly    |

Stop the instance when you're not using it. When you're done for good:

- Terminate the instance.
- Release the Elastic IP.
- Delete leftover volumes and snapshots.
- Check Cost Explorer the next day.

### Security basics

- Previews are public on the internet. Never put real data or secrets in them.
- Optional: add Traefik basic auth or an IP allowlist.
- The GitHub token is read-only, scoped to one repo and set to expire. Rotate it.
- Keep `k3s.yaml` (cluster-admin) and SSH keys off shared machines and out of Git.
- Keep `unattended-upgrades` on for OS security patches. Ubuntu's cloud images enable it by default.

### How to verify

```bash
curl -s http://pr-<N>.<public-ip>.nip.io/api/health     # from your Mac
kubectl --context ec2 get applications -n argocd          # through the tunnel

# Teardown audit: every command should come back empty
aws ec2 describe-instances --filters Name=instance-state-name,Values=running --query 'Reservations[].Instances[].InstanceId'
aws ec2 describe-addresses --query 'Addresses[?AssociationId==null]'
aws ec2 describe-volumes --filters Name=status,Values=available --query 'Volumes[].VolumeId'
```

Done when:

- [ ] A labeled PR goes through all of `checks` → `image` → Argo CD preview on EC2 → `preview-e2e`, green with artifacts.
- [ ] Closing the PR removes the preview on EC2.
- [ ] The budget alert is configured, and the instance stops itself overnight.
- [ ] Nothing but 80 and 443 (and 22 from your IP) is reachable from the internet. Check with `nc -vz <ip> 6443` from your Mac; it should fail.

### Common mistakes and debugging

- **Preview times out from CI but works from your Mac.** Ports 80 and 443 are only open to your IP.
- **`exec format error`.** An arm64-only image on a t3 instance, or the reverse. Milestone 3's multi-arch build prevents this.
- **Pods `OOMKilled` or evicted.** The instance is too small, or there are too many open previews. Use the label gate.
- **Disk full after many pushes.** Old images pile up. Check `df -h` and the k3s image garbage collection.
- **Everything broke after stop and start.** The public IP changed. See 8.9.
- **`kubectl` hangs.** The SSH tunnel isn't running.

Debugging commands:

```bash
aws ec2 describe-instances --query 'Reservations[].Instances[].[InstanceId,State.Name,PublicIpAddress]' --output table
aws ec2 describe-security-groups --group-ids <sg-id>
sudo systemctl status k3s
sudo journalctl -u k3s -f
sudo k3s kubectl get pods -A
kubectl -n kube-system logs deploy/traefik
free -h && df -h
```

---

## Milestone 9 (optional): Self-hosted GitHub runner on EC2

### What you're learning

- How runners register and get selected by labels.
- Persistent versus ephemeral runners.
- Running tests from inside the network, so previews don't have to be public.
- The security model of self-hosted runners.

### Why it matters for an SDET

Many companies run test infrastructure inside a private network, so the runner can reach environments the internet can't. Knowing how runners are isolated, and how they get compromised, is part of owning a test pipeline.

### Files you'll create

- An edit to the `preview-e2e` job: `runs-on: [self-hosted, linux, preview-net]`.
- `deploy/ec2/runner.md`: setup steps and the security checklist.

### Read this first

Self-hosted runners execute whatever code a workflow tells them to.

- On a public repo, a fork PR could run code on your instance, which also holds your cluster.
- Either make the repo private, or keep it public with all of these:
  - Require approval for workflows from all outside contributors.
  - Only run the self-hosted job when `github.event.pull_request.head.repo.full_name == github.repository`.
  - Never use the `pull_request_target` trigger with it.
- A private repo changes earlier choices:
  - The GHCR package becomes private, so the cluster needs an image pull Secret.
  - GitHub-hosted minutes are limited on the free plan.

### Steps

#### 9.1 Require approval for outside contributors

If the repo stays public: Settings → Actions → General. Under the approval setting for fork pull request workflows, pick the strictest option, which requires approval for all outside contributors. Save.

**Check:** reload the page; the strictest option is still selected.

#### 9.2 Create the runner user

On the instance, as `ubuntu`:

```bash
sudo useradd --create-home --shell /bin/bash runner
```

No password, no `sudo` group, no kubeconfig. If a workflow is ever compromised, this user can't touch the cluster.

**Check:**

```bash
id runner                          # only the runner group
sudo -l -U runner                  # "not allowed to run sudo"
sudo -u runner kubectl get pods    # fails: permission denied on /etc/rancher/k3s/k3s.yaml
```

#### 9.3 Install Playwright's system libraries

The runner user can't `sudo`, so `--with-deps` would fail inside the job. Install the libraries once as `ubuntu`, using the exact Playwright version from `npm ls @playwright/test`:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npx -y playwright@<version> install-deps chromium
```

Run the last command again whenever you upgrade Playwright.

**Check:** it ends without errors, and `dpkg -s libnss3 | grep Status` prints `install ok installed`.

#### 9.4 Register the runner

1. On your Mac, get a registration token. It expires in about an hour:

   ```bash
   gh api -X POST repos/<owner>/sdet-cicd-lab/actions/runners/registration-token -q .token
   ```

2. On the instance, switch to the runner user with `sudo -iu runner`.
3. In the repo, open Settings → Actions → Runners → New self-hosted runner → Linux, x64. Run its Download commands: they make `actions-runner`, download the tarball, check its hash and extract it.
4. Configure it:

   ```bash
   ./config.sh --url https://github.com/<owner>/sdet-cicd-lab --token <token> \
     --name sdet-lab-ec2 --labels preview-net --unattended
   ```

5. `exit` back to `ubuntu`, and install it as a service that runs as `runner`. This way it survives reboots:

   ```bash
   sudo bash -c 'cd /home/runner/actions-runner && ./svc.sh install runner && ./svc.sh start'
   ```

**Check:**

```bash
gh api repos/<owner>/sdet-cicd-lab/actions/runners \
  -q '.runners[] | [.name, .status, (.labels | map(.name) | join(","))] | @tsv'
```

It shows `sdet-lab-ec2`, `online`, and labels including `self-hosted` and `preview-net`. Reboot the instance with `sudo reboot` and check again; it should come back online by itself.

#### 9.5 Move preview-e2e to the runner

Edit only the `preview-e2e` job. Keep `checks` and `image` on GitHub-hosted runners.

1. `runs-on: [self-hosted, linux, preview-net]`.
2. Add to its `if:` `github.event.pull_request.head.repo.full_name == github.repository`. PRs from forks then never reach your instance.
3. Change the browser step to `npx playwright install chromium`, without `--with-deps`. 9.3 already installed the libraries.
4. Change the test step to `npm run test:e2e -- --workers=1`. Playwright, Next.js, k3s and Argo CD now share 2 vCPU. If tests still time out, move up to t3.large.

**Check:** push to a labeled PR. The `preview-e2e` job passes, and its "Set up job" step names the runner `sdet-lab-ec2`.

#### 9.6 Close ports 80 and 443

1. Decide how the runner reaches the previews.
   - **The private IP (recommended).** Find it with `aws ec2 describe-instances --instance-ids <id> --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text`. Set `PREVIEW_DOMAIN` to `<private-ip>.nip.io`, and change the EC2 ApplicationSet's host to match. Traffic to the instance's own address never leaves it, so the security group doesn't apply. The private IP also survives stop and start.
   - **The public IP.** Keep the current domain and allow the instance's own public IP, as a `/32`, in the security group.
2. Swap the open rules for your IP only:

   ```bash
   aws ec2 revoke-security-group-ingress --group-id $SG --protocol tcp --port 80 --cidr 0.0.0.0/0
   aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 80 --cidr $MY_IP/32
   aws ec2 revoke-security-group-ingress --group-id $SG --protocol tcp --port 443 --cidr 0.0.0.0/0
   aws ec2 authorize-security-group-ingress --group-id $SG --protocol tcp --port 443 --cidr $MY_IP/32
   ```

3. To view a private-domain preview from your Mac, send the host name as a header: `curl -s -H "Host: pr-<N>.<private-ip>.nip.io" http://<public-ip>/api/health`.

**Check:**

- Push to a labeled PR. `preview-e2e` still passes.
- From another network, such as your phone's hotspot, `curl --max-time 5 http://<public-ip>/` times out.

#### 9.7 Watch the disk

A persistent runner keeps its workspace and browser cache between jobs.

```bash
df -h /
sudo du -sh /home/runner/actions-runner/_work /home/runner/.cache/ms-playwright
```

**Check:** note the sizes in `runner.md`. Look again after a week of pushes. If they keep growing, clean them on a schedule, or move to ephemeral runners.

### Done when

- [ ] The runner shows as Idle under Settings → Actions → Runners, and `preview-e2e` logs show your runner's name.
- [ ] With ports 80 and 443 closed to the world, `preview-e2e` still passes.
- [ ] `curl` to the preview from outside your IP fails, as expected.
- [ ] The runner user can't `sudo` or run `kubectl`.

### Common mistakes and debugging

- **Runner registered as root, or the registration token expired.** Tokens last about an hour.
- **Runner shows as offline after a reboot.** It wasn't installed as a service.
- **`sudo: a password is required` in the browser step.** The job still uses `--with-deps`.
- **Leftover workspace between jobs on a persistent runner.** Stale `node_modules`, old reports. Clean the workspace or use ephemeral runners.
- **`_work` and Playwright caches fill the disk.**

Debugging commands:

```bash
sudo ./svc.sh status
journalctl -u 'actions.runner.*' -f
ls ~/actions-runner/_diag/
gh api repos/<owner>/sdet-cicd-lab/actions/runners
```

---

## Stretch goals

- **Event-driven E2E.** Use Argo CD Notifications to post a GitHub deployment status when a preview turns Healthy, and trigger E2E from `deployment_status` instead of polling.
- **Image cleanup.** On PR close, delete that PR's image versions from GHCR, keeping anything `main` uses.
- **TLS.** cert-manager with Let's Encrypt and a real domain you own.
- **Infrastructure as code.** Terraform for the EC2 instance, security group, budget and Elastic IP, so teardown is one command.
- **Gateway API** in place of Ingress.
- **Shard Playwright** across jobs and merge blob reports.
- **Argo CD Image Updater,** or the CI tag-bump commit from Milestone 5, for a `main` → staging promotion flow.
