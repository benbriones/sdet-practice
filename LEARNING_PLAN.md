# Learning Plan

Nine milestones that take this repo from "app with tests" to "every PR gets a tested preview environment on EC2". You write the infrastructure. This plan says what to build, why, and how to prove it works. It doesn't give finished files.

## How to use this plan

- Do one milestone at a time, in order. Each one depends on the contracts of the one before.
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

### What to implement yourself

1. **Standalone output.** Add `output: "standalone"` and run `npm run build`. Look inside `.next/standalone/`: there's a `server.js` and a trimmed `node_modules`. Then check which folders aren't in there. You'll have to copy those yourself.
2. **`.dockerignore`.** Keep the build context small, and keep host-built artifacts out of it. Think about `node_modules`, `.next`, test output, `.git` and env files.
3. **Three stages:**
   - `deps`: install from the lockfile with `npm ci`. Copy only the package files first, so this layer caches until dependencies change.
   - `builder`: copy the source and run `next build`.
   - `runner`: a small Node 24 base image, `NODE_ENV=production`, a non-root user, and the standalone output plus the static assets and `public/`. Listen on `0.0.0.0:3000` and start with `node server.js`.
4. **Bake in the commit.** Accept a `COMMIT_SHA` build arg and expose it to the app as `APP_COMMIT_SHA` in the runner stage. Add the OCI label `org.opencontainers.image.revision` too.
5. **Tag by commit.** Tag the image with `git rev-parse HEAD`, never just `latest`. Commit first: an image built from a dirty working tree carries a SHA that doesn't describe its contents.

### How to verify

```bash
SHA=$(git rev-parse HEAD)
docker build --build-arg COMMIT_SHA=$SHA -t sdet-cicd-lab:$SHA .
docker run --rm -p 3000:3000 -e APP_ENVIRONMENT=docker sdet-cicd-lab:$SHA

# In another terminal
curl -s localhost:3000/api/health
BASE_URL=http://localhost:3000 EXPECTED_COMMIT_SHA=$SHA npm run test:e2e

docker run --rm --entrypoint id sdet-cicd-lab:$SHA        # uid must not be 0
docker image inspect sdet-cicd-lab:$SHA --format '{{.Architecture}} {{.Size}}'
```

Done when:

- [ ] All 5 tests pass against the container, including `serves the expected commit`.
- [ ] The container runs as a non-root user.
- [ ] Rebuilding after a source-only change reuses the cached `npm ci` layer.
- [ ] `docker run -e APP_COMMIT_SHA=override …` changes the reported SHA. That proves the value is read at runtime.
- [ ] The image is roughly 250 MB or less. Check `docker image ls`.

### Common mistakes and debugging

- **The page renders but buttons do nothing, and tests time out on the disabled input.** The JS chunks returned 404 because `.next/static` wasn't copied into the runner, so React never hydrated. Open DevTools → Network, or `curl -I` a `/_next/static/...` URL.
- **`ARG` declared in one stage and used in another.** An `ARG` is scoped to the stage that declares it. Declare it again where you use it.
- **Reachable inside the container but not from the host.** The server must bind to `0.0.0.0`. Docker and Kubernetes both set `HOSTNAME` to the container or pod name, so set it yourself.
- **Copying your Mac's `node_modules` into the image.** Native binaries (Tailwind's oxide, lightningcss) are platform-specific. That's what `.dockerignore` prevents.
- **`npm install` instead of `npm ci`.** The build stops being reproducible.

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

### What to implement yourself

1. **Triggers:**
   - `pull_request` with types `opened`, `synchronize`, `reopened` and `labeled`. Adding the `preview` label should start a run.
   - `push` to `main`.
2. **Concurrency.** A group keyed on the PR number with `cancel-in-progress: true`. A new push cancels the stale run.
3. **Permissions.** Workflow default `contents: read`. Grant `packages: write` only on the image job.
4. **`checks` job:**
   - Check out the PR head commit, not the merge commit.
   - Set up Node from `.nvmrc` with npm caching.
   - Run `npm ci`, lint, typecheck and build.
   - Install Chromium with system dependencies and run Playwright.
   - Upload `playwright-report/` and `test-results/` even when tests fail. Think about `if: ${{ !cancelled() }}`.
