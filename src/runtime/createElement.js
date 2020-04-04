export const createElement = (tag, props) => {
  let __current_props = {};
  const element = document.createElement(tag);

  if (props) {
    updateProps(props);
  }

  return {
    element,
    type: Node,
    native: true,
    updateProps
  };

  function updateProps(newProps) {
    for (const name in newProps) {
      setProperty(element, name, newProps, __current_props);
    }
    __current_props = newProps;
  }
};

function setProperty(element, name, newProps, oldProps) {
  const value = newProps[name];
  let oldValue = oldProps[name];

  if (name === "key" || name === "children") {
  } else if (name === "style") {
    const s = element.style;

    if (typeof value == "string") {
      s.cssText = value;
    } else {
      if (typeof oldValue == "string") {
        s.cssText = "";
        oldValue = null;
      }

      setStyle(element, value);
    }
  } else if (name[0] === "o" && name[1] === "n") {
    let useCapture = name !== (name = name.replace(/Capture$/, ""));
    let eventName = normalizeEventName(
      name.toLowerCase().slice(2),
      element,
      newProps
    );

    if (value) {
      if (!oldValue) {
        element.addEventListener(eventName, eventProxy, useCapture);
      }
      (element._listeners || (element._listeners = {}))[eventName] = value;
    } else {
      element.removeEventListener(eventName, eventProxy, useCapture);
    }
  } else if (
    name !== "list" &&
    name !== "tagName" &&
    // HTMLButtonElement.form and HTMLInputElement.form are read-only but can be set using
    // setAttribute
    name !== "form" &&
    name !== "type" &&
    name !== "size" &&
    name in element
  ) {
    element[name] = value == null ? "" : value;
  } else if (typeof value != "function" && name !== "dangerouslySetInnerHTML") {
    if (name !== (name = name.replace(/^xlink:?/, ""))) {
      if (value == null || value === false) {
        element.removeAttributeNS(
          "http://www.w3.org/1999/xlink",
          name.toLowerCase()
        );
      } else {
        element.setAttributeNS(
          "http://www.w3.org/1999/xlink",
          name.toLowerCase(),
          value
        );
      }
    } else if (
      value == null ||
      (value === false &&
        // ARIA-attributes have a different notion of boolean values.
        // The value `false` is different from the attribute not
        // existing on the DOM, so we can't remove it. For non-boolean
        // ARIA-attributes we could treat false as a removal, but the
        // amount of exceptions would cost us too many bytes. On top of
        // that other VDOM frameworks also always stringify `false`.
        !/^ar/.test(name))
    ) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, value);
    }
  }
}

function setStyle(element, styles) {
  const _prevStyles = element._prevStyles || [];
  const elementStyle = element.style;

  Object.entries(styles).forEach(([key, style]) => {
    elementStyle[key] = style;
    const prevId = _prevStyles.indexOf(key);
    if (prevId !== -1) {
      _prevStyles.splice(prevId, 1);
    }
  });

  _prevStyles.forEach(key => {
    elementStyle[key] = null;
  });

  element._prevStyles = Object.keys(styles);
}

function eventProxy(e) {
  this._listeners[e.type](e);
}

function normalizeEventName(name, element, newProps) {
  if (name === "doubleclick") {
    return "dblclick";
  }

  const type = element.tagName.toLowerCase();
  const inputType = newProps["type"] || element.type;

  if (
    name === "change" &&
    (type === "textarea" ||
      (type === "input" && !/^fil|che|ra/i.test(inputType)))
  ) {
    return "input";
  }

  return name;
}
