import { transform } from "@babel/standalone";

function transformCode(content, runtime = "module") {
  const { code } = transform(content, {
    plugins: [[require("../../../build"), { runtime }]],
  });

  return code;
}

export default transformCode;