5. **`image` job,** after `checks`:
   - Set up QEMU and Buildx, then log in to `ghcr.io` with `GITHUB_TOKEN`.
   - Build for `linux/amd64,linux/arm64` with `COMMIT_SHA` set, using the GitHub Actions build cache.
   - Push exactly one tag: the PR head SHA.
   - Image names must be lowercase. `${GITHUB_REPOSITORY,,}` in bash lowercases a variable.
6. **Immutability guard.** Before building, check whether the tag already exists. `docker buildx imagetools inspect` exits non-zero when it doesn't. If it exists, skip the build, so re-runs never overwrite a published tag.
7. **After the first push:**
   - Check the package's visibility in GHCR. Make it public, or kind will need pull credentials in Milestone 4.
   - Link the package to the repo.
8. **Branch ruleset.** Protect `main` and require `checks` to pass.

The key expression, because getting it wrong breaks Milestone 6:

```yaml
${{ github.event.pull_request.head.sha }}   # the commit you pushed, which Argo CD calls head_sha
${{ github.sha }}                           # on pull_request: a temporary merge commit, so don't tag with it
```

### How to verify

1. Open a throwaway PR. `checks` and `image` should both go green.
2. In GHCR, the new tag should equal `git rev-parse HEAD` on your branch.
3. Inspect the image:

   ```bash
   docker buildx imagetools inspect ghcr.io/<owner>/sdet-cicd-lab:<sha>   # lists amd64 and arm64
   docker logout ghcr.io && docker pull ghcr.io/<owner>/sdet-cicd-lab:<sha>   # works anonymously
   ```

4. Run that pulled image locally and run Playwright against it with `EXPECTED_COMMIT_SHA=<sha>`.
5. Push twice quickly. The first run should show as cancelled.
6. Re-run the last workflow. The image job should skip the build because the tag already exists.
7. Break a test on purpose. The run should go red, the failure should be annotated on the PR, and the report artifact should open with `npx playwright show-report`.

### Common mistakes and debugging

- **`denied: permission_denied: write_package`.** The image job is missing `packages: write`.
- **`repository name must be lowercase`.** The owner name has capitals.
- **Image tag doesn't match your commit.** You used `github.sha` or checked out the merge ref.
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

### What to implement yourself

1. **Cluster.** Create it with `kind create cluster --name sdet-lab --config deploy/kind/cluster.yaml`.
2. **Traefik.** Install it with Helm. Run `helm show values traefik/traefik` to find the service type and NodePort keys yourself.
3. **Chart values:** `image.repository`, `image.tag` (required, no default), `environment`, `ingress.host`, `replicaCount`.
4. **Deployment:**
   - Set `APP_ENVIRONMENT` from values.
   - Readiness and liveness probes on `/api/health`.
   - Small requests and limits; roughly 50m CPU and 128Mi memory to start.
   - `imagePullPolicy: IfNotPresent`, which is correct with immutable tags.
   - A rolling update strategy that never drops below one ready pod.
5. **Service and Ingress.** A ClusterIP Service selecting the Deployment's pods. An Ingress with `ingressClassName: traefik` and the host from values.
6. **Deploy by hand twice:**
   - With a locally built image, loaded using `kind load docker-image`.
   - With the GHCR image from Milestone 3.

### How to verify

```bash
helm lint deploy/chart
helm template local deploy/chart --set image.tag=<sha> --set ingress.host=local.127.0.0.1.nip.io | less

helm upgrade --install local deploy/chart -n preview-local --create-namespace \
  --set image.repository=ghcr.io/<owner>/sdet-cicd-lab --set image.tag=<sha> \
  --set environment=local-k8s --set ingress.host=local.127.0.0.1.nip.io
kubectl rollout status deploy -n preview-local --timeout=120s

curl -s http://local.127.0.0.1.nip.io/api/health
BASE_URL=http://local.127.0.0.1.nip.io EXPECTED_COMMIT_SHA=<sha> npm run test:e2e
```

