# autoware-repos-visualizer

An interactive swimlane visualizer for the per-repository pin history of
[`autoware.repos`](https://github.com/autowarefoundation/autoware/blob/main/repositories/autoware.repos)
across Autoware releases.

Live: <https://autowarefoundation.github.io/autoware-repos-visualizer/>

## What it shows

- One lane per repository: the meta repo on top, then the `core`,
  `universe`, `launcher`, and `sensor_component` groups.
- One dot per commit on each lane's default branch. Time on the X axis,
  newest on the left.
- The current `autoware.repos` pin renders as an accent-colored bubble.
  Hollow accent rings at the lane edges mark pins that fall outside the
  current zoom window, so no pin is ever hidden.
- Selecting an Autoware version in the right sidebar draws a colored
  polyline through every sub-repo's pin for that release. Tagged commits
  on the meta lane are always shown in the version's color.
- A dashed vertical line marks "now".

## Run locally

The frontend reads `web/public/data/commits.json`. Two ways to populate
it:

### Quick (UI changes only)

Reuse the snapshot the deployed site already serves.

```bash
cd web
npm ci
mkdir -p public/data
curl -fsSL \
  https://raw.githubusercontent.com/autowarefoundation/autoware-repos-visualizer/data/commits.json \
  -o public/data/commits.json
npm run dev
```

### Full (regenerate data locally)

Requires cloning the meta repo plus every entry in `autoware.repos`
(several GB total).

```bash
git clone https://github.com/autowarefoundation/autoware.git \
  autoware-meta/autoware

pip install vcstool
mkdir -p src
vcs import src < autoware-meta/autoware/repositories/autoware.repos

cd web
npm ci
npm run data
npm run dev
```

## Architecture

```
.
├── autoware-meta/autoware/   upstream meta repo; drives autoware.repos at every tag
├── src/                      sub-repo clones; drive per-lane commit history
└── web/
    ├── scripts/generate-data.ts   builds commits.json from the two clone trees
    └── src/                       Vite + Svelte + TypeScript + d3 swimlane
```

Two GitHub Actions decouple data refresh from frontend deploy:

- [`update-data.yml`](.github/workflows/update-data.yml): daily cron
  plus manual dispatch. Caches the heavy clone trees, reconciles `src/`
  against the latest `autoware.repos`, regenerates `commits.json`, and
  force-pushes it onto an orphan
  [`data`](https://github.com/autowarefoundation/autoware-repos-visualizer/tree/data)
  branch.
- [`pages.yml`](.github/workflows/pages.yml): runs on push to `main`
  and after every successful `update-data` run. Pulls `commits.json`
  from the `data` branch via `git show`, builds the static site, and
  deploys to GitHub Pages.

The split keeps Pages builds fast and the `main` branch code-only.
