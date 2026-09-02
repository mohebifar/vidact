# vidact

The project generator for [Vidact](https://github.com/mohebifar/vidact). It writes a ready-to-run
application, so there is nothing to wire up by hand.

```sh
npx vidact my-app
```

Answer the prompts, or pass everything up front:

```sh
npx vidact my-app --template start --package-manager pnpm --install --git
```

## Templates

| Template | What you get                                                                |
| -------- | --------------------------------------------------------------------------- |
| `spa`    | Vite, the Vidact compiler plugin, and a client-rendered entry point         |
| `start`  | Vidact Start with file routes, loaders, server rendering, and hydration     |
| `nitro`  | The same full-stack app served by Nitro, with a preset for every major host |

## Options

```
vidact [directory] [options]

  -t, --template <name>         Template to generate (spa, start, nitro)
  -p, --package-manager <name>  Package manager to use (npm, pnpm, yarn, bun, deno)
      --install, --no-install   Install dependencies after generating
      --git, --no-git           Initialize a git repository
  -y, --yes                     Accept the defaults without prompting
  -h, --help                    Show the help text
  -v, --version                 Show the version
```

The directory defaults to `vidact-app`, and the package manager is detected from the one that
invoked the CLI, falling back to the lockfiles around it. Without a TTY the CLI never prompts: it
takes the defaults, and skips installing and `git init` unless you ask for them.
