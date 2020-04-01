import { createText } from "./createNativeDom";

export function setContent(element, content) {
  const isCurrentElementText = element instanceof Text;
  const isNewContentNativeNode = (content && content.native) || false;

  if (isNewContentNativeNode) {
    content = content.element;
  }

  if (element === content) {
    return element;
  }

  if (Array.isArray(content)) {
    const normalizedElements = content.map(e =>
      setContent(createText().element, e)
    );

    if (Array.isArray(element)) {
      const newNode = replaceArrayWithText(element);

      if (normalizedElements.length === 0) {
        return newNode;
      } else {
        newNode.replaceWith(...normalizedElements);
      }
    } else {
      if (normalizedElements.length === 0) {
        return setContent(element, "");
      } else {
        element.replaceWith(...normalizedElements);
      }
    }

    return normalizedElements;
  }

  if (Array.isArray(element)) {
    element = replaceArrayWithText(element);
  }

  if (content instanceof Node) {
    element.replaceWith(content);
    return content;
  } else if (!isCurrentElementText) {
    const text = createText(content).element;
    element.replaceWith(text);
    return text;
  } else {
    element.textContent = content || "";
    return element;
  }
}

function replaceArrayWithText(element) {
  const parent = element[0].parentNode;
  const newNode = createText().element;
  let i = element.length;
  while (i--) {
    const currentNode = element[i];
    if (!i) {
      parent.replaceChild(newNode, currentNode);
    } else {
      parent.removeChild(currentNode);
    }
  }
  return newNode;
}