Done when:

- [ ] The suite passes against the nip.io URL.
- [ ] `kubectl delete pod` on a running pod causes no failed requests while a replacement starts. Try it with `replicaCount=2`.
- [ ] Changing `image.tag` to a new SHA rolls out, and `/api/health` reports it.
- [ ] Pointing the readiness probe at a bad path keeps the new pod un-Ready while the old one keeps serving. Undo it afterward.

### Common mistakes and debugging

- **Ingress returns 503 or `no available server`.** The Service selector doesn't match the pod labels, so there are no endpoints. Check `kubectl get endpointslices -n <ns>`.
- **Ingress returns 404.** The Host doesn't match, or `ingressClassName` is missing.
- **`ErrImagePull` or `ImagePullBackOff`:**
  - The GHCR package is private.
  - The tag doesn't exist.
  - It's a single-arch amd64 image on an arm64 kind node: `no match for platform in manifest`.
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

### What to implement yourself

1. **Install Argo CD.**
   - Pin a specific release tag; don't use `stable`.
   - Use server-side apply: the CRDs are too large for client-side apply's annotation.

   ```bash
   kubectl create namespace argocd
   kubectl apply -n argocd --server-side --force-conflicts \
     -f https://raw.githubusercontent.com/argoproj/argo-cd/<version>/manifests/install.yaml
   ```

2. **Log in to the UI and CLI** through a port-forward. Don't expose the UI.
3. **Write the staging Application:**
   - Automated sync with prune and self-heal.
   - `CreateNamespace=true`.
   - Helm `valueFiles` pointing at `deploy/envs/staging/values.yaml`.
4. **Deploy by Git commit.** Put a known image SHA in the values file, commit and push, and watch Argo CD sync it. Then change the tag in Git and watch a rolling update.
5. **Drift.** Run `kubectl scale` or `kubectl edit` on the live Deployment and watch self-heal revert it.
6. **Stretch:** on push to `main`, have CI commit the new tag into `deploy/envs/staging/values.yaml`. That's image promotion through Git. Guard against the workflow re-triggering itself.

### How to verify

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
argocd admin initial-password -n argocd
argocd login localhost:8080 --username admin --insecure

