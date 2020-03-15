export function setProperty(element, name, value) {
  const _prevProps = element._prevProps || {};
  let oldValue = _prevProps[name];

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
    let nameLower = name.toLowerCase();
    name = (nameLower in element ? nameLower : name).slice(2);
    let eventName = normalizeEventName(name, element);

    if (value) {
      if (!oldValue) element.addEventListener(eventName, eventProxy, useCapture);
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
  }

  _prevProps[name] = value;
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

function normalizeEventName(name, element) {
  if (name === "doubleclick") {
    return "dblclick";
  }

  const type = element.tagName.toLowerCase();
  const inputType = element.type;

  if (
    name === "change" &&
    (type === "textarea" ||
      (type === "input" && !/^fil|che|ra/i.test(inputType)))
  ) {
    return "input";
  }

  return name;
}
