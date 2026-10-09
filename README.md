# Aurevia AV-301: governed release demo

A fictional clinical-trial microsite (Singapore, Indonesia and Vietnam) published through a governed pipeline on Cloudflare Workers Static Assets. It is the live demo for slide 10:

> **One approval. One visible change. One release identity.**
> An unapproved change cannot reach production. An approved change reaches production as the exact bundle that was reviewed, and you can prove it.

| What the panel sees | What enforces it |
|---|---|
| Production still says **Recruiting** while the change waits | GitHub `production` environment with required reviewers. The production API token only exists inside that job. |
| The candidate is visible only behind a login | Cloudflare Access on the staging Worker. CI checks that an unauthenticated request is refused. |
| The approved bundle is what goes live | Build once, then a SHA-256 manifest. `verify-bundle` runs before each deploy, and `smoke` hashes every live file afterwards. |
| The change is tied to an MLR approval | `validate` refuses a snapshot whose approval doesn't match its exact content version. `promotion-check` re-checks validity at the gate. |
| Recovery is controlled | `rollback` workflow: explicit Worker version, content-authority confirmation, same approval gate. |
| Delivery is measured, not claimed | `ttfb` takes a fresh connection per run and reports the median, the range and the serving colo. |

All content is fictional. No patient data. The MLR approval is simulated as a field in the content snapshot. In a real deployment, an adapter would read it from Veeva or the customer's MLR system.

---

## Repository map

```
content/trial.json            approved content snapshot (what the MLR adapter would export)
site/styles.css               stylesheet (gets a content-hashed filename at build)
scripts/build.mjs             build once: pages per market, hreflang, _headers, release.json, manifest
scripts/validate.mjs          schema, dates, approval bound to this exact content version
scripts/verify-bundle.mjs     artifact integrity against the manifest (+ expected digest / release)
scripts/promotion-check.mjs   approval still valid at the moment of promotion
scripts/smoke.mjs             live site = approved bundle; headers; 404; Access boundary
scripts/ttfb.mjs              TTFB median/range + Cloudflare colo
scripts/demo-change.mjs       rehearsal: simulate a newly approved snapshot (pause / resume)
scripts/demo-negative.mjs     laptop proof that 4 unsafe releases are blocked
.github/workflows/ci.yml      pull requests: validate, test, build, negative cases (no secrets)
.github/workflows/release.yml build once → protected staging → approval gate → production → verify
.github/workflows/rollback.yml restore an explicit, still-approved version
wrangler.jsonc                assets-only Worker; production + env.staging; no preview URLs
```

Local commands:

```bash
npm ci
npm run check            # validate + 11 tests + build + verify
npm run dev              # build and serve on http://localhost:8787
npm run smoke:local      # verify the local server is serving the built bundle
npm run demo:blocked     # 4 unsafe releases, all blocked
```

---

## One-time setup (about 45–60 minutes)

You need Node 22, Git, a GitHub account and a Cloudflare account. The Workers free plan is enough.

### 1. GitHub repository

Create a **public** repository, for example `aurevia-release-demo`. Environment protection rules such as required reviewers are available on public repositories on every GitHub plan. On private repositories they depend on your plan, so check GitHub's docs if you go private. The content is fictional, so public is fine.

```bash
cd aurevia-release-demo
git init -b main && git add -A && git commit -m "Aurevia governed release demo"
git remote add origin https://github.com/<you>/aurevia-release-demo.git
git push -u origin main      # the release run will fail at the staging step until setup is complete; that's expected
```

### 2. Cloudflare account values

1. **Account ID.** Dashboard → Workers & Pages → copy *Account ID* from the right-hand panel.
2. **workers.dev subdomain.** Workers & Pages → Settings shows `<sub>.workers.dev`. Set one if you haven't already.
   - Production URL: `https://aurevia-trial.<sub>.workers.dev`
   - Staging URL: `https://aurevia-trial-staging.<sub>.workers.dev`