kubectl apply -f deploy/argocd/staging.yaml
argocd app get staging              # want: Sync Status Synced, Health Status Healthy
curl -s http://staging.127.0.0.1.nip.io/api/health
```

Done when:

- [ ] Changing the tag in Git, and nothing else, updates staging.
- [ ] Manual drift is reverted without you touching it.
- [ ] You can explain the difference between `OutOfSync`/`Synced` and `Progressing`/`Healthy`/`Degraded`.
- [ ] `argocd app history staging` shows each revision you deployed.

### Common mistakes and debugging

- **"I pushed and nothing happened."** Argo CD polls Git about every 3 minutes. Run `argocd app get staging --refresh`, or add a webhook later.
- **`Synced` but `Degraded`.** The manifests applied fine; the pods are unhealthy. Go back to the Milestone 4 debugging steps.
- **`ComparisonError`.** Usually a wrong `path`, a missing values file, or a Helm template error. Run `helm template` locally with the same values.
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
- Possibly `deploy/chart/templates/namespace.yaml`, depending on what you find in step 5.
- A GitHub token Secret, created with `kubectl create secret`. Never commit it.

### What to implement yourself

1. **Token.** Create a fine-grained GitHub token scoped to this one repo, read-only:
   - Pull requests: read. Metadata: read.
   - Store it as a Secret in the `argocd` namespace.
   - Set an expiry date.
2. **Generator.**
   - Point it at your repo with `tokenRef`, filtered to the `preview` label.
   - Set `requeueAfterSeconds: 60`. The default is 30 minutes, and GitHub can't send webhooks to your laptop.
3. **Template.** Use `goTemplate: true` with `missingkey=error`.
   - Name: `preview-pr-{{.number}}`.
   - Source: `targetRevision: {{.head_sha}}`, so chart changes in the PR are previewed too.
   - Helm values:
     - `image.tag = {{.head_sha}}`
     - `environment = pr-{{.number}}`
     - `ingress.host = pr-{{.number}}.127.0.0.1.nip.io`
   - Destination namespace: `preview-pr-{{.number}}`.
   - Automated sync with prune and self-heal. Project: `previews`.
4. **Lifecycle test.**
   - Open a PR, add the label, push twice, open a second PR, then close both.
   - After each step, record what exists with `kubectl get applications -n argocd` and `kubectl get ns`.
5. **Cleanup.**
   - After closing a PR, check what's left. A namespace made by `CreateNamespace=true` isn't one of the Application's resources.
   - Decide how the namespace gets deleted with the PR. If the chart renders it, the `AppProject` must allow the cluster-scoped `Namespace` kind.
   - Confirm the generated Applications carry the `resources-finalizer.argocd.argoproj.io` finalizer.
6. **The race.** Push a commit and watch the pods while CI is still building. Argo CD may roll out the new SHA before the image exists. Watch the old pod keep serving while the new one sits in `ImagePullBackOff`, and note how long the preview takes to recover.
   - This is why "the preview is healthy" isn't the same as "the preview runs my commit".
   - A small win: start the image build in parallel with `checks`.

### How to verify

Done when:

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

- `scripts/wait-for-preview.ts`, or `.sh`. Node 24 runs `.ts` files directly.
- A `preview-e2e` job in `.github/workflows/pr.yml`.

### What to implement yourself

1. **Wait script.**
   - Poll `<url>/api/health` every few seconds until it returns 200 and `commitSha` equals the expected SHA, or a deadline passes (about 10 minutes).
   - On timeout, say which failure it was: unreachable, a 5xx, or healthy at the wrong SHA (print it).
   - Exit non-zero.
2. **Validate locally first.** Run the script and then the suite against your kind preview from your Mac. That's exactly what the CI job will do.
3. **`preview-e2e` job:**
   - Runs after `image`.
   - Only for PRs with the `preview` label: check `github.event.pull_request.labels.*.name`.
   - Skipped when the repo variable `PREVIEW_DOMAIN` is empty.
   - Steps:
     - Build the URL as `http://pr-<number>.<PREVIEW_DOMAIN>`.
     - Run the wait script with the head SHA.
     - Run Playwright with `BASE_URL` and `EXPECTED_COMMIT_SHA`.
     - Always upload the report and traces.
   - Set `timeout-minutes`.
4. **Report on the PR.** Use `environment: { name: preview, url: <preview url> }` so the PR shows a "View deployment" button. Write a short job summary: URL, SHA, pass/fail counts.

**Reachability:** GitHub-hosted runners can't reach `pr-N.127.0.0.1.nip.io` on your laptop. While you're on kind, leave `PREVIEW_DOMAIN` unset so the job is skipped, and prove the logic with step 2. The job goes live in Milestone 8, when you set `PREVIEW_DOMAIN` to the EC2 domain.

Don't use a quick tunnel that exposes your laptop, and don't register a self-hosted runner on your Mac for a public repo.

### How to verify

Done when:

- [ ] Locally, the wait script blocks during a rollout and returns the moment the new SHA is live.
- [ ] Locally, the wait script fails clearly within its deadline when you point it at a wrong SHA or a dead host.
- [ ] Without `PREVIEW_DOMAIN`, the job shows as skipped, not failed.
- [ ] After Milestone 8: a labeled PR runs `checks` → `image` → `preview-e2e` green. The PR shows the deployment link, and a deliberately broken test leaves a trace you can open with `npx playwright show-trace`.

### Common mistakes and debugging

