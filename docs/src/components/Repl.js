import debounce from "lodash/debounce";

import srcdoc from "!raw-loader!../assets/repl_iframe.html";
import "!style-loader!css-loader!monaco-editor/min/vs/editor/editor.main.css";

import CodeInput from "./CodeInput";
import transformCode from "../utils/transformCode";

import * as styles from "./Repl.css";

let i = 0;

function Repl(props) {
  const iframe = useRef();
  const [outputCode, setOutputCode] = useState("");
  const [error, setError] = useState();

  const handleChange = debounce(
    (content) => {
      try {
        const code = transformCode(content);

        if (code) {
          setOutputCode(code);
          const inlineCode = transformCode(content, "inline");
          iframe.current.contentWindow.postMessage(
            {
              action: "eval",
              cmd_id: i++,
              args: {
                script: `(function() {\n${inlineCode}\n})()`,
              },
            },
            "*"
          );
        }
      } catch (error) {
        setError(error.message.split("\n")[0]);
      }
    },
    100,
    { leading: true }
  );

  useEffect(() => {
    iframe.current.addEventListener("load", () => {
      handleChange(props.initialCode);

      window.addEventListener("message", ({ data }) => {
        if (data.action === "cmd_error") {
          setError(data.message);
        } else if (data.action === "cmd_ok") {
          setError(undefined);
        }
      });
    });
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.codeInputOutputWrapper}>
        <CodeInput
          heading="JS Input"
          code={props.initialCode}
          onChange={handleChange}
        />
        <CodeInput heading="JS Output" code={outputCode} readOnly={true} />
      </div>
      <div className={styles.resultWrapper}>
        <h2 className="repl-heading">Result</h2>
        <iframe ref={iframe} className={styles.resultIFrame} srcDoc={srcdoc} />
      </div>

      <div className={styles.error}>{error}</div>
    </div>
  );
}

export default Repl;
