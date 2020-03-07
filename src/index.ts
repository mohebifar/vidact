import { transform } from "@babel/core";

const code = `
function MyComponent(props) {
  const b = props.mySecondProp * 9;

  let x = 0;
  for(var l = 10; l < 20; l++) {
    x += l % b;
  }

  return (<div>
    Test Here {b * 2 + Math.random()}
    <div>{x}</div>
    <div>Migam ke</div>
    {props.alo}
  </div>);
}
`;

const output = transform(code, {
  plugins: [__dirname + "/plugin"]
});

console.log("---------");
console.log("= Input =");
console.log("---------");
console.log(code);
console.log("----------");
console.log("= Output =");
console.log("----------");
console.log(output.code);
