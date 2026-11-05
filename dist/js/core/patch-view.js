// Keep existing nodes during live updates so focus and layout stay stable.
export function patchView(target, html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  function sync(parent, source) {
    const next = [...source.childNodes];
    next.forEach((node, index) => {
      const current = parent.childNodes[index];
      if (!current) {
        parent.append(node.cloneNode(true));
        return;
      }
      if (
        current.nodeType !== node.nodeType ||
        current.nodeName !== node.nodeName
      ) {
        current.replaceWith(node.cloneNode(true));
        return;
      }
      if (node.nodeType !== 1) {
        if (current.nodeValue !== node.nodeValue)
          current.nodeValue = node.nodeValue;
        return;
      }
      for (const attribute of [...current.attributes])
        if (!node.hasAttribute(attribute.name))
          current.removeAttribute(attribute.name);
      for (const attribute of node.attributes)
        if (current.getAttribute(attribute.name) !== attribute.value)
          current.setAttribute(attribute.name, attribute.value);
      sync(current, node);
    });
    while (parent.childNodes.length > next.length) parent.lastChild.remove();
  }
  sync(target, template.content);
}
