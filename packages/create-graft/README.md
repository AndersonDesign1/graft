# create-graft

Make a new [Graft](https://graft.page) site:

```sh
npm create graft@latest my-site
```

It asks what kind of site you want, how people will edit it, and whether to
make a free database. Then it writes the site, installs it and loads example
content. Every question has a flag, so a coding agent can run it without
prompts:

```sh
npm create graft@latest my-site -- --template blog --edit online --database new --yes
```

This runs `graft create` from `@usegraft/cli`; `npx graft create --help` lists
every option.
