export function css(element, styles) {
    const stylesToRemove = []
    const _prevStyles = element._prevStyles || [];

    Object.entries(styles).forEach(([key, style]) => {
        element.style[key] = style;
        const prevId = _prevStyles.indexOf(key);
        if (prevId !== -1) {
            _prevStyles.splice(prevId, 1);
        }
    });

    _prevStyles.forEach(key => {
        element.style[key] = null;
    })

    element._prevStyles = Object.keys(styles);
}
