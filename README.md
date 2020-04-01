# Coroact

Coroact compiles your React source codes to VanillaJS code with **No Virtual DOM** ™️. It is similar to Svelte, but unlike [Svelte](https://svelte.dev/), Coroact is not a "language" and does not introduce a new syntax. It takes in pure JavaScript (or JSX to be accurate) and outputs JavaScript.

It currently is in alpha phase and has known limitations. It does not fully comply with React's behaviour in some edge cases, and probably never will, but the goal is to get the behaviour as close as possible

# Roadmap

- [x] JSX conversion for native HTML elements
- [x] JSX conversion for component elements
- [x] Support event listeners for native HTML elements
  * Proxy onChange for text inputs and textarea
- [x] Support inline styles
- [x] Reactive props
- [x] Stateful components
- [x] Basic array child nodes support
- [ ] Improve array child support
  * Avoid refreshing elements with the same key and only do prop updates instead
  * Avoid refreshing rearranged elements with the same key
- [ ] SVG support
- [ ] Support components with multiple conditional return statements
- [ ] Support context