- **Waiting on HTTP 200 alone.** The old pod returns 200 for the whole rollout.
- **No deadline.** A job default of 6 hours burns minutes and hides the real failure.
- **The `playwright.config.ts` webServer still starts.** It only starts when `BASE_URL` is unset, so check the variable actually reaches the step.
- **Uploading artifacts only on success.**
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
- `deploy/argocd/previews-appset.ec2.yaml`, or a values overlay: the same ApplicationSet with the EC2 domain.

### What to implement yourself

1. **Account hygiene,** before launching anything:
   - Turn on MFA for the root account and stop using it.
   - Create an admin identity with MFA, through IAM Identity Center or an IAM user.
   - Create an AWS Budget with alerts at around $10 and $25, actual and forecasted.
2. **Instance:**
   - Ubuntu 24.04 LTS.
   - `t3.medium`: x86_64, 2 vCPU, 4 GiB. 2 GiB is too tight for k3s plus Argo CD plus previews.
   - 30 GiB of encrypted gp3.
   - IMDSv2 required.
   - No instance role, or only `AmazonSSMManagedInstanceCore` if you use Session Manager instead of SSH.
3. **Security group:**
   - Port 22 from your IP `/32` only, or no SSH at all with Session Manager.
   - Ports 80 and 443 from `0.0.0.0/0`, because GitHub-hosted runners come from a huge, changing IP range. Milestone 9 removes this.
   - Never open 6443 (the Kubernetes API) or the Argo CD UI.
4. **Bootstrap:**
   - Install k3s with a pinned version. It includes Traefik on ports 80 and 443, so don't install a second ingress controller.
   - Install Argo CD with the same pinned version as local.
   - Create the token Secret, the AppProject and the ApplicationSet. The domain is `<public-ip>.nip.io`.
5. **Kubernetes API from your Mac.** Copy `/etc/rancher/k3s/k3s.yaml`, keep its server address as `127.0.0.1`, and tunnel: `ssh -L 6443:127.0.0.1:6443 ubuntu@<ip>`.
6. **Wire up CI.** Set the repo variable `PREVIEW_DOMAIN=<public-ip>.nip.io`. Milestone 7's job now runs for real.
7. **Decide on the IP.**
   - Without an Elastic IP, the public IP changes on every stop and start, so `PREVIEW_DOMAIN` and the ApplicationSet must change with it.
   - An Elastic IP keeps the domain stable but costs money even while the instance is stopped.
8. **Auto-stop.** Shut the instance down every night, with a cron `shutdown -h` inside the instance or EventBridge Scheduler. The instance's shutdown behavior must be "stop", not "terminate".

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
- Turn on `unattended-upgrades` for OS security patches.

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
- **Everything broke after stop and start.** The public IP changed. See step 7.
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

### What to implement yourself

1. **Register the runner** on the EC2 instance:
   - Use a dedicated non-root user with no sudo and no kubeconfig.
   - Give it the label `preview-net`.
   - Install it as a service so it survives reboots.
2. **Install Playwright's system dependencies** once on the host, or run the job inside the official Playwright container image.
3. **Move only `preview-e2e`** to the self-hosted runner. Keep `checks` and `image` on GitHub-hosted runners.
4. **Close the internet off.**
   - Restrict ports 80 and 443 to your IP.
   - The runner must still reach the previews. Either:
     - switch `PREVIEW_DOMAIN` to the instance's private IP (`<private-ip>.nip.io`), which stays stable across stop and start, or
     - allow the instance's own public IP in the security group.
5. **Watch resource contention.** Playwright, Next.js, k3s and Argo CD now share 2 vCPU. Set Playwright `workers` to 1 in CI, or move up to t3.large.

### How to verify

Done when:

- [ ] The runner shows as Idle under Settings → Actions → Runners, and `preview-e2e` logs show your runner's name.
- [ ] With ports 80 and 443 closed to the world, `preview-e2e` still passes.
- [ ] `curl` to the preview from outside your IP fails, as expected.
- [ ] The runner user can't `sudo` or run `kubectl`.

### Common mistakes and debugging

- **Runner registered as root, or the registration token expired.** Tokens last about an hour.
- **Runner shows as offline after a reboot.** It wasn't installed as a service.
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
