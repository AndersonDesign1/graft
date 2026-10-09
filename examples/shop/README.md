# shop

A product catalog on Graft, edited in Studio. It is the example for hosting
Studio for a content team: products with prices, variants, galleries,
categories and related products, edited by people who never see a file.

## Run it locally

```sh
cp .env.example .env            # DATABASE_URL for a local Postgres
pnpm exec graft db migrate
pnpm compile
pnpm studio                     # http://127.0.0.1:4983
```

Locally, saves go to the files under `content/` and Publish is a Git commit.

To try Studio on a large catalog, generate one (and put the committed
catalog back afterwards with `pnpm seed`, which writes the same 48 products):

```sh
pnpm seed --count 2000
pnpm compile
```

## Host it

Hosted, Studio saves to GitHub instead: each editor drafts on their own
branch, and publishing commits to `main` or opens a pull request. Run
`graft serve --studio` on any Node host with:

```sh
DATABASE_URL=…
GRAFT_STUDIO=1
GRAFT_STUDIO_SECRET=…                  # openssl rand -base64 48
GRAFT_STUDIO_URL=https://shop.example.com
GRAFT_GITHUB_REPO=acme/shop
GRAFT_GITHUB_TOKEN=…                   # or GRAFT_GITHUB_APP_ID + GRAFT_GITHUB_APP_PRIVATE_KEY
GRAFT_GITHUB_CONTENT_PATH=examples/shop/content   # where content/ sits in the repository
```

Then invite someone:

```sh
graft studio invite ana@shop.example.com --name "Ana Lima" --role editor
```

The whole setup, including GitHub sign-in and roles, is in the docs page
"Host Studio for your team" (`examples/docs-site/content/docs/studio-hosting.mdx`).

## Check hosted writes end to end

```sh
DATABASE_URL=postgres://… pnpm e2e:hosted
```

This deploys a copy of the shop with its content directory read-only, runs
`graft serve --studio` against a stand-in for GitHub served over HTTP, signs in
with an invite link, edits a price, and publishes. It checks that the save is a
commit on the editor's draft branch authored by them, that the deployed files
are untouched, that a stale save is refused, and that publishing lands one
commit on `main`. `E2E_KEEP=1` leaves it running so you can walk the same flow
in a browser.

To check against real GitHub, point the variables above at a test repository
and follow the checklist at the end of the hosting guide.
