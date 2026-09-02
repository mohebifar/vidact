import { packageManagers } from './package-manager.ts'
import { templates } from './templates.ts'

export function helpText(): string {
  const templateLines = templates
    .map((template) => `  ${template.name.padEnd(22)}${template.description}`)
    .join('\n')

  return `Create a new Vidact project.

Usage
  vidact [directory] [options]

Options
  -t, --template <name>         Template to generate (${templates.map(({ name }) => name).join(', ')})
  -p, --package-manager <name>  Package manager to use (${packageManagers.join(', ')})
      --install, --no-install   Install dependencies after generating
      --git, --no-git           Initialize a git repository
  -y, --yes                     Accept the defaults without prompting
  -h, --help                    Show this message
  -v, --version                 Show the version

Templates
${templateLines}

Examples
  npx vidact my-app
  npx vidact my-app --template start --no-install
`
}
