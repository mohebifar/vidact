export function setContent(el, content) {
  const isCurrentElementText = el instanceof Text;

  if (el === content) {
    return el;
  }

  if (Array.isArray(content)) {
    const normalizedElements = content.map(e => setContent(createText(), e));

    if (Array.isArray(el)) {
      const newNode = replaceArrayWithText(el);

      if (normalizedElements.length === 0) {
        return newNode;
      } else {
        newNode.replaceWith(...normalizedElements);
      }
    } else {
      if (normalizedElements.length === 0) {
        return setContent(el, "");
      } else {
        el.replaceWith(...normalizedElements);
      }
    }

    return normalizedElements;
  }

  if (Array.isArray(el)) {
    el = replaceArrayWithText(el);
  }

  if (content instanceof Node) {
    el.replaceWith(content);
    return content;
  } else if (!isCurrentElementText) {
    const text = createText(content);
    el.replaceWith(text);
    return text;
  } else {
    el.textContent = content;
    return el;
  }

  function createText(text = "") {
    return document.createTextNode(text);
  }
}

function replaceArrayWithText(el) {
  const parent = el[0].parentNode;
  const newNode = createText();
  let i = el.length;
  while (i--) {
    const currentNode = el[i];
    if (!i) {
      parent.replaceChild(newNode, currentNode);
    } else {
      parent.removeChild(currentNode);
    }
  }
  return newNode;
}
