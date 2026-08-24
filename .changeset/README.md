# Changesets

Every pull request must include a changeset file. For a published-package
change, run `pnpm changeset`, select the affected packages and bump level, then
commit the generated Markdown file with the code change. Use
`pnpm changeset --empty` when a pull request intentionally has no package
release.

The five public Vidact packages form one fixed release group. A bump to any one
of them versions all five together. The Version Packages workflow consumes
merged changesets and opens or updates the coordinated release pull request.
