export function css(element, styles) {
    const stylesToRemove = []
    const prevStyles = element.prevStyles || [];

    Object.entries(styles).forEach(([key, style]) => {
        element.style[key] = style;
        const prevId = prevStyles.indexOf(key);
        if (prevId !== -1) {
            prevStyles.splice(prevId, 1);
        }
    });

    prevStyles.forEach(key => {
        element.style[key] = null;
    })

    element.prevStyles = Object.keys(styles);
}
