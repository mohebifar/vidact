# Vidact

Vidact compiles your React source codes to VanillaJS code with **No Virtual DOM** ™️. It is similar to Svelte, but unlike [Svelte](https://svelte.dev/), Vidact does not introduce a new syntax. It takes in pure React-compatible JavaScript (JSX) and outputs plain JavaScript.

Vidact currently is in alpha phase and has known limitations. It does not fully comply with React's behaviour in some edge cases, and probably never will, but the goal is to get as close behaviour to React as possible. Also, it currently only supports functional components and does not support class components.

## How does it work and how is it different from React?

Vidact is a babel-plugin that scans your source code to find what parts of the UI need to be updated in response to a prop or state change and generates a plain JavaScript code that should have the same DOM result as the equivalent React code. Note that all of this is done in build time! Whereas React does the bulk of its work in runtime in the browser by leveraging Virtual DOMs to determine what needs to be updated in the actual DOM.

## When should I use it instead of React?

_Vidact is not currently ready to be used in production._

The goal is to have an alternative library for those who love React, but are looking for a more lightweight and high-performance implementation for smaller projects.

# Roadmap

- [x] JSX conversion for native HTML elements
- [x] JSX conversion for component elements
- [x] Support event listeners for native HTML elements
  - Proxy onChange for text inputs and textarea
- [x] Support inline styles
- [x] Reactive props
- [x] Basic array child nodes support
- [x] useState: Stateful components
- [ ] Dangerously set innerHTML
- [x] useRef
- [x] useEffect
- [ ] useEffect with cleanup (detect component unmount)
- [x] useCallback
- [x] useMemo
- [ ] Conditional expression performance
- [ ] Support custom hook functions built upon native hooks
- [ ] Improve array child support
  - Avoid refreshing elements with the same key and only do prop updates instead
  - Avoid refreshing rearranged elements with the same key
- [ ] SVG support
- [ ] Support components with multiple conditional return statements
- [ ] Support context
- [ ] SSR support
- [ ] Props spread