3. **API token.** My Profile → API Tokens → Create Token → *Edit Cloudflare Workers* template. Restrict it to your account and copy it.
   - Better practice: create two tokens, one for staging and one for production.

### 3. Create the staging Worker and protect it with Access

```bash
npx wrangler login
npm run build
npx wrangler deploy --env staging
```

Then protect it:

1. Workers & Pages → **aurevia-trial-staging** → Settings → Domains & Routes → on the `workers.dev` row, choose **Enable Cloudflare Access**.
   - If your dashboard looks different, use Zero Trust → Access → Applications → Add a *self-hosted* application for `aurevia-trial-staging.<sub>.workers.dev` instead.
   - The first time you use Zero Trust, it asks you to pick a team name and the Free plan.
2. Edit the Access policy so that only your email can log in.
3. Optional, recommended: let CI verify the candidate.
   - Zero Trust → Access → Service credentials → **Create service token**, and keep the Client ID and Secret.
   - Add a second policy to the staging application: Action **Service Auth**, Include **Service Token** set to that token.

Check the protection:

```bash
node scripts/smoke.mjs https://aurevia-trial-staging.<sub>.workers.dev --expect-protected
# ✓ ... is not public: unauthenticated request got HTTP 302 (Access challenge)
```

### 4. GitHub settings

**Settings → Secrets and variables → Actions → Variables** (repository level):

| Variable | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | your Account ID |
| `PRODUCTION_URL` | `https://aurevia-trial.<sub>.workers.dev` |
| `STAGING_URL` | `https://aurevia-trial-staging.<sub>.workers.dev` |

**Settings → Environments → New environment `staging`:**
- Secret `CLOUDFLARE_API_TOKEN`
- Optional secrets `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` (the service token)

**Settings → Environments → New environment `production`:**
- **Required reviewers:** yourself, plus a second GitHub account if you have one.
- **Prevent self-review:** turn this on only if a second reviewer exists. Otherwise you couldn't approve your own demo.
- **Deployment branches and tags:** *Selected branches* → `main`.
- Secret `CLOUDFLARE_API_TOKEN`. It lives only here, so it is only released after approval.

Optional, and good to show: **Settings → Branches** → protect `main` (require a pull request and the `ci / Validate, test, build` check).

### 5. First governed release

Actions → **release** → *Run workflow* (or push a commit). The run goes like this:

1. **Build once.** Validates, tests and builds. The summary shows the release ID, MLR reference and digest.
2. **Candidate on protected staging.** Deploys, then proves staging is *not* public.
3. **Promote approved release.** Waits. Click **Review deployments** → `production` → Approve.

After approval, the job verifies the bundle digest, re-checks the approval and deploys. It then hashes every live file against the manifest, probes TTFB, and writes a **release record** (approver, Worker version ID, digest) to the summary and to an artifact.

Production now shows **Recruiting**. From the job summary, note the **Worker version ID**: it is your rollback target in Q&A.

---

## Rehearsal and interview-day setup

The demo needs this state when you walk in: **production = Recruiting, and a candidate "Enrollment paused" release waiting at the gate.**

### Getting into the demo state (repeatable)

```bash
# Only if production currently shows "Enrollment paused" from a previous rehearsal:
npm run demo:resume                      # new version, "recruiting", next MLR ref
git checkout -b resume && git commit -am "AV-301: recruiting" && git push -u origin HEAD
# → open PR → ci passes → merge → approve the release run → production = Recruiting

# 30–60 minutes before the interview:
git checkout main && git pull
npm run demo:pause                       # new version, "enrollment-paused", next MLR ref
git checkout -b pause-enrollment && git commit -am "AV-301: pause enrollment" && git push -u origin HEAD
# → open PR → ci passes → merge → release run builds, deploys staging, WAITS at production
```

Before the interview, reject or cancel any older run that is still waiting. Runs share one concurrency group, so a new run queues behind an old one.

