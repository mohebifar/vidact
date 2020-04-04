export function createText(text = "") {
  const element = document.createTextNode(text || "");

  return {
    element,
    type: Text,
    native: true,
  };
}
