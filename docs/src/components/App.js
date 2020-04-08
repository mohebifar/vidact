import Repl from "./Repl";

import * as styles from "./App.css";

const helloWorldCode = `function App() {
    return (
        <div>
            Hello World!
        </div>
    );
}

document.body.innerHTML = "";
document.body.append(App({}).element.element);
`;

const statefulCode = `function App() {
    const [counter, setCounter] = useState(0);
    const handleIncrement = () => setCounter(counter + 1);
    const handleDecrement = () => setCounter(counter - 1);

    return (
        <div>
            <p>Current count is {counter}</p>
            <button onClick={handleIncrement}>
                + Increment
            </button>
            <button onClick={handleDecrement}>
                - Decrement
            </button>
        </div>
    );
}

document.body.innerHTML = "";
document.body.append(App({}).element.element);
`;

const useRefCode = `function App() {
    const colors = ["tomato", "teal", "red", "green", "yellow"];
    const wrapperRef = useRef();
    const currentIndex = useRef(0);
    useEffect(() => {
        setInterval(() => {
            wrapperRef.current.style.backgroundColor = colors[currentIndex.current++ % colors.length];
        }, 500);
    }, []);

    return (
        <div ref={wrapperRef}>
            My background color is changing by direct DOM manipulation using useRef
        </div>
    );
}

document.body.innerHTML = "";
document.body.append(App({}).element.element);
`;

const memoizeCode = `function App() {
    const [a, setA] = useState(0);
    const [b, setB] = useState(0);
    const updateA = useCallback(() => setA(Math.random()), []);
    const updateB = useCallback(() => setB(Math.random()), []);
    const aMemoizedByB = useMemo(() => a, [b]);

    return (
        <div>
            <div>A value: {a}</div>
            <div>B value: {b}</div>
            <div>A Memoizied by B: {aMemoizedByB}</div>
            <button onClick={updateA}>
                Change State A
            </button>
            <button onClick={updateB}>
                Change State B
            </button>
        </div>
    );
}

document.body.innerHTML = "";
document.body.append(App({}).element.element);
`;

const propsCode = `function App() {
    const [text, setText] = useState("Vidact is cool!");
    const [random, setRandom] = useState(1);
    const rollDice = useCallback(() => {
        setRandom(Math.ceil(Math.random() * 6));
    }, []);

    return (
        <div>
            <h3>{text}</h3>
            <TextInput value={text} onChange={setText} />
            <div>
                <Button color="#c8d6e5" onClick={rollDice}>
                    Roll dice: {random}
                </Button>
            </div>
        </div>
    );
}

function Button(props) {
    return <button
        style={{ backgroundColor: props.color, padding: 10 }}
        onClick={props.onClick}
    >
        {props.children}
    </button>
}

function TextInput(props) {
    return (
        <input
            style={{ padding: 10 }}
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
        />
    )
}

document.body.innerHTML = "";
document.body.append(App({}).element.element);
`;

function App() {
  return (
    <div>
      <div className={styles.hero}>
        <h1>Vidact</h1>
        <h3>
          A compiler that converts React-compatible codes to{" "}
          <strong>VanillaJS with no Virtual DOM</strong>
        </h3>
        <p>
          <a target="_blank" href="https://github.com/mohebifar/vidact">
            View source code on Github
          </a>
        </p>
        <iframe
          src="https://ghbtns.com/github-btn.html?user=mohebifar&repo=vidact&type=star&count=true&size=large"
          frameborder="0"
          scrolling="0"
          width="120px"
          height="30px"
        />
      </div>
      <div className={styles.container}>
        <div>
          Vidact compiles your React source codes to VanillaJS code with{" "}
          <strong>No Virtual DOM</strong> ™️. It is similar to{" "}
          <a href="https://svelte.dev/" target="_blank">
            Svelte
          </a>
          , but unlike Svelte, Vidact does not introduce a new syntax. It takes
          in pure React-compatible JavaScript (JSX) and outputs plain
          JavaScript. Vidact currently is in alpha phase and has known
          limitations. It does not fully comply with React's behaviour in some
          edge cases, and probably never will, but the goal is to get as close
          behaviour to React as possible. Also, it currently only supports
          functional components and does not support class components.
        </div>
        <p>
          <strong>📣 Vidact is not ready for production yet.</strong> It is
          currently in alpha phase and has{" "}
          <a target="_blank" href="https://github.com/mohebifar/vidact#roadmap">
            known limitations.
          </a>
        </p>
        <div>
          <h3>Simple DOM Render</h3>
          <div className={styles.replContainer}>
            <Repl initialCode={helloWorldCode} />
          </div>
        </div>
        <div>
          <h3>Stateful components</h3>
          <div className={styles.replContainer}>
            <Repl initialCode={statefulCode} />
          </div>
        </div>
        <div>
          <h3>Passing props</h3>
          <div className={styles.replContainer}>
            <Repl initialCode={propsCode} />
          </div>
        </div>
        <div>
          <h3>useRef and useEffect Hooks</h3>
          <div className={styles.replContainer}>
            <Repl initialCode={useRefCode} />
          </div>
        </div>
        <div>
          <h3>useMemo</h3>
          <div className={styles.replContainer}>
            <Repl initialCode={memoizeCode} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
