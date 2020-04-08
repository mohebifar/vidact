import * as monaco from "monaco-editor";

import * as styles from "./CodeInput.css";

function CodeInput(props) {
  const wrapper = useRef();
  const editor = useRef();
  const initialRenderDone = useRef(false);

  useEffect(() => {
    editor.current = monaco.editor.create(wrapper.current, {
      value: props.code,
      theme: "vs-dark",
      language: "javascript",
      minimap: { enabled: false },
      automaticLayout: true,
      readOnly: props.readOnly,
      wordWrap: "bounded",
    });

    editor.current.getModel().onDidChangeContent((event) => {
      if (props.onChange) {
        const content = editor.current.getModel().getLinesContent().join("\n");
        props.onChange(content);
      }
    });
  }, [wrapper]);

  useEffect(() => {
    if (initialRenderDone.current) {
      editor.current.setValue(props.code);
    }

    initialRenderDone.current = true;
  }, [props.code]);

  return (
    <div className={styles.container}>
      <h2 className="repl-heading">{props.heading}</h2>
      <div ref={wrapper} className={styles.wrapper} />
    </div>
  );
}

export default CodeInput;
