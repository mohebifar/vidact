import propUpdater from "!raw-loader!../src/runtime/propUpdater";
import createElement from "!raw-loader!../src/runtime/createElement";
import createText from "!raw-loader!../src/runtime/createText";
import append from "!raw-loader!../src/runtime/append";
import setContent from "!raw-loader!../src/runtime/setContent";
import consolidateExecuters from "!raw-loader!../src/runtime/consolidateExecuters";
import addPropTransaction from "!raw-loader!../src/runtime/addPropTransaction";

const files = {
  propUpdater,
  createElement,
  createText,
  append,
  setContent,
  consolidateExecuters,
  addPropTransaction,
};

export function readFileSync(inputFile) {
  for (const file in files) {
    if (new RegExp(`${file}(\.js)?$`).test(inputFile)) {
      return files[file];
    }
  }

  return `"Module ${inputFile} not found"`;
}