### Dress rehearsal checklist (the day before)

- [ ] Run the whole flow twice, end to end.
- [ ] **Record one complete run** (screen and voice) as a fallback video.
- [ ] Save the numbers you'll quote:
  - `npm run ttfb -- $PRODUCTION_URL/sg/en/ --runs 5` from your laptop (Singapore, colo `SIN` expected);
  - the runner probe from the job summary (a different colo).
- [ ] Update slide 10 and backup 26 with those measured numbers, and **delete the "remain the rehearsal gate" caveat**.
- [ ] Note the previous production Worker version ID, for the rollback question.
- [ ] Log in to staging (Access) in your demo browser profile, and keep an incognito window ready.

### Tabs to have open before you start

1. **Production** `/sg/en/` (Recruiting)
2. **Staging** `/sg/en/`, logged in (Enrollment paused)
3. **Incognito** window on the staging URL (shows the Access login)
4. **GitHub Actions** release run, at the waiting production job
5. **Terminal** in the repository, font size raised, with `PROD=https://aurevia-trial.<sub>.workers.dev` exported

---

## Live demo script (3:30)

| Time | Show | Say |
|---|---|---|
| 0:00–0:25 | Tab 1, production | "Medical review has approved pausing enrollment for AV-301, under reference 0157. The change merged an hour ago. Production still says **Recruiting**, because nobody has authorised the release." |
| 0:25–1:05 | Tab 2, staging. Then tab 3, incognito | "This is the release candidate, built once from the approved snapshot. The page shows its release ID and the approval reference. It isn't public: without a login, Access stops you here." |
| 1:05–1:20 | Tab 4, run summary | "The pipeline has already validated, tested and fingerprinted every file. This digest is what we approve, not a branch." |
| 1:20–1:45 | **Review deployments** → production → comment `MLR-AV301-0157 verified on staging` → **Approve** | "This is the release authority. Only now does the production credential exist in the job. It will re-verify the digest and re-check that the approval hasn't expired." |
| 1:45–2:45 | Tab 5: `npm run demo:blocked` (while it deploys) | "While it promotes, here's what the gates refuse: a change without matching approval, a bundle edited after build, a different bundle swapped in, and an approval that expired while waiting. Four unsafe releases, all blocked." |
| 2:45–3:30 | Tab 1, refresh (**Enrollment paused**). Run summary: *Live*, approver, version ID, TTFB table. Tab 5: `npm run smoke -- $PROD --expect-release <id>` and `npm run ttfb -- $PROD/sg/en/` | "Production now serves the approved release. Same ID, every file byte-identical to what we reviewed. Here's who approved it and the version we'd roll back to. Delivered from Singapore at a median of __ ms first byte." |

**If anything stalls for more than 20 seconds,** switch to the recording and say so: "Here is the same flow recorded yesterday on this account."

### Ready for Q&A

- **"Roll it back."** Actions → rollback → paste the previous version ID, enter a reason, tick *content still approved*, approve. Then show the summary with the seconds taken.
- **"What if the content was withdrawn?"** Not a rollback. The workflow refuses unless the content is confirmed still approved, so you publish an approved correction instead.
- **"Can someone change it after approval?"** Run `npm run demo:blocked`, or show the `verify-bundle` step in the production job.
- **"Who approved this page on that date?"** Open the `release-record-*` artifact: MLR reference, release approver, Worker version, digest, time.

### Be upfront about what the demo simplifies

- One Cloudflare account and two Workers. The enterprise target is separate non-production and production accounts.
- You are both presenter and approver. In production, roles are separated: self-review is prevented, and the content authority and the release authority are independent gates.
- The MLR approval is a field in the snapshot. In reality, an adapter reads it from the MLR system.
- It runs on `workers.dev`. Production would use a custom domain on the customer's zone with WAF in front, and `workers_dev: false`.
- TTFB comes from your laptop and one GitHub runner. That is an indication, not a regional study (see backup 26 for the full method).
