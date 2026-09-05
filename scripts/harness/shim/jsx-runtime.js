// tsc's react-jsx output imports jsx/jsxs/Fragment from react/jsx-runtime.
const React = window.React;
export const Fragment = React.Fragment;
function jsx(type, props, key) {
  const { children, ...rest } = props ?? {};
  if (key !== undefined) rest.key = key;
  return children === undefined ? React.createElement(type, rest) : React.createElement(type, rest, children);
}
export { jsx, jsx as jsxs, jsx as jsxDEV };
