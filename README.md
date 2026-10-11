# Automation

Opt-in CI failure investigation for Jose Valerio's apps. A failed trusted
default-branch workflow can start an Amp orb that diagnoses the failure,
validates a fix locally, opens a ready-for-review PR, and automatically
squash-merges its own validated repair without another approval. It does not
bypass GitHub merge requirements or run deployment/release commands. Existing
default-branch workflows still run normally after a merge. Not every failure
has a code fix.

The implementation is a dependency-free Node 24 **shared GitHub Action**. Each
app has a small generated `workflow_run` listener pinned to one automation
commit. Using an action rather than a reusable job pins its code and policy
together, without separately fetching scripts or checking out the failed build.

## Coverage

The enrollment policy covers Caper, Captures, DBM, FindAnything, Credit Card
Horoscope, josevalerio.com, Godis, and infrastructure. It maps GitHub repositories
to exact Amp project references; repository URLs alone are ambiguous when several
Amp projects share the same Git repository. Only the named CI, image, native
build/release, and deployment workflows are enrolled. Runner watchdogs, install
workflows, notifications, tags, forks, PRs, and other events are not enrolled.

Deployment dispatches and FindAnything's chained release are supported explicitly;
their workflow SHA is not assumed to be the deployed application's revision.
Failures whose correct fix belongs in a different project produce a handoff,
not an automatic cross-project edit.

## Agent modes and subscriptions

Repairs explicitly use `--mode high` by default. The optional repository variable
`AMP_REPAIR_MODE=external-agent:claude-code` selects Claude Code for future
launches, using the token owner's linked Claude Pro/Max subscription. Only these
two modes are accepted; a raw Claude model mode does not use a Claude subscription.
High follows the owner's Amp model routing, including a linked ChatGPT subscription
for supported OpenAI models. Other model/tool usage and orbs can still cost Amp
credits; selecting a mode does not enforce subscription-only billing.

This is a **manual backup selector, not automatic high-to-Claude failover**.
Amp fixes a thread's mode when it starts, and an async launch response does not
report subsequent quota failures. A timeout may also leave a working agent.
Keep the reservation and reconcile the original thread before replacing it;
see [the recovery procedure](docs/rollout.md#agent-modes-and-manual-claude-code-recovery).

## Safety and limits

- Disabled unless the caller sets `AMP_REPAIR_ENABLED=true`. Dry-run mode needs
  no Amp key and performs no writes or launches.
- Re-fetch the run from GitHub and check repository identity, workflow file/name,
  allowed event, `main`, the latest attempt, and failed jobs/steps. A cancelled
  workflow with a failed step is eligible; ordinary cancellations are not.
- A push is superseded only by a newer trusted `main` push run of the same
  workflow (ID, file and enrolled name) on a different SHA. Workflow run numbers,
  not rerun timestamps, establish order. Unrelated commits/workflows, dispatches
  and same-SHA reruns do not suppress repair. The agent still fetches current
  `main` and verifies the failure remains relevant before editing.
- A newer matching run takes over regardless of status/conclusion, including
  queued, running and cancelled runs. This avoids concurrent/stale work, but a
  newer ordinary cancellation can leave an older failure needing human review;
  skipped events are not automatically replayed. Workflow lookup errors or
  truncated pagination stop before reservation/launch rather than guessing.
- One reservation per push commit across enrolled workflows, or per non-push run
  across reruns. Deploying two images at one infrastructure SHA uses two run keys.
- A labelled tracking issue is written **before** installing Amp or launching.
  Lost responses, runner termination, and reruns do not silently create another
  agent. Ambiguous launches require human reconciliation, not automatic retries.
- One open tracking issue or repair PR pauses new launches in that repository.
  There is **no daily launch cap**, dollar budget, or agent-runtime limit. Once
  a repair merges and closes its issue, a new failed fix commit is eligible too.
  The retired `AMP_REPAIR_DAILY_LIMIT` variable and `daily-limit` input are ignored.
- Caller concurrency queues up to 100 completions. Events beyond that GitHub
  queue limit can be cancelled. Events skipped while blocked are not
  replayed automatically; this is not a durable backlog of every failure.
- The listener never checks out failed-run code, downloads build artifacts, or
  passes its GitHub token to Amp. GitHub permissions are read-only except Issues.
- The repair agent merges only its own validated PR using the exact validated
  head SHA, without administrator bypass. An unverified fix or blocked merge
  stays open for human review. Normal main CI runs after the squash merge;
  repair PRs do not run CI. No GitHub repository auto-merge setting is required.

The agent's merge and operational restrictions are **instructions, not an authorization
sandbox**. Orbs inherit the selected Amp project's GitHub access, secrets, and
tools. Review that access before enabling unattended repairs. The Amp access
token can act as its owner and incurs their Amp usage/orb charges; it is not
limited to one repository. Use only trusted repositories and default-branch
maintainers. The action pin does not pin Amp itself: the official installer
downloads the current CLI at launch time.

## Setup and operation

See [the rollout and recovery runbook](docs/rollout.md). Merging the action and
listeners alone does not activate paid repairs. No AWS/Cloudflare infrastructure,
database migration, application service rollout, or client release is needed.

## Local validation

Requires Node 24; no dependency installation is needed:

```sh
npm run check
```

Tests exercise the action against a simulated GitHub HTTP API and an Amp launch
boundary, including cancellations, pagination, deduplication, uncapped distinct
failures, disabled/dry-run behavior, deployment identity, lost launch responses,
and the agent's merge instructions. They are not evidence of a real agent
completing or merging a fix. CI runs on default-branch pushes, never on PRs.

Workflow linting needs support for GitHub's documented `concurrency.queue` field.
Actionlint 1.7.12 does not have it; initial validation used the reviewed queue
support in [upstream PR #654](https://github.com/rhysd/actionlint/pull/654), built
from commit `644076a59742c2d1540ebd4686eab3c308f0e562`. Do not remove queuing or
suppress other diagnostics just to accommodate an older linter.
